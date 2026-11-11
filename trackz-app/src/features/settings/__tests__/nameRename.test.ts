import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import {
  planRename,
  summarizeNames,
  validateRename,
} from "@/features/settings/nameRename";
import type { CategoryType, Transaction } from "@/domain/transaction";
import { hasExpectedValues, readExpectedValues } from "@/__tests__/expectedValues";

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
const hasFixture = existsSync(csvPath) && hasExpectedValues;

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
    amountCents: 1250,
    notes: "",
    createdAt: "2026-10-17T14:32:00.000Z",
    updatedAt: "2026-10-17T14:32:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("summarizeNames (category)", () => {
  it("counts rows and sums amounts per name", () => {
    const summaries = summarizeNames([
      makeTransaction("Restaurant", { amountCents: 1000 }),
      makeTransaction("Restaurant", { amountCents: 500 }),
      makeTransaction("Dining", { amountCents: 1250 }),
    ], "category");

    expect(summaries).toHaveLength(2);
    const restaurant = summaries.find((s) => s.name === "Restaurant")!;
    expect(restaurant.rowCount).toBe(2);
    expect(restaurant.totalCents).toBe(1500);
    const dining = summaries.find((s) => s.name === "Dining")!;
    expect(dining.rowCount).toBe(1);
    expect(dining.totalCents).toBe(1250);
  });

  it("groups names that differ only by surrounding whitespace", () => {
    // draft.ts trims `category` on write but an imported row may not be,
    // so " Rent" and "Rent" are the SAME category, not two.
    const summaries = summarizeNames([
      makeTransaction("Rent"),
      makeTransaction(" Rent"),
      makeTransaction("Rent "),
    ], "category");

    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.name).toBe("Rent");
    expect(summaries[0]!.rowCount).toBe(3);
  });

  it("skips blank category names rather than inventing a category", () => {
    const summaries = summarizeNames([
      makeTransaction("Rent"),
      makeTransaction(""),
      makeTransaction("   "),
      makeTransaction("\t"),
    ], "category");

    // Three DISTINCT blank spellings, so this stays falsifiable: if the
    // blank guard were removed they would all trim to "" and collapse
    // into one group, making the count 2 rather than 1.
    expect(summaries.map((s) => s.name)).toEqual(["Rent"]);
  });

  it("reports a per-type breakdown and flags a name carrying several types", () => {
    const summaries = summarizeNames([
      makeTransaction("WiFi", { categoryType: "non_expense" }),
      makeTransaction("WiFi", { categoryType: "non_expense" }),
      makeTransaction("WiFi", { categoryType: "expense" }),
      makeTransaction("Rent", { categoryType: "expense" }),
    ], "category");

    const wifi = summaries.find((s) => s.name === "WiFi")!;
    expect(wifi.categoryTypes).toEqual({ non_expense: 2, expense: 1 });
    expect(wifi.hasMixedTypes).toBe(true);

    const rent = summaries.find((s) => s.name === "Rent")!;
    expect(rent.categoryTypes).toEqual({ expense: 1 });
    expect(rent.hasMixedTypes).toBe(false);
  });

  it("sorts by row count descending, then by name", () => {
    const summaries = summarizeNames([
      makeTransaction("Zebra"),
      makeTransaction("Apple"),
      makeTransaction("Busy"),
      makeTransaction("Busy"),
    ], "category");

    expect(summaries.map((s) => s.name)).toEqual(["Busy", "Apple", "Zebra"]);
  });
});

