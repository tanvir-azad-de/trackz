import { CATEGORY_TYPES, type CategoryType, type Transaction } from "@/domain/transaction";
import { isValidISODate } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import { draftFromTransaction, emptyDraft, type EntryDraft } from "@/features/entry/draft";

/**
 * "Remember everything except the amount" for Add transaction (user
 * decision 2026-11-10, renovation doc section 5 "ENTRY FORM REWORK"). Pure
 * half; storage/entryMemory.ts is the localStorage plumbing.
 *
 * The DATE is remembered too, deliberately — the user asked for it. It is
 * not reset to today on the next open.
 */
export type RememberedEntry = Omit<EntryDraft, "amountCents">;

/**
 * Built from the SAVED transaction, not the draft, so what is remembered is
 * exactly what was written: trimmed, and with destinationAccount already
 * blanked for non-transfers by buildTransaction. Reuses draftFromTransaction
 * for the cashflow -> direction mapping rather than writing a second copy.
 */
export function rememberFromTransaction(tx: Transaction): RememberedEntry {
  const { amountCents: _dropped, ...rest } = draftFromTransaction(tx);
  return rest;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Seeds a new draft from whatever is in storage. `stored` is untrusted —
 * it comes from JSON.parse of localStorage, which another build, a manual
 * edit, or a half-written value can leave in any shape — so each field is
 * checked on its own and a bad one falls back to the empty-draft default
 * without discarding the good ones.
 */
export function draftFromRemembered(stored: unknown, today: string, amountCents: Cents = 0): EntryDraft {
  const base = emptyDraft(today, amountCents);
  if (typeof stored !== "object" || stored === null) return base;
  const s = stored as Record<string, unknown>;
  const categoryType = CATEGORY_TYPES.includes(s.categoryType as CategoryType)
    ? (s.categoryType as CategoryType)
    : base.categoryType;
  return {
    amountCents,
    date: typeof s.date === "string" && isValidISODate(s.date) ? s.date : base.date,
    categoryType,
    category: str(s.category),
    merchant: str(s.merchant),
    account: str(s.account),
    destinationAccount: str(s.destinationAccount),
    direction: s.direction === "in" ? "in" : "out",
    notes: str(s.notes),
  };
}
