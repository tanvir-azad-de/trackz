import type { CategoryType, CategoryTypeBreakdown, Transaction } from "@/domain/transaction";
import type { Cents } from "@/domain/money";

/**
 * Summaries of every distinct category or merchant name, for Settings'
 * Categories / Merchants list sheets (NamesSheet.tsx).
 *
 * Was nameRename.ts until 2026-11-11, when rename/merge was removed (user
 * decision); only the summary half remains. PURE: no repository, no DOM.
 */

/** The transaction field being summarized. Both are plain names on the row. */
export type NameField = "category" | "merchant";

/** A category or merchant as the list sheet shows it: a name plus what its rows look like. */
export interface NameSummary {
  name: string;
  /** Live (non-tombstoned) rows carrying this name. */
  rowCount: number;
  /** Sum of amountCents across those rows. Unsigned — see categoryTypes for direction. */
  totalCents: Cents;
  /**
   * Row counts per category type (domain/transaction.ts's shared shape).
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

/**
 * Summarize every distinct name in `field`, for the list sheet.
 *
 * Names are TRIMMED and grouped on the trimmed value, matching
 * storage/derive.ts's deriveCategories — otherwise a stray-whitespace
 * twin would appear as its own row here. Blank names are skipped: a row
 * with no merchant (every transfer, and some spending) has no name to list.
 */
export function summarizeNames(transactions: Transaction[], field: NameField): NameSummary[] {
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