describe("planRename (category)", () => {
  it("rewrites only the source rows, leaving others alone", () => {
    const plan = planRename(
      [makeTransaction("Dining"), makeTransaction("Groceries"), makeTransaction("Smokes")], "category",
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
    const original = makeTransaction("Dining", { amountCents: 1250, categoryType: "expense" });
    const plan = planRename([original], "category", "Dining", "Restaurant");

    expect(plan.changed[0]).toEqual({ ...original, category: "Restaurant" });
  });

  it("counts rows already carrying the target name without rewriting them", () => {
    // Merging Dining (1) into Restaurant (2) must write ONE row, not three
    // — the other two would each bump updatedAt and sync for no change.
    const plan = planRename(
      [makeTransaction("Dining"), makeTransaction("Restaurant"), makeTransaction("Restaurant")], "category",
      "Dining",
      "Restaurant",
    );

    expect(plan.changed).toHaveLength(1);
    expect(plan.mergedIntoCount).toBe(2);
    expect(plan.isMerge).toBe(true);
  });

  it("matches and writes trimmed names", () => {
    const plan = planRename([makeTransaction(" Dining ")], "category", "Dining", "  Restaurant  ");

    expect(plan.canonical).toBe("Restaurant");
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]!.category).toBe("Restaurant");
  });

  it("preserves categoryType, so a rename cannot turn spending into non-spending", () => {
    const plan = planRename(
      [
        makeTransaction("WiFi", { categoryType: "non_expense" }),
        makeTransaction("WiFi", { categoryType: "expense" }),
      ], "category",
      "WiFi",
      "Internet",
    );

    expect(plan.changed).toHaveLength(2);
    expect(plan.changed.map((t) => t.categoryType)).toEqual(["non_expense", "expense"]);
  });

  it("returns an empty plan when no row carries the source name", () => {
    const plan = planRename([makeTransaction("Rent")], "category", "Dining", "Restaurant");
    expect(plan.changed).toEqual([]);
  });
});

describe("validateRename (category)", () => {
  const rows = [makeTransaction("Dining"), makeTransaction("Restaurant")];

  it("allows renaming onto a name that already exists (that is a merge)", () => {
    // The merchant merge deliberately BLOCKS an unrelated target
    // ("Edeka" -> "Aldi"). Categories must NOT: "Dining" -> "Restaurant"
    // is the whole point of the feature, and the real data has no
    // case-duplicate category names to merge instead.
    expect(validateRename(rows, "category", "Dining", "Restaurant")).toBeNull();
  });

  it("allows a brand-new name", () => {
    expect(validateRename(rows, "category", "Dining", "Eating out")).toBeNull();
  });

  it("rejects a blank name", () => {
    expect(validateRename(rows, "category", "Dining", "   ")).toBe("Enter a name.");
  });

  it("rejects a name with no letters or numbers", () => {
    expect(validateRename(rows, "category", "Dining", "***")).toBe(
      "That name has no letters or numbers in it.",
    );
  });

  it("accepts a non-ASCII name", () => {
    // \p{L} not [a-z]: "Café" and "Ernährung" are legitimate names, and
    // an ASCII-only check would reject a fully-non-Latin one outright.
    expect(validateRename(rows, "category", "Dining", "Café")).toBeNull();
    expect(validateRename(rows, "category", "Dining", "食費")).toBeNull();
  });

  it("rejects renaming a name to itself, which would write nothing", () => {
    expect(validateRename(rows, "category", "Dining", "Dining")).toBe("That's already the name.");
    expect(validateRename(rows, "category", "Dining", "  Dining  ")).toBe("That's already the name.");
  });

  it("rejects a source name that no transaction carries", () => {
    expect(validateRename(rows, "category", "Nonexistent", "Restaurant")).toBe(
      'No transactions are in "Nonexistent".',
    );
  });
});

