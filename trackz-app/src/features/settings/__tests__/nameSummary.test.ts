import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import { summarizeNames } from "@/features/settings/nameSummary";
import type { CategoryType, Transaction } from "@/domain/transaction";
import { hasExpectedValues } from "@/__tests__/expectedValues";

/**
 * Phase 13b: the category/merchant name summaries behind Settings'
 * Categories and Merchants sheets (rename was removed 2026-11-11).
 *
 * hasFixture gates only the real-data blocks, matching
 * filter.test.ts (dummyData/ is gitignored real
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

describe("summarizeNames (merchant)", () => {
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
});
