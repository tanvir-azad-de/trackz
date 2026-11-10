import type { Account, Cashflow, CategoryType, Transaction } from "@/domain/transaction";
import { newTransactionId } from "@/domain/id";
import { isValidISODate } from "@/domain/dates";
import type { Cents } from "@/domain/money";

/**
 * In-progress quick-entry state, before it becomes a real Transaction.
 * Shared by Add transaction and the Activity edit form, so there is exactly one place that turns a draft into a
 * saved Transaction — buildTransaction() below — and exactly one place
 * that decides whether a draft is save-able — validateDraft() below.
 */
export interface EntryDraft {
  amountCents: Cents;
  date: string; // ISODate
  categoryType: CategoryType;
  category: string;
  merchant: string;
  account: string;
  destinationAccount: string; // only meaningful when categoryType === "transfer"
  /**
   * Only meaningful for "receivable"/"payable", where direction is
   * genuinely ambiguous (see defaultCashflowForCategoryType). For every
   * other categoryType the sign is implied by the type itself and this
   * field is ignored by buildTransaction.
   */
  direction: "out" | "in";
  notes: string;
}

export function emptyDraft(today: string, amountCents: Cents = 0): EntryDraft {
  return {
    amountCents,
    date: today,
    categoryType: "expense",
    category: "",
    merchant: "",
    account: "",
    destinationAccount: "",
    direction: "out",
    notes: "",
  };
}

/**
 * Cashflow is DERIVED from categoryType wherever the old CSV data shows it
 * is deterministic (see dummyData/snapshot-2026-10-31 category_type ->
 * cashflow crosstab: expense/non_expense always "out", income/non_income
 * always "in", transfer always "none"). The quick-entry UI never asks for
 * cashflow directly for those types — asking would just be a second way
 * to get the same answer wrong.
 *
 * receivable/payable are the two types that are genuinely bidirectional in
 * the real data (9 "out" / 4 "in" for receivable in the full CSV) — those
 * use the draft's explicit `direction` field instead.
 */
export function defaultCashflowForCategoryType(categoryType: CategoryType, direction: "out" | "in"): Cashflow {
  switch (categoryType) {
    case "expense":
    case "non_expense":
      return "out";
    case "income":
    case "non_income":
      return "in";
    case "transfer":
      return "none";
    case "receivable":
    case "payable":
      return direction;
  }
}

/**
 * Inverse of buildTransaction, for the Activity screen's edit flow
 * (Phase 11). `direction` is recovered from the existing transaction's
 * cashflow — for receivable/payable "in" means direction "in", everything
 * else defaults to "out" (direction is ignored by buildTransaction for
 * the other 5 category types, so the exact fallback value doesn't matter
 * there, but receivable/payable must round-trip exactly).
 */
export function draftFromTransaction(tx: Transaction): EntryDraft {
  return {
    amountCents: tx.amountCents,
    date: tx.date,
    categoryType: tx.categoryType,
    category: tx.category,
    merchant: tx.merchant,
    account: tx.account,
    destinationAccount: tx.destinationAccount,
    direction: tx.cashflow === "in" ? "in" : "out",
    notes: tx.notes,
  };
}

/**
 * Same validation rules as storage/csv.ts's row-level checks — a
 * quick-entry transaction must be able to round-trip through CSV
 * export/import (Phase 13) exactly like an imported one. Returns a list
 * of human-readable problems; empty means "save-able".
 */
export function validateDraft(draft: EntryDraft, knownAccounts: readonly Account[]): string[] {
  const errors: string[] = [];

  if (draft.amountCents <= 0) errors.push("Enter an amount greater than 0.");
  if (!isValidISODate(draft.date)) errors.push("Pick a valid date.");
  if (!draft.category.trim()) errors.push("Pick or type a category.");
  if (!draft.account.trim()) errors.push("Pick or type an account.");

  if (draft.categoryType === "transfer") {
    if (!draft.destinationAccount.trim()) {
      errors.push("Transfers need a destination account.");
    } else if (draft.destinationAccount.trim() === draft.account.trim()) {
      errors.push("Destination account must differ from the source account.");
    }
  }

  // Not a hard error — the account picker offers "+ new account" — but
  // callers (the form) use this to show a confirmation hint, so exposed
  // here rather than duplicated.
  void knownAccounts;

  return errors;
}

export function isDraftValid(draft: EntryDraft, knownAccounts: readonly Account[]): boolean {
  return validateDraft(draft, knownAccounts).length === 0;
}

/** Turns a valid draft into a real Transaction. Caller must check validateDraft() first. */
export function buildTransaction(draft: EntryDraft, createdAt: string = new Date().toISOString()): Transaction {
  const cashflow = defaultCashflowForCategoryType(draft.categoryType, draft.direction);
  return {
    id: newTransactionId(),
    date: draft.date,
    account: draft.account.trim(),
    destinationAccount: cashflow === "none" ? draft.destinationAccount.trim() : "",
    cashflow,
    category: draft.category.trim(),
    categoryType: draft.categoryType,
    merchant: draft.merchant.trim(),
    amountCents: draft.amountCents,
    notes: draft.notes.trim(),
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

/**
 * Inverse of buildTransaction, for the Activity screen's edit flow
 * (Phase 11) — preserves the original id and createdAt instead of
 * minting new ones, so an edited transaction stays the "same" row (undo
 * restores the exact prior object, and the key the list renders by
 * doesn't change under the user's finger). Caller must check
 * validateDraft() first, same contract as buildTransaction.
 */
/**
 * Inverse of buildTransaction, for the Activity screen's edit flow
 * (Phase 11) — preserves the original id and createdAt instead of
 * minting new ones, so an edited transaction stays the "same" row (undo
 * restores the exact prior object, and the key the list renders by
 * doesn't change under the user's finger). Caller must check
 * validateDraft() first, same contract as buildTransaction.
 *
 * Deliberately does NOT touch updatedAt/deletedAt — this function is a
 * pure, deterministic data transform (exact-round-trip tested:
 * applyDraftToTransaction(draftFromTransaction(tx)) === tx when nothing
 * changed), and repository.updateTransaction() is the one place that
 * stamps updatedAt on an actual write (Phase 15a). Stamping here too
 * would make this function's output depend on wall-clock time, which
 * the round-trip test specifically guards against.
 */
export function applyDraftToTransaction(existing: Transaction, draft: EntryDraft): Transaction {
  const cashflow = defaultCashflowForCategoryType(draft.categoryType, draft.direction);
  return {
    ...existing,
    date: draft.date,
    account: draft.account.trim(),
    destinationAccount: cashflow === "none" ? draft.destinationAccount.trim() : "",
    cashflow,
    category: draft.category.trim(),
    categoryType: draft.categoryType,
    merchant: draft.merchant.trim(),
    amountCents: draft.amountCents,
    notes: draft.notes.trim(),
  };
}
