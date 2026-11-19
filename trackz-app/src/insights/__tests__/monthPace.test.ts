import { describe, expect, it } from "vitest";
import { getMonthPace } from "@/insights/engine";
import type { CategoryType, Transaction } from "@/domain/transaction";

let seq = 0;
function tx(date: string, category: string, amountCents: number, categoryType: CategoryType = "expense"): Transaction {
  seq += 1;
  return {
    id: `p${seq}`,
    date,
    account: "CMRZ",
    destinationAccount: "",
    cashflow: categoryType === "income" || categoryType === "non_income" ? "in" : "out",
    category,
    categoryType,
    merchant: "",
    amountCents,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("getMonthPace", () => {
  it("compares spend so far with the average FULL month, counting days after today in past months", () => {
    const txs = [
      tx("2026-10-02", "Food", 1000),
      tx("2026-10-28", "Food", 2000), // after the 15th, still in October's full month
      tx("2026-09-20", "Food", 6000),
      tx("2026-11-05", "Food", 1500),
      tx("2026-11-20", "Food", 9999), // after as-of: not spent yet
    ];
    expect(getMonthPace(txs, "2026-11", "2026-11-15")).toEqual({
      spentCents: 1500,
      usualCents: 4500, // (3000 + 6000) / 2
      usualMonths: 2,
      categories: [{ category: "Food", spentCents: 1500, usualCents: 4500, months: 2 }],
    });
  });

  it("averages a category over the months it had spend, and marks a new one with 0 months", () => {
    const txs = [
      tx("2026-10-07", "Power", 7200),
      tx("2026-09-07", "Food", 100),
      tx("2026-08-07", "Food", 100),
      tx("2026-11-07", "Power", 7300),
      tx("2026-11-08", "Gym", 3000),
    ];
    const pace = getMonthPace(txs, "2026-11", "2026-11-15");
    expect(pace.categories).toEqual([
      { category: "Power", spentCents: 7300, usualCents: 7200, months: 1 },
      { category: "Gym", spentCents: 3000, usualCents: 0, months: 0 },
    ]);
    expect(pace.usualCents).toBe(2467); // (7200 + 100 + 100) / 3, rounded
    expect(pace.usualMonths).toBe(3);
  });

  it("keeps only the top 3 by spend so far, ignores non-expense rows and months outside the window", () => {
    const txs = [
      tx("2026-11-01", "A", 400),
      tx("2026-11-01", "B", 300),
      tx("2026-11-01", "C", 200),
      tx("2026-11-01", "D", 100),
      tx("2026-11-01", "Loan", 9000, "non_expense"),
      tx("2026-04-01", "A", 50000), // 7 months back: outside a 6-month window
    ];
    const pace = getMonthPace(txs, "2026-11", "2026-11-15");
    expect(pace.categories.map((c) => c.category)).toEqual(["A", "B", "C"]);
    expect(pace.spentCents).toBe(1000);
    expect(pace).toMatchObject({ usualCents: 0, usualMonths: 0 });
  });

  it("nets non_income into spent and usual, and leaves a negative category out of the list", () => {
    const txs = [
      tx("2026-10-03", "Shopping", 8000),
      tx("2026-10-09", "Refunds", 2000, "non_income"),
      tx("2026-11-02", "Shopping", 5000),
      tx("2026-11-04", "Shopping", 1000, "non_income"),
      tx("2026-11-06", "Refunds", 1500, "non_income"),
    ];
    const pace = getMonthPace(txs, "2026-11", "2026-11-15");
    expect(pace).toEqual({
      spentCents: 2500, // 5000 - 1000 - 1500
      usualCents: 6000, // October: 8000 - 2000
      usualMonths: 1,
      categories: [{ category: "Shopping", spentCents: 4000, usualCents: 8000, months: 1 }],
    });
  });
});
