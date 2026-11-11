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
}

/**
 * Income and expense for a month, optionally only up to `asOfDate`.
 *
 * Only categoryType "income" and "expense" count. non_income/non_expense
 * are money that moved but is not wholly mine (a loan out, a shared bill,
 * a refund), so adding them here inflated both tiles: a 600 € rent paid
 * for two flatmates is not 600 € of my spending. They used to be summed
 * in because the net-worth perspective (rightly) treats them as cash
 * movements; "what did I earn/spend" is a different question.
 */
export function summarizeMonth(transactions: Transaction[], monthKey: string, asOfDate?: string): MonthSummary {
  let income = 0;
  let expense = 0;
  for (const tx of transactions) {
    if (toMonthKey(tx.date) !== monthKey) continue;
    if (asOfDate && tx.date > asOfDate) continue;
    if (tx.categoryType === "income") {
      income = addCents(income, getSignedAmountCents(tx, { kind: "net-worth" }));
    } else if (tx.categoryType === "expense") {
      expense = addCents(expense, -getSignedAmountCents(tx, { kind: "net-worth" }));
    }
  }
  return { monthKey, incomeCents: income, expenseCents: expense };
}

/**
 * Sum of every CASH account's running balance — the
 * import dry-run's Liquid figure (features/settings/exportImport.ts).
 * Home's Liquid assets card adds up getBalanceSheet's rows instead, which
 * is the same set of accounts. Every other type is excluded: investment
 * accounts (e.g. SCLB) are an asset but not spendable, and including them
 * overstated "Liquid" by their full balance (Phase 12 QA). Credit cards
 * (e.g. ADVZ, 2026-11-11) hold money owed, not money held; counted as
 * cash, unpaid card spend came off Liquid before it had left any bank.
 *
 * `!== "cash"` rather than a list of excluded types is deliberate: a type
 * added later stays out of Liquid until someone decides it is spendable.
 *
 * `accountTypes` defaults to "every account is cash" so existing callers
 * that don't care about the cash/investment distinction (e.g. a future
 * CSV-import dry-run) don't have to thread a classification map through
 * for a question they're not asking. exportImport passes the real map.
 */
