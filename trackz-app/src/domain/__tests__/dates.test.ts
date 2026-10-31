import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatDayLabel,
  formatMonthLabel,
  getLastNMonthsRange,
  getMonthEndDate,
  getMonthStartDate,
  getThisMonthRange,
  getYearToDateRange,
  isValidISODate,
  isWithinRange,
  shiftMonthKey,
} from "@/domain/dates";

describe("dates (UTC-safe, timezone bug regression)", () => {
  it("validates real calendar dates only", () => {
    expect(isValidISODate("2024-02-29")).toBe(true); // leap year
    expect(isValidISODate("2023-02-29")).toBe(false); // not a leap year
    expect(isValidISODate("2024-13-01")).toBe(false);
    expect(isValidISODate("not-a-date")).toBe(false);
  });

  it("shifts months across year boundaries without DST drift", () => {
    expect(shiftMonthKey("2025-01", -1)).toBe("2024-12");
    expect(shiftMonthKey("2024-12", 1)).toBe("2025-01");
    expect(shiftMonthKey("2025-06", -6)).toBe("2024-12");
  });

  it("computes correct month end for February across leap/non-leap years", () => {
    expect(getMonthEndDate("2024-02")).toBe("2024-02-29");
    expect(getMonthEndDate("2023-02")).toBe("2023-02-28");
  });

  it("computes month start", () => {
    expect(getMonthStartDate("2025-07")).toBe("2025-07-01");
  });

  it("this-month range is anchored to the supplied local today, not UTC", () => {
    // Old bug: toISODate(new Date()) used toISOString() (UTC), so for a
    // user east of UTC late at night, "today" rolled back a day.
    const range = getThisMonthRange("2026-11-01");
    expect(range).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });

  it("last-N-months range includes the current partial month", () => {
    const range = getLastNMonthsRange(3, "2026-03-15");
    expect(range).toEqual({ from: "2026-01-01", to: "2026-03-15" });
  });

  it("year-to-date range starts Jan 1 of the given year", () => {
    const range = getYearToDateRange("2026-08-20");
    expect(range).toEqual({ from: "2026-01-01", to: "2026-08-20" });
  });

  it("isWithinRange is inclusive on both ends", () => {
    const range = { from: "2026-01-01", to: "2026-01-31" };
    expect(isWithinRange("2026-01-01", range)).toBe(true);
    expect(isWithinRange("2026-01-31", range)).toBe(true);
    expect(isWithinRange("2026-02-01", range)).toBe(false);
  });

  it("daysBetween counts whole calendar days, UTC-anchored across a DST boundary", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
    expect(daysBetween("2026-01-10", "2026-01-01")).toBe(-9);
    // March 29 2026 is a DST "spring forward" day in much of Europe; a
    // naive local-Date subtraction can be off by an hour here.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-02-01", "2026-03-01")).toBe(28); // 2026 not a leap year
  });
});

describe("formatDayLabel / formatMonthLabel (Phase 11 Activity day/month headers)", () => {
  it("labels the exact today date as 'Today'", () => {
    expect(formatDayLabel("2026-10-17", "2026-10-17")).toBe("Today");
  });

  it("labels the day before today as 'Yesterday'", () => {
    expect(formatDayLabel("2026-10-16", "2026-10-17")).toBe("Yesterday");
  });

  it("omits the year for a date in the same year as today", () => {
    expect(formatDayLabel("2026-10-01", "2026-10-17")).toBe("Thu 1 Oct");
  });

  it("includes the year for a date in a different year than today", () => {
    expect(formatDayLabel("2025-10-01", "2026-10-17")).toBe("Wed, 1 Oct 2025");
  });

  it("formats a month key as 'Month YYYY'", () => {
    expect(formatMonthLabel("2026-10")).toBe("October 2026");
    expect(formatMonthLabel("2025-01")).toBe("January 2025");
  });

  it("produces identical labels regardless of the host machine's timezone", () => {
    // Regression guard for the exact class of bug this module exists to
    // avoid (see header comment): formatting must not re-derive "now" or
    // shift across a local-timezone midnight boundary. Both formatters
    // take their dates as already-resolved ISODate strings, so flipping
    // process.env.TZ between calls must change nothing.
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "Asia/Dhaka";
      const dhakaDay = formatDayLabel("2026-10-01", "2026-10-17");
      const dhakaMonth = formatMonthLabel("2026-10");

      process.env.TZ = "America/Los_Angeles";
      const laDay = formatDayLabel("2026-10-01", "2026-10-17");
      const laMonth = formatMonthLabel("2026-10");

      expect(dhakaDay).toBe(laDay);
      expect(dhakaMonth).toBe(laMonth);
    } finally {
      process.env.TZ = originalTz;
    }
  });
});
