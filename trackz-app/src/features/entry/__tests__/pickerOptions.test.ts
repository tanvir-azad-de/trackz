import { describe, expect, it } from "vitest";
import { merchantInScope, merchantsFor, pickerAccounts, pickerCategories, pickerMerchants, pickerNames, sortedByLabel } from "@/features/entry/pickerOptions";
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
    expect(pickerMerchants(list).all).toEqual(["edeka", "Zara"]);
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
    expect(pickerMerchants(list).all).toEqual([]);
  });
});

describe("merchantsFor", () => {
  const list = [
    tx(TODAY, { category: "Shopping", merchant: "Tedi" }),
    tx(TODAY, { category: "Shopping", categoryType: "non_income", cashflow: "in", merchant: "Amazon" }),
    tx(TODAY, { category: " Shopping ", merchant: "Zara" }),
    tx(TODAY, { category: "Groceries", merchant: "Alice" }),
    tx(TODAY, { category: "", categoryType: "receivable", merchant: "Bob" }),
    tx(TODAY, { category: "", categoryType: "payable", cashflow: "in", merchant: "Carol" }),
    tx(TODAY, { category: "", categoryType: "transfer", cashflow: "none", destinationAccount: "REVO", merchant: "" }),
  ];
  const options = pickerMerchants(list);

  it("lists only the chosen category's merchants, across every type on it", () => {
    // Amazon is a non_income row: matching on type as well would drop it.
    expect(merchantsFor(options, "Shopping", "expense")).toEqual(["Amazon", "Tedi", "Zara"]);
    expect(merchantsFor(options, "Groceries", "expense")).toEqual(["Alice"]);
  });

  it("matches a padded category to its trimmed name", () => {
    expect(merchantsFor(options, " Shopping", "expense")).toEqual(["Amazon", "Tedi", "Zara"]);
  });

  it("shows everything until a category is chosen, and nothing for a brand-new one", () => {
    expect(merchantsFor(options, "", "expense")).toEqual(["Alice", "Amazon", "Bob", "Carol", "Tedi", "Zara"]);
    expect(merchantsFor(options, "Brand New", "expense")).toEqual([]);
  });

  it("gives Lent out / I owe the people from both of those types, whatever category the draft still holds", () => {
    expect(merchantsFor(options, "", "receivable")).toEqual(["Bob", "Carol"]);
    expect(merchantsFor(options, "Shopping", "payable")).toEqual(["Bob", "Carol"]);
  });

  it("gives a transfer nothing", () => {
    expect(merchantsFor(options, "", "transfer")).toEqual([]);
  });
});

describe("merchantInScope", () => {
  const options = pickerMerchants([
    tx(TODAY, { category: "Shopping", merchant: "Tedi" }),
    tx(TODAY, { category: "Subscriptions", merchant: "Netflix" }),
    tx(TODAY, { category: "Shopping", merchant: "Alice" }),
    tx(TODAY, { category: "Gifts", merchant: "Alice" }),
    tx(TODAY, { category: "", categoryType: "receivable", merchant: "Bob" }),
  ]);

  it("clears a merchant the new category doesn't list", () => {
    expect(merchantInScope("Tedi", options, "Subscriptions", "expense")).toBe("");
  });

  it("keeps a merchant the new category also lists", () => {
    expect(merchantInScope("Alice", options, "Gifts", "expense")).toBe("Alice");
  });

  it("clears a shop when the type switches to Lent out, and keeps a person", () => {
    expect(merchantInScope("Tedi", options, "Shopping", "receivable")).toBe("");
    expect(merchantInScope("Bob", options, "", "payable")).toBe("Bob");
  });

  it("matches a padded merchant by its trimmed name", () => {
    expect(merchantInScope(" Tedi ", options, "Shopping", "expense")).toBe(" Tedi ");
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
