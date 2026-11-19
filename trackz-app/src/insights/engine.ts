import type { Transaction } from "@/domain/transaction";
import { getSignedAmountCents } from "@/domain/transaction";
import type { AccountType } from "@/domain/transaction";
import type { Cents } from "@/domain/money";
import { addCents } from "@/domain/money";
import { getMonthStartDate, isWithinRange, shiftMonthKey, toMonthKey } from "@/domain/dates";

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
 * Whether a row counts toward spending, and by how much: expense rows add,
 * non_income rows (a refund, a reimbursement, an item sold) subtract, so a
 * 10 EUR purchase refunded 10 EUR nets to zero (user decision 2026-11-19).
 * null means the row is not spending at all.
 *
 * non_expense stays out: a 600 € rent paid for two flatmates is not 600 €
 * of my spending. Netting non_income but not non_expense is asymmetric on
 * purpose; the user chose it after seeing that shared bills are logged
 * as non_expense while the money back is non_income.
 *
 * Derived from getSignedAmountCents (expense is -amount, non_income
 * +amount, under net-worth) rather than a sign of its own. Every spending
 * figure on Home goes through here, so the chart point, the category
 * sheet's rows and This month so far cannot drift apart.
 */
function spendingCents(tx: Transaction): Cents | null {
  if (tx.categoryType !== "expense" && tx.categoryType !== "non_income") return null;
  return -getSignedAmountCents(tx, { kind: "net-worth" });
}

/**
 * Income and net expense for a month, optionally only up to `asOfDate`.
 *
 * Income is categoryType "income" only. Expense is spendingCents: expense
 * minus non_income, so it can go negative in a month where refunds
 * outweigh spending (chartGeometry clamps that point).
 */
