import type { CategoryType, Transaction } from "@/domain/transaction";
import type { CategoryTypeBreakdown } from "@/domain/merchant";
import type { Cents } from "@/domain/money";

/**
 * Phase 13b: renaming a category, which also merges when the target name
 * already exists. Generalized 2026-11-11 to merchants too (user request:
 * a Merchants sheet that works exactly like Categories), so every function
 * takes the `field` it renames. Everything below written about categories
 * holds for merchants, with two differences worth knowing:
 *   - merchants DO have spelling duplicates; those are the job of
 *     merchantMerge.ts ("Tidy up Merchants"), which auto-detects groups
 *     and guards against renaming into a different merchant. This rename
 *     has no such guard, the same deliberate choice as for categories.
 *   - on non_expense / non_income / receivable / payable rows the merchant
 *     names a PERSON, so renaming one renames that person on Lent out /
 *     I owe, and renaming into another person's name merges their
 *     balances. Shown in the same list, with no distinction (user call).
 *
 * PURE. No repository, no DOM, no side effects — it computes which rows
 * would change and returns them, so the whole decision is unit-testable
 * against the real CSV fixture. The caller (SettingsScreen) is the only
 * part that writes. Same split as exportImport.ts / merchantMerge.ts
 * (tested) vs SettingsScreen.tsx (thin, untested).
 *
 * ONE OPERATION, NOT TWO. "Rename" and "merge" are the same write: every
 * matching row's `category` becomes the new name. If that name already
 * exists the two collapse into one category; if it does not, the category
 * is simply renamed. There is no separate delete, and that is not an
 * omission — Phase 0 locked categories as DERIVED from transactions, so a
 * category with no rows cannot exist to be deleted, and deleting one that
 * has rows means moving those rows somewhere. That IS this operation.
 *
 * WHY THERE IS NO "DIFFERENT CATEGORY" GUARD, unlike merchantMerge.ts.
 * validateMerge() blocks renaming "Edeka"/"EDEKA" -> "Aldi" because that
 * is a mass reassignment dressed up as a spelling fix. The equivalent
 * guard here would block the ONLY thing this feature was asked for: the
 * real data has ZERO case- or punctuation-duplicate category names (all
 * 36 are distinct even normalized, unlike merchants' 7 duplicate groups),
 * so every genuine category tidy-up is a semantic one — "Dining" (1 row,
 * Papa Johns) into "Restaurant" (144), "Fees" (1 row, a bank
 * fee) into "Bank Charges" (7, which holds that same monthly charge).
 * A normalized-equality guard would reject both. Instead of guessing
 * which reassignments are legitimate, the UI states the exact
 * consequence ("moves 1 row into Restaurant, which has 144") and the
 * user confirms.
 *
 * WHAT A RENAME DOES NOT CHANGE: amountCents, categoryType, cashflow,
 * merchant, date, account. In particular categoryType is untouched, so a
 * rename cannot turn spending into non-spending. A rename that merges
 * into a name with a different type mix is still legitimate (both of the
 * user's real renames are expense -> expense), but the sheet shows the
 * resulting breakdown so a type-mixing merge is visible rather than
 * silent.
 *
 * WHY IDS DO NOT MOVE. domain/id.ts's contentDerivedTransactionId hashes
 * `category`, which makes it look as though renaming should re-key the
 * row and strand it in sync. It does not: content-derived ids are minted
 * only at CSV PARSE time. Rewriting category in the store leaves tx.id
 * alone, so a rename reaches other devices as N ordinary edits through
 * the last-writer-wins path verified live in Phase 15c. The flip side,
 * identical to the merchant merge's: re-importing the ORIGINAL CSV after
 * a rename REVERTS it, because those ids derive from the original
 * category strings and still match. A V3 export taken AFTER renaming
 * round-trips correctly. The import preview says so.
 */

/** The transaction field a rename rewrites. Both are plain names on the row. */
export type RenameField = "category" | "merchant";

/** A category or merchant as the editor sees it: a name plus what its rows look like. */
export interface NameSummary {
  name: string;
  /** Live (non-tombstoned) rows carrying this name. */
  rowCount: number;
  /** Sum of amountCents across those rows. Unsigned — see categoryTypes for direction. */
  totalCents: Cents;
  /**
   * Row counts per category type. Reuses merchant.ts's breakdown shape so
   * the UI can render it with the same component the merchant merge sheet
   * already uses, rather than inventing a second representation.
   */
  categoryTypes: CategoryTypeBreakdown;
  /**
   * True when this name carries more than one category type. Shown as
   * information, NOT as a problem to fix: in the real data both such
   * names are legitimate (WiFi spans a shared flat contract and a later
   * sole one; Shopping spans a purchase, a partly-reimbursed purchase and
   * a refund). See domain/transaction.ts's Category doc.
   */
  hasMixedTypes: boolean;
}

