import { useEffect } from "preact/hooks";

export interface ToastState {
  id: number; // bumped on every show() so a repeat toast restarts its own timer
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
  durationMs?: number;
}

/**
 * One-at-a-time toast, used by the quick-entry sheet (Phase 8) for the
 * "Saved 12,40 € · Groceries — Undo" confirmation after a chip tap. Sits
 * above the tab bar (see z-index in Toast.css vs TabBar.css's 50).
 */
export function Toast({ toast, onDismiss, durationMs = 5000 }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [toast?.id, durationMs, onDismiss]);

  if (!toast) return null;

  return (
    <div class="toast" role="status">
      <span class="toast__message">{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          class="toast__action"
          onClick={() => {
            toast.onAction?.();
            onDismiss();
          }}
        >
          {toast.actionLabel}
        </button>
      )}
    </div>
  );
}
