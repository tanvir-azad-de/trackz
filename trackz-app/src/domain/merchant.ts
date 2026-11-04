import type { CategoryType, Transaction } from "./transaction";

/**
 * Phase 6: merchant normalization and duplicate detection.
 *
 * The `merchant` field (renamed from the old model's `subcategory`) is
 * free text, and in the real 1,456-row backup it is a graveyard of
 * case variants: "Edeka"/"EDEKA", "Rossmann"/"ROSSMANN",
 * "Tedi"/"TEDi", and one raw bank string ("SPC*Indian Wholesales"
 * alongside a hand-typed "Spc Indian Wholesales").
 *
 * This module only FINDS duplicate groups. It does not rewrite
 * anything: per the locked renovation decisions, every merge is an
 * explicit user confirmation, nothing is auto-merged silently.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO — read before "improving" it.
 * An obvious-looking extension is to also group by first token, which
 * would catch "Niemerszein" / "NIEMERSZEIN & CO.KG" and "Kaufland" /
 * "KAUFLAND HAMBURG BRAMF". It was measured against the real data and
 * REJECTED, because the same rule also proposes three merges that
 * destroy a distinction the user deliberately encoded:
 *
 *   - "Vodafone"           -> Mobile / expense      (12 rows)
 *     "Vodafone Frankfurt" -> WiFi   / non_expense  (13 rows)
 *   - "DM"                 -> Shopping              (8 rows)
 *     "dm drogerie"        -> Groceries             (1 row)
 *   - "Amazon"             -> Shopping + Refunds    (54 rows)
 *     "Amazon Prime"       -> Subscriptions         (8 rows)
 *
 * A suggestion list the user must police for wrong entries is worse
 * than a shorter list they can trust, so the rule here is equality of
 * normalized form only. Niemerszein and Kaufland are real missed wins
 * and are meant to be handled by an explicit manual merge (the user
 * names both sides), not by a heuristic that also breaks Vodafone.
 * There are regression tests asserting those three pairs stay SEPARATE.
 */

/**
 * Fold a merchant name to a comparison key: names sharing a key are
 * considered the same merchant spelled differently.
 *
 * Trim -> casefold -> strip accents -> discard every non-alphanumeric.
 *
 * ORDER IS LOAD-BEARING. Accents must be decomposed and their combining
 * marks removed BEFORE the non-alphanumeric filter runs. Reversed (or
 * with the NFD step omitted), the filter eats the combining mark but
 * leaves the stripped base letter, so "Café" folds to "caf" rather than
 * "cafe" and "Müller" to "mller" rather than "muller" — which both
 * splits a merchant from its unaccented spelling and merges it with any
 * unrelated "Caf…" name. Confirmed there are ZERO non-ASCII merchant
 * names in the real data today, so this guards a latent bug rather than
 * a current one; merchants are hand-typed free text, so it is a matter
 * of time rather than hypothetical.
 *
 * NOT the same function as features/activity/filter.ts's
 * normalizeForSearch, and deliberately not merged with it. The first two
 * steps are identical, but that one must KEEP spaces and punctuation
 * because it powers substring search (typing "indian whole" has to match
 * "SPC*Indian Wholesales"), whereas this one must DISCARD them because
 * it tests whole-string equality. Collapsing them would break one of the
 * two callers.
 */
