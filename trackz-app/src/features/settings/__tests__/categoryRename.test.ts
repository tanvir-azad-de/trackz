import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import {
  planCategoryRename,
  summarizeCategories,
  validateCategoryRename,
} from "@/features/settings/categoryRename";
import type { CategoryType, Transaction } from "@/domain/transaction";

/**
 * Phase 13b: the category rename/merge path, pure half.
 *
 * hasFixture gates only the real-data blocks, matching
 * merchantMerge.test.ts and filter.test.ts (dummyData/ is gitignored real
 * financial data, absent on a fresh clone).
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

let seq = 0;
function makeTransaction(
  category: string,
  overrides: Partial<Transaction> & { categoryType?: CategoryType } = {},
): Transaction {
  seq++;
  return {
    id: `txn_${seq}`,
    date: "2026-10-17",
    account: "CMRZ",
    destinationAccount: "",
    cashflow: "out",
    category,
    categoryType: "expense",
    merchant: "Papa Johns",
    amountCents: 1119,
    notes: "",
    createdAt: "2026-10-17T14:32:00.000Z",
    updatedAt: "2026-10-17T14:32:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("summarizeCategories", () => {
  it("counts rows and sums amounts per name", () => {
    const summaries = summarizeCategories([
      makeTransaction("Restaurant", { amountCents: 1000 }),
      makeTransaction("Restaurant", { amountCents: 500 }),
      makeTransaction("Dining", { amountCents: 1119 }),
    ]);

    expect(summaries).toHaveLength(2);
    const restaurant = summaries.find((s) => s.name === "Restaurant")!;
    expect(restaurant.rowCount).toBe(2);
    expect(restaurant.totalCents).toBe(1500);
    const dining = summaries.find((s) => s.name === "Dining")!;
    expect(dining.rowCount).toBe(1);
    expect(dining.totalCents).toBe(1119);
  });

  it("groups names that differ only by surrounding whitespace", () => {
    // draft.ts trims `category` on write but an imported row may not be,
    // so " Rent" and "Rent" are the SAME category, not two.
    const summaries = summarizeCategories([
      makeTransaction("Rent"),
      makeTransaction(" Rent"),
      makeTransaction("Rent "),
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.name).toBe("Rent");
    expect(summaries[0]!.rowCount).toBe(3);
  });

  it("skips blank category names rather than inventing a category", () => {
    const summaries = summarizeCategories([
      makeTransaction("Rent"),
      makeTransaction(""),
      makeTransaction("   "),
      makeTransaction("\t"),
    ]);

    // Three DISTINCT blank spellings, so this stays falsifiable: if the
    // blank guard were removed they would all trim to "" and collapse
    // into one group, making the count 2 rather than 1.
    expect(summaries.map((s) => s.name)).toEqual(["Rent"]);
  });

  it("reports a per-type breakdown and flags a name carrying several types", () => {
    const summaries = summarizeCategories([
      makeTransaction("WiFi", { categoryType: "non_expense" }),
      makeTransaction("WiFi", { categoryType: "non_expense" }),
      makeTransaction("WiFi", { categoryType: "expense" }),
      makeTransaction("Rent", { categoryType: "expense" }),
    ]);

    const wifi = summaries.find((s) => s.name === "WiFi")!;
    expect(wifi.categoryTypes).toEqual({ non_expense: 2, expense: 1 });
    expect(wifi.hasMixedTypes).toBe(true);

    const rent = summaries.find((s) => s.name === "Rent")!;
    expect(rent.categoryTypes).toEqual({ expense: 1 });
    expect(rent.hasMixedTypes).toBe(false);
  });

  it("sorts by row count descending, then by name", () => {
    const summaries = summarizeCategories([
      makeTransaction("Zebra"),
      makeTransaction("Apple"),
      makeTransaction("Busy"),
      makeTransaction("Busy"),
    ]);

    expect(summaries.map((s) => s.name)).toEqual(["Busy", "Apple", "Zebra"]);
  });
});

describe("planCategoryRename", () => {
  it("rewrites only the source rows, leaving others alone", () => {
    const plan = planCategoryRename(
      [makeTransaction("Dining"), makeTransaction("Groceries"), makeTransaction("Smokes")],
      "Dining",
      "Restaurant",
    );

    expect(plan.canonical).toBe("Restaurant");
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]!.category).toBe("Restaurant");
    expect(plan.isMerge).toBe(false);
    expect(plan.mergedIntoCount).toBe(0);
  });

  it("changes nothing but the category field", () => {
    const original = makeTransaction("Dining", { amountCents: 1119, categoryType: "expense" });
    const plan = planCategoryRename([original], "Dining", "Restaurant");

    expect(plan.changed[0]).toEqual({ ...original, category: "Restaurant" });
  });

  it("counts rows already carrying the target name without rewriting them", () => {
    // Merging Dining (1) into Restaurant (2) must write ONE row, not three
    // — the other two would each bump updatedAt and sync for no change.
    const plan = planCategoryRename(
      [makeTransaction("Dining"), makeTransaction("Restaurant"), makeTransaction("Restaurant")],
      "Dining",
      "Restaurant",
    );

    expect(plan.changed).toHaveLength(1);
    expect(plan.mergedIntoCount).toBe(2);
    expect(plan.isMerge).toBe(true);
  });

  it("matches and writes trimmed names", () => {
    const plan = planCategoryRename([makeTransaction(" Dining ")], "Dining", "  Restaurant  ");

    expect(plan.canonical).toBe("Restaurant");
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]!.category).toBe("Restaurant");
  });

  it("preserves categoryType, so a rename cannot turn spending into non-spending", () => {
    const plan = planCategoryRename(
      [
        makeTransaction("WiFi", { categoryType: "non_expense" }),
        makeTransaction("WiFi", { categoryType: "expense" }),
      ],
      "WiFi",
      "Internet",
    );

    expect(plan.changed).toHaveLength(2);
    expect(plan.changed.map((t) => t.categoryType)).toEqual(["non_expense", "expense"]);
  });

  it("returns an empty plan when no row carries the source name", () => {
    const plan = planCategoryRename([makeTransaction("Rent")], "Dining", "Restaurant");
    expect(plan.changed).toEqual([]);
  });
});

describe("validateCategoryRename", () => {
  const rows = [makeTransaction("Dining"), makeTransaction("Restaurant")];

  it("allows renaming onto a name that already exists (that is a merge)", () => {
    // The merchant merge deliberately BLOCKS an unrelated target
    // ("Edeka" -> "Aldi"). Categories must NOT: "Dining" -> "Restaurant"
    // is the whole point of the feature, and the real data has no
    // case-duplicate category names to merge instead.
    expect(validateCategoryRename(rows, "Dining", "Restaurant")).toBeNull();
  });

  it("allows a brand-new name", () => {
    expect(validateCategoryRename(rows, "Dining", "Eating out")).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(validateCategoryRename(rows, "Dining", "   ")).toBe("Enter a name.");
  });

  it("rejects a name with no letters or numbers", () => {
    expect(validateCategoryRename(rows, "Dining", "***")).toBe(
      "That name has no letters or numbers in it.",
    );
  });

  it("accepts a non-ASCII name", () => {
    // \p{L} not [a-z]: "Café" and "Ernährung" are legitimate names, and
    // an ASCII-only check would reject a fully-non-Latin one outright.
    expect(validateCategoryRename(rows, "Dining", "Café")).toBeNull();
    expect(validateCategoryRename(rows, "Dining", "食費")).toBeNull();
  });

  it("rejects renaming a name to itself, which would write nothing", () => {
    expect(validateCategoryRename(rows, "Dining", "Dining")).toBe("That's already the name.");
    expect(validateCategoryRename(rows, "Dining", "  Dining  ")).toBe("That's already the name.");
  });

  it("rejects a source name that no transaction carries", () => {
    expect(validateCategoryRename(rows, "Nonexistent", "Restaurant")).toBe(
      'No transactions are in "Nonexistent".',
    );
  });
});

describe.skipIf(!hasFixture)("against the real backup", () => {
  it("finds the 36 real categories with Groceries the largest", () => {
    const summaries = summarizeCategories(transactions);
    expect(summaries).toHaveLength(36);
    expect(summaries[0]!.name).toBe("Groceries");
    expect(summaries[0]!.rowCount).toBe(578);
  });

  it("flags exactly the two real mixed-type names, both legitimate", () => {
    // Shopping: a purchase, a partly-reimbursed purchase and a refund.
    // WiFi: a shared flat contract, then a sole one after moving.
    // Neither is a mistake, which is why the UI shows this as
    // information with nothing to action.
    const mixed = summarizeCategories(transactions).filter((s) => s.hasMixedTypes);

    expect(mixed.map((s) => s.name).sort()).toEqual(["Shopping", "WiFi"]);
    expect(mixed.find((s) => s.name === "Shopping")!.categoryTypes).toEqual({
      expense: 151,
      non_expense: 2,
      non_income: 1,
    });
    expect(mixed.find((s) => s.name === "WiFi")!.categoryTypes).toEqual({
      non_expense: 14,
      expense: 4,
    });
  });

  it("merges the real Dining row into Restaurant, writing one row", () => {
    const plan = planCategoryRename(transactions, "Dining", "Restaurant");

    expect(plan.isMerge).toBe(true);
    expect(plan.changed).toHaveLength(1);
    expect(plan.mergedIntoCount).toBe(144);
    expect(plan.changed[0]!.amountCents).toBe(1119); // the Papa Johns row
    expect(plan.changed[0]!.merchant).toBe("Papa Johns");
  });

  it("merges the real Fees row into Bank Charges, writing one row", () => {
    const plan = planCategoryRename(transactions, "Fees", "Bank Charges");

    expect(plan.isMerge).toBe(true);
    expect(plan.changed).toHaveLength(1);
    expect(plan.mergedIntoCount).toBe(7);
    expect(plan.changed[0]!.amountCents).toBe(490);
  });

  it("conserves row count and total cents across a real merge", () => {
    const before = summarizeCategories(transactions);
    const dining = before.find((s) => s.name === "Dining")!;
    const restaurant = before.find((s) => s.name === "Restaurant")!;

    const plan = planCategoryRename(transactions, "Dining", "Restaurant");
    const changedById = new Map(plan.changed.map((t) => [t.id, t]));
    const applied = transactions.map((t) => changedById.get(t.id) ?? t);

    const after = summarizeCategories(applied);
    expect(after).toHaveLength(35); // 36 - 1, Dining is gone
    expect(after.find((s) => s.name === "Dining")).toBeUndefined();

    const merged = after.find((s) => s.name === "Restaurant")!;
    expect(merged.rowCount).toBe(dining.rowCount + restaurant.rowCount);
    expect(merged.totalCents).toBe(dining.totalCents + restaurant.totalCents);
    // The ledger itself is untouched in size — a rename moves rows
    // between categories, it never adds or drops one.
    expect(applied).toHaveLength(transactions.length);
  });

  it("leaves transaction ids alone, so a rename syncs as ordinary edits", () => {
    // contentDerivedTransactionId hashes `category`, but ids are minted
    // only at CSV parse time — so the rewrite must NOT re-key rows, or
    // every renamed row would strand itself in sync as a new record.
    const plan = planCategoryRename(transactions, "Dining", "Restaurant");
    const original = transactions.find((t) => t.category === "Dining")!;

    expect(plan.changed[0]!.id).toBe(original.id);
  });
});
