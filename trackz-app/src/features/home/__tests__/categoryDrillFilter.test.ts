import { describe, expect, it } from "vitest";
import type { Cashflow, CategoryType, Transaction } from "@/domain/transaction";
import { getSignedAmountCents } from "@/domain/transaction";
import { filterTransactions } from "@/features/activity/filter";
import { categoryDrillFilter } from "@/features/home/categoryDrillFilter";
import { getTopCategoriesForMonth } from "@/insights/engine";

let seq = 0;
function row(date: string, category: string, categoryType: CategoryType, cashflow: Cashflow, amountCents: number): Transaction {
  seq++;
  return {
    id: `d${seq}`,
    date,
    account: "ACC",
    destinationAccount: "",
    cashflow,
    category,
    categoryType,
    merchant: "",
    amountCents,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("categoryDrillFilter", () => {
  const txs = [
    row("2026-10-03", "Bills", "expense", "out", 12000),
    row("2026-10-12", "Bills", "non_income", "in", 4500), // a flatmate's share back
    row("2026-10-14", "Bills", "non_expense", "out", 3000), // shared bill: not spending
    row("2026-10-20", "Food", "expense", "out", 999),
    row("2026-09-30", "Bills", "expense", "out", 7777), // previous month
  ];

  it("lands on the rows whose Activity total equals the category sheet's figure", () => {
    const shown = filterTransactions(txs, categoryDrillFilter("Bills", "2026-10"));
    // Activity sums cash flow (in +, out -); the sheet shows spending positive.
    const activityCents = shown.reduce((sum, tx) => sum + getSignedAmountCents(tx, { kind: "cash-flow" }), 0);
    const sheet = getTopCategoriesForMonth(txs, "2026-10", Infinity).find((c) => c.category === "Bills")!;
    expect(sheet.amountCents).toBe(7500);
    expect(activityCents).toBe(-7500);
    expect(shown.map((tx) => tx.categoryType).sort()).toEqual(["expense", "non_income"]);
  });
});
