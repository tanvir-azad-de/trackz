/**
 * iOS standalone-PWA keyboard fix (bug report 2026-11-11): focusing an
 * input scrolls the page up to clear the keyboard, and dismissing the
 * keyboard with Done does NOT scroll it back. The whole app stays shifted
 * up with a black band at the bottom until something forces a re-layout
 * (switching to Home did; Debts/Settings did not, because their
 * tab-change scrollTo(0, 0) was a no-op on an already-0 scrollY while the
 * offset lived in the visual viewport).
 *
 * The guard remembers where the page was when a keyboard-raising field
 * took focus and puts it back when focus leaves for something that does
 * not raise one. Focus moving input -> input (Amount -> Note) keeps the
 * FIRST position: the intermediate one is already iOS's shifted offset.
 *
 * Pure half: no DOM globals, so it runs under vitest's node environment.
 * installKeyboardScrollGuard() below is the thin wiring.
 */

export interface FocusTargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** True for elements that raise the on-screen keyboard. */
export function raisesKeyboard(el: FocusTargetLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
  return false;
}

export interface ScrollPort {
  scrollX(): number;
  scrollY(): number;
  scrollTo(x: number, y: number): void;
}

export function createKeyboardScrollGuard(port: ScrollPort) {
  let saved: { x: number; y: number } | null = null;
  let pending: { x: number; y: number } | null = null;

  return {
    focusIn(target: FocusTargetLike | null) {
      if (!raisesKeyboard(target)) return;
      // Already tracking (input -> input): keep the pre-keyboard position.
      if (saved === null) saved = { x: port.scrollX(), y: port.scrollY() };
      // Load-bearing: a refocus before the keyboard finished closing must
      // cancel the queued restore, or the keyboard-OPENING resize would
      // yank the page back under the newly focused field.
      pending = null;
    },
    /** `next` is FocusEvent.relatedTarget — where focus is going. */
    focusOut(next: FocusTargetLike | null) {
      if (saved === null || raisesKeyboard(next)) return;
      const target = saved;
      saved = null;
      // Unconditional, not "only if scrollY changed": the bug's offset can
      // sit in the visual viewport with scrollY already back at the saved
      // value, and that is exactly the case a changed-check would skip.
      port.scrollTo(target.x, target.y);
      pending = target;
    },
    /**
     * visualViewport resize. iOS animates the keyboard away AFTER blur,
     * and can re-apply its offset during that animation, so the restore
     * is repeated once the viewport has actually grown back.
     */
    viewportResized() {
      if (pending === null) return;
      port.scrollTo(pending.x, pending.y);
      pending = null;
    },
  };
}

/** Thin wiring; untested by design (see AGENTS.md "Pure logic splits from plumbing"). */
export function installKeyboardScrollGuard(win: Window = window): void {
  const guard = createKeyboardScrollGuard({
    scrollX: () => win.scrollX,
    scrollY: () => win.scrollY,
    scrollTo: (x, y) => win.scrollTo(x, y),
  });
  win.document.addEventListener("focusin", (e) => guard.focusIn(e.target as FocusTargetLike | null));
  win.document.addEventListener("focusout", (e) => guard.focusOut(e.relatedTarget as FocusTargetLike | null));
  win.visualViewport?.addEventListener("resize", () => guard.viewportResized());
}
