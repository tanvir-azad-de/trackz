import { describe, expect, it } from "vitest";
import { pickerAccounts, pickerCategories, pickerMerchants, pickerNames, sortedByLabel } from "@/features/entry/pickerOptions";
import { ACCOUNT_TYPES, CATEGORY_TYPES, accountTypeLabel, categoryTypeLabel } from "@/domain/transaction";
import type { Transaction } from "@/domain/transaction";

const TODAY = "2026-11-10";

let seq = 0;
function tx(date: string, fields: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `txn_${seq}`,
    date,
    account: "ADVZ",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant: "",
    amountCents: 100,
    notes: "",
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    deletedAt: null,
    ...fields,
  };
}

const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe("pickerCategories / pickerMerchants / pickerAccounts", () => {
  it("sorts alphabetically regardless of how recently or often a name was used", () => {
    const list = [
      tx(TODAY, { category: "Zed" }),
      tx(TODAY, { category: "Zed" }),
      tx(TODAY, { category: "Zed" }),
      tx("2025-10-06", { category: "Alpha" }),
      tx(TODAY, { category: "Mid" }),
    ];
    expect(names(pickerCategories(list))).toEqual(["Alpha", "Mid", "Zed"]);
  });

  it("sorts case-insensitively, not uppercase-first", () => {
    // Default .sort() would give ["Zara", "edeka"].
    const list = [tx(TODAY, { merchant: "Zara" }), tx(TODAY, { merchant: "edeka" })];
    expect(names(pickerMerchants(list))).toEqual(["edeka", "Zara"]);
  });

  it("counts transfer destinations as accounts", () => {
    const list = [
      tx(TODAY, { account: "REVO", destinationAccount: "CMRZ", categoryType: "transfer", cashflow: "none" }),
      tx(TODAY, { account: "ADVZ", destinationAccount: "", categoryType: "expense" }),
    ];
    expect(names(pickerAccounts(list))).toEqual(["ADVZ", "CMRZ", "REVO"]);
  });

  it("trims category names and skips blank merchants", () => {
    const list = [tx(TODAY, { category: " Groceries ", merchant: "" }), tx(TODAY, { category: "Groceries", merchant: " " })];
    expect(names(pickerCategories(list))).toEqual(["Groceries"]);
    expect(names(pickerMerchants(list))).toEqual([]);
  });
});

describe("pickerNames", () => {
  it("inserts a current value the list doesn't contain in its alphabetical place", () => {
    expect(pickerNames("Lidl", ["Edeka", "Rewe"])).toEqual(["Edeka", "Lidl", "Rewe"]);
  });

  it("leaves the list alone when the value is already in it", () => {
    expect(pickerNames("Rewe", ["Edeka", "Rewe"])).toEqual(["Edeka", "Rewe"]);
  });

  it("adds nothing for a blank value", () => {
    expect(pickerNames("  ", ["Edeka"])).toEqual(["Edeka"]);
  });
});

describe("sortedByLabel", () => {
  it("orders category types by their visible label, not their key", () => {
    expect(sortedByLabel(CATEGORY_TYPES, categoryTypeLabel).map(categoryTypeLabel)).toEqual([
      "Expense",
      "I owe",
      "Income",
      "Lent out",
      "Non expense",
      "Non income",
      "Transfer",
    ]);
  });

  it("orders account types by label", () => {
    expect(sortedByLabel(ACCOUNT_TYPES, accountTypeLabel)).toEqual(["cash", "credit_card", "investment"]);
  });

  it("does not reorder the source array", () => {
    sortedByLabel(CATEGORY_TYPES, categoryTypeLabel);
    expect(CATEGORY_TYPES[0]).toBe("income");
  });
});
