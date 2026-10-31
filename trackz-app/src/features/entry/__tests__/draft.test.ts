import { describe, expect, it } from "vitest";
import {
  buildTransaction,
  defaultCashflowForCategoryType,
  draftFromCombo,
  emptyDraft,
  isDraftValid,
  validateDraft,
} from "@/features/entry/draft";
import type { RecallCombo } from "@/features/entry/recall";
import type { Account } from "@/domain/transaction";

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

describe("draftFromCombo + buildTransaction (the 3-tap happy path)", () => {
  const combo: RecallCombo = {
    key: "expense|Groceries|Edeka|ADVZ|",
    categoryType: "expense",
    category: "Groceries",
    merchant: "Edeka",
    account: "ADVZ",
    destinationAccount: "",
    cashflow: "out",
    count: 31,
    lastUsedDate: "2026-09-29",
    medianAmountCents: 1240,
    score: 5.5,
  };

  it("builds a valid, saveable draft straight from a chip tap", () => {
    const draft = draftFromCombo(combo, 1240, "2026-10-17");
    expect(isDraftValid(draft, accounts)).toBe(true);
  });

  it("turns that draft into a real Transaction with the derived sign fields set correctly", () => {
    const draft = draftFromCombo(combo, 1240, "2026-10-17");
    const tx = buildTransaction(draft, "2026-10-17T12:00:00.000Z");
    expect(tx).toMatchObject({
      date: "2026-10-17",
      account: "ADVZ",
      destinationAccount: "",
      cashflow: "out",
      category: "Groceries",
      categoryType: "expense",
      merchant: "Edeka",
      amountCents: 1240,
      notes: "",
    });
    expect(tx.id).toMatch(/^txn_/);
  });

  it("builds a transfer transaction with destinationAccount populated and cashflow 'none'", () => {
    const transferCombo: RecallCombo = {
      ...combo,
      categoryType: "transfer",
      category: "Transfer",
      merchant: "",
      account: "CMRZ",
      destinationAccount: "REVO",
      cashflow: "none",
    };
    const draft = draftFromCombo(transferCombo, 50000, "2026-10-17");
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
