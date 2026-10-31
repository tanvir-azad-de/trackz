import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import {
  activeFacetCount,
  emptyFilter,
  filterTransactions,
  isFilterActive,
  matchesQuery,
  normalizeForSearch,
  summarizeFiltered,
  type ActivityFilter,
} from "@/features/activity/filter";
import type { Transaction } from "@/domain/transaction";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../../..");
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");
const referenceTotalsPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/reference-totals.json");

let transactions: Transaction[];
let referenceTotals: { rowCount: number; categoryTotals: Record<string, number> };

beforeAll(() => {
  const csvText = readFileSync(csvPath, "utf-8");
  const result = parseTransactionsCsv(csvText);
  expect(result.errors).toEqual([]);
  transactions = result.transactions;
  referenceTotals = JSON.parse(readFileSync(referenceTotalsPath, "utf-8"));
});

describe("normalizeForSearch", () => {
  it("lowercases and strips diacritics", () => {
    expect(normalizeForSearch("Édeka")).toBe("edeka");
    expect(normalizeForSearch("KAUFLAND HAMBURG BRAMF")).toBe("kaufland hamburg bramf");
  });
});

describe("matchesQuery", () => {
  it("matches on merchant, category, notes, account, or destination account", () => {
    const tx: Transaction = {
      id: "t1",
      date: "2026-10-01",
      account: "ADVZ",
      destinationAccount: "REVO",
      cashflow: "none",
      category: "Transfer",
      categoryType: "transfer",
      merchant: "Edeka",
      amountCents: 1000,
      notes: "rent split",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    expect(matchesQuery(tx, normalizeForSearch("edeka"))).toBe(true);
    expect(matchesQuery(tx, normalizeForSearch("transfer"))).toBe(true);
    expect(matchesQuery(tx, normalizeForSearch("rent split"))).toBe(true);
    expect(matchesQuery(tx, normalizeForSearch("advz"))).toBe(true);
    expect(matchesQuery(tx, normalizeForSearch("revo"))).toBe(true);
    expect(matchesQuery(tx, normalizeForSearch("kaufland"))).toBe(false);
  });

  it("an empty query matches everything", () => {
    const tx: Transaction = {
      id: "t2",
      date: "2026-10-01",
      account: "ADVZ",
      destinationAccount: "",
      cashflow: "out",
      category: "Groceries",
      categoryType: "expense",
      merchant: "",
      amountCents: 500,
      notes: "",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    expect(matchesQuery(tx, "")).toBe(true);
  });
});

describe("filterTransactions against the real CSV", () => {
  it("an empty filter returns every row, matching the reference row count", () => {
    const result = filterTransactions(transactions, emptyFilter());
    expect(result.length).toBe(referenceTotals.rowCount);
  });

  it("search is case-insensitive and finds a known merchant graveyard entry", () => {
    const result = filterTransactions(transactions, { ...emptyFilter(), query: "EDEKA" });
    expect(result.length).toBeGreaterThan(0);
    for (const tx of result) {
      expect(normalizeForSearch(tx.merchant)).toContain("edeka");
    }
  });

  it("search matches notes-only content", () => {
    const withNotes = transactions.find((t) => t.notes.trim().length > 3);
    expect(withNotes).toBeDefined();
    const needle = withNotes!.notes.trim().slice(0, 4);
    const result = filterTransactions(transactions, { ...emptyFilter(), query: needle });
    expect(result.some((t) => t.id === withNotes!.id)).toBe(true);
  });

  it("search matches account-only (no merchant/category hit)", () => {
    const result = filterTransactions(transactions, { ...emptyFilter(), query: "cmrz" });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((tx) => normalizeForSearch(tx.account).includes("cmrz") || normalizeForSearch(tx.destinationAccount).includes("cmrz") || normalizeForSearch(tx.merchant).includes("cmrz") || normalizeForSearch(tx.category).includes("cmrz") || normalizeForSearch(tx.notes).includes("cmrz"))).toBe(true);
  });

  it("date bounds are inclusive on both ends", () => {
    const filter: ActivityFilter = { ...emptyFilter(), from: "2026-10-01", to: "2026-10-17" };
    const result = filterTransactions(transactions, filter);
    expect(result.every((tx) => tx.date >= "2026-10-01" && tx.date <= "2026-10-17")).toBe(true);
    expect(result.some((tx) => tx.date === "2026-10-17")).toBe(true);
  });

  it("an unbounded 'from' with no 'to' includes everything after it", () => {
    const filter: ActivityFilter = { ...emptyFilter(), from: "2026-10-01" };
    const result = filterTransactions(transactions, filter);
    expect(result.every((tx) => tx.date >= "2026-10-01")).toBe(true);
    expect(result.length).toBe(transactions.filter((tx) => tx.date >= "2026-10-01").length);
  });

  it("multiple facets AND together (account + categoryType)", () => {
    const filter: ActivityFilter = { ...emptyFilter(), accounts: ["ADVZ"], categoryTypes: ["expense"] };
    const result = filterTransactions(transactions, filter);
    expect(result.length).toBeGreaterThan(0);
    for (const tx of result) {
      expect(tx.account === "ADVZ" || tx.destinationAccount === "ADVZ").toBe(true);
      expect(tx.categoryType).toBe("expense");
    }
  });

  it("filters by category name", () => {
    const filter: ActivityFilter = { ...emptyFilter(), categories: ["Groceries"] };
    const result = filterTransactions(transactions, filter);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((tx) => tx.category === "Groceries")).toBe(true);
  });

  it("filters by categoryType across multiple selected types", () => {
    const filter: ActivityFilter = { ...emptyFilter(), categoryTypes: ["receivable", "payable"] };
    const result = filterTransactions(transactions, filter);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((tx) => tx.categoryType === "receivable" || tx.categoryType === "payable")).toBe(true);
  });

  it("sorts strictly by date descending", () => {
    const result = filterTransactions(transactions, emptyFilter());
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.date >= result[i]!.date).toBe(true);
    }
  });

  it("a filter that matches nothing returns an empty array, not an error", () => {
    const result = filterTransactions(transactions, { ...emptyFilter(), query: "zzz-no-such-merchant-zzz" });
    expect(result).toEqual([]);
  });
});

