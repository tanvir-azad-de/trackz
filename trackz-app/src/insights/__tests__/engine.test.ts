import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
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
  getTotalAssetsCents,
  summarizeMonth,
} from "@/insights/engine";
import { centsToDecimal } from "@/domain/money";
import type { Transaction } from "@/domain/transaction";

/**
 * Verifies the insight engine's output against numbers independently
 * computed with a standalone python script against the real CSV
 * (September 2026, the last fully-complete month in the dataset — see
 * the grill session). These are the exact figures shown in the approved
 * Home screen mockup (docs/mockups/home-b-flat-minimal.html).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../.."); // src/insights/__tests__ -> trackz-app -> trackz
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");

let transactions: Transaction[];

beforeAll(() => {
  const csvText = readFileSync(csvPath, "utf-8");
  const result = parseTransactionsCsv(csvText);
  expect(result.errors).toEqual([]);
  transactions = result.transactions;
});

describe("insight engine against real September 2026 data", () => {
  it("summarizes income/expense/surplus for September", () => {
    const summary = summarizeMonth(transactions, "2026-09");
    expect(centsToDecimal(summary.incomeCents)).toBeCloseTo(3125.84, 2);
    expect(centsToDecimal(summary.expenseCents)).toBeCloseTo(2714.32, 2);
    expect(centsToDecimal(summary.surplusCents)).toBeCloseTo(411.52, 2);
  });

  it("ranks top expense categories for September", () => {
    const top = getTopCategoriesForMonth(transactions, "2026-09", 4);
    expect(top[0]).toMatchObject({ category: "Rent" });
    expect(centsToDecimal(top[0]!.amountCents)).toBeCloseTo(960, 2);
    expect(top.map((t) => t.category)).toContain("Shopping");
    expect(top.map((t) => t.category)).toContain("Groceries");
  });

  it("computes 6-month baseline deltas: Shopping up ~80%, Family Support down ~53%", () => {
    const deltas = getCategoryDeltasForMonth(transactions, "2026-09", 6);
    const shopping = deltas.find((d) => d.category === "Shopping")!;
    expect(shopping.deltaPercent).toBeGreaterThan(70);
    expect(shopping.deltaPercent).toBeLessThan(90);

    const family = deltas.find((d) => d.category === "Family Support")!;
    expect(family.deltaPercent).toBeLessThan(-45);
    expect(family.deltaPercent).toBeGreaterThan(-60);
  });

  it("prorates the baseline for a partial month instead of falsely showing a crash (regression: caught via live headless smoke test against Oct 2026, a 17-day partial month)", () => {
    // Full-month September average, unprorated.
    const fullMonth = getCategoryDeltasForMonth(transactions, "2026-09", 6, "2026-09-30");
    const groceriesFull = fullMonth.find((d) => d.category === "Groceries")!;

    // Same category type, but pretend "today" is only the 15th of the month.
    const partialMonth = getCategoryDeltasForMonth(transactions, "2026-09", 6, "2026-09-15");
    const groceriesPartial = partialMonth.find((d) => d.category === "Groceries")!;

    // The partial-month baseline must be roughly half the full-month baseline
    // (15/30 days), not the same — otherwise every category looks like it
    // collapsed simply because the month isn't over yet.
    expect(groceriesPartial.baselineAvgCents).toBeLessThan(groceriesFull.baselineAvgCents);
    expect(groceriesPartial.baselineAvgCents / groceriesFull.baselineAvgCents).toBeCloseTo(15 / 30, 1);
  });

  it("computes per-account balances as of the full dataset", () => {
    const balances = getAccountBalances(transactions);
    const cmrz = balances.find((b) => b.account === "CMRZ")!;
    expect(centsToDecimal(cmrz.balanceCents)).toBeCloseTo(700.01, 2);
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
    const may = series.find((s) => s.monthKey === "2026-05")!;
    expect(centsToDecimal(may.expenseCents)).toBeCloseTo(5277.31, 2);
  });
});

/**
 * Phase 12 (Accounts screen) additions. Reference figures independently
 * computed with a standalone python script against the same CSV (not
 * this codebase) — see the numbers quoted in docs/renovation_version_1.txt's
 * Phase 12 write-up.
 */
