import { describe, expect, it } from "vitest";
import { activeMonthAt, monthPillLabel, rowsBeforeMonth } from "@/features/activity/monthNav";
import { groupByMonthAndDay } from "@/features/activity/group";
import type { Transaction } from "@/domain/transaction";

let seq = 0;
function tx(date: string): Transaction {
  seq += 1;
  return {
    id: `txn_${seq}`, date, account: "ADVZ", destinationAccount: "", cashflow: "out", category: "Groceries",
    categoryType: "expense", merchant: "Edeka", amountCents: 100, notes: "",
    createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", deletedAt: null,
  };
}

describe("monthPillLabel", () => {
  it("is the short month in the current year", () => {
    expect(monthPillLabel("2026-11", "2026-11-10")).toBe("Nov");
  });
  it("is 'Sep', not en-GB's 'Sept'", () => {
    expect(monthPillLabel("2026-09", "2026-11-10")).toBe("Sep");
  });
  it("adds the year for another year", () => {
    expect(monthPillLabel("2025-12", "2026-01-02")).toBe("Dec 2025");
  });
});

describe("rowsBeforeMonth", () => {
  // Nov: 3 rows over two days, Oct: 2 rows, Aug: 1 row (no September).
  const months = groupByMonthAndDay([
    tx("2026-11-10"), tx("2026-11-10"), tx("2026-11-02"),
    tx("2026-10-31"), tx("2026-10-01"),
    tx("2026-08-15"),
  ]);
  it("is 0 for the first month", () => {
    expect(rowsBeforeMonth(months, "2026-11")).toBe(0);
  });
  it("counts every row of every earlier-listed month", () => {
    expect(rowsBeforeMonth(months, "2026-08")).toBe(5);
  });
  it("is -1 for a month not in the list", () => {
    expect(rowsBeforeMonth(months, "2026-09")).toBe(-1);
  });
});

describe("activeMonthAt", () => {
  const starts = [
    { monthKey: "2026-11", top: -900 },
    { monthKey: "2026-10", top: -100 },
    { monthKey: "2026-09", top: 400 },
  ];
  it("picks the last month whose start has reached the line", () => {
    expect(activeMonthAt(starts, 150)).toBe("2026-10");
  });
  it("is the first month when nothing has reached the line yet", () => {
    expect(activeMonthAt([{ monthKey: "2026-11", top: 300 }, { monthKey: "2026-10", top: 900 }], 150)).toBe("2026-11");
  });
  it("counts a start a sub-pixel below the line as reached (where a jump lands)", () => {
    expect(activeMonthAt([{ monthKey: "2026-11", top: -500 }, { monthKey: "2026-10", top: 150.6 }], 150)).toBe("2026-10");
  });
  it("is null for an empty list", () => {
    expect(activeMonthAt([], 150)).toBeNull();
  });
});