describe("activeFacetCount / isFilterActive", () => {
  it("counts each facet group once regardless of how many values it holds", () => {
    const filter: ActivityFilter = { ...emptyFilter(), accounts: ["ADVZ", "CMRZ"], categories: ["Groceries"] };
    expect(activeFacetCount(filter)).toBe(2);
  });

  it("counts a date range (either bound) as one facet", () => {
    expect(activeFacetCount({ ...emptyFilter(), from: "2026-01-01" })).toBe(1);
    expect(activeFacetCount({ ...emptyFilter(), to: "2026-01-01" })).toBe(1);
  });

  it("an empty filter has zero active facets and is not active", () => {
    expect(activeFacetCount(emptyFilter())).toBe(0);
    expect(isFilterActive(emptyFilter())).toBe(false);
  });

  it("a search-only filter is active even with zero facets", () => {
    expect(isFilterActive({ ...emptyFilter(), query: "edeka" })).toBe(true);
  });
});

describe("summarizeFiltered", () => {
  it("reconciles income/expense totals against the independently-computed reference totals for a single category", () => {
    const groceries = filterTransactions(transactions, { ...emptyFilter(), categories: ["Groceries"] });
    const summary = summarizeFiltered(groceries);
    const expectedCents = Math.round(referenceTotals.categoryTotals["expense|Groceries"]! * 100);
    expect(summary.outCents).toBe(expectedCents);
    expect(summary.inCents).toBe(0);
  });

  it("a transfer-only result nets to zero in/out (transfers don't affect net worth)", () => {
    const transfers = filterTransactions(transactions, { ...emptyFilter(), categoryTypes: ["transfer"] });
    const summary = summarizeFiltered(transfers);
    expect(summary.inCents).toBe(0);
    expect(summary.outCents).toBe(0);
    expect(summary.netCents).toBe(0);
    expect(summary.count).toBe(transfers.length);
  });

  it("an empty result summarizes to all zeros", () => {
    expect(summarizeFiltered([])).toEqual({ count: 0, inCents: 0, outCents: 0, netCents: 0 });
  });
});