/** The rewrite a rename would perform. */
export interface RenamePlan {
  /** The name every matched row will end up with. */
  canonical: string;
  /** Rows that will actually change, with the renamed field already rewritten. */
  changed: Transaction[];
  /**
   * Rows that already carry the target name — i.e. the rows this rename
   * is merging INTO. Counted, never rewritten: handing them to
   * updateTransactions() would bump updatedAt and sync every one of them
   * for no change. Merging "Dining" into "Restaurant" writes 1 row, not
   * 145.
   */
  mergedIntoCount: number;
  /** True when the target name already exists, i.e. this is a merge rather than a pure rename. */
  isMerge: boolean;
}

/**
 * Summarize every distinct name in `field`, for the editor's list.
 *
 * Names are TRIMMED and grouped on the trimmed value, matching
 * storage/derive.ts's deriveCategories — otherwise a stray-whitespace
 * twin would appear as its own row here and be un-mergeable. Blank names
 * are skipped: a row with no merchant (every transfer, and some spending)
 * has nothing to rename.
 */
export function summarizeNames(transactions: Transaction[], field: RenameField): NameSummary[] {
  const byName = new Map<string, { rowCount: number; totalCents: Cents; types: Map<CategoryType, number> }>();

  for (const tx of transactions) {
    const name = tx[field].trim();
    if (name === "") continue;

    let entry = byName.get(name);
    if (!entry) {
      entry = { rowCount: 0, totalCents: 0, types: new Map() };
      byName.set(name, entry);
    }
    entry.rowCount++;
    entry.totalCents += tx.amountCents;
    entry.types.set(tx.categoryType, (entry.types.get(tx.categoryType) ?? 0) + 1);
  }

  return [...byName.entries()]
    .map(([name, entry]) => {
      const categoryTypes: CategoryTypeBreakdown = {};
      for (const [type, count] of entry.types) categoryTypes[type] = count;
      return {
        name,
        rowCount: entry.rowCount,
        totalCents: entry.totalCents,
        categoryTypes,
        hasMixedTypes: entry.types.size > 1,
      };
    })
    .sort((a, b) => b.rowCount - a.rowCount || a.name.localeCompare(b.name));
}

/**
 * Compute the rewrite for renaming `from` to `to`.
 *
 * Matching is by EXACT STORED SPELLING (after trim), the same choice
 * merchantMerge.planMerge makes and for the same reason: it does exactly
 * what the sheet showed the user, and cannot silently pull in a spelling
 * created between the list being computed and the user tapping Rename.
 *
 * Returns an empty `changed` when nothing needs rewriting, so the caller
 * can skip the write — and therefore the sync round trip — entirely.
 */
export function planRename(
  transactions: Transaction[],
  field: RenameField,
  from: string,
  to: string,
): RenamePlan {
  const source = from.trim();
  const target = to.trim();

  const changed: Transaction[] = [];
  let mergedIntoCount = 0;

  for (const tx of transactions) {
    const current = tx[field].trim();
    if (current === target) {
      mergedIntoCount++;
      continue;
    }
    if (current !== source) continue;
    changed.push({ ...tx, [field]: target });
  }

  return {
    canonical: target,
    changed,
    mergedIntoCount,
    isMerge: mergedIntoCount > 0,
  };
}

/**
 * Validate a rename before it can be applied. Returns null when it is
 * fine, or a human-readable reason it is not.
 *
 * Deliberately permissive about the TARGET — it may be an existing
 * name (that is a merge) or a brand-new one, and it need not
 * resemble the source (see this module's header for why). What it
 * rejects is a rename that cannot mean anything:
 *   - a blank target, or one with no letters or numbers at all
 *   - a target identical to the source, which would write nothing
 *   - a source that does not exist, which would silently no-op
 *
 * The no-op cases are errors rather than silent successes because a
 * screen that reports "renamed" having written nothing is the kind of
 * broken promise Phase 15c's import bug already taught this codebase to
 * avoid.
 */
export function validateRename(
  transactions: Transaction[],
  field: RenameField,
  from: string,
  to: string,
): string | null {
  const source = from.trim();
  const target = to.trim();

  if (target === "") return "Enter a name.";
  if (!/[\p{L}\p{N}]/u.test(target)) return "That name has no letters or numbers in it.";
  if (target === source) return "That's already the name.";

  const sourceExists = transactions.some((tx) => tx[field].trim() === source);
  if (!sourceExists) return `No transactions are in "${source}".`;

  return null;
}
