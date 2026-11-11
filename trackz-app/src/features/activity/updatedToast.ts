import type { ToastState } from "@/components/Toast";
import { categoryOrTypeLabel, type Transaction } from "@/domain/transaction";

/** How long the post-edit confirmation stays up. */
export const UPDATED_TOAST_MS = 500;

/**
 * The confirmation Activity shows after an edit is saved. No Undo (user
 * decision 2026-11-11): at 500ms a button could not be reached anyway, and
 * a wrong edit is fixed by editing the row again. Delete keeps its 5s Undo
 * — a deleted row is gone from the list, so there is nothing to re-edit.
 */
export function updatedToast(updated: Transaction, id: number): ToastState {
  return {
    id,
    message: `Updated ${categoryOrTypeLabel(updated)}`,
    durationMs: UPDATED_TOAST_MS,
  };
}