export function summarizeMonth(transactions: Transaction[], monthKey: string, asOfDate?: string): MonthSummary {
  let income = 0;
  let expense = 0;
  for (const tx of transactions) {
    if (toMonthKey(tx.date) !== monthKey) continue;
    if (asOfDate && tx.date > asOfDate) continue;
    if (tx.categoryType === "income") {
      income = addCents(income, getSignedAmountCents(tx, { kind: "net-worth" }));
      continue;
    }
    const spent = spendingCents(tx);
    if (spent !== null) expense = addCents(expense, spent);
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

/** One category on Home's "This month so far" card. */
export interface CategoryPace {
  category: string;
  /** Spend from the 1st up to the as-of date. */
  spentCents: Cents;
  /** Average FULL month over the baseline months that had any spend in it; 0 when none did. */
  usualCents: Cents;
  /** How many baseline months that average is over (0 = new). Shown when it is fewer than the window. */
  months: number;
}

export interface MonthPace {
  /** The month's net expense so far: summarizeMonth's figure, so it equals the chart point. */
  spentCents: Cents;
  /** Average full-month net expense over the baseline months that had any spending row. */
  usualCents: Cents;
  usualMonths: number;
  /** The biggest categories so far, biggest first. */
  categories: CategoryPace[];
}

/**
 * Home's "This month so far" (user decisions 2026-11-17, replacing the
 * "what changed" feed): what was spent so far against a normal FULL month,
 * in total and for the biggest categories.
 *
 * Replaces the same-days comparison ("X so far vs Y usual by now"). That
 * average of days 1..N across past months was a number the user could
 * not recognise or check, and it hid how few months it rested on. A full
 * month is a figure the user knows, and `months` is shown when short.
 *
 * WHY "MONTHS WITH SPEND" AS THE DIVISOR, kept from the old feed: a bill
 * that started in July averages over its real months instead of being
 * diluted by empty ones. The same rule for the total skips months before
 * any data was logged.
 */
export function getMonthPace(
  transactions: Transaction[],
  monthKey: string,
  asOfDate: string,
  baselineMonths = 6,
  topN = 3,
): MonthPace {
  const prior = new Set<string>();
  for (let i = 1; i <= baselineMonths; i++) prior.add(shiftMonthKey(monthKey, -i));

  const monthTotals = new Map<string, Cents>();
  const categoryTotals = new Map<string, Cents>();
  const categoryMonths = new Map<string, Set<string>>();
  for (const tx of transactions) {
    const spent = spendingCents(tx);
    if (spent === null) continue;
    const txMonth = toMonthKey(tx.date);
    if (!prior.has(txMonth)) continue;
    monthTotals.set(txMonth, addCents(monthTotals.get(txMonth) ?? 0, spent));
    categoryTotals.set(tx.category, addCents(categoryTotals.get(tx.category) ?? 0, spent));
    if (!categoryMonths.has(tx.category)) categoryMonths.set(tx.category, new Set());
    categoryMonths.get(tx.category)!.add(txMonth);
  }

  const average = (total: Cents, months: number): Cents => (months > 0 ? Math.round(total / months) : 0);
  const usualMonths = monthTotals.size;

  return {
    spentCents: summarizeMonth(transactions, monthKey, asOfDate).expenseCents,
    usualCents: average(addCents(...monthTotals.values()), usualMonths),
    usualMonths,
    // Only categories with net spend: a non_income category such as
    // Refunds is negative, and "−10 € so far vs 0 € usual" is no pace.
    categories: getTopCategoriesForMonth(transactions, monthKey, Infinity, asOfDate)
      .filter((c) => c.amountCents > 0)
      .slice(0, topN)
      .map(({ category, amountCents }) => {
      const months = categoryMonths.get(category)?.size ?? 0;
      return { category, spentCents: amountCents, usualCents: average(categoryTotals.get(category) ?? 0, months), months };
    }),
  };
}

/**
 * Per-category net spending for a month, biggest first: Home's category
 * sheet (2026-11-11). Rows are spendingCents, so a non_income category
 * (Refunds) is its own negative row at the bottom and one shared by both
 * types nets inside itself; either way the list adds up to summarizeMonth's
 * expense. `asOfDate` caps the current month at today, like summarizeMonth,
 * rather than counting a later-dated row.
 */
export function getTopCategoriesForMonth(transactions: Transaction[], monthKey: string, limit = 5, asOfDate?: string) {
  const totals = new Map<string, Cents>();
  for (const tx of transactions) {
    const spent = spendingCents(tx);
    if (spent === null) continue;
    if (toMonthKey(tx.date) !== monthKey) continue;
    if (asOfDate && tx.date > asOfDate) continue;
    totals.set(tx.category, addCents(totals.get(tx.category) ?? 0, spent));
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
 * Outstanding "Lent" balances per counterparty (UI label for
 * categoryType "receivable" — see docs/renovation_version_1.txt
 * decisions). Counterparty name lives in tx.merchant for these rows
 * (confirmed against the real CSV: receivable rows carry the person's
 * name there). Settled-to-zero counterparties (lent X, repaid exactly X)
 * are excluded rather than shown as a 0,00 € row.
 */
export function getReceivableBalances(transactions: Transaction[]): CounterpartyBalance[] {
  return getCounterpartyBalances(transactions, "receivable");
}

/** "Borrowed" balances per counterparty (UI label for categoryType "payable"). Empty on the real dataset — zero payable rows exist — so callers must handle an empty-state, not assume this is always populated. */
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
  /** Investment accounts, then one "Lent" row. */
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
 * and into "Lent" (nets to 0), borrowing moves cash in and adds the
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
  const otherBucket = bucket([...investments, { label: "Lent", kind: "lent_out", amountCents: lentOutCents }]);
  const liabilitiesBucket = bucket([...cards, { label: "Borrowed", kind: "borrowed", amountCents: borrowedCents }]);
  return {
    netWorthCents: addCents(liquidBucket.totalCents, otherBucket.totalCents, -liabilitiesBucket.totalCents),
    liquid: liquidBucket,
    other: otherBucket,
    liabilities: liabilitiesBucket,
  };
}

/**
 * Who a Lent / Borrowed row is with. The category fallback is for old
 * rows that named the counterparty there; new rows must name one in merchant
 * (features/entry/draft.ts). Shared with features/entry/debtBalance.ts so
 * the entry check and the balances shown can never key people differently.
 */
export function counterpartyOf(tx: Pick<Transaction, "merchant" | "category">): string {
  return tx.merchant || tx.category;
}

function getCounterpartyBalances(
  transactions: Transaction[],
  categoryType: "receivable" | "payable",
): CounterpartyBalance[] {
  const totals = new Map<string, Cents>();
  for (const tx of transactions) {
    if (tx.categoryType !== categoryType) continue;
    const key = counterpartyOf(tx);
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
 * net-expense rule (spendingCents) are that function's, not a second copy here. (The
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
