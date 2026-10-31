import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import { deriveAccounts, getAllAccountBalances, getCategoryTotals } from "@/storage/derive";
import { centsToDecimal } from "@/domain/money";

/**
 * Phase 0 data safety net: proves the new CSV -> domain model pipeline is
 * lossless against an INDEPENDENTLY computed reference (a plain
 * python/awk script, not this codebase) over the real 1,456-row export.
 * See dummyData/snapshot-2026-10-31/reference-totals.json and
 * docs/renovation_version_1.txt Phase 0.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../.."); // src/storage/__tests__ -> trackz-app -> trackz
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");
const referencePath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/reference-totals.json");

interface ReferenceTotals {
  rowCount: number;
  accounts: string[];
  accountBalances: Record<string, number>; // decimal EUR
  categoryTotals: Record<string, number>; // decimal EUR
}

describe("CSV import matches independent reference totals", () => {
  const csvText = readFileSync(csvPath, "utf-8");
  const reference: ReferenceTotals = JSON.parse(readFileSync(referencePath, "utf-8"));
  const { transactions, errors } = parseTransactionsCsv(csvText);

  it("parses with zero errors", () => {
    expect(errors).toEqual([]);
  });

  it("parses the expected row count", () => {
    expect(transactions.length).toBe(reference.rowCount);
  });

  it("derives the exact same account set", () => {
    const accounts = deriveAccounts(transactions).map((a) => a.name);
    expect(accounts).toEqual(reference.accounts);
  });

  it("matches per-account balances to the cent", () => {
    const balances = getAllAccountBalances(transactions);
    for (const account of reference.accounts) {
      const got = centsToDecimal(balances[account] ?? 0);
      const want = reference.accountBalances[account] ?? 0;
      expect(got).toBeCloseTo(want, 2);
    }
  });

  it("matches per-category totals to the cent", () => {
    const totals = getCategoryTotals(transactions);
    for (const [key, wantDecimal] of Object.entries(reference.categoryTotals)) {
      const gotCents = totals[key] ?? 0;
      expect(centsToDecimal(gotCents)).toBeCloseTo(wantDecimal, 2);
    }
  });
});
