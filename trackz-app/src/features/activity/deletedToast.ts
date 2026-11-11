import type { ToastState } from "@/components/Toast";
import { categoryOrTypeLabel, type Transaction } from "@/domain/transaction";

/** How long the post-delete toast, and so its Undo, stays up. */
export const DELETED_TOAST_MS = 1000;

/**
 * The toast Activity shows after a delete. Unlike the save/edit toasts it
 * keeps Undo (user decision 2026-11-11), because once a row is deleted
 * there is nothing left in the list to fix it from. 1s by the same
 * decision: short, but long enough for the button to be tapped.
 * `undo` is passed in so this stays free of repository access.
 */
export function deletedToast(target: Transaction, id: number, undo: () => void): ToastState {
  return {
    id,
    message: `Deleted ${categoryOrTypeLabel(target)}`,
    actionLabel: "Undo",
    onAction: undo,
    durationMs: DELETED_TOAST_MS,
  };
}