export function getLiquidCashCents(transactions: Transaction[], accountTypes: Record<string, AccountType> = {}): Cents {
  const accounts = new Set<string>();
  for (const tx of transactions) {
    for (const acc of [tx.account, tx.destinationAccount].filter(Boolean)) {
      accounts.add(acc);
    }
  }
  let total = 0;
  for (const acc of accounts) {
    if ((accountTypes[acc] ?? "cash") !== "cash") continue;
    total = addCents(
      total,
      addCents(...transactions.map((tx) => getSignedAmountCents(tx, { kind: "account", name: acc }))),
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

/**
 * Per-category expense ranking for a month, biggest first: Home's
 * category sheet (2026-11-11). `asOfDate` caps the current month at today,
 * like summarizeMonth, so the categories add up to the chart point and
 * the Spent tile rather than counting a later-dated row.
 */
export function getTopCategoriesForMonth(transactions: Transaction[], monthKey: string, limit = 5, asOfDate?: string) {
  const totals = new Map<string, Cents>();
  for (const tx of transactions) {
    if (tx.categoryType !== "expense") continue;
    if (toMonthKey(tx.date) !== monthKey) continue;
    if (asOfDate && tx.date > asOfDate) continue;
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

export type BalanceSheetRowKind = AccountType | "lent_out" | "borrowed";

export interface BalanceSheetRow {
  label: string;
  /** Picks the row's icon on Home: one icon per account type, not per account. */
  kind: BalanceSheetRowKind;
  amountCents: Cents;
}

export interface BalanceSheetBucket {
  totalCents: Cents;
  rows: BalanceSheetRow[];
}

export interface BalanceSheet {
  netWorthCents: Cents;
  /** Cash accounts. */
  liquid: BalanceSheetBucket;
  /** Investment accounts, then one "Lent out" row. */
  other: BalanceSheetBucket;
  /** Credit cards, then one "Borrowed" row — as positive amounts owed. */
  liabilities: BalanceSheetBucket;
}

/**
 * Home's four balance cards (user decision 2026-11-11, replacing the
 * Liquid hero and the account strip).
 *
 * Every figure comes from a balance the app already computes —
 * getAccountBalances, getReceivableBalances, getPayableBalances — so the
 * sign convention stays getSignedAmountCents'. Net worth is assets minus
 * liabilities, which is the same as summing every account plus what is
 * lent out minus what is borrowed: lending moves cash out of an account
 * and into "Lent out" (nets to 0), borrowing moves cash in and adds the
 * same to "Borrowed" (nets to 0).
 *
 * Credit-card rows are NEGATED: a card's account balance is negative
 * while spend is unpaid, and this card lists what is owed. An overpaid
 * card (positive balance) therefore shows as a negative liability, which
 * still nets correctly into net worth.
 *
 * Zero rows are dropped — dormant accounts and settled loans would
 * otherwise sit as 0,00 € lines. Totals are summed over the same rows, so
 * a total always equals what its card lists.
 */
export function getBalanceSheet(
  transactions: Transaction[],
  accountTypes: Record<string, AccountType> = {},
): BalanceSheet {
  const liquid: BalanceSheetRow[] = [];
  const investments: BalanceSheetRow[] = [];
  const cards: BalanceSheetRow[] = [];
  for (const { account, balanceCents } of getAccountBalances(transactions)) {
    const kind = accountTypes[account] ?? "cash";
    if (kind === "cash") liquid.push({ label: account, kind, amountCents: balanceCents });
    else if (kind === "investment") investments.push({ label: account, kind, amountCents: balanceCents });
    else cards.push({ label: account, kind, amountCents: -balanceCents });
  }
  const lentOutCents = addCents(...getReceivableBalances(transactions).map((r) => r.balanceCents));
  const borrowedCents = addCents(...getPayableBalances(transactions).map((p) => p.balanceCents));

  const bucket = (rows: BalanceSheetRow[]): BalanceSheetBucket => {
    const kept = rows.filter((r) => r.amountCents !== 0);
    return { totalCents: addCents(...kept.map((r) => r.amountCents)), rows: kept };
  };
  const liquidBucket = bucket(liquid);
  const otherBucket = bucket([...investments, { label: "Lent out", kind: "lent_out", amountCents: lentOutCents }]);
  const liabilitiesBucket = bucket([...cards, { label: "Borrowed", kind: "borrowed", amountCents: borrowedCents }]);
  return {
    netWorthCents: addCents(liquidBucket.totalCents, otherBucket.totalCents, -liabilitiesBucket.totalCents),
    liquid: liquidBucket,
    other: otherBucket,
    liabilities: liabilitiesBucket,
  };
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
 * Expense totals for the `months` months ending at (and including)
 * monthKey, oldest first: Home's 6-month chart (user decision 2026-11-11,
 * replacing Phase 14's running-total line for this month only).
 *
 * Each month goes through summarizeMonth, so the sign convention and the
 * expense-only rule are that function's, not a second copy here. (The
 * previous body summed raw tx.amountCents. For expense rows that is the
 * same number, since net-worth signs an expense as -amountCents, checked
 * by mutation. The reuse buys one definition, not a fix.) `asOfDate` caps the current month at today: without it a later-dated
 * row lands in the last point, and the point stops equalling
 * summarizeMonth(..., today), which CategorySheet's list adds up to.
 */
export function getMonthlyExpenseSeries(
  transactions: Transaction[],
  monthKey: string,
  months = 6,
  asOfDate?: string,
): Array<{ monthKey: string; expenseCents: Cents }> {
  const series: Array<{ monthKey: string; expenseCents: Cents }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const key = shiftMonthKey(monthKey, -i);
    series.push({ monthKey: key, expenseCents: summarizeMonth(transactions, key, asOfDate).expenseCents });
  }
  return series;
}

// re-exported for convenience at call sites that build their own ranges
export { getMonthStartDate, isWithinRange };
