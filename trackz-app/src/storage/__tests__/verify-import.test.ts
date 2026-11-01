import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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
 *
 * dummyData/ is gitignored real financial data (root .gitignore) — absent
 * on a fresh clone or CI. Phase 15a fixture-gap fix: describe.skipIf marks
 * the resulting its as skipped, but vitest still RUNS the describe
 * callback body itself to discover them — so the readFileSync calls
 * below are guarded by `hasFixture &&` rather than relying on skipIf
 * alone, which would still throw at collection time on a fixture-less
 * machine (confirmed directly: an earlier version of this fix that
 * called readFileSync unconditionally inside the describe body still
 * failed the whole suite with ENOENT even with skipIf applied).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../.."); // src/storage/__tests__ -> trackz-app -> trackz
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");
const referencePath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/reference-totals.json");
const hasFixture = existsSync(csvPath) && existsSync(referencePath);

interface ReferenceTotals {
  rowCount: number;
  accounts: string[];
  accountBalances: Record<string, number>; // decimal EUR
  categoryTotals: Record<string, number>; // decimal EUR
}

describe.skipIf(!hasFixture)("CSV import matches independent reference totals", () => {
  const csvText = hasFixture ? readFileSync(csvPath, "utf-8") : "";
  const reference: ReferenceTotals = hasFixture
    ? JSON.parse(readFileSync(referencePath, "utf-8"))
    : { rowCount: 0, accounts: [], accountBalances: {}, categoryTotals: {} };
  const { transactions, errors } = hasFixture ? parseTransactionsCsv(csvText) : { transactions: [], errors: [] };

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
