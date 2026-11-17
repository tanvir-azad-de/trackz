import { describe, expect, it } from "vitest";
import { debtBalanceProblem } from "@/features/entry/debtBalance";
import type { Cashflow, CategoryType, Transaction } from "@/domain/transaction";

let seq = 0;
function row(categoryType: CategoryType, cashflow: Cashflow, amountCents: number, merchant = "Bob", date = "2026-11-01"): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    date,
    account: "ADVZ",
    destinationAccount: "",
    cashflow,
    category: "",
    categoryType,
    merchant,
    amountCents,
    notes: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("debtBalanceProblem — Lent", () => {
  const loan = row("receivable", "out", 1000);

  it("lets Bob repay exactly what he owes, and refuses one cent more", () => {
    expect(debtBalanceProblem([loan], null, row("receivable", "in", 1000))).toBeNull();
    expect(debtBalanceProblem([loan], null, row("receivable", "in", 1001))).toBe("Bob only owes you 10,00\u00a0€.");
  });

  it("counts earlier repayments against the limit", () => {
    const live = [loan, row("receivable", "in", 400)];
    expect(debtBalanceProblem(live, null, row("receivable", "in", 600))).toBeNull();
    expect(debtBalanceProblem(live, null, row("receivable", "in", 601))).toBe("Bob only owes you 6,00\u00a0€.");
  });

  it("keeps people apart: Alice's loan does not cover Bob", () => {
    const live = [row("receivable", "out", 5000, "Alice")];
    expect(debtBalanceProblem(live, null, row("receivable", "in", 100))).toBe("Bob doesn't owe you anything.");
  });

  it("checks the final total, not each date: a repayment dated before the loan is fine", () => {
    const live = [row("receivable", "out", 1000, "Bob", "2026-11-10")];
    expect(debtBalanceProblem(live, null, row("receivable", "in", 1000, "Bob", "2026-11-01"))).toBeNull();
  });

  it("checks an edit against the other rows, not against its own old amount", () => {
    const repay = row("receivable", "in", 1000);
    const live = [loan, repay];
    // Unchanged re-save: must not count the row twice.
    expect(debtBalanceProblem(live, repay, repay)).toBeNull();
    expect(debtBalanceProblem(live, repay, { ...repay, amountCents: 1100 })).toBe("Bob only owes you 10,00\u00a0€.");
    // Shrinking the loan under the repayment.
    expect(debtBalanceProblem(live, loan, { ...loan, amountCents: 999 })).toBe(
      "Bob has repaid more than this would leave lent. Remove the repayments first.",
    );
  });

  it("refuses moving a repaid loan to another person or type, which empties Bob's side", () => {
    const live = [loan, row("receivable", "in", 1000)];
    expect(debtBalanceProblem(live, loan, { ...loan, merchant: "Alice" })).toBe(
      "Bob has repaid more than this would leave lent. Remove the repayments first.",
    );
    expect(debtBalanceProblem(live, loan, { ...loan, categoryType: "expense", category: "Food" })).not.toBeNull();
  });

  it("refuses deleting the loan under its repayment, and allows deleting the repayment", () => {
    const repay = row("receivable", "in", 300);
    expect(debtBalanceProblem([loan, repay], loan, null)).not.toBeNull();
    expect(debtBalanceProblem([loan, repay], repay, null)).toBeNull();
  });
});

describe("debtBalanceProblem — Borrowed", () => {
  const borrow = row("payable", "in", 500);

  it("lets you repay what you borrowed and no more", () => {
    expect(debtBalanceProblem([borrow], null, row("payable", "out", 500))).toBeNull();
    expect(debtBalanceProblem([borrow], null, row("payable", "out", 501))).toBe("You only owe Bob 5,00\u00a0€.");
    expect(debtBalanceProblem([], null, row("payable", "out", 1))).toBe("You don't owe Bob anything.");
  });

  it("does not mix Lent and Borrowed with the same person", () => {
    const live = [row("receivable", "out", 5000)];
    expect(debtBalanceProblem(live, null, row("payable", "out", 100))).toBe("You don't owe Bob anything.");
  });
});

describe("debtBalanceProblem — other types", () => {
  it("never objects to rows that are not Lent / Borrowed", () => {
    expect(debtBalanceProblem([], null, row("expense", "out", 100))).toBeNull();
    expect(debtBalanceProblem([], row("income", "in", 100), null)).toBeNull();
  });
});
