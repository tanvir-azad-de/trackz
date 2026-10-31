import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import {
  getAccountBalances,
  getCategoryDeltasForMonth,
  getMonthlyExpenseSeries,
  getTopCategoriesForMonth,
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
