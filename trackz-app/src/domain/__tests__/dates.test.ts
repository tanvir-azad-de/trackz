import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatOrdinalDay,
  formatShortDay,
  formatDayLabel,
  formatDayHeading,
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

describe("formatDayHeading (Activity day-card titles)", () => {
  it("keeps Today and Yesterday", () => {
    expect(formatDayHeading("2026-11-10", "2026-11-10")).toBe("Today");
    expect(formatDayHeading("2026-11-09", "2026-11-10")).toBe("Yesterday");
  });

  it("is 'D. Month' with no leading zero in the same year", () => {
    expect(formatDayHeading("2026-11-07", "2026-11-10")).toBe("7. November");
  });

  it("appends the year for a different year, even across New Year", () => {
    expect(formatDayHeading("2025-12-30", "2026-01-02")).toBe("30. December 2025");
  });

  it("does not shift the day across a timezone midnight", () => {
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(formatDayHeading("2026-10-01", "2026-10-17")).toBe("1. October");
      process.env.TZ = "Asia/Dhaka";
      expect(formatDayHeading("2026-10-01", "2026-10-17")).toBe("1. October");
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

describe("formatDayLabel (Accounts last-activity, detail sheet 'Logged')", () => {
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

      process.env.TZ = "America/Los_Angeles";
      const laDay = formatDayLabel("2026-10-01", "2026-10-17");

      expect(dhakaDay).toBe(laDay);
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

describe("formatOrdinalDay", () => {
  it("uses st/nd/rd for 1/2/3 endings except 11-13", () => {
    const got = [1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 30, 31].map(formatOrdinalDay);
    expect(got).toEqual(["1st", "2nd", "3rd", "4th", "10th", "11th", "12th", "13th", "21st", "22nd", "23rd", "30th", "31st"]);
  });
});

describe("formatShortDay", () => {
  it("formats day and short month without shifting the day", () => {
    expect([formatShortDay("2026-11-01"), formatShortDay("2026-11-30")]).toEqual(["1 Nov", "30 Nov"]);
  });
});
