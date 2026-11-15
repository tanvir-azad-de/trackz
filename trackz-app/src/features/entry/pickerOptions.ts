import type { Account, Category, Merchant, Transaction } from "@/domain/transaction";

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

export function pickerMerchants(transactions: readonly Transaction[]): Merchant[] {
  return sortedNames(transactions, (tx) => [tx.merchant.trim()]).map((name) => ({ name }));
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
