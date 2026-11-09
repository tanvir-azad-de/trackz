import type { Account, Category, Merchant, Transaction } from "@/domain/transaction";
import { getSignedAmountCents } from "@/domain/transaction";
import type { Cents } from "@/domain/money";
import { addCents } from "@/domain/money";

/**
 * Accounts, categories, and merchants are NEVER persisted on their own —
 * confirmed with the user (Phase 0) that the CSV transaction list is the
 * single source of truth and there is no opening-balance feature in use.
 * These are pure derivations, recomputed from the transaction list.
 */

export function deriveAccounts(transactions: Transaction[]): Account[] {
  const names = new Set<string>();
  for (const tx of transactions) {
    names.add(tx.account);
    if (tx.destinationAccount) names.add(tx.destinationAccount);
  }
  return [...names].sort().map((name) => ({ name }));
}

/**
 * Distinct category names, deduped and sorted.
 *
 * Returns NAMES ONLY. A category has no single categoryType — that lives
 * on each transaction, and one name legitimately carries several types
 * (real data: WiFi, Shopping). See domain/transaction.ts's Category doc
 * for the evidence and for why the legacy per-category pin was wrong.
 *
 * This used to return { name, categoryType } and set the type from the
 * FIRST transaction carrying each name. That was lossy in a way nothing
 * surfaced: array order decided which of WiFi's two real types won, and
 * the discarded one vanished. Dedup-by-name is now correct rather than
 * lossy. Note the COUNT does not move (36 names either way, 39 distinct
 * (name, type) pairs) — what changes is that the returned type is no
 * longer an arbitrary pick presented as fact.
 *
 * TRIMMED, because features/entry/draft.ts trims `category` on write
 * while this keyed the raw value — so an imported row with a stray
 * trailing space would show up here as a SECOND category identical to
 * the eye. Blank names are skipped: csv.ts rejects them at parse time
 * and draft.ts's validation requires one, so a blank is not a legitimate
 * category the way a blank merchant is a legitimate "no counterparty".
 */
export function deriveCategories(transactions: Transaction[]): Category[] {
  const names = new Set<string>();
  for (const tx of transactions) {
    const name = tx.category.trim();
    if (name !== "") names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));
}

export function deriveMerchants(transactions: Transaction[]): Merchant[] {
  const names = new Set<string>();
  for (const tx of transactions) {
    if (tx.merchant) names.add(tx.merchant);
  }
  return [...names].sort().map((name) => ({ name }));
}

/** Current balance for one account, starting from 0 (no opening balance concept). */
export function getAccountBalance(transactions: Transaction[], accountName: string): Cents {
  return addCents(...transactions.map((tx) => getSignedAmountCents(tx, { kind: "account", name: accountName })));
}

export function getAllAccountBalances(transactions: Transaction[]): Record<string, Cents> {
  const accounts = deriveAccounts(transactions);
  const result: Record<string, Cents> = {};
  for (const acc of accounts) {
    result[acc.name] = getAccountBalance(transactions, acc.name);
  }
  return result;
}

/** Sum of amountCents grouped by "categoryType|category", for verification/testing. */
export function getCategoryTotals(transactions: Transaction[]): Record<string, Cents> {
  const totals: Record<string, Cents> = {};
  for (const tx of transactions) {
    const key = `${tx.categoryType}|${tx.category}`;
    totals[key] = (totals[key] ?? 0) + tx.amountCents;
  }
  return totals;
}
