import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import { filterTransactions, emptyFilter } from "@/features/activity/filter";
import { groupByMonthAndDay } from "@/features/activity/group";
import type { Transaction } from "@/domain/transaction";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../../..");
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");
// dummyData/ is gitignored real financial data — absent on a fresh clone
// or CI (Phase 15a fixture-gap fix). This file is mostly synthetic
// fixtures (makeTx below); only the two real-CSV tests at the bottom
// need gating, so hasFixture guards those individually rather than the
// whole file.
const hasFixture = existsSync(csvPath);

let transactions: Transaction[];

beforeAll(() => {
  if (!hasFixture) return;
  const csvText = readFileSync(csvPath, "utf-8");
  const result = parseTransactionsCsv(csvText);
  expect(result.errors).toEqual([]);
  transactions = result.transactions;
});

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: "t",
    date: "2026-10-17",
    account: "ADVZ",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant: "Edeka",
    amountCents: 1000,
    notes: "",
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("groupByMonthAndDay", () => {
  it("returns an empty array for an empty input", () => {
    expect(groupByMonthAndDay([])).toEqual([]);
  });

  it("groups same-day transactions together and computes their net", () => {
    const txs = [
      makeTx({ id: "1", date: "2026-10-17", cashflow: "out", categoryType: "expense", amountCents: 500 }),
      makeTx({ id: "2", date: "2026-10-17", cashflow: "in", categoryType: "income", amountCents: 2000 }),
    ];
    const groups = groupByMonthAndDay(txs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.days).toHaveLength(1);
    expect(groups[0]!.days[0]!.netCents).toBe(1500); // +2000 income, -500 expense
    expect(groups[0]!.days[0]!.transactions).toHaveLength(2);
  });

  it("splits transactions on different days into separate day groups, same month", () => {
    const txs = [
      makeTx({ id: "1", date: "2026-10-17" }),
      makeTx({ id: "2", date: "2026-10-16" }),
    ];
    const groups = groupByMonthAndDay(txs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.days.map((d) => d.date)).toEqual(["2026-10-17", "2026-10-16"]);
  });

  it("splits transactions in different months into separate month groups, preserving input order", () => {
    const txs = [
      makeTx({ id: "1", date: "2026-10-17" }),
      makeTx({ id: "2", date: "2026-09-30" }),
    ];
    const groups = groupByMonthAndDay(txs);
    expect(groups.map((g) => g.monthKey)).toEqual(["2026-10", "2026-09"]);
  });

  it("a transfer day nets to zero", () => {
    const txs = [
      makeTx({ id: "1", date: "2026-10-17", cashflow: "none", categoryType: "transfer", category: "Transfer", account: "ADVZ", destinationAccount: "REVO", amountCents: 50000 }),
    ];
    const groups = groupByMonthAndDay(txs);
    expect(groups[0]!.days[0]!.netCents).toBe(0);
    expect(groups[0]!.netCents).toBe(0);
    expect(groups[0]!.inCents).toBe(0);
    expect(groups[0]!.outCents).toBe(0);
  });

  it("month in/out split reflects both income and expense within the month", () => {
    const txs = [
      makeTx({ id: "1", date: "2026-10-17", cashflow: "out", categoryType: "expense", amountCents: 1000 }),
      makeTx({ id: "2", date: "2026-10-01", cashflow: "in", categoryType: "income", amountCents: 3000 }),
    ];
    const groups = groupByMonthAndDay(txs);
    expect(groups[0]!.inCents).toBe(3000);
    expect(groups[0]!.outCents).toBe(1000);
    expect(groups[0]!.netCents).toBe(2000);
  });

  it("month netCents (the month pill's figure) is the exact sum of its day cards' nets", () => {
    const txs = [
      makeTx({ id: "1", date: "2026-10-17", cashflow: "out", categoryType: "expense", amountCents: 1234 }),
      makeTx({ id: "2", date: "2026-10-17", cashflow: "in", categoryType: "income", amountCents: 500 }),
      makeTx({ id: "3", date: "2026-10-03", cashflow: "out", categoryType: "non_expense", amountCents: 2001 }),
      makeTx({ id: "4", date: "2026-10-01", cashflow: "none", categoryType: "transfer", amountCents: 9999, destinationAccount: "Cash" }),
    ];
    const [october] = groupByMonthAndDay(txs);
    expect(october!.days.map((d) => d.netCents)).toEqual([-734, -2001, 0]);
    expect(october!.netCents).toBe(-2735);
  });

  it.skipIf(!hasFixture)("every real month's pill net equals the sum of its day nets", () => {
    for (const month of groupByMonthAndDay(filterTransactions(transactions, emptyFilter()))) {
      expect(month.netCents).toBe(month.days.reduce((sum, d) => sum + d.netCents, 0));
    }
  });

  it.skipIf(!hasFixture)("re-grouping all real October 2026 transactions matches an independently-computed day count", () => {
    const octoberTxs = filterTransactions(transactions, { ...emptyFilter(), from: "2026-10-01", to: "2026-10-17" });
    const groups = groupByMonthAndDay(octoberTxs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.monthKey).toBe("2026-10");
    const totalTxInGroups = groups[0]!.days.reduce((sum, d) => sum + d.transactions.length, 0);
    expect(totalTxInGroups).toBe(octoberTxs.length);
    const distinctDates = new Set(octoberTxs.map((t) => t.date)).size;
    expect(groups[0]!.days).toHaveLength(distinctDates);
  });

  it.skipIf(!hasFixture)("day and month groups preserve descending date order from the input", () => {
    const sorted = filterTransactions(transactions, emptyFilter());
    const groups = groupByMonthAndDay(sorted);
    const monthKeys = groups.map((g) => g.monthKey);
    for (let i = 1; i < monthKeys.length; i++) {
      expect(monthKeys[i - 1]! >= monthKeys[i]!).toBe(true);
    }
    for (const group of groups) {
      const dates = group.days.map((d) => d.date);
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]! > dates[i]!).toBe(true);
      }
    }
  });
});
