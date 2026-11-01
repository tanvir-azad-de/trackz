import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import { getRecallCombos } from "@/features/entry/recall";
import type { Transaction } from "@/domain/transaction";

/**
 * Verified against the real CSV (dummyData/snapshot-2026-10-31). The last
 * transaction date in that file is 2026-10-17, which we use as `asOfDate`
 * so these tests are deterministic.
 *
 * dummyData/ is gitignored real financial data — absent on a fresh clone
 * or CI (Phase 15a fixture-gap fix). Every test here depends on it, so
 * describe.skipIf on the whole suite.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../../..");
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");
const hasFixture = existsSync(csvPath);

let transactions: Transaction[];
const TODAY = "2026-10-17";

beforeAll(() => {
  if (!hasFixture) return;
  const csvText = readFileSync(csvPath, "utf-8");
  const result = parseTransactionsCsv(csvText);
  expect(result.errors).toEqual([]);
  transactions = result.transactions;
});

describe.skipIf(!hasFixture)("getRecallCombos against real CSV data", () => {
  it("ranks Shopping/Amazon/REVO first — most recently used (4 days before TODAY), even though Groceries/Edeka/ADVZ has more raw occurrences in the window (31 vs 15) but hasn't been used in 18 days", () => {
    const combos = getRecallCombos(transactions, TODAY, 6);
    expect(combos[0]).toMatchObject({ category: "Shopping", merchant: "Amazon", account: "REVO" });
    const edekaRank = combos.findIndex((c) => c.merchant === "Edeka");
    expect(edekaRank).toBeGreaterThan(0); // present, but not first — recency beat raw count
  });

  it("returns at most `limit` combos, each with a positive score and count", () => {
    const combos = getRecallCombos(transactions, TODAY, 6);
    expect(combos.length).toBeLessThanOrEqual(6);
    for (const c of combos) {
      expect(c.score).toBeGreaterThan(0);
      expect(c.count).toBeGreaterThan(0);
      expect(c.medianAmountCents).toBeGreaterThan(0);
    }
  });

  it("includes transfers with their destination account populated", () => {
    const combos = getRecallCombos(transactions, TODAY, 20);
    const transfer = combos.find((c) => c.categoryType === "transfer");
    expect(transfer).toBeDefined();
    expect(transfer!.destinationAccount.length).toBeGreaterThan(0);
    expect(transfer!.cashflow).toBe("none");
  });

  it("excludes combos outside the 90-day window even if they were frequent historically", () => {
    // A combo only ever used in the first month of the dataset (Nov 2024)
    // must not appear when "today" is Oct 2026 — otherwise a dead habit
    // from 2 years ago would resurface ahead of what the user actually
    // does now.
    const combos = getRecallCombos(transactions, TODAY, 1000);
    for (const c of combos) {
      expect(c.lastUsedDate >= "2026-07-19").toBe(true); // ~90 days before TODAY
    }
  });

  it("ranks a single very recent use above many uses that all happened long ago", () => {
    const synthetic: Transaction[] = [
      // 15 occurrences, but the most recent is 89 days before "today" —
      // right at the edge of the window, each one heavily decayed
      // (0.5^(89/21) ≈ 0.053 per occurrence, so 15 * 0.053 ≈ 0.79).
      ...Array.from({ length: 15 }, (_, i) => ({
        id: `old_${i}`,
        date: "2026-07-20",
        account: "ADVZ",
        destinationAccount: "",
        cashflow: "out" as const,
        category: "Old Habit",
        categoryType: "expense" as const,
        merchant: "Old Merchant",
        amountCents: 500,
        notes: "",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
        deletedAt: null,
      })),
      // A single use, today.
      {
        id: "new_1",
        date: TODAY,
        account: "ADVZ",
        destinationAccount: "",
        cashflow: "out" as const,
        category: "New Habit",
        categoryType: "expense" as const,
        merchant: "New Merchant",
        amountCents: 500,
        notes: "",
        createdAt: `${TODAY}T00:00:00.000Z`,
        updatedAt: `${TODAY}T00:00:00.000Z`,
        deletedAt: null,
      },
    ];
    const combos = getRecallCombos(synthetic, TODAY, 5);
    expect(combos[0]!.category).toBe("New Habit");
  });

  it("is deterministic: tie-break order is stable across repeated calls", () => {
    const a = getRecallCombos(transactions, TODAY, 10).map((c) => c.key);
    const b = getRecallCombos(transactions, TODAY, 10).map((c) => c.key);
    expect(a).toEqual(b);
  });
});
