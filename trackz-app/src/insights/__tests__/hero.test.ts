import { describe, expect, it } from "vitest";
import { getBalanceSheet, getLiquidCashCents, getMonthlyExpenseSeries, summarizeMonth } from "@/insights/engine";
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

describe("getMonthlyExpenseSeries", () => {
  const txs = [
    row("2026-11-01", "expense", "out", 1000),
    row("2026-11-03", "expense", "out", 250),
    row("2026-11-02", "non_expense", "out", 9999),
    row("2026-11-02", "income", "in", 9999),
    // Later than today: must not reach the November point.
    row("2026-11-05", "expense", "out", 7777),
    row("2026-10-31", "expense", "out", 400),
    // A refund booked as a negative expense row nets against the month.
    row("2026-09-10", "expense", "out", 2000),
    row("2026-09-11", "expense", "out", -300),
    // Older than the 6-month window.
    row("2026-05-31", "expense", "out", 5555),
  ];

  it("gives six months oldest first, the last capped at today", () => {
    expect(getMonthlyExpenseSeries(txs, "2026-11", 6, "2026-11-04")).toEqual([
      { monthKey: "2026-06", expenseCents: 0 },
      { monthKey: "2026-07", expenseCents: 0 },
      { monthKey: "2026-08", expenseCents: 0 },
      { monthKey: "2026-09", expenseCents: 1700 },
      { monthKey: "2026-10", expenseCents: 400 },
      { monthKey: "2026-11", expenseCents: 1250 },
    ]);
  });

  it("ends at summarizeMonth's expense for the same today", () => {
    const series = getMonthlyExpenseSeries(txs, "2026-11", 6, "2026-11-04");
    expect(series[5]!.expenseCents).toBe(summarizeMonth(txs, "2026-11", "2026-11-04").expenseCents);
  });
});

describe("getLiquidCashCents with a credit card", () => {
  it("counts cash accounts only: a card's spending and its payoff transfer both stay out of Liquid", () => {
    const txs = [
      row("2026-11-01", "income", "in", 300000, "CMRZ"),
      row("2026-11-02", "expense", "out", 4500, "ADVZ"), // card spend
      row("2026-11-03", "expense", "out", 1250, "CMRZ"),
      // Paying the card off from cash: Liquid drops by it, the card rises.
      { ...row("2026-11-04", "transfer", "none", 4500, "CMRZ"), destinationAccount: "ADVZ", category: "" },
      { ...row("2026-11-05", "transfer", "none", 100000, "CMRZ"), destinationAccount: "SCLB", category: "" },
    ];
    const types = { CMRZ: "cash", ADVZ: "credit_card", SCLB: "investment" } as const;

    // CMRZ only: 300000 - 1250 - 4500 - 100000. (The card nets to zero
    // here, so this alone cannot tell cash from credit_card; the next
    // case can.)
    expect(getLiquidCashCents(txs, types)).toBe(194250);

    const withUnpaidSpend = [...txs, row("2026-11-06", "expense", "out", 2000, "ADVZ")];
    // Unpaid card spend is not yet cash leaving: Liquid is unchanged.
    expect(getLiquidCashCents(withUnpaidSpend, types)).toBe(194250);
    // The bug this replaces: as "cash", ADVZ's -2000 lands in Liquid.
    expect(getLiquidCashCents(withUnpaidSpend, { ...types, ADVZ: "cash" })).toBe(192250);
  });
});

describe("getBalanceSheet", () => {
  const types = { CMRZ: "cash", CASH: "cash", SCLB: "investment", ADVZ: "credit_card" } as const;
  function sheetTxs(): Transaction[] {
    return [
      row("2026-11-01", "income", "in", 300000, "CMRZ"),
      row("2026-11-01", "income", "in", 5000, "CASH"),
      { ...row("2026-11-02", "transfer", "none", 100000, "CMRZ"), destinationAccount: "SCLB", category: "" },
      row("2026-11-03", "expense", "out", 4500, "ADVZ"), // unpaid card spend
      { ...row("2026-11-04", "receivable", "out", 20000, "CMRZ"), merchant: "Friend A" },
      { ...row("2026-11-05", "payable", "in", 7000, "CMRZ"), merchant: "Friend B" },
      // REVJ: in and out again — a dormant 0,00 € account.
      row("2026-11-06", "income", "in", 1000, "REVJ"),
      row("2026-11-07", "expense", "out", 1000, "REVJ"),
    ];
  }

  it("splits accounts by type, with card debt as a positive liability and net worth as assets minus liabilities", () => {
    const sheet = getBalanceSheet(sheetTxs(), types);
    // CMRZ: 300000 - 100000 - 20000 + 7000 = 187000. REVJ is 0 and dropped.
    expect(sheet.liquid).toEqual({
      totalCents: 192000,
      rows: [
        { label: "CASH", kind: "cash", amountCents: 5000 },
        { label: "CMRZ", kind: "cash", amountCents: 187000 },
      ],
    });
    expect(sheet.other).toEqual({
      totalCents: 120000,
      rows: [
        { label: "SCLB", kind: "investment", amountCents: 100000 },
        { label: "Lent out", kind: "lent_out", amountCents: 20000 },
      ],
    });
    expect(sheet.liabilities).toEqual({
      totalCents: 11500,
      rows: [
        { label: "ADVZ", kind: "credit_card", amountCents: 4500 },
        { label: "Borrowed", kind: "borrowed", amountCents: 7000 },
      ],
    });
    // 192000 + 120000 - 11500. Equals income minus expense (305000 + 1000
    // - 4500 - 1000): lending and borrowing net to zero.
    expect(sheet.netWorthCents).toBe(300500);
  });

  it("drops zero rows, so a settled loan and a paid-off card leave no 0,00 € line", () => {
    const txs = [
      ...sheetTxs(),
      { ...row("2026-11-08", "receivable", "in", 20000, "CMRZ"), merchant: "Friend A" },
      { ...row("2026-11-09", "payable", "out", 7000, "CMRZ"), merchant: "Friend B" },
      { ...row("2026-11-10", "transfer", "none", 4500, "CMRZ"), destinationAccount: "ADVZ", category: "" },
    ];
    const sheet = getBalanceSheet(txs, types);
    expect(sheet.other.rows.map((r) => r.label)).toEqual(["SCLB"]);
    expect(sheet.liabilities).toEqual({ totalCents: 0, rows: [] });
    expect(sheet.netWorthCents).toBe(300500);
  });

  it("treats an unclassified account as cash", () => {
    expect(getBalanceSheet(sheetTxs(), {}).liquid.rows.map((r) => r.label)).toEqual(["ADVZ", "CASH", "CMRZ", "SCLB"]);
  });
});
