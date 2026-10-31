import { describe, expect, it } from "vitest";
import { getSignedAmountCents, type Transaction } from "@/domain/transaction";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: "t1",
    date: "2026-01-01",
    account: "CMRZ",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant: "Rewe",
    amountCents: 1000,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getSignedAmountCents — single source of truth for sign (replaces 4 old copies)", () => {
  it("account perspective: expense reduces the source account", () => {
    const t = tx({ cashflow: "out", account: "CMRZ", amountCents: 1000 });
    expect(getSignedAmountCents(t, { kind: "account", name: "CMRZ" })).toBe(-1000);
  });

  it("account perspective: income increases the source account", () => {
    const t = tx({ cashflow: "in", account: "CMRZ", categoryType: "income", amountCents: 500 });
    expect(getSignedAmountCents(t, { kind: "account", name: "CMRZ" })).toBe(500);
  });

  it("account perspective: transfer reduces source, increases destination", () => {
    const t = tx({
      cashflow: "none",
      account: "CMRZ",
      destinationAccount: "CASH",
      categoryType: "transfer",
      amountCents: 10000,
    });
    expect(getSignedAmountCents(t, { kind: "account", name: "CMRZ" })).toBe(-10000);
    expect(getSignedAmountCents(t, { kind: "account", name: "CASH" })).toBe(10000);
  });

  it("account perspective: zero effect on an unrelated account", () => {
    const t = tx({ cashflow: "out", account: "CMRZ", amountCents: 1000 });
    expect(getSignedAmountCents(t, { kind: "account", name: "REVO" })).toBe(0);
  });

  it("net-worth perspective: income positive, expense negative, transfer zero", () => {
    expect(getSignedAmountCents(tx({ categoryType: "income", cashflow: "in" }), { kind: "net-worth" })).toBe(1000);
    expect(getSignedAmountCents(tx({ categoryType: "expense", cashflow: "out" }), { kind: "net-worth" })).toBe(-1000);
    expect(getSignedAmountCents(tx({ categoryType: "transfer", cashflow: "none" }), { kind: "net-worth" })).toBe(0);
  });

  it("receivable perspective: lending (out) is positive, repayment (in) is negative", () => {
    const lent = tx({ categoryType: "receivable", cashflow: "out", amountCents: 5000 });
    const repaid = tx({ categoryType: "receivable", cashflow: "in", amountCents: 5000 });
    expect(getSignedAmountCents(lent, { kind: "receivable" })).toBe(5000);
    expect(getSignedAmountCents(repaid, { kind: "receivable" })).toBe(-5000);
  });

  it("payable perspective: borrowing (in) is positive, repaying (out) is negative", () => {
    const borrowed = tx({ categoryType: "payable", cashflow: "in", amountCents: 3000 });
    const repaid = tx({ categoryType: "payable", cashflow: "out", amountCents: 3000 });
    expect(getSignedAmountCents(borrowed, { kind: "payable" })).toBe(3000);
    expect(getSignedAmountCents(repaid, { kind: "payable" })).toBe(-3000);
  });

  it("receivable perspective ignores non-receivable transactions", () => {
    expect(getSignedAmountCents(tx({ categoryType: "expense" }), { kind: "receivable" })).toBe(0);
  });
});
