import { useEffect } from "preact/hooks";

export interface ToastState {
  id: number; // bumped on every show() so a repeat toast restarts its own timer
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Per-toast override of the default 5s auto-dismiss. Added for the
   * service-worker update prompt (Phase 16): a short save/edit/delete
   * toast and a "new version available, reload when convenient" prompt
   * have very different urgency — the SW toast should sit until the
   * user acts on it, not vanish before they've noticed. */
  durationMs?: number;
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
  durationMs?: number;
}

/**
 * One-at-a-time toast, used by the quick-entry sheet (Phase 8) for the
 * "Saved 12,40 € · Groceries" confirmation after a save (1s, no action —
 * see features/entry/savedToast.ts), and by Activity/Settings for Undo. Sits
 * above the tab bar (see z-index in Toast.css vs TabBar.css's 50).
 */
export function Toast({ toast, onDismiss, durationMs = 5000 }: ToastProps) {
  const effectiveDuration = toast?.durationMs ?? durationMs;
  useEffect(() => {
    if (!toast) return;
    if (effectiveDuration === Infinity) return;
    const timer = window.setTimeout(onDismiss, effectiveDuration);
    return () => window.clearTimeout(timer);
  }, [toast?.id, effectiveDuration, onDismiss]);

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
