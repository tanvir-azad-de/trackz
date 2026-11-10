import type { Transaction } from "@/domain/transaction";
import { getSignedAmountCents } from "@/domain/transaction";
import type { AccountType } from "@/domain/transaction";
import type { Cents } from "@/domain/money";
import { addCents } from "@/domain/money";
import { getMonthEndDate, getMonthStartDate, isWithinRange, shiftMonthKey, toMonthKey } from "@/domain/dates";

/**
 * Pure, unit-tested functions. No DOM, no localStorage reads — callers
 * pass in the transaction list. This is what the old dashboard.js's 2382
 * lines of DOM-reading aggregation should have been from the start (see
 * bug B3/B4 in docs/renovation_version_1.txt: the old summary pipeline
 * read half-initialized globals and was dead code half the time).
 */

export interface MonthSummary {
  monthKey: string; // "YYYY-MM"
  incomeCents: Cents;
  expenseCents: Cents;
  surplusCents: Cents; // income - expense
}

export function summarizeMonth(transactions: Transaction[], monthKey: string): MonthSummary {
  let income = 0;
  let expense = 0;
  for (const tx of transactions) {
    if (toMonthKey(tx.date) !== monthKey) continue;
    if (tx.categoryType === "income" || tx.categoryType === "non_income") {
      income = addCents(income, getSignedAmountCents(tx, { kind: "net-worth" }));
    } else if (tx.categoryType === "expense" || tx.categoryType === "non_expense") {
      expense = addCents(expense, -getSignedAmountCents(tx, { kind: "net-worth" }));
    }
  }
  return { monthKey, incomeCents: income, expenseCents: expense, surplusCents: income - expense };
}

/**
 * Sum of every CASH account's running balance — this is what Home's
 * "Liquid" hero shows (see docs/renovation_version_1.txt's Phase 12
 * write-up for the relabel). Investment accounts (classified via
 * storage/accountTypes.ts, e.g. SCLB/Scalable Capital) are deliberately
 * excluded: they're a real asset but not spendable cash, and including
 * them here silently overstated "Liquid" by their full balance (caught
 * live during Phase 12 QA, where the investment balance was most of the
 * number this function returned before this fix).
 *
 * `accountTypes` defaults to "every account is cash" so existing callers
 * that don't care about the cash/investment distinction (e.g. a future
 * CSV-import dry-run) don't have to thread a classification map through
 * for a question they're not asking. HomeScreen passes the real map.
 */
export function getLiquidCashCents(
  transactions: Transaction[],
  accountTypes: Record<string, AccountType> = {},
  asOfDate?: string,
): Cents {
  const relevant = asOfDate ? transactions.filter((tx) => tx.date <= asOfDate) : transactions;
  const accounts = new Set<string>();
  for (const tx of relevant) {
    for (const acc of [tx.account, tx.destinationAccount].filter(Boolean)) {
      accounts.add(acc);
    }
  }
  let total = 0;
  for (const acc of accounts) {
    if ((accountTypes[acc] ?? "cash") !== "cash") continue;
    total = addCents(
      total,
      addCents(...relevant.map((tx) => getSignedAmountCents(tx, { kind: "account", name: acc }))),
    );
  }
  return total;
}

export interface CategoryDelta {
  category: string;
  /** Spend from day 1 up to the as-of day. */
  thisMonthCents: Cents;
  /** Usual spend by the same day of the month, see getCategoryDeltasForMonth. */
  baselineAvgCents: Cents;
  deltaCents: Cents; // thisMonth - baseline
  deltaPercent: number | null; // null when baselineAvgCents is 0
  /** No spend at all in any baseline month: a new category, not a change. */
  isNew: boolean;
}

/** The "what changed" feed drops anything that moved by less than this (user decision 2026-11-10). */
export const MIN_INSIGHT_DELTA_CENTS: Cents = 1000;

