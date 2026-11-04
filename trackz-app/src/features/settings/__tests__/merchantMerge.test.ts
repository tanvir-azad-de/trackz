import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import { findMergeGroups } from "@/domain/merchant";
import { planMerge, validateMerge } from "@/features/settings/merchantMerge";
import type { Transaction } from "@/domain/transaction";

/**
 * Phase 6 part 2: the merge APPLY path, pure half.
 *
 * hasFixture gates only the real-data blocks, matching
 * domain/__tests__/merchant.test.ts and filter.test.ts (dummyData/ is
 * gitignored real financial data, absent on a fresh clone).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../../.."); // src/features/settings/__tests__ -> trackz-app -> trackz
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");
const hasFixture = existsSync(csvPath);

let transactions: Transaction[];

beforeAll(() => {
  if (!hasFixture) return;
  const result = parseTransactionsCsv(readFileSync(csvPath, "utf-8"));
  expect(result.errors).toEqual([]);
  transactions = result.transactions;
});

function makeTransaction(merchant: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `txn_${merchant}_${Math.random().toString(36).slice(2, 8)}`,
    date: "2026-10-17",
    account: "CMRZ",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant,
    amountCents: 1240,
    notes: "",
    createdAt: "2026-10-17T14:32:00.000Z",
    updatedAt: "2026-10-17T14:32:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("planMerge", () => {
  it("rewrites only the rows whose spelling was selected", () => {
    const plan = planMerge(
      [makeTransaction("EDEKA"), makeTransaction("Edeka"), makeTransaction("Aldi")],
      ["Edeka", "EDEKA"],
      "Edeka",
    );

    expect(plan.canonical).toBe("Edeka");
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]!.merchant).toBe("Edeka");
    expect(plan.unchangedCount).toBe(1); // the row already named "Edeka"
  });

  it("leaves every other field untouched", () => {
    const original = makeTransaction("EDEKA", {
      amountCents: 999,
      categoryType: "non_expense",
      cashflow: "out",
      notes: "half was Chayan's",
      id: "txn_fixed",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const plan = planMerge([original], ["EDEKA"], "Edeka");

    expect(plan.changed[0]).toEqual({ ...original, merchant: "Edeka" });
  });

  /**
   * The id is content-derived for CSV-imported rows and hashes
   * `merchant`, so it LOOKS like a rename should re-key the row. It must
   * not: ids are minted only at parse time, and a changed id would make
   * sync treat the rename as a delete plus an unrelated insert.
   */
  it("does not change ids", () => {
    const plan = planMerge([makeTransaction("EDEKA", { id: "txn_c0123" })], ["EDEKA"], "Edeka");
    expect(plan.changed[0]!.id).toBe("txn_c0123");
  });

  it("reports an empty plan when every matching row already has the canonical name", () => {
    const plan = planMerge([makeTransaction("Edeka"), makeTransaction("Edeka")], ["Edeka"], "Edeka");
    expect(plan.changed).toEqual([]);
    expect(plan.unchangedCount).toBe(2);
  });

  it("matches on exact stored spelling, not normalized form", () => {
    // "EDEKA" normalizes the same as "Edeka" but was NOT selected, so it
    // must be left alone — the merge does exactly what the sheet showed.
    const plan = planMerge(
      [makeTransaction("EDEKA"), makeTransaction("edeka")],
      ["edeka"],
      "Edeka",
    );
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]!.merchant).toBe("Edeka");
  });

  it("tolerates untrimmed stored spellings and canonical input", () => {
    const plan = planMerge([makeTransaction("  EDEKA  ")], ["EDEKA"], "  Edeka  ");
    expect(plan.canonical).toBe("Edeka");
    expect(plan.changed[0]!.merchant).toBe("Edeka");
  });

  it("can merge into a name that is not one of the stored spellings", () => {
    // Real case: stored "TEDi"/"TEDI", user wants the clean "Tedi".
    const plan = planMerge([makeTransaction("TEDi"), makeTransaction("TEDI")], ["TEDi", "TEDI"], "Tedi");
    expect(plan.changed).toHaveLength(2);
    expect(plan.changed.every((t) => t.merchant === "Tedi")).toBe(true);
    expect(plan.unchangedCount).toBe(0);
  });

  it("ignores rows carrying a spelling that was not selected", () => {
    const plan = planMerge([makeTransaction("Rewe"), makeTransaction("Aldi")], ["Edeka", "EDEKA"], "Edeka");
    expect(plan.changed).toEqual([]);
    expect(plan.unchangedCount).toBe(0);
  });
});

