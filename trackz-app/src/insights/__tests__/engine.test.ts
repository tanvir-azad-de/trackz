import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import {
  getAccountActivity,
  getAccountBalanceSeries,
  getAccountBalances,
  getCategoryDeltasForMonth,
  getLiquidCashCents,
  getMonthlyExpenseSeries,
  getPayableBalances,
  getReceivableBalances,
  getTopCategoriesForMonth,
  getDailyExpenseAvgCents,
  getLiquidVsSameDayAverage,
  summarizeMonth,
} from "@/insights/engine";
import type { Transaction } from "@/domain/transaction";
import { hasExpectedValues, readExpectedValues, type ExpectedValues } from "@/__tests__/expectedValues";

/**
 * Verifies the insight engine's output against numbers independently
 * computed with a standalone python script against the real CSV
 * (September 2026, the last fully-complete month in the dataset — see
 * the grill session).
 *
 * dummyData/ is gitignored real financial data — absent on a fresh clone
 * or CI (Phase 15a fixture-gap fix). Every test in this file depends on
 * it (unlike filter.test.ts/group.test.ts, which mix in synthetic-only
 * cases), so describe.skipIf on the whole suite is correct here rather
 * than guarding individual blocks.
 *
 * The expected figures and counterparty names live in gitignored
 * dummyData/.../expected-values.json, not here: this repo is public.
 * See src/__tests__/expectedValues.ts.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../.."); // src/insights/__tests__ -> trackz-app -> trackz
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");
const hasFixture = existsSync(csvPath) && hasExpectedValues;

let transactions: Transaction[];
let want: ExpectedValues["engine"];

beforeAll(() => {
  if (!hasFixture) return;
  const csvText = readFileSync(csvPath, "utf-8");
  const result = parseTransactionsCsv(csvText);
  expect(result.errors).toEqual([]);
  transactions = result.transactions;
  want = readExpectedValues().engine;
});

describe.skipIf(!hasFixture)("insight engine against real September 2026 data", () => {
  it("summarizes income/expense for September", () => {
    const summary = summarizeMonth(transactions, want.september.monthKey);
    expect(summary.incomeCents).toBe(want.september.incomeCents);
    expect(summary.expenseCents).toBe(want.september.expenseCents);
  });

  it("leaves non_income/non_expense out of October's income and expense", () => {
    // October has both, so this is the month that catches the old inflation.
    const summary = summarizeMonth(transactions, want.october.monthKey);
    expect(summary.incomeCents).toBe(want.october.incomeCents);
    expect(summary.expenseCents).toBe(want.october.expenseCents);
  });

  it("averages October's spend per day up to the 15th", () => {
    expect(getDailyExpenseAvgCents(transactions, want.dailyExpenseAvg.today)).toBe(want.dailyExpenseAvg.cents);
  });

  it("ends the 6-month chart series at the same figure as the daily average's numerator", () => {
    const series = getMonthlyExpenseSeries(transactions, "2026-10", 6, want.dailyExpenseAvg.today);
    expect(series).toHaveLength(6);
    expect(series[5]!.expenseCents).toBe(want.dailyExpenseAvg.expenseCents);
  });

  it("averages liquid cash on the same day of the previous 6 months", () => {
    for (const w of want.liquidVsSameDay) {
      const current = getLiquidCashCents(transactions, { [want.liquid.investmentAccount]: "investment" }, w.today);
      expect(current).toBe(w.currentCents);
      const r = getLiquidVsSameDayAverage(transactions, { [want.liquid.investmentAccount]: "investment" }, current, w.today);
      expect(r.averageCents).toBe(w.averageCents);
      expect(r.monthsUsed).toBe(6);
    }
  });

  it("caps the category list at today, so October's categories add up to the daily average's numerator", () => {
    const all = getTopCategoriesForMonth(transactions, "2026-10", Infinity, want.dailyExpenseAvg.today);
    expect(all.reduce((sum, c) => sum + c.amountCents, 0)).toBe(want.dailyExpenseAvg.expenseCents);
  });

  it("ranks top expense categories for September", () => {
    const top = getTopCategoriesForMonth(transactions, "2026-09", 4);
    expect(top[0]!.category).toBe(want.topCategory.category);
    expect(top[0]!.amountCents).toBe(want.topCategory.amountCents);
    for (const category of want.alsoInTop4) {
      expect(top.map((t) => t.category)).toContain(category);
    }
  });

  it("computes same-days deltas with the exact independently computed cents", () => {
    // Full month (the 30th) and a partial one (the 15th), including a
    // category with spend in only 2 of the 6 baseline months (divisor 2,
    // not 6), a new one, and a 15th whose window average is an exact .5
    // (Math.round half-up, which the fixture was computed to match).
    expect(want.deltas.length).toBeGreaterThan(0); // fixture sanity: an empty list would pass vacuously
    for (const w of want.deltas) {
      const delta = getCategoryDeltasForMonth(transactions, "2026-09", 6, w.asOfDate).find((d) => d.category === w.category)!;
      expect({ at: w.asOfDate, category: delta.category, thisMonthCents: delta.thisMonthCents, baselineAvgCents: delta.baselineAvgCents, isNew: delta.isNew }).toEqual({
        at: w.asOfDate,
        category: w.category,
        thisMonthCents: w.thisMonthCents,
        baselineAvgCents: w.baselineAvgCents,
        isNew: w.isNew,
      });
    }
  });

  it("computes per-account balances as of the full dataset", () => {
    const balances = getAccountBalances(transactions);
    const account = balances.find((b) => b.account === want.accountBalance.account)!;
    expect(account.balanceCents).toBe(want.accountBalance.balanceCents);
  });

  it("builds a 6-month expense series ending at September, matching the sparkline mockup", () => {
    const series = getMonthlyExpenseSeries(transactions, "2026-09", 6);
    expect(series.map((s) => s.monthKey)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    const month = series.find((s) => s.monthKey === want.monthlyExpense.monthKey)!;
    expect(month.expenseCents).toBe(want.monthlyExpense.expenseCents);
  });
});

/**
 * Phase 12 (Accounts screen) additions. Reference figures independently
 * computed with a standalone python script against the same CSV (not
 * this codebase).
 */
