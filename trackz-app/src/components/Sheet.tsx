import { useEffect } from "preact/hooks";
import type { ComponentChildren } from "preact";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ComponentChildren;
}

/**
 * Bottom sheet primitive — Phase 8's quick-entry sheet is the first
 * consumer, but this is deliberately generic so Phase 11's transaction
 * detail sheet and Phase 13's merchant-merge screen can reuse it instead
 * of each hand-rolling their own backdrop/scroll-lock/escape handling.
 *
 * - role="dialog" + aria-modal, backdrop tap and Escape both close.
 * - Body scroll is locked while open (old app had no modals at all, so
 *   this is new territory — overscroll-behavior alone doesn't stop the
 *   page behind a fixed-position sheet from scrolling on iOS).
 * - max-height 85dvh with internal scroll, safe-area bottom padding.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="sheet__grabber" />
        {title && <h2 class="sheet__title">{title}</h2>}
        <div class="sheet__content">{children}</div>
      </div>
    </div>
  );
}
