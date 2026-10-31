import { describe, expect, it } from "vitest";
import {
  daysBetween,
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