describe("Phase 12: account activity, receivables/payables, total assets", () => {
  it("surfaces last-activity date per account, including dormant ones", () => {
    const activity = getAccountActivity(transactions);
    const byAccount = Object.fromEntries(activity.map((a) => [a.account, a]));
    expect(byAccount["CMRZ"]!.lastActivityDate).toBe("2026-10-16");
    expect(byAccount["REVO"]!.lastActivityDate).toBe("2026-10-17");
    // Dormant accounts are surfaced, not dropped.
    expect(byAccount["REVB"]!.lastActivityDate).toBe("2026-04-11");
    expect(byAccount["REVJ"]!.lastActivityDate).toBe("2026-08-17");
  });

  it("builds a 6-month end-of-month running balance series for one account (cumulative, not per-month deltas)", () => {
    const series = getAccountBalanceSeries(transactions, "CMRZ", "2026-09", 6);
    expect(series.map((s) => s.monthKey)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    const byMonth = Object.fromEntries(series.map((s) => [s.monthKey, centsToDecimal(s.balanceCents)]));
    expect(byMonth["2026-04"]).toBeCloseTo(5075.21, 2);
    expect(byMonth["2026-05"]).toBeCloseTo(2956.16, 2);
    expect(byMonth["2026-09"]).toBeCloseTo(1695.1, 2);
  });

  it("handles a negative-running-balance account in the series without special-casing (ADVZ goes negative every month in this window)", () => {
    const series = getAccountBalanceSeries(transactions, "ADVZ", "2026-09", 6);
    const byMonth = Object.fromEntries(series.map((s) => [s.monthKey, centsToDecimal(s.balanceCents)]));
    expect(byMonth["2026-04"]).toBeCloseTo(-433.91, 2);
    expect(byMonth["2026-09"]).toBeCloseTo(-459.66, 2);
  });

  it("computes outstanding receivable ('Lent out') balances per counterparty, excluding settled-to-zero ones", () => {
    const receivables = getReceivableBalances(transactions);
    const byCounterparty = Object.fromEntries(
      receivables.map((r) => [r.counterparty, centsToDecimal(r.balanceCents)]),
    );
    expect(byCounterparty["Kaution"]).toBeCloseTo(2160, 2);
    expect(byCounterparty["Towkir"]).toBeCloseTo(195.99, 2);
    expect(byCounterparty["Al Imran Ahmed"]).toBeCloseTo(19.9, 2);
    // Chayan Mitra lent 130, repaid 130 — settled to exactly 0, must not appear as a row.
    expect(byCounterparty["Chayan Mitra"]).toBeUndefined();

    const total = receivables.reduce((sum, r) => sum + centsToDecimal(r.balanceCents), 0);
    expect(total).toBeCloseTo(2415.69, 2);
  });

  it("returns an empty list for payables ('I owe') — zero payable rows exist in the real dataset", () => {
    expect(getPayableBalances(transactions)).toEqual([]);
  });

  it("computes total assets as liquid + receivables - payables, reconciling Home's liquid-only hero with the Accounts screen's fuller picture", () => {
    const total = getTotalAssetsCents(transactions);
    expect(centsToDecimal(total)).toBeCloseTo(5562.76, 2);
  });
});

/**
 * Post-Phase-12 fix: SCLB (Scalable Capital, a real brokerage account in
 * the user's data) was being summed into "Liquid" alongside true cash
 * accounts, overstating spendable cash by its full 2.300,00 € balance.
 * Reference figures re-derived from the same independent python script's
 * per-account output (see Phase 12's reference-totals.json) minus SCLB.
 */
describe("account-type classification: cash vs investment", () => {
  it("getLiquidCashCents excludes accounts classified as investment", () => {
    const allCash = getLiquidCashCents(transactions, {}); // no classification = everything is cash
    expect(centsToDecimal(allCash)).toBeCloseTo(3147.07, 2);

    const withSclbAsInvestment = getLiquidCashCents(transactions, { SCLB: "investment" });
    expect(centsToDecimal(withSclbAsInvestment)).toBeCloseTo(847.07, 2);
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

  it("getTotalAssetsCents is unaffected by account-type classification — investment balances are still real assets, not excluded from the full picture", () => {
    expect(centsToDecimal(getTotalAssetsCents(transactions))).toBeCloseTo(5562.76, 2);
  });
});
