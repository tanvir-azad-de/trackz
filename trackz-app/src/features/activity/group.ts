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
 * Both levels' netCents use the net-worth perspective (@/domain/transaction
 * getSignedAmountCents), the same single source of truth every other KPI
 * in the app goes through — a transfer day/month nets to 0 rather than
 * inventing a second sign convention here.
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

function netWorthSigned(tx: Transaction): Cents {
  return getSignedAmountCents(tx, { kind: "net-worth" });
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
    const signed = netWorthSigned(tx);
    currentDay.netCents = addCents(currentDay.netCents, signed);
    currentMonth.netCents = addCents(currentMonth.netCents, signed);
    if (signed > 0) currentMonth.inCents = addCents(currentMonth.inCents, signed);
    else if (signed < 0) currentMonth.outCents = addCents(currentMonth.outCents, -signed);
  }

  return months;
}
