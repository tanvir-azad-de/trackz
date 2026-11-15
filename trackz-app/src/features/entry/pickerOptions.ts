import { usesCategory } from "@/domain/transaction";
import type { Account, Category, CategoryType, Transaction } from "@/domain/transaction";

/**
 * The option lists for the entry form's dropdowns, ALPHABETICAL (user
 * decision 2026-11-15, superseding the 2026-11-10 recency-weighted
 * most-used-first ranking). Pure — the caller passes the live
 * (non-tombstoned) transaction list.
 *
 * Every name ever used is listed; there is no time window, because a
 * dropdown that hid an old name would push the user into "+ New…" and
 * re-create the near-duplicate the pickers exist to prevent.
 */

/**
 * localeCompare, not the default .sort(): the default compares UTF-16 code
 * units, which puts every uppercase name before every lowercase one
 * ("Zara" above "edeka") and "Ä" after "z".
 */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b);
}

function sortedNames(transactions: readonly Transaction[], namesOf: (tx: Transaction) => string[]): string[] {
  const names = new Set<string>();
  for (const tx of transactions) {
    for (const name of namesOf(tx)) {
      if (name !== "") names.add(name);
    }
  }
  return [...names].sort(compareNames);
}

/** Source AND destination both count — a transfer target is an account you use. */
export function pickerAccounts(transactions: readonly Transaction[]): Account[] {
  return sortedNames(transactions, (tx) => [tx.account, tx.destinationAccount]).map((name) => ({ name }));
}

/** Trimmed, matching deriveCategories, so " Groceries" isn't a second entry. */
export function pickerCategories(transactions: readonly Transaction[]): Category[] {
  return sortedNames(transactions, (tx) => [tx.category.trim()]).map((name) => ({ name }));
}

/**
 * The merchant dropdown's options, scoped to the draft's category (user
 * decision 2026-11-15): picking Shopping lists only names used on earlier
 * Shopping rows. Derived from the rows each time, never stored. A
 * "Shopping>Tedi" prefix in the data was rejected, because one name
 * legitimately spans categories and a prefix would split one person into
 * several on the Lent out / I owe screens. See merchantsFor.
 */
export interface MerchantOptions {
  /** Trimmed category name → its merchants, alphabetical. */
  byCategory: ReadonlyMap<string, readonly string[]>;
  /** Merchants on receivable/payable rows: the people, for Lent out / I owe. */
  counterparties: readonly string[];
  all: readonly string[];
}

export function pickerMerchants(transactions: readonly Transaction[]): MerchantOptions {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const category = tx.category.trim();
    if (category === "") continue;
    const group = groups.get(category);
    if (group) group.push(tx);
    else groups.set(category, [tx]);
  }
  const merchantOf = (tx: Transaction) => [tx.merchant.trim()];
  const byCategory = new Map<string, readonly string[]>();
  for (const [category, rows] of groups) byCategory.set(category, sortedNames(rows, merchantOf));
  return {
    byCategory,
    counterparties: sortedNames(
      transactions.filter((tx) => tx.categoryType === "receivable" || tx.categoryType === "payable"),
      merchantOf,
    ),
    all: sortedNames(transactions, merchantOf),
  };
}

/**
 * The names the Merchant picker shows for this draft. Matches on category
 * alone, not category + type: a Shopping refund (non_income) is still a
 * Shopping merchant. Lent out / I owe rows carry a blank category
 * (usesCategory), so they get the people from earlier rows of those two
 * types instead. No category chosen yet means no filter. A new category has no history, so it gets an empty
 * list and the name is typed via "+ New".
 */
export function merchantsFor(options: MerchantOptions, category: string, categoryType: CategoryType): readonly string[] {
  if (!usesCategory(categoryType)) return categoryType === "transfer" ? [] : options.counterparties;
  const key = category.trim();
  if (key === "") return options.all;
  return options.byCategory.get(key) ?? [];
}

/**
 * The merchant to keep when the draft's category or type changes: the
 * same one if the new list offers it, else blank (user decision
 * 2026-11-15). Keeping it whatever happened let a Tedi chosen under
 * Shopping be saved under Subscriptions. Clearing it every time would
 * drop a name that is valid in both, such as a person under two
 * categories. Only the form's category/type handlers call this, never on
 * open, so an edited row keeps its merchant until the user changes one of
 * those two fields.
 */
export function merchantInScope(
  merchant: string,
  options: MerchantOptions,
  category: string,
  categoryType: CategoryType,
): string {
  return merchantsFor(options, category, categoryType).includes(merchant.trim()) ? merchant : "";
}

/**
 * The names a picker <select> shows. A current value that is NOT in the
 * list (a remembered merchant whose rows were deleted, an account only on
 * deleted rows) is inserted in its alphabetical place, so the select
 * displays it rather than silently falling back to the first option — a
 * <select> whose value matches no <option> shows option 0 and would
 * quietly re-assign the field on the next change event.
 */
export function pickerNames(current: string, names: readonly string[]): string[] {
  const value = current.trim();
  return value !== "" && !names.includes(value) ? [...names, value].sort(compareNames) : [...names];
}

/**
 * A fixed enum (category type, account type) ordered by its VISIBLE label,
 * not its key — "I owe" is `payable`, so sorting keys would misplace it.
 * Sorts a copy: CATEGORY_TYPES' own order is relied on elsewhere.
 */
export function sortedByLabel<T>(values: readonly T[], label: (value: T) => string): T[] {
  return [...values].sort((a, b) => compareNames(label(a), label(b)));
}