describe("renaming merchants (field = merchant)", () => {
  it("summarizes by merchant, not category, and skips rows with no merchant", () => {
    const summaries = summarizeNames(
      [
        makeTransaction("Groceries", { merchant: "Edeka", amountCents: 1240 }),
        makeTransaction("Household", { merchant: "Edeka", amountCents: 760 }),
        makeTransaction("Groceries", { merchant: "Aldi", amountCents: 300 }),
        makeTransaction("", { merchant: "", categoryType: "transfer", cashflow: "none" }),
        makeTransaction("Groceries", { merchant: "  " }),
      ],
      "merchant",
    );

    expect(summaries.map((s) => [s.name, s.rowCount, s.totalCents])).toEqual([
      ["Edeka", 2, 2000],
      ["Aldi", 1, 300],
    ]);
  });

  it("rewrites only merchant, leaving category and amounts untouched", () => {
    const plan = planRename(
      [
        makeTransaction("Groceries", { merchant: "EDEKA", amountCents: 1240 }),
        makeTransaction("Groceries", { merchant: "Edeka" }),
        makeTransaction("EDEKA", { merchant: "Aldi" }), // category spelled like the source
      ],
      "merchant",
      "EDEKA",
      "Edeka",
    );

    expect(plan.isMerge).toBe(true);
    expect(plan.mergedIntoCount).toBe(1);
    expect(plan.changed).toHaveLength(1);
    expect(plan.changed[0]).toMatchObject({ merchant: "Edeka", category: "Groceries", amountCents: 1240 });
  });

  it("keeps a person's row types when their name is renamed", () => {
    // On receivable/payable rows merchant names a person (Lent out / I owe).
    // A rename moves the name only; the type, and so the sign, stays.
    const plan = planRename(
      [
        makeTransaction("Loan", { merchant: "Sam", categoryType: "receivable", amountCents: 5000 }),
        makeTransaction("Loan", { merchant: "Sam", categoryType: "payable", cashflow: "in", amountCents: 2000 }),
      ],
      "merchant",
      "Sam",
      "Samir",
    );

    expect(plan.isMerge).toBe(false);
    expect(plan.changed.map((t) => [t.merchant, t.categoryType, t.cashflow, t.amountCents])).toEqual([
      ["Samir", "receivable", "out", 5000],
      ["Samir", "payable", "in", 2000],
    ]);
  });

  it("validates against merchants, not categories", () => {
    const rows = [makeTransaction("Edeka", { merchant: "Aldi" })];
    expect(validateRename(rows, "merchant", "Aldi", "ALDI")).toBeNull();
    expect(validateRename(rows, "merchant", "Edeka", "Rewe")).toBe('No transactions are in "Edeka".');
  });
});

describe.skipIf(!hasFixture)("against the real backup", () => {
  it("finds the 36 real categories with Groceries the largest", () => {
    const summaries = summarizeNames(transactions, "category");
    expect(summaries).toHaveLength(36);
    expect(summaries[0]!.name).toBe("Groceries");
    expect(summaries[0]!.rowCount).toBe(578);
  });

  it("flags exactly the two real mixed-type names, both legitimate", () => {
    // Shopping: a purchase, a partly-reimbursed purchase and a refund.
    // WiFi: a shared flat contract, then a sole one after moving.
    // Neither is a mistake, which is why the UI shows this as
    // information with nothing to action.
    const mixed = summarizeNames(transactions, "category").filter((s) => s.hasMixedTypes);

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
    const plan = planRename(transactions, "category", "Dining", "Restaurant");

    expect(plan.isMerge).toBe(true);
    expect(plan.changed).toHaveLength(1);
    expect(plan.mergedIntoCount).toBe(144);
    expect(plan.changed[0]!.amountCents).toBe(readExpectedValues().categoryRename.diningRowAmountCents);
    expect(plan.changed[0]!.merchant).toBe("Papa Johns");
  });

  it("merges the real Fees row into Bank Charges, writing one row", () => {
    const plan = planRename(transactions, "category", "Fees", "Bank Charges");

    expect(plan.isMerge).toBe(true);
    expect(plan.changed).toHaveLength(1);
    expect(plan.mergedIntoCount).toBe(7);
    expect(plan.changed[0]!.amountCents).toBe(readExpectedValues().categoryRename.feesRowAmountCents);
  });

  it("conserves row count and total cents across a real merge", () => {
    const before = summarizeNames(transactions, "category");
    const dining = before.find((s) => s.name === "Dining")!;
    const restaurant = before.find((s) => s.name === "Restaurant")!;

    const plan = planRename(transactions, "category", "Dining", "Restaurant");
    const changedById = new Map(plan.changed.map((t) => [t.id, t]));
    const applied = transactions.map((t) => changedById.get(t.id) ?? t);

    const after = summarizeNames(applied, "category");
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
    const plan = planRename(transactions, "category", "Dining", "Restaurant");
    const original = transactions.find((t) => t.category === "Dining")!;

    expect(plan.changed[0]!.id).toBe(original.id);
  });
});
