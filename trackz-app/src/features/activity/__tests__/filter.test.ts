import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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
  matchingPreset,
  presetRange,
  type ActivityFilter,
} from "@/features/activity/filter";
import type { Transaction } from "@/domain/transaction";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../../..");
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");
const referenceTotalsPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/reference-totals.json");
// dummyData/ is gitignored real financial data — absent on a fresh clone
// or CI (Phase 15a fixture-gap fix). This file mixes synthetic-only
// tests (normalizeForSearch, matchesQuery, activeFacetCount/
// isFilterActive, and summarizeFiltered's empty-result case) with
// real-CSV-dependent ones — unlike engine.test.ts, a
// single whole-file skip would wrongly drop the synthetic coverage too.
// hasFixture gates only the describe/it blocks that actually touch
// `transactions`/`referenceTotals` below.
const hasFixture = existsSync(csvPath) && existsSync(referenceTotalsPath);

let transactions: Transaction[];
let referenceTotals: { rowCount: number; categoryTotals: Record<string, number> };

beforeAll(() => {
  if (!hasFixture) return;
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
      updatedAt: "2026-10-01T00:00:00.000Z",
      deletedAt: null,
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
      updatedAt: "2026-10-01T00:00:00.000Z",
      deletedAt: null,
    };
    expect(matchesQuery(tx, "")).toBe(true);
  });
});

describe.skipIf(!hasFixture)("filterTransactions against the real CSV", () => {
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

describe.skipIf(!hasFixture)("summarizeFiltered against the real CSV", () => {
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
});

describe("summarizeFiltered", () => {
  it("an empty result summarizes to all zeros", () => {
    expect(summarizeFiltered([])).toEqual({ count: 0, inCents: 0, outCents: 0, netCents: 0 });
  });
});

/**
 * The preset buttons had no active state at all before this: they set a
 * date range and then looked identical to the unselected ones. These pin
 * the derive-by-comparison approach, which is what makes hand-editing a
 * date clear the highlight instead of leaving a stale "This month".
 *
 * A fixed `today` is passed everywhere rather than relying on the
 * getLocalToday() default, so these do not start failing on the 1st of a
 * month or in a different timezone.
 */
describe("presetRange / matchingPreset", () => {
  const today = "2026-10-17";

  it("computes each preset's bounds from the given day", () => {
    expect(presetRange("this-month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(presetRange("last-3-months", today)).toEqual({ from: "2026-08-01", to: today });
    expect(presetRange("this-year", today)).toEqual({ from: "2026-01-01", to: today });
    expect(presetRange("all-time", today)).toEqual({ from: "", to: "" });
  });

  it("round-trips: every preset's own range matches that preset", () => {
    for (const preset of ["this-month", "last-3-months", "this-year", "all-time"] as const) {
      expect(matchingPreset(presetRange(preset, today), today)).toBe(preset);
    }
  });

  it("reads an empty filter as All time, not as 'no preset'", () => {
    // all-time is the absence of both bounds, so it is the one preset that
    // a freshly-reset filter already satisfies — it must light up rather
    // than leaving the row with nothing selected.
    expect(matchingPreset(emptyFilter(), today)).toBe("all-time");
  });

  it("returns null for a hand-picked custom range", () => {
    expect(matchingPreset({ from: "2026-03-07", to: "2026-04-02" }, today)).toBeNull();
  });

  it("returns null when only one end is set", () => {
    // "everything after 1 Sept" is a legitimate filter state here (see
    // ActivityFilter's comment) and is not any preset.
    expect(matchingPreset({ from: "2026-09-01", to: "" }, today)).toBeNull();
    expect(matchingPreset({ from: "", to: "2026-09-01" }, today)).toBeNull();
  });

  it("distinguishes this-month from last-3-months rather than matching the first with the same 'to'", () => {
    // Both presets end at `today`, so comparing only the upper bound would
    // conflate them.
    expect(matchingPreset({ from: "2026-10-01", to: today }, today)).toBe("this-month");
    expect(matchingPreset({ from: "2026-08-01", to: today }, today)).toBe("last-3-months");
  });

  it("stops matching once the day moves on", () => {
    // Yesterday's "this month" range is not today's, so a sheet left open
    // across midnight must not keep claiming the preset is active.
    const yesterdayRange = presetRange("this-month", "2026-10-16");
    expect(matchingPreset(yesterdayRange, "2026-10-17")).toBeNull();
  });

  it("matches in January, where last-3-months crosses a year boundary", () => {
    const jan = "2027-01-09";
    expect(presetRange("last-3-months", jan)).toEqual({ from: "2026-11-01", to: jan });
    expect(matchingPreset({ from: "2026-11-01", to: jan }, jan)).toBe("last-3-months");
  });

  it("resolves the January this-month/this-year tie toward this-month", () => {
    // GENUINELY AMBIGUOUS, and worth pinning rather than pretending it
    // isn't: throughout January, this-month and this-year are the SAME
    // range (both 1 Jan -> today), so no comparison can tell them apart.
    // matchingPreset's array order decides it, and this-month is the
    // narrower, more specific claim. The consequence is cosmetic (in
    // January, tapping "This year" highlights "This month"), but it is a
    // consequence of the derive-by-comparison design and not a bug to
    // hunt later.
    const jan = "2027-01-09";
    expect(presetRange("this-month", jan)).toEqual(presetRange("this-year", jan));
    expect(matchingPreset({ from: "2027-01-01", to: jan }, jan)).toBe("this-month");
  });
});
