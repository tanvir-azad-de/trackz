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

export function deriveCategories(transactions: Transaction[]): Category[] {
  const byName = new Map<string, Category>();
  for (const tx of transactions) {
    if (!byName.has(tx.category)) {
      byName.set(tx.category, { name: tx.category, categoryType: tx.categoryType });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
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
