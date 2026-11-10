import { describe, expect, it } from "vitest";
import {
  applyDraftToTransaction,
  buildTransaction,
  defaultCashflowForCategoryType,
  draftFromTransaction,
  emptyDraft,
  isDraftValid,
  validateDraft,
} from "@/features/entry/draft";
import type { Account, Transaction } from "@/domain/transaction";

const accounts: Account[] = [{ name: "ADVZ" }, { name: "CMRZ" }];

describe("defaultCashflowForCategoryType", () => {
  it("derives cashflow deterministically for the 5 unambiguous category types (matches real CSV crosstab)", () => {
    expect(defaultCashflowForCategoryType("expense", "out")).toBe("out");
    expect(defaultCashflowForCategoryType("non_expense", "out")).toBe("out");
    expect(defaultCashflowForCategoryType("income", "out")).toBe("in");
    expect(defaultCashflowForCategoryType("non_income", "out")).toBe("in");
    expect(defaultCashflowForCategoryType("transfer", "out")).toBe("none");
  });

  it("uses the explicit direction for receivable/payable, the two genuinely bidirectional types", () => {
    expect(defaultCashflowForCategoryType("receivable", "out")).toBe("out");
    expect(defaultCashflowForCategoryType("receivable", "in")).toBe("in");
    expect(defaultCashflowForCategoryType("payable", "out")).toBe("out");
    expect(defaultCashflowForCategoryType("payable", "in")).toBe("in");
  });
});

describe("validateDraft", () => {
  it("accepts a well-formed expense draft", () => {
    const draft = { ...emptyDraft("2026-10-17", 1240), category: "Groceries", account: "ADVZ", merchant: "Edeka" };
    expect(validateDraft(draft, accounts)).toEqual([]);
    expect(isDraftValid(draft, accounts)).toBe(true);
  });

  it("rejects a zero or negative amount", () => {
    const draft = { ...emptyDraft("2026-10-17", 0), category: "Groceries", account: "ADVZ" };
    expect(validateDraft(draft, accounts)).toContain("Enter an amount greater than 0.");
  });

  it("rejects a missing category or account", () => {
    const draft = emptyDraft("2026-10-17", 500);
    const errors = validateDraft(draft, accounts);
    expect(errors).toContain("Pick or type a category.");
    expect(errors).toContain("Pick or type an account.");
  });

  it("rejects an invalid date", () => {
    const draft = { ...emptyDraft("not-a-date", 500), category: "Groceries", account: "ADVZ" };
    expect(validateDraft(draft, accounts)).toContain("Pick a valid date.");
  });

  it("requires a destination account for transfers, matching csv.ts's row-level rule", () => {
    const draft = {
      ...emptyDraft("2026-10-17", 1000),
      categoryType: "transfer" as const,
      category: "Transfer",
      account: "CMRZ",
    };
    expect(validateDraft(draft, accounts)).toContain("Transfers need a destination account.");
  });

  it("rejects a transfer whose destination equals its source", () => {
    const draft = {
      ...emptyDraft("2026-10-17", 1000),
      categoryType: "transfer" as const,
      category: "Transfer",
      account: "CMRZ",
      destinationAccount: "CMRZ",
    };
    expect(validateDraft(draft, accounts)).toContain("Destination account must differ from the source account.");
  });

  it("accepts a well-formed transfer", () => {
    const draft = {
      ...emptyDraft("2026-10-17", 1000),
      categoryType: "transfer" as const,
      category: "Transfer",
      account: "CMRZ",
      destinationAccount: "REVO",
    };
    expect(isDraftValid(draft, accounts)).toBe(true);
  });
});

