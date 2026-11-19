import type { Transaction } from "@/domain/transaction";
import { getSignedAmountCents } from "@/domain/transaction";
import type { Cents } from "@/domain/money";
import { addCents } from "@/domain/money";
import { toMonthKey } from "@/domain/dates";

/**
 * Groups an already-sorted (date desc) transaction list into day groups
 * nested under month groups, for the Activity screen's sticky-month /
 * day-heading list (Phase 11). Pure — takes the output of
 * features/activity/filter.ts's filterTransactions, does no filtering or
 * fetching itself.
 *
 * Both levels' netCents use the cash-flow perspective (@/domain/transaction
 * getSignedAmountCents): money in +, money out -, transfers 0. Lent and
 * Borrowed COUNT, unlike net-worth, where they are 0 (user decision
 * 2026-11-19, with the days-only toggle). So a day's figure is the sum of
 * the signed amounts its rows show, and it tracks Home's Liquid card,
 * not its Net worth card.
 */

export interface DayGroup {
  date: string; // ISODate
  monthKey: string;
  netCents: Cents;
  transactions: Transaction[];
}

export interface MonthGroup {
  monthKey: string;
  inCents: Cents;
  outCents: Cents;
  netCents: Cents;
  days: DayGroup[];
}

function cashFlowSigned(tx: Transaction): Cents {
  return getSignedAmountCents(tx, { kind: "cash-flow" });
}

/** `transactions` must already be sorted date-descending (filterTransactions does this). */
export function groupByMonthAndDay(transactions: Transaction[]): MonthGroup[] {
  const months: MonthGroup[] = [];
  let currentMonth: MonthGroup | null = null;
  let currentDay: DayGroup | null = null;

  for (const tx of transactions) {
    const monthKey = toMonthKey(tx.date);
    if (!currentMonth || currentMonth.monthKey !== monthKey) {
      currentMonth = { monthKey, inCents: 0, outCents: 0, netCents: 0, days: [] };
      months.push(currentMonth);
      currentDay = null;
    }
    if (!currentDay || currentDay.date !== tx.date) {
      currentDay = { date: tx.date, monthKey, netCents: 0, transactions: [] };
      currentMonth.days.push(currentDay);
    }

    currentDay.transactions.push(tx);
    const signed = cashFlowSigned(tx);
    currentDay.netCents = addCents(currentDay.netCents, signed);
    currentMonth.netCents = addCents(currentMonth.netCents, signed);
    if (signed > 0) currentMonth.inCents = addCents(currentMonth.inCents, signed);
    else if (signed < 0) currentMonth.outCents = addCents(currentMonth.outCents, -signed);
  }

  return months;
}

/**
 * The day cards to render for the first `rowBudget` transactions
 * (useIncrementalList's visibleCount), flattened across months now that
 * the list has no month header (2026-11-10 redesign). The budget counts
 * ROWS only. Headers are not rows, and counting them would make the page
 * size depend on how many days the rows happen to span.
 *
 * A day cut by the budget is returned with only its visible rows but its
 * FULL-day netCents. The card title states the day's net, and a partial
 * sum would show a figure that changes as more rows load in.
 */
export function takeVisibleDays(months: readonly MonthGroup[], rowBudget: number): { days: DayGroup[]; hasMore: boolean } {
  const days: DayGroup[] = [];
  let remaining = rowBudget;
  for (const month of months) {
    for (const day of month.days) {
      if (remaining <= 0) return { days, hasMore: true };
      const shown = day.transactions.length <= remaining ? day.transactions : day.transactions.slice(0, remaining);
      days.push(shown === day.transactions ? day : { ...day, transactions: shown });
      remaining -= shown.length;
    }
  }
  // The loop only exits early when rows are left over. A budget that ends
  // exactly on the last row falls through here, and so does a cut inside
  // the last day.
  const total = months.reduce((n, m) => n + m.days.reduce((k, d) => k + d.transactions.length, 0), 0);
  return { days, hasMore: rowBudget < total };
}

/**
 * The days-only view's rows: every day, flattened across months, minus
 * days where EVERY row is a transfer (user decision 2026-11-19). Keyed on
 * the rows, not on netCents === 0: a day with 20 in and 20 out also nets
 * to 0 and still has spending on it, so it stays.
 */
export function collapsedDays(months: readonly MonthGroup[]): DayGroup[] {
  return months.flatMap((m) => m.days.filter((d) => d.transactions.some((tx) => tx.categoryType !== "transfer")));
}

/**
 * The one month days-only shows: the wanted one while it still has a
 * pill, else the newest. A search or filter can remove the wanted month,
 * and falling back beats an empty list behind a row of pills.
 */
export function daysOnlyMonth(wanted: string | null, available: readonly string[]): string | null {
  return wanted !== null && available.includes(wanted) ? wanted : (available[0] ?? null);
}
