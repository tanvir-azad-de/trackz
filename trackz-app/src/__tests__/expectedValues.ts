import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Expected values for the real-data suites, read from gitignored
 * dummyData/ rather than written into the tests. This repo is public: a
 * real balance or a counterparty's name in a committed test is published,
 * even though the CSV it came from is not. Keep every real figure and
 * name in expected-values.json and only the assertion shape here.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = resolve(__dirname, "../../../dummyData/snapshot-2026-10-31/expected-values.json"); // src/__tests__ -> trackz-app -> trackz

export interface ExpectedValues {
  engine: {
    september: { monthKey: string; incomeCents: number; expenseCents: number };
    october: { monthKey: string; incomeCents: number; expenseCents: number };
    dailyExpenseAvg: { today: string; expenseCents: number };
    topCategory: { category: string; amountCents: number };
    alsoInTop4: string[];
    deltas: { asOfDate: string; category: string; thisMonthCents: number; baselineAvgCents: number; isNew: boolean }[];
    accountBalance: { account: string; balanceCents: number };
    monthlyExpense: { monthKey: string; expenseCents: number };
    receivables: { outstandingCents: Record<string, number>; settledToZero: string[]; totalCents: number };
    liquid: { investmentAccount: string; allCashCents: number; withInvestmentExcludedCents: number };
    balanceSheet: {
      accountTypes: Record<string, "cash" | "investment" | "credit_card">;
      netWorthCents: number;
      liquidTotalCents: number;
      liquidAccounts: string[];
      otherTotalCents: number;
      liabilitiesTotalCents: number;
    };
  };
}

export const hasExpectedValues = existsSync(path);

export function readExpectedValues(): ExpectedValues {
  return JSON.parse(readFileSync(path, "utf-8")) as ExpectedValues;
}