describe("validateMerge", () => {
  it("accepts a canonical name that is one of the group's spellings", () => {
    expect(validateMerge(["Edeka", "EDEKA"], "Edeka")).toBeNull();
  });

  it("accepts a cleaner spelling the data does not contain", () => {
    expect(validateMerge(["TEDi", "TEDI"], "Tedi")).toBeNull();
  });

  it("rejects a blank canonical name", () => {
    expect(validateMerge(["Edeka", "EDEKA"], "")).toMatch(/enter a name/i);
    expect(validateMerge(["Edeka", "EDEKA"], "   ")).toMatch(/enter a name/i);
  });

  it("rejects a canonical name with no letters or digits", () => {
    expect(validateMerge(["Edeka", "EDEKA"], "***")).toMatch(/no letters or numbers/i);
  });

  it("rejects fewer than two spellings", () => {
    expect(validateMerge(["Edeka"], "Edeka")).toMatch(/at least two/i);
  });

  /**
   * The guard that stops a "merge duplicates" screen from quietly
   * performing a mass reassignment to a DIFFERENT merchant.
   */
  it("rejects renaming a group to an unrelated merchant", () => {
    expect(validateMerge(["Edeka", "EDEKA"], "Aldi")).toMatch(/different merchant/i);
  });

  it("allows a manual merge across different normalized forms", () => {
    // "Niemerszein" / "NIEMERSZEIN & CO.KG" — the real missed win that
    // the safe auto-detector deliberately does not propose.
    expect(validateMerge(["Niemerszein", "NIEMERSZEIN & CO.KG"], "Niemerszein")).toBeNull();
  });

  it("rejects a manual merge into a name matching neither side", () => {
    expect(validateMerge(["Niemerszein", "NIEMERSZEIN & CO.KG"], "Kaufland")).toMatch(/doesn't match/i);
  });
});

describe.skipIf(!hasFixture)("planMerge against the real backup", () => {
  it("rewrites exactly the 11 EDEKA rows, leaving the 53 Edeka rows alone", () => {
    const plan = planMerge(transactions, ["Edeka", "EDEKA"], "Edeka");

    expect(plan.changed).toHaveLength(11);
    expect(plan.unchangedCount).toBe(53);
    expect(plan.changed.every((t) => t.merchant === "Edeka")).toBe(true);
  });

  it("preserves every amount across all 7 auto-detected groups", () => {
    // The whole point of a merge is that it renames and nothing else.
    // Asserted on the real data because an amount changing here would be
    // silent financial corruption, not a visible bug.
    const groups = findMergeGroups(transactions);
    const byId = new Map(transactions.map((t) => [t.id, t]));

    let totalChanged = 0;
    for (const g of groups) {
      const plan = planMerge(
        transactions,
        g.variants.map((v) => v.name),
        g.suggestedCanonical,
      );
      totalChanged += plan.changed.length;
      for (const row of plan.changed) {
        const before = byId.get(row.id)!;
        expect(row.amountCents).toBe(before.amountCents);
        expect(row.categoryType).toBe(before.categoryType);
        expect(row.cashflow).toBe(before.cashflow);
        expect(row.account).toBe(before.account);
        expect(row.date).toBe(before.date);
      }
    }

    // 150 rows in the 7 groups, of which the most-used spelling in each
    // already carries the canonical name: 150 - (53+18+16+13+16+8+1) = 25.
    expect(totalChanged).toBe(25);
  });

  it("never touches a receivable or payable row", () => {
    // insights/engine.ts groups Lent out / I owe BY MERCHANT, so a merge
    // reaching one of those rows would move money between counterparties.
    const groups = findMergeGroups(transactions);
    for (const g of groups) {
      const plan = planMerge(
        transactions,
        g.variants.map((v) => v.name),
        g.suggestedCanonical,
      );
      for (const row of plan.changed) {
        expect(row.categoryType).not.toBe("receivable");
        expect(row.categoryType).not.toBe("payable");
      }
    }
  });

  it("leaves the row count unchanged (a merge renames, never removes)", () => {
    const plan = planMerge(transactions, ["Edeka", "EDEKA"], "Edeka");
    const ids = new Set(plan.changed.map((t) => t.id));
    expect(ids.size).toBe(plan.changed.length); // no duplicate ids produced
    expect(plan.changed.length + plan.unchangedCount).toBe(64); // the full Edeka group
  });
});