export function normalizeMerchant(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** One spelling of a merchant, with how many transactions use it. */
export interface MerchantVariant {
  name: string; // exactly as stored, original case and punctuation
  rowCount: number;
}

/**
 * How many rows of each category type a merge would touch.
 *
 * SURFACED IN THE UI ON PURPOSE, not debug data. The `merchant` field
 * does double duty in this dataset: for ordinary expense rows it is a
 * shop ("Edeka"), but for non_expense / non_income / receivable /
 * payable rows it is a COUNTERPARTY — a person. Confirmed with the user:
 * non_expense means "this money left my account but the whole amount is
 * not my expense" (e.g. a loan to a friend, or a bill partly reimbursed
 * by someone else), and non_income is its mirror. In the real data those
 * rows carry names like "Alif Elahi" and "Chayan Mitra", and
 * insights/engine.ts groups Lent out / I owe BY MERCHANT.
 *
 * So a merge of two counterparty spellings is usually RIGHT (same
 * person), but it moves money between people in a view the user cares
 * about, and it is not the same kind of decision as tidying two
 * spellings of a supermarket. The merge sheet therefore shows this
 * breakdown instead of presenting every group as interchangeable.
 */
export type CategoryTypeBreakdown = Partial<Record<CategoryType, number>>;

/** A set of merchant spellings that normalize to the same key. */
export interface MergeGroup {
  /** The shared normalized key (see normalizeMerchant). */
  normalized: string;
  /** Every distinct spelling found, most-used first. */
  variants: MerchantVariant[];
  /** Which spelling to offer as the merged name — a suggestion, not a decision. */
  suggestedCanonical: string;
  /** Transactions affected if this group is merged. */
  totalRows: number;
  /** Row counts per category type across the whole group (see CategoryTypeBreakdown). */
  categoryTypes: CategoryTypeBreakdown;
  /**
   * True when the group touches any row whose amount is not a plain
   * expense/income — i.e. non_expense, non_income, receivable or
   * payable. These are the rows where `merchant` is a counterparty and
   * where part or all of the amount is someone else's money, so the UI
   * warns before merging rather than treating it as cosmetic tidying.
   */
  touchesCounterpartyRows: boolean;
}

/**
 * Category types whose `merchant` field holds a counterparty (a person),
 * not a shop — and whose amounts are wholly or partly not the user's own
 * expense/income. See CategoryTypeBreakdown for the full reasoning.
 */
const COUNTERPARTY_TYPES: readonly CategoryType[] = [
  "non_expense",
  "non_income",
  "receivable",
  "payable",
];

/**
 * Pick the spelling to suggest as canonical.
 *
 * Most-used wins ("Edeka" 53 beats "EDEKA" 11) — that is the spelling
 * the user themselves typed most often.
 *
 * THE TIE-BREAK IS NOT DECORATION. Group 7 in the real data is a
 * genuine 1-vs-1 tie ("Spc Indian Wholesales" 1 / "SPC*Indian
 * Wholesales" 1). With no explicit rule the result would fall out of
 * Map insertion order, i.e. CSV row order, making this function's
 * output unstable and its tests order-dependent. So ties prefer:
 *   1. a name with no punctuation — raw bank strings carry "*", "&",
 *      and a leading one actively wins a plain localeCompare, which is
 *      the wrong answer ("*Aldi" would beat "Aldi"),
 *   2. lexicographic, purely so the outcome is deterministic.
 *
 * There is deliberately NO all-caps rule, though an earlier draft had
 * one. Mutation testing showed it was dead code: because names in a
 * group differ only by case and punctuation, localeCompare ALREADY
 * ranks "Edeka" before "EDEKA" and "Aldi" before "ALDI" in every
 * pure-case pair. Keeping it would have implied a decision this
 * function does not actually make.
 */
function pickCanonical(variants: MerchantVariant[]): string {
  const ranked = [...variants].sort((a, b) => {
    if (a.rowCount !== b.rowCount) return b.rowCount - a.rowCount;

    const aPunct = /[^a-zA-Z0-9\s]/.test(a.name);
    const bPunct = /[^a-zA-Z0-9\s]/.test(b.name);
    if (aPunct !== bPunct) return aPunct ? 1 : -1;

    return a.name.localeCompare(b.name);
  });

  // Non-null: callers only ever build groups from a non-empty variant list.
  return ranked[0]!.name;
}

/**
 * Find every set of merchant spellings that differ only by case,
 * spacing, or punctuation.
 *
 * Returns only genuine groups (2+ distinct spellings), largest first by
 * affected row count, so the caller shows the highest-impact merge
 * first.
 *
 * BLANK MERCHANTS ARE SKIPPED, not grouped. 265 rows in the real data
 * have no merchant (130 Transfer, 124 Restaurant) — blank is a
 * legitimate value for a transaction with no counterparty, not a
 * misspelling of another name. Grouping them would offer to "merge" a
 * fifth of the ledger into one invented merchant. A name consisting
 * ONLY of punctuation normalizes to "" too, and is skipped by the same
 * check rather than being silently lumped in with true blanks.
 */
export function findMergeGroups(transactions: Transaction[]): MergeGroup[] {
  // normalized key -> original spelling -> row count
  const byKey = new Map<string, Map<string, number>>();
  // normalized key -> category type -> row count
  const typesByKey = new Map<string, Map<CategoryType, number>>();

  for (const tx of transactions) {
    const name = tx.merchant.trim();

    // ONE guard, not two. A separate `name === ""` check above this was
    // removed after mutation testing showed it was unreachable-by-
    // consequence: normalizeMerchant("") is "", so this check already
    // covers blank and whitespace-only names as well as names made
    // entirely of punctuation.
    const key = normalizeMerchant(name);
    if (key === "") continue;

    let spellings = byKey.get(key);
    if (!spellings) {
      spellings = new Map<string, number>();
      byKey.set(key, spellings);
    }
    spellings.set(name, (spellings.get(name) ?? 0) + 1);

    let types = typesByKey.get(key);
    if (!types) {
      types = new Map<CategoryType, number>();
      typesByKey.set(key, types);
    }
    types.set(tx.categoryType, (types.get(tx.categoryType) ?? 0) + 1);
  }

  const groups: MergeGroup[] = [];

  for (const [normalized, spellings] of byKey) {
    if (spellings.size < 2) continue;

    const variants: MerchantVariant[] = [...spellings.entries()]
      .map(([name, rowCount]) => ({ name, rowCount }))
      .sort((a, b) => (a.rowCount !== b.rowCount ? b.rowCount - a.rowCount : a.name.localeCompare(b.name)));

    const types = typesByKey.get(normalized) ?? new Map<CategoryType, number>();
    const categoryTypes: CategoryTypeBreakdown = {};
    for (const [type, count] of types) categoryTypes[type] = count;

    groups.push({
      normalized,
      variants,
      suggestedCanonical: pickCanonical(variants),
      totalRows: variants.reduce((sum, v) => sum + v.rowCount, 0),
      categoryTypes,
      touchesCounterpartyRows: COUNTERPARTY_TYPES.some((t) => (categoryTypes[t] ?? 0) > 0),
    });
  }

  return groups.sort((a, b) =>
    a.totalRows !== b.totalRows ? b.totalRows - a.totalRows : a.normalized.localeCompare(b.normalized),
  );
}