function daysElapsedInMonth(monthKey: string, asOfDate: string): number {
  const monthStart = getMonthStartDate(monthKey);
  const monthEnd = getMonthEndDate(monthKey);
  const clamped = asOfDate < monthStart ? monthStart : asOfDate > monthEnd ? monthEnd : asOfDate;
  return Number(clamped.slice(8, 10));
}


/**
 * For every expense category with spend in `monthKey` up to `asOfDate`,
 * compares it to what the same category usually costs BY THE SAME DAY of
 * the month, over the preceding `baselineMonths` months (user decisions
 * 2026-11-10, replacing a prorated full-month average).
 *
 * WHY SAME DAYS, NOT PRORATION. The old baseline was the 6-month average
 * times the fraction of the month elapsed, which assumes spending is
 * spread evenly. Bills are not: a 72 € electricity bill paid on the 7th
 * of every month read "up 400%" on the 9th against a prorated 14,40 €.
 * Comparing days 1..N with days 1..N of past months compares like with
 * like. A month shorter than N (the 31st against September) simply
 * contributes its whole length: no row's day can exceed its own month,
 * so no clamp is needed.
 *
 * WHY "MONTHS WITH SPEND" AS THE DIVISOR, NOT `baselineMonths`. The
 * average divides by the number of baseline months in which the
 * category had ANY spend in the whole month, not just the window. A bill
 * that started in July therefore averages over its 4 real months instead
 * of being diluted by 2 empty ones into a false "up 50%". Counting the
 * whole month rather than the window keeps a bill paid on the 9th one
 * month and the 11th the next from dropping out of the divisor.
 * The cost, accepted when chosen: for occasional spending, a month with
 * no spend at all does not pull "usual" down.
 *
 * A category with no spend in any baseline month is flagged `isNew`.
 * Categories with no spend so far this month are not listed: early in a
 * month that is usually "not logged yet", not "stopped spending".
 */
export function getCategoryDeltasForMonth(
  transactions: Transaction[],
  monthKey: string,
  baselineMonths = 6,
  asOfDate: string = getMonthEndDate(monthKey),
): CategoryDelta[] {
  const asOfDay = daysElapsedInMonth(monthKey, asOfDate);

  const priorMonthKeys: string[] = [];
  for (let i = 1; i <= baselineMonths; i++) {
    priorMonthKeys.push(shiftMonthKey(monthKey, -i));
  }

  const thisMonthTotals = new Map<string, Cents>();
  const windowTotals = new Map<string, Cents>(); // category -> sum over baseline windows
  const monthsWithSpend = new Map<string, Set<string>>(); // category -> baseline months with any spend

  for (const tx of transactions) {
    if (tx.categoryType !== "expense") continue;
    const txMonth = toMonthKey(tx.date);
    const day = Number(tx.date.slice(8, 10));

    if (txMonth === monthKey) {
      if (day <= asOfDay) thisMonthTotals.set(tx.category, addCents(thisMonthTotals.get(tx.category) ?? 0, tx.amountCents));
      continue;
    }
    if (!priorMonthKeys.includes(txMonth)) continue;

    if (!monthsWithSpend.has(tx.category)) monthsWithSpend.set(tx.category, new Set());
    monthsWithSpend.get(tx.category)!.add(txMonth);
    if (day <= asOfDay) {
      windowTotals.set(tx.category, addCents(windowTotals.get(tx.category) ?? 0, tx.amountCents));
    }
  }

  const results: CategoryDelta[] = [];
  for (const [category, thisMonthCents] of thisMonthTotals) {
    const months = monthsWithSpend.get(category)?.size ?? 0;
    const baselineAvgCents = months > 0 ? Math.round((windowTotals.get(category) ?? 0) / months) : 0;
    const deltaCents = thisMonthCents - baselineAvgCents;
    const deltaPercent = baselineAvgCents > 0 ? (deltaCents / baselineAvgCents) * 100 : null;
    results.push({ category, thisMonthCents, baselineAvgCents, deltaCents, deltaPercent, isNew: months === 0 });
  }

  return results.sort((a, b) => b.thisMonthCents - a.thisMonthCents);
}

