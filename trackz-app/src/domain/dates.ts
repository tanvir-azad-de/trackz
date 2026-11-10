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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole calendar days between two ISODates, UTC-anchored so DST can't shift
 * the result by an hour and flip the rounding. Used by the quick-entry
 * entry-picker ranking (features/entry/rank.ts) to decay older names.
 * Positive when `later` is after `earlier`.
 */
export function daysBetween(earlier: ISODate, later: ISODate): number {
  const [ey, em, ed] = earlier.split("-").map(Number) as [number, number, number];
  const [ly, lm, ld] = later.split("-").map(Number) as [number, number, number];
  const earlierMs = Date.UTC(ey, em - 1, ed);
  const laterMs = Date.UTC(ly, lm - 1, ld);
  return Math.round((laterMs - earlierMs) / MS_PER_DAY);
}

/**
 * Both ISODate -> Date conversions below go through Date.UTC and format
 * with `timeZone: "UTC"` explicitly. This is deliberate: an ISODate like
 * "2026-10-17" has no time-of-day component, so parsing it with the
 * platform's local-timezone Date constructor (`new Date("2026-10-17")`
 * is actually parsed as UTC midnight by spec, but formatting it back with
 * a *local* Intl.DateTimeFormat would then shift it onto the 16th for
 * anyone west of UTC) would reintroduce exactly the off-by-one-day class
 * of bug this module's header comment warns about. Pinning both the
 * construction and the formatting to UTC keeps the string-in/string-out
 * round trip exact regardless of the viewer's timezone.
 */
function parseISODateUTC(date: ISODate): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

const WEEKDAY_MONTH_DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});

const WEEKDAY_MONTH_DAY_YEAR_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const LONG_MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
});

/**
 * "Today" / "Yesterday" / "Fri 17 Oct" (same year as `today`) / "Fri 17 Oct
 * 2025" (a different year). Used by the Activity screen's day group
 * headers (Phase 11). `today` must be the caller's actual getLocalToday()
 * — this function does no "what day is it" work itself, it only compares
 * two already-resolved ISODate strings, so it can't reintroduce the
 * UTC-vs-local "today" bug this module exists to avoid.
 */
export function formatDayLabel(date: ISODate, today: ISODate): string {
  if (date === today) return "Today";
  if (daysBetween(date, today) === 1) return "Yesterday";
  const dt = parseISODateUTC(date);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return sameYear ? WEEKDAY_MONTH_DAY_FORMAT.format(dt) : WEEKDAY_MONTH_DAY_YEAR_FORMAT.format(dt);
}

/**
 * "Today" / "Yesterday" / "7. November" (same year as `today`) /
 * "7. November 2025" (a different year). The Activity list's day-card
 * titles (2026-11-10 redesign, docs/mockups/activity-list-v2.html). The
 * "D. Month" shape is the user's own, from their sample.
 *
 * Assembled from parts rather than one Intl pattern: no en-GB format
 * produces "7. November", and switching to de-DE for the dot would also
 * translate the month name to German.
 */
export function formatDayHeading(date: ISODate, today: ISODate): string {
  if (date === today) return "Today";
  if (daysBetween(date, today) === 1) return "Yesterday";
  const day = Number(date.slice(8, 10));
  const month = LONG_MONTH_FORMAT.format(parseISODateUTC(date));
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return sameYear ? `${day}. ${month}` : `${day}. ${month} ${date.slice(0, 4)}`;
}

/** "1st", "2nd", "3rd", "4th" … "11th", "12th", "13th" … "21st", "31st". */
export function formatOrdinalDay(day: number): string {
  // 11-13 take "th" even though they end in 1-3.
  if (day >= 11 && day <= 13) return `${day}th`;
  const suffix = day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";
  return `${day}${suffix}`;
}
