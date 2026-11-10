import { describe, expect, it } from "vitest";
import { getCumulativeExpenseSeries, getDailyExpenseAvgCents, getLiquidVsSameDayAverage, summarizeMonth } from "@/insights/engine";
import type { Cashflow, CategoryType, Transaction } from "@/domain/transaction";

/**
 * Synthetic, so it runs without the gitignored real data. The real-data
 * checks with exact cents are in engine.test.ts.
 */
let seq = 0;
function row(date: string, categoryType: CategoryType, cashflow: Cashflow, amountCents: number, account = "ADVZ"): Transaction {
  seq++;
  return {
    id: `t${seq}`,
    date,
    account,
    destinationAccount: "",
    cashflow,
    category: "C",
    categoryType,
    merchant: "",
    amountCents,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("summarizeMonth", () => {
  it("counts only income and expense, not non_income/non_expense", () => {
    const txs = [
      row("2026-10-03", "income", "in", 200000),
      row("2026-10-04", "non_income", "in", 30000),
      row("2026-10-05", "expense", "out", 5000),
      row("2026-10-06", "non_expense", "out", 60000),
    ];
    expect(summarizeMonth(txs, "2026-10")).toEqual({ monthKey: "2026-10", incomeCents: 200000, expenseCents: 5000 });
  });

  it("stops at asOfDate", () => {
    const txs = [row("2026-10-05", "expense", "out", 5000), row("2026-10-20", "expense", "out", 700)];
    expect(summarizeMonth(txs, "2026-10", "2026-10-10").expenseCents).toBe(5000);
  });
});

describe("getDailyExpenseAvgCents", () => {
  it("divides this month's spend up to today by today's day of the month, rounded", () => {
    // 100,00 € over 3 days = 33,333… → 3333 cents. Last month and a later
    // row this month are excluded.
    const txs = [
      row("2026-11-01", "expense", "out", 4000),
      row("2026-11-03", "expense", "out", 6000),
      row("2026-11-03", "non_expense", "out", 9000),
      row("2026-10-30", "expense", "out", 50000),
      row("2026-11-04", "expense", "out", 50000),
    ];
    expect(getDailyExpenseAvgCents(txs, "2026-11-03")).toBe(3333);
  });

  it("divides by 1 on the 1st", () => {
    expect(getDailyExpenseAvgCents([row("2026-11-01", "expense", "out", 1234)], "2026-11-01")).toBe(1234);
  });
});

describe("getLiquidVsSameDayAverage", () => {
  // One cash account. The balance on the 10th of each month is set by a
  // deposit on the 1st and a withdrawal on the 20th, so the 10th and the
  // 25th give different answers.
  function salaryMonths(): Transaction[] {
    const txs: Transaction[] = [];
    for (const m of ["05", "06", "07", "08", "09", "10"]) {
      txs.push(row(`2026-${m}-01`, "income", "in", 100000));
      txs.push(row(`2026-${m}-20`, "expense", "out", 90000));
    }
    return txs;
  }

  it("averages liquid on the same day of each of the previous 6 months", () => {
    // Balance on the 10th: May 1000, Jun 1100, Jul 1200, Aug 1300, Sep 1400, Oct 1500 → avg 1250 €.
    const r = getLiquidVsSameDayAverage(salaryMonths(), {}, 150000, "2026-11-10");
    expect(r).toEqual({ averageCents: 125000, monthsUsed: 6, deltaPercent: 20 });
  });

  it("compares the 31st with the end of shorter months, and skips months before the first transaction", () => {
    // Sep..May compare on their last day, after the 20th's withdrawal:
    // Sep 500, Aug 400, Jul 300, Jun 200, May 100. April is before the
    // first row and is skipped, not counted as 0 (which would give 250).
    const r = getLiquidVsSameDayAverage(salaryMonths(), {}, 60000, "2026-10-31");
    expect(r).toEqual({ averageCents: 30000, monthsUsed: 5, deltaPercent: 100 });
  });

  it("excludes investment accounts from the past balances, like the Liquid figure itself", () => {
    const txs = [...salaryMonths(), row("2026-05-01", "income", "in", 1000000, "SCLB")];
    expect(getLiquidVsSameDayAverage(txs, { SCLB: "investment" }, 150000, "2026-11-10").averageCents).toBe(125000);
  });

  it("gives no percentage without history or with a non-positive average", () => {
    expect(getLiquidVsSameDayAverage([row("2026-11-02", "income", "in", 100)], {}, 100, "2026-11-10")).toEqual({
      averageCents: 0,
      monthsUsed: 0,
      deltaPercent: null,
    });
    const overdrawn = [row("2026-09-01", "expense", "out", 5000)];
    expect(getLiquidVsSameDayAverage(overdrawn, {}, 100, "2026-11-10").deltaPercent).toBeNull();
  });
});

describe("getCumulativeExpenseSeries", () => {
  it("runs from 0 through each day up to today, expense rows only", () => {
    const txs = [
      row("2026-11-01", "expense", "out", 1000),
      row("2026-11-03", "expense", "out", 250),
      row("2026-11-03", "expense", "out", 50),
      row("2026-11-02", "non_expense", "out", 9999),
      row("2026-11-02", "income", "in", 9999),
      row("2026-10-31", "expense", "out", 9999),
      row("2026-11-05", "expense", "out", 9999),
    ];
    expect(getCumulativeExpenseSeries(txs, "2026-11-04")).toEqual([0, 1000, 1000, 1300, 1300]);
  });

  it("is [0, 0] on the 1st with nothing logged, so the line still draws", () => {
    expect(getCumulativeExpenseSeries([], "2026-11-01")).toEqual([0, 0]);
  });
});
