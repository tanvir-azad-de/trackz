import type { Account, Category, Merchant, Transaction } from "@/domain/transaction";
import { daysBetween } from "@/domain/dates";

/**
 * Orders the entry form's Category / Merchant / Account dropdowns by
 * recency-weighted frequency, most-used first (user decision 2026-11-10,
 * docs/renovation_version_1.txt section 5 "ENTRY FORM REWORK"). Pure — the
 * caller passes the live (non-tombstoned) transaction list.
 *
 * Score per name = sum of 0.5^(ageDays / HALF_LIFE_DAYS) over every
 * transaction carrying it. The half-life is the one the removed recall
 * chips used.
 *
 * Deliberately NO time window, unlike the old recall.ts's 90 days: a chip
 * row could drop stale combos, but a dropdown that hid a name unused for 90
 * days would push the user straight back into "+ New…" and re-create the
 * near-duplicate this whole change exists to prevent. Old names sort last;
 * they never disappear.
 */
const HALF_LIFE_DAYS = 21;

function rankBy(transactions: readonly Transaction[], asOfDate: string, namesOf: (tx: Transaction) => string[]): string[] {
  const stats = new Map<string, { score: number; count: number }>();
  for (const tx of transactions) {
    // Clamped at 0: a future-dated row (rare, but the date picker allows
    // it) would otherwise weigh MORE than today's, outranking real habits.
    const ageDays = Math.max(0, daysBetween(tx.date, asOfDate));
    const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    for (const name of namesOf(tx)) {
      if (name === "") continue;
      const s = stats.get(name) ?? { score: 0, count: 0 };
      s.score += weight;
      s.count += 1;
      stats.set(name, s);
    }
  }
  return [...stats.entries()]
    .sort(([an, a], [bn, b]) => b.score - a.score || b.count - a.count || an.localeCompare(bn))
    .map(([name]) => name);
}

/** Source AND destination both count — a transfer target is an account you use. */
export function rankAccounts(transactions: readonly Transaction[], asOfDate: string): Account[] {
  return rankBy(transactions, asOfDate, (tx) => [tx.account, tx.destinationAccount]).map((name) => ({ name }));
}

/** Trimmed, matching deriveCategories, so " Groceries" isn't a second entry. */
export function rankCategories(transactions: readonly Transaction[], asOfDate: string): Category[] {
  return rankBy(transactions, asOfDate, (tx) => [tx.category.trim()]).map((name) => ({ name }));
}

export function rankMerchants(transactions: readonly Transaction[], asOfDate: string): Merchant[] {
  return rankBy(transactions, asOfDate, (tx) => [tx.merchant.trim()]).map((name) => ({ name }));
}

/**
 * The names a picker <select> shows. A current value that is NOT in the
 * ranked list (a remembered merchant since merged away, an account only on
 * deleted rows) is prepended, so the select displays it rather than
 * silently falling back to the first option — a <select> whose value
 * matches no <option> shows option 0 and would quietly re-assign the field
 * on the next change event.
 */
export function pickerNames(current: string, ranked: readonly string[]): string[] {
  const value = current.trim();
  return value !== "" && !ranked.includes(value) ? [value, ...ranked] : [...ranked];
}
