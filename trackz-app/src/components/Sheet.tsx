import { useEffect, useState } from "preact/hooks";
import { keyboardInsetPx } from "./keyboardInset";
import type { ComponentChildren } from "preact";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ComponentChildren;
  /**
   * Pinned below the scrolling content — the place for a sheet's CTAs.
   * A sibling of .sheet__content rather than position:sticky inside it:
   * sticky would still scroll away with any content rendered after it,
   * and needs a background to hide the rows passing beneath.
   */
  footer?: ComponentChildren;
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
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const keyboardInset = useKeyboardInset(open);

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
    <div
      class="sheet-backdrop"
      onClick={onClose}
      style={keyboardInset > 0 ? { "--keyboard-inset": `${keyboardInset}px` } : undefined}
    >
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
        {footer && <div class="sheet__footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Tracks keyboardInsetPx while a sheet is open (see keyboardInset.ts).
 * visualViewport fires resize when the keyboard opens or closes, and
 * scroll when iOS pans to the focused field. Both change the inset.
 * window.visualViewport is absent on old browsers, which keeps the inset
 * at 0, the behaviour from before this existed.
 */
function useKeyboardInset(open: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const update = () => setInset(keyboardInsetPx(window.innerHeight, vv.height, vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setInset(0);
    };
  }, [open]);
  return inset;
}
