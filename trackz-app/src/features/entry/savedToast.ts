import type { ToastState } from "@/components/Toast";
import { categoryOrTypeLabel, type Transaction } from "@/domain/transaction";
import { formatEUR } from "@/domain/money";

/** How long the post-save confirmation stays up. */
export const SAVED_TOAST_MS = 1000;

/**
 * The confirmation App shows after a new transaction is saved. Deliberately
 * no Undo action (user decision 2026-11-11): a mistaken add is fixed by
 * opening the row in Activity and deleting it, which has its own Undo.
 * Without an action to reach for, the toast only needs to be read, so it
 * clears after 1s instead of Toast's 5s default.
 */
export function savedToast(tx: Transaction, id: number): ToastState {
  return {
    id,
    message: `Saved ${formatEUR(tx.amountCents)} · ${categoryOrTypeLabel(tx)}`,
    durationMs: SAVED_TOAST_MS,
  };
}
