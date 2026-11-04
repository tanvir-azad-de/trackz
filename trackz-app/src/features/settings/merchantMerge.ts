import type { Transaction } from "@/domain/transaction";
import { normalizeMerchant } from "@/domain/merchant";

/**
 * Phase 6 part 2: applying a merchant merge.
 *
 * PURE. No repository, no DOM, no side effects — it computes which rows
 * would change and returns them, so the whole decision is unit-testable
 * against the real CSV fixture. The caller (SettingsScreen) is the only
 * part that writes. Same split as exportImport.ts (tested) vs
 * SettingsScreen.tsx (thin, untested).
 *
 * WHAT A MERGE IS. The user picks a set of merchant spellings that mean
 * the same thing ("Edeka", "EDEKA") and one canonical name. Every
 * matching transaction's `merchant` becomes the canonical name; nothing
 * else about the row changes. In particular amountCents, categoryType
 * and cashflow are untouched — see the warning in domain/merchant.ts's
 * CategoryTypeBreakdown about why that matters for non_expense /
 * non_income / receivable / payable rows, where the amount is wholly or
 * partly not the user's own money and `merchant` names a person.
 *
 * WHY IDS DO NOT MOVE. domain/id.ts's contentDerivedTransactionId hashes
 * `merchant`, which makes it look as though renaming a merchant should
 * re-key the row and strand it in sync. It does not: content-derived ids
 * are minted only at CSV PARSE time. Rewriting merchant in the store
 * leaves tx.id alone, so a merge reaches other devices as N ordinary
 * edits through the last-writer-wins path verified live in Phase 15c.
 */

export interface MergePlan {
  /** The name every matched row will end up with. */
  canonical: string;
  /** Rows that will actually change, with `merchant` already rewritten. */
  changed: Transaction[];
  /**
   * Rows that matched the merge but already carry the canonical name, so
   * they need no write. Counted separately rather than folded into
   * `changed` so the UI can say "rename 11 rows" rather than
   * "rename 64", and so updateTransactions() isn't handed 53 no-op
   * writes that would each still bump updatedAt and sync.
   */
  unchangedCount: number;
}

/**
 * Compute the rewrite for merging `variants` into `canonical`.
 *
 * Matching is by EXACT STORED SPELLING (after trim), not by normalized
 * form. That is deliberate and is the safer of the two options: it means
 * the merge does exactly what the sheet showed the user, touching only
 * the spellings listed in front of them. Matching on normalized form
 * instead would silently pull in any other spelling that happens to
 * normalize the same way — including one created between the moment the
 * group was computed and the moment the user tapped Merge.
 *
 * Returns an empty plan when nothing needs changing, so the caller can
 * skip the write (and therefore the sync round trip) entirely.
 */
export function planMerge(
  transactions: Transaction[],
  variants: readonly string[],
  canonical: string,
): MergePlan {
  const target = canonical.trim();
  const wanted = new Set(variants.map((v) => v.trim()));

  const changed: Transaction[] = [];
  let unchangedCount = 0;

  for (const tx of transactions) {
    const current = tx.merchant.trim();
    if (!wanted.has(current)) continue;

    if (current === target) {
      unchangedCount++;
      continue;
    }
    changed.push({ ...tx, merchant: target });
  }

  return { canonical: target, changed, unchangedCount };
}

/**
 * Validate a merge before it can be applied. Returns null when the merge
 * is fine, or a human-readable reason it is not.
 *
 * The canonical name is NOT required to be one of the variants — the
 * user may type a cleaner spelling than any in their data (e.g. "Tedi"
 * when the stored spellings are "TEDi" and "TEDI"). But it must not be
 * blank, and it must not normalize to something different from the group
 * itself: renaming "Edeka"/"EDEKA" to "Aldi" is not a merge, it is a
 * mass reassignment to a DIFFERENT merchant, and silently allowing it
 * through a screen labelled "merge duplicates" would be the kind of
 * surprise this app's import flow already goes out of its way to avoid.
 */
export function validateMerge(
  variants: readonly string[],
  canonical: string,
): string | null {
  const target = canonical.trim();
  if (target === "") return "Enter a name to merge into.";
  if (normalizeMerchant(target) === "") {
    return "That name has no letters or numbers in it.";
  }
  if (variants.length < 2) return "Pick at least two spellings to merge.";

  const groupKeys = new Set(variants.map((v) => normalizeMerchant(v)));
  if (groupKeys.size > 1) {
    // A manual merge legitimately spans different normalized forms
    // ("Niemerszein" vs "NIEMERSZEIN & CO.KG"), so this is not an error
    // by itself — but the canonical name must match ONE of them, not be
    // a third unrelated name.
    if (!groupKeys.has(normalizeMerchant(target))) {
      return `"${target}" doesn't match any of the selected spellings.`;
    }
    return null;
  }

  const [only] = [...groupKeys];
  if (normalizeMerchant(target) !== only) {
    return `"${target}" is a different merchant, not a spelling of this one.`;
  }
  return null;
}
