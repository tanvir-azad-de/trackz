/**
 * Dates are stored and compared as "YYYY-MM-DD" strings (lexicographically
 * sortable, timezone-free once written). The bugs in the old app came from
 * mixing local-time and UTC-time `Date` construction when computing *today*
 * or *this month* (see docs/renovation_version_1.txt bug list, date section):
 * `toISOString()` is always UTC, so for anyone east of UTC, "today" could
 * resolve to yesterday after local midnight-minus-the-UTC-offset.
 *
 * Rule followed throughout this module:
 *   - "What is today/this month, from the user's point of view?" -> use
 *     local Date getters (getFullYear/getMonth/getDate).
 *   - "Add N months to this known date" / "last day of this month?" -> use
 *     Date.UTC anchoring so DST transitions can't shift the result.
 */

export type ISODate = string; // "YYYY-MM-DD"

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Today's date in the user's local timezone, as an ISODate. */
export function getLocalToday(): ISODate {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** YYYY-MM for the given ISODate (or local today if omitted). */
export function toMonthKey(date: ISODate): string {
  return date.slice(0, 7);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(value: string): value is ISODate {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Add (or subtract, with a negative count) whole months to a "YYYY-MM" key, DST-safe. */
export function shiftMonthKey(monthKey: string, count: number): string {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + count, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** Last calendar day of the given "YYYY-MM" month, as an ISODate. */
export function getMonthEndDate(monthKey: string): ISODate {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  // day 0 of next month == last day of this month, UTC-anchored.
  const d = new Date(Date.UTC(y, m, 0));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** First calendar day of the given "YYYY-MM" month, as an ISODate. */
export function getMonthStartDate(monthKey: string): ISODate {
  return `${monthKey}-01`;
}

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

/** [from, to] inclusive, both bounds anchored to local "today". */
export function getThisMonthRange(today: ISODate = getLocalToday()): DateRange {
  const monthKey = toMonthKey(today);
  return { from: getMonthStartDate(monthKey), to: today };
}

export function getLastNMonthsRange(n: number, today: ISODate = getLocalToday()): DateRange {
  const monthKey = toMonthKey(today);
  return { from: getMonthStartDate(shiftMonthKey(monthKey, -(n - 1))), to: today };
}

export function getYearToDateRange(today: ISODate = getLocalToday()): DateRange {
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/** Inclusive membership test on lexicographically-sortable ISO date strings. */
export function isWithinRange(date: ISODate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}