describe.skipIf(!hasFixture)("Phase 12: account activity, receivables/payables, total assets", () => {
  it("surfaces last-activity date per account, including dormant ones", () => {
    const activity = getAccountActivity(transactions);
    const byAccount = Object.fromEntries(activity.map((a) => [a.account, a]));
    expect(byAccount["CMRZ"]!.lastActivityDate).toBe("2026-10-16");
    expect(byAccount["REVO"]!.lastActivityDate).toBe("2026-10-17");
    // Dormant accounts are surfaced, not dropped.
    expect(byAccount["REVB"]!.lastActivityDate).toBe("2026-04-11");
    expect(byAccount["REVJ"]!.lastActivityDate).toBe("2026-08-17");
  });

  it("builds a 6-month end-of-month running balance series (cumulative, not per-month deltas), including an account that goes negative every month without special-casing", () => {
    expect(want.balanceSeries.length).toBeGreaterThan(0); // fixture sanity
    for (const { account, points } of want.balanceSeries) {
      const series = getAccountBalanceSeries(transactions, account, "2026-09", 6);
      expect(series.map((s) => s.monthKey)).toEqual([
        "2026-04",
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
      ]);
      const byMonth = Object.fromEntries(series.map((s) => [s.monthKey, s.balanceCents]));
      for (const [monthKey, balanceCents] of Object.entries(points)) {
        expect(byMonth[monthKey]).toBe(balanceCents);
      }
    }
  });

  it("computes outstanding receivable ('Lent out') balances per counterparty, excluding settled-to-zero ones", () => {
    const receivables = getReceivableBalances(transactions);
    const byCounterparty = Object.fromEntries(receivables.map((r) => [r.counterparty, r.balanceCents]));
    expect(byCounterparty).toMatchObject(want.receivables.outstandingCents);
    // A counterparty lent and repaid the same amount nets to exactly 0 and must not appear as a row.
    expect(want.receivables.settledToZero.length).toBeGreaterThan(0); // fixture sanity
    for (const name of want.receivables.settledToZero) {
      expect(byCounterparty[name]).toBeUndefined();
    }

    const total = receivables.reduce((sum, r) => sum + r.balanceCents, 0);
    expect(total).toBe(want.receivables.totalCents);
  });

  it("returns an empty list for payables ('I owe') — zero payable rows exist in the real dataset", () => {
    expect(getPayableBalances(transactions)).toEqual([]);
  });
});

/**
 * Post-Phase-12 fix: an investment account was being summed into "Liquid"
 * alongside true cash accounts, overstating spendable cash by its full
 * balance. Reference figures re-derived from the same independent python
 * script's per-account output minus that account.
 */
describe.skipIf(!hasFixture)("account-type classification: cash vs investment", () => {
  it("getLiquidCashCents excludes accounts classified as investment", () => {
    const allCash = getLiquidCashCents(transactions, {}); // no classification = everything is cash
    expect(allCash).toBe(want.liquid.allCashCents);

    const withInvestmentExcluded = getLiquidCashCents(transactions, { [want.liquid.investmentAccount]: "investment" });
    expect(withInvestmentExcluded).toBe(want.liquid.withInvestmentExcludedCents);
  });

  it("getLiquidCashCents defaults every account to cash when accountTypes is omitted", () => {
    expect(getLiquidCashCents(transactions)).toBe(getLiquidCashCents(transactions, {}));
  });

  it("getAccountActivity tags each account with its classification, defaulting unlisted accounts to cash", () => {
    const activity = getAccountActivity(transactions, { SCLB: "investment" });
    const byAccount = Object.fromEntries(activity.map((a) => [a.account, a.accountType]));
    expect(byAccount["SCLB"]).toBe("investment");
    expect(byAccount["CMRZ"]).toBe("cash");
    expect(byAccount["ADVZ"]).toBe("cash");
  });
});
