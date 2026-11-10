import { describe, expect, it } from "vitest";
import { pickerNames, rankAccounts, rankCategories, rankMerchants } from "@/features/entry/rank";
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

describe("rankCategories / rankMerchants / rankAccounts", () => {
  it("weights recency over raw count: one use today beats three uses 60 days ago", () => {
    // 3 * 0.5^(60/21) = 0.414 < 1
    const list = [
      tx("2026-09-11", { category: "Old" }),
      tx("2026-09-11", { category: "Old" }),
      tx("2026-09-11", { category: "Old" }),
      tx(TODAY, { category: "New" }),
    ];
    expect(names(rankCategories(list, TODAY))).toEqual(["New", "Old"]);
  });

  it("has no time window: a name last used 400 days ago is still listed, last", () => {
    const list = [tx("2025-10-06", { merchant: "Ancient" }), tx(TODAY, { merchant: "Edeka" })];
    expect(names(rankMerchants(list, TODAY))).toEqual(["Edeka", "Ancient"]);
  });

  it("breaks an exact score tie by count, then by name", () => {
    // Zed: 2 * 0.5^(21/21) = 1.0 exactly. Alpha: 1 * 0.5^0 = 1.0. Equal score.
    const list = [
      tx("2026-10-20", { category: "Zed" }),
      tx("2026-10-20", { category: "Zed" }),
      tx(TODAY, { category: "Alpha" }),
      tx(TODAY, { category: "Beta" }),
    ];
    expect(names(rankCategories(list, TODAY))).toEqual(["Zed", "Alpha", "Beta"]);
  });

  it("clamps future-dated rows to today's weight instead of letting them outrank habits", () => {
    // Unclamped, the future row would weigh 0.5^(-30/21) = 2.69 > 2.
    const list = [tx("2026-12-10", { category: "Future" }), tx(TODAY, { category: "Habit" }), tx(TODAY, { category: "Habit" })];
    expect(names(rankCategories(list, TODAY))).toEqual(["Habit", "Future"]);
  });

  it("counts transfer destinations as accounts", () => {
    const list = [
      tx(TODAY, { account: "CMRZ", destinationAccount: "REVO", categoryType: "transfer", cashflow: "none" }),
      tx(TODAY, { account: "ADVZ", destinationAccount: "REVO", categoryType: "transfer", cashflow: "none" }),
    ];
    expect(names(rankAccounts(list, TODAY))).toEqual(["REVO", "ADVZ", "CMRZ"]);
  });

  it("trims category names and skips blank merchants", () => {
    const list = [tx(TODAY, { category: " Groceries ", merchant: "" }), tx(TODAY, { category: "Groceries", merchant: " " })];
    expect(names(rankCategories(list, TODAY))).toEqual(["Groceries"]);
    expect(names(rankMerchants(list, TODAY))).toEqual([]);
  });
});

describe("pickerNames", () => {
  it("prepends a current value the ranked list doesn't contain", () => {
    expect(pickerNames("Merged Away", ["Edeka", "Rewe"])).toEqual(["Merged Away", "Edeka", "Rewe"]);
  });

  it("leaves the order alone when the value is already ranked", () => {
    expect(pickerNames("Rewe", ["Edeka", "Rewe"])).toEqual(["Edeka", "Rewe"]);
  });

  it("adds nothing for a blank value", () => {
    expect(pickerNames("  ", ["Edeka"])).toEqual(["Edeka"]);
  });
});