/**
 * Ranks the feed by absolute deviation, biggest first, and drops changes
 * under MIN_INSIGHT_DELTA_CENTS. New categories are ranked by their whole
 * amount, which IS their delta. A category whose usual by this day is 0
 * but which is not new (a bill paid earlier than usual) is kept, with no
 * percentage. It used to be dropped along with new ones, which hid
 * exactly the real changes.
 */
export function getMostSurprisingDeltas(deltas: CategoryDelta[], limit = 4): CategoryDelta[] {
  return deltas
    .filter((d) => Math.abs(d.deltaCents) >= MIN_INSIGHT_DELTA_CENTS)
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
    .slice(0, limit);
}

/** Per-category expense ranking for a month, for the "where it went" bar list. */
export function getTopCategoriesForMonth(transactions: Transaction[], monthKey: string, limit = 5) {
  const totals = new Map<string, Cents>();
  for (const tx of transactions) {
    if (tx.categoryType !== "expense") continue;
    if (toMonthKey(tx.date) !== monthKey) continue;
    totals.set(tx.category, addCents(totals.get(tx.category) ?? 0, tx.amountCents));
  }
  return [...totals.entries()]
    .map(([category, amountCents]) => ({ category, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, limit);
}

/** Per-account current balance, for the account strip. */
export function getAccountBalances(transactions: Transaction[]): Array<{ account: string; balanceCents: Cents }> {
  const accounts = new Set<string>();
  for (const tx of transactions) {
    accounts.add(tx.account);
    if (tx.destinationAccount) accounts.add(tx.destinationAccount);
  }
  return [...accounts].sort().map((account) => ({
    account,
    balanceCents: addCents(...transactions.map((tx) => getSignedAmountCents(tx, { kind: "account", name: account }))),
  }));
}

export interface AccountActivity {
  account: string;
  balanceCents: Cents;
  lastActivityDate: string | null; // null only if an account somehow has zero transactions
  accountType: AccountType;
}

/** Per-account current balance + last-activity date + cash/investment classification, for the Accounts screen (Phase 12). Dormant accounts (ADVZ/REVJ/REVB in the real data) are surfaced, not hidden. */
export function getAccountActivity(
  transactions: Transaction[],
  accountTypes: Record<string, AccountType> = {},
): AccountActivity[] {
  const balances = getAccountBalances(transactions);
  return balances.map(({ account, balanceCents }) => {
    let lastActivityDate: string | null = null;
    for (const tx of transactions) {
      if (tx.account !== account && tx.destinationAccount !== account) continue;
      if (lastActivityDate === null || tx.date > lastActivityDate) lastActivityDate = tx.date;
    }
    return { account, balanceCents, lastActivityDate, accountType: accountTypes[account] ?? "cash" };
  });
}

/**
 * End-of-month running balance for one account, over `months` months
 * ending at (and including) monthKey — feeds the Accounts screen's
 * sparkline (components/Sparkline.tsx). Cumulative over ALL history up to
 * each month end, not a per-month delta: a balance line must start from
 * the true running total, otherwise a dormant account (no transactions
 * this window) would wrongly show as flat-zero instead of flat-at-its-
 * actual-balance.
 */
export function getAccountBalanceSeries(
  transactions: Transaction[],
  account: string,
  monthKey: string,
  months = 6,
): Array<{ monthKey: string; balanceCents: Cents }> {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(shiftMonthKey(monthKey, -i));

  return keys.map((k) => {
    const asOfDate = getMonthEndDate(k);
    const balanceCents = addCents(
      ...transactions
        .filter((tx) => tx.date <= asOfDate)
        .map((tx) => getSignedAmountCents(tx, { kind: "account", name: account })),
    );
    return { monthKey: k, balanceCents };
  });
}

export interface CounterpartyBalance {
  counterparty: string; // tx.merchant — where the counterparty name lives for receivable/payable rows
  balanceCents: Cents; // outstanding amount, always > 0 (settled-to-zero counterparties are excluded)
}

/**
 * Outstanding "Lent out" balances per counterparty (UI label for
 * categoryType "receivable" — see docs/renovation_version_1.txt
 * decisions). Counterparty name lives in tx.merchant for these rows
 * (confirmed against the real CSV: receivable rows carry the person's
 * name there). Settled-to-zero counterparties (lent X, repaid exactly X)
 * are excluded rather than shown as a 0,00 € row.
 */
export function getReceivableBalances(transactions: Transaction[]): CounterpartyBalance[] {
  return getCounterpartyBalances(transactions, "receivable");
}

/** "I owe" balances per counterparty (UI label for categoryType "payable"). Empty on the real dataset — zero payable rows exist — so callers must handle an empty-state, not assume this is always populated. */
export function getPayableBalances(transactions: Transaction[]): CounterpartyBalance[] {
  return getCounterpartyBalances(transactions, "payable");
}

function getCounterpartyBalances(
  transactions: Transaction[],
  categoryType: "receivable" | "payable",
): CounterpartyBalance[] {
  const totals = new Map<string, Cents>();
  for (const tx of transactions) {
    if (tx.categoryType !== categoryType) continue;
    const key = tx.merchant || tx.category;
    totals.set(key, addCents(totals.get(key) ?? 0, getSignedAmountCents(tx, { kind: categoryType })));
  }
  return [...totals.entries()]
    .filter(([, balanceCents]) => balanceCents !== 0)
    .map(([counterparty, balanceCents]) => ({ counterparty, balanceCents }))
    .sort((a, b) => b.balanceCents - a.balanceCents);
}

/**
 * Total assets = every account's balance (cash AND investment — unlike
 * getLiquidCashCents, this does NOT filter by account type, since an
 * investment account's balance is still a real asset) + outstanding
 * receivables ("Lent out") - outstanding payables ("I owe"). This is the
 * number that makes Home's "Liquid" hero and the Accounts screen's
 * fuller breakdown reconcile: Home intentionally shows cash-only (see
 * HeroCard's relabel in Phase 12), this is the full picture shown on
 * Accounts (Liquid + Investments + Lent out = Total).
 */
export function getTotalAssetsCents(transactions: Transaction[]): Cents {
  const everyAccount = addCents(...getAccountBalances(transactions).map((a) => a.balanceCents));
  const receivables = addCents(...getReceivableBalances(transactions).map((r) => r.balanceCents));
  const payables = addCents(...getPayableBalances(transactions).map((p) => p.balanceCents));
  return addCents(everyAccount, receivables, -payables);
}

/** Monthly expense totals for N months ending at (and including) monthKey — feeds the sparkline. */
export function getMonthlyExpenseSeries(
  transactions: Transaction[],
  monthKey: string,
  months = 6,
): Array<{ monthKey: string; expenseCents: Cents }> {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(shiftMonthKey(monthKey, -i));

  const totals = new Map<string, Cents>();
  for (const tx of transactions) {
    if (tx.categoryType !== "expense") continue;
    const txMonth = toMonthKey(tx.date);
    if (!keys.includes(txMonth)) continue;
    totals.set(txMonth, addCents(totals.get(txMonth) ?? 0, tx.amountCents));
  }

  return keys.map((k) => ({ monthKey: k, expenseCents: totals.get(k) ?? 0 }));
}

export function getLatestMonthKey(transactions: Transaction[]): string | null {
  const latest = getLatestDate(transactions);
  return latest ? latest.slice(0, 7) : null;
}

export function getLatestDate(transactions: Transaction[]): string | null {
  if (transactions.length === 0) return null;
  return transactions.reduce((latest, tx) => (tx.date > latest ? tx.date : latest), transactions[0]!.date);
}

// re-exported for convenience at call sites that build their own ranges
export { getMonthStartDate, isWithinRange };
