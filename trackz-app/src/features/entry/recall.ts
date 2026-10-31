import type { Transaction, CategoryType, Cashflow } from "@/domain/transaction";
import { daysBetween } from "@/domain/dates";

/**
 * Ranks (category, merchant, account[, destinationAccount]) combos by
 * recency-weighted frequency so the quick-entry sheet (Phase 8) can surface
 * "tap to re-log this" chips. Pure function — no DOM, no localStorage,
 * callers pass the transaction list (same convention as insights/engine.ts).
 *
 * Score = sum of exp(-ln2 * ageDays / HALF_LIFE_DAYS) over every matching
 * transaction within WINDOW_DAYS of `asOfDate`. A combo used today scores
 * 1 per use; one used HALF_LIFE_DAYS ago scores 0.5 per use; anything
 * outside the window scores 0 and is dropped entirely, so a combo you
 * stopped using (e.g. 18 months ago) never resurfaces just because it was
 * frequent once.
 *
 * Verified against the real CSV (dummyData/snapshot-2026-10-31): in the
 * last 90 days before 2026-10-17 (the latest date in that file), the top
 * combo is Shopping/Amazon/REVO — 15 occurrences, most recently 4 days
 * before "today". Groceries/Edeka/ADVZ has more raw occurrences (31) but
 * its most recent use was 18 days before "today", so it ranks 2nd: this is
 * recency-WEIGHTED frequency, not raw frequency, by design (see
 * HALF_LIFE_DAYS below) — a habit you did a lot of a few weeks ago but
 * haven't touched since should rank behind one you're doing right now.
 */

const WINDOW_DAYS = 90;
const HALF_LIFE_DAYS = 21;

export interface RecallCombo {
  key: string; // stable identity for the combo, also usable as a React/Preact list key
  categoryType: CategoryType;
  category: string;
  merchant: string;
  account: string;
  destinationAccount: string; // only non-empty for transfers
  cashflow: Cashflow;
  count: number; // occurrences within the window
  lastUsedDate: string; // ISODate, most recent occurrence within the window
  medianAmountCents: number; // shown on the chip as a hint, e.g. "~12,40 €"
  score: number;
}

function comboKey(tx: Transaction): string {
  return [tx.categoryType, tx.category, tx.merchant, tx.account, tx.destinationAccount].join("|");
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? Math.round((sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2) : sortedAsc[mid]!;
}

interface Accumulator {
  categoryType: CategoryType;
  category: string;
  merchant: string;
  account: string;
  destinationAccount: string;
  cashflow: Cashflow;
  count: number;
  lastUsedDate: string;
  amounts: number[];
  score: number;
}

/**
 * Top-ranked recall combos as of `asOfDate` (defaults to the latest
 * transaction date so this is deterministic under test; callers in the UI
 * pass getLocalToday()).
 */
export function getRecallCombos(transactions: Transaction[], asOfDate: string, limit = 6): RecallCombo[] {
  const byKey = new Map<string, Accumulator>();

  for (const tx of transactions) {
    const ageDays = daysBetween(tx.date, asOfDate);
    if (ageDays < 0 || ageDays > WINDOW_DAYS) continue;

    const key = comboKey(tx);
    const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);

    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        categoryType: tx.categoryType,
        category: tx.category,
        merchant: tx.merchant,
        account: tx.account,
        destinationAccount: tx.destinationAccount,
        cashflow: tx.cashflow,
        count: 0,
        lastUsedDate: tx.date,
        amounts: [],
        score: 0,
      };
      byKey.set(key, acc);
    }
    acc.count += 1;
    acc.score += weight;
    acc.amounts.push(tx.amountCents);
    if (tx.date > acc.lastUsedDate) acc.lastUsedDate = tx.date;
  }

  const combos: RecallCombo[] = [...byKey.entries()].map(([key, acc]) => ({
    key,
    categoryType: acc.categoryType,
    category: acc.category,
    merchant: acc.merchant,
    account: acc.account,
    destinationAccount: acc.destinationAccount,
    cashflow: acc.cashflow,
    count: acc.count,
    lastUsedDate: acc.lastUsedDate,
    medianAmountCents: median([...acc.amounts].sort((a, b) => a - b)),
    score: acc.score,
  }));

  return combos
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.lastUsedDate !== b.lastUsedDate) return a.lastUsedDate < b.lastUsedDate ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    })
    .slice(0, limit);
}