describe("buildTransaction", () => {
  // Ported from the removed draftFromCombo tests (recall chips, 2026-11-10),
  // which were the only coverage of buildTransaction's derived sign fields.
  it("turns an expense draft into a Transaction with the derived sign fields set", () => {
    const draft = { ...emptyDraft("2026-10-17", 1240), category: "Groceries", merchant: "Edeka", account: "ADVZ", destinationAccount: "REVO" };
    const tx = buildTransaction(draft, "2026-10-17T12:00:00.000Z");
    expect(tx).toMatchObject({
      date: "2026-10-17",
      account: "ADVZ",
      destinationAccount: "", // blanked: only transfers keep one
      cashflow: "out",
      category: "Groceries",
      categoryType: "expense",
      merchant: "Edeka",
      amountCents: 1240,
      notes: "",
      createdAt: "2026-10-17T12:00:00.000Z",
    });
    expect(tx.id).toMatch(/^txn_/);
  });

  it("builds a transfer with destinationAccount kept and cashflow 'none'", () => {
    const draft = { ...emptyDraft("2026-10-17", 50000), categoryType: "transfer" as const, category: "Transfer", account: "CMRZ", destinationAccount: "REVO" };
    const tx = buildTransaction(draft);
    expect(tx.cashflow).toBe("none");
    expect(tx.destinationAccount).toBe("REVO");
  });

  it("trims whitespace from free-text fields on build", () => {
    const draft = { ...emptyDraft("2026-10-17", 500), category: "  Groceries  ", account: " ADVZ ", merchant: " Edeka " };
    const tx = buildTransaction(draft);
    expect(tx.category).toBe("Groceries");
    expect(tx.account).toBe("ADVZ");
    expect(tx.merchant).toBe("Edeka");
  });
});

describe("draftFromTransaction + applyDraftToTransaction (Phase 11 edit flow)", () => {
  const baseTx: Transaction = {
    id: "txn_abc123",
    date: "2026-10-17",
    account: "ADVZ",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant: "Edeka",
    amountCents: 1240,
    notes: "weekly shop",
    createdAt: "2026-10-17T08:00:00.000Z",
    updatedAt: "2026-10-17T08:00:00.000Z",
    deletedAt: null,
  };

  it("round-trips an expense transaction exactly through draft and back", () => {
    const draft = draftFromTransaction(baseTx);
    expect(applyDraftToTransaction(baseTx, draft)).toEqual(baseTx);
  });

  it("round-trips a transfer, preserving destinationAccount and cashflow 'none'", () => {
    const transferTx: Transaction = {
      ...baseTx,
      destinationAccount: "REVO",
      cashflow: "none",
      category: "Transfer",
      categoryType: "transfer",
      merchant: "",
    };
    const draft = draftFromTransaction(transferTx);
    expect(applyDraftToTransaction(transferTx, draft)).toEqual(transferTx);
  });

  it("round-trips a receivable transaction in the 'out' direction (lending)", () => {
    const lendingTx: Transaction = {
      ...baseTx,
      cashflow: "out",
      category: "Lent",
      categoryType: "receivable",
      merchant: "",
    };
    const draft = draftFromTransaction(lendingTx);
    expect(draft.direction).toBe("out");
    expect(applyDraftToTransaction(lendingTx, draft)).toEqual(lendingTx);
  });

  it("round-trips a receivable transaction in the 'in' direction (getting repaid)", () => {
    const repaidTx: Transaction = {
      ...baseTx,
      cashflow: "in",
      category: "Lent",
      categoryType: "receivable",
      merchant: "",
    };
    const draft = draftFromTransaction(repaidTx);
    expect(draft.direction).toBe("in");
    expect(applyDraftToTransaction(repaidTx, draft)).toEqual(repaidTx);
  });

  it("round-trips a payable transaction in both directions", () => {
    const borrowingTx: Transaction = {
      ...baseTx,
      cashflow: "out",
      category: "Owed",
      categoryType: "payable",
      merchant: "",
    };
    const repayingTx: Transaction = { ...borrowingTx, cashflow: "in" };

    expect(applyDraftToTransaction(borrowingTx, draftFromTransaction(borrowingTx))).toEqual(borrowingTx);
    expect(applyDraftToTransaction(repayingTx, draftFromTransaction(repayingTx))).toEqual(repayingTx);
  });

  it("preserves id and createdAt from the existing transaction, not the draft's build-time", () => {
    const draft = draftFromTransaction(baseTx);
    const edited = applyDraftToTransaction(baseTx, { ...draft, amountCents: 999 });
    expect(edited.id).toBe(baseTx.id);
    expect(edited.createdAt).toBe(baseTx.createdAt);
    expect(edited.amountCents).toBe(999);
  });
});
