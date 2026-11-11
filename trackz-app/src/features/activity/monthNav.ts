import type { MonthGroup } from "@/features/activity/group";
import { shortMonthName } from "@/domain/dates";

/**
 * Pure half of the Activity month pills (2026-11-10, approved as
 * docs/mockups/activity-month-pills.html). MonthPills.tsx and the scroll
 * wiring in ActivityList.tsx are the thin half.
 */

/** "Nov" in `today`'s year, "Dec 2025" in any other. `monthKey` is "YYYY-MM". */
export function monthPillLabel(monthKey: string, today: string): string {
  const name = shortMonthName(monthKey);
  return monthKey.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${monthKey.slice(0, 4)}`;
}

/**
 * Rows that come before `monthKey`'s first row, so a jump can make
 * useIncrementalList render far enough to reach it. -1 if the month isn't
 * in the list, because the pills only offer months from the same list.
 */
export function rowsBeforeMonth(months: readonly MonthGroup[], monthKey: string): number {
  let rows = 0;
  for (const month of months) {
    if (month.monthKey === monthKey) return rows;
    for (const day of month.days) rows += day.transactions.length;
  }
  return -1;
}

/**
 * The month being looked at: the LAST month whose first day card has
 * reached the line under the sticky header. `starts` are in list order
 * with viewport-relative tops. Before any start reaches the line (scrolled
 * to the very top), that is the first month.
 *
 * The 2px tolerance is for a jump. It lands a month's start exactly on the
 * line, and a sub-pixel rounding of `top` would otherwise leave the
 * PREVIOUS month highlighted after tapping this one.
 */
export function activeMonthAt(starts: readonly { monthKey: string; top: number }[], line: number): string | null {
  let active: string | null = starts[0]?.monthKey ?? null;
  // No early break: list-order tops only ever increase, so it would change
  // nothing but save a few iterations over ~30 month starts.
  for (const s of starts) {
    if (s.top <= line + 2) active = s.monthKey;
  }
  return active;
}
