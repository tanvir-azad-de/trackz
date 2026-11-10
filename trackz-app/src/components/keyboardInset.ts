/**
 * How many CSS pixels of the layout viewport's bottom edge the on-screen
 * keyboard covers. Sheet lifts itself by this much.
 *
 * Why Sheet needs it: on iOS Safari a position:fixed element stays put
 * when the keyboard opens. Only the VISUAL viewport shrinks. So the
 * sheet's pinned footer (Save) sat under the keyboard whenever the
 * focused field was high enough in the sheet that iOS didn't scroll
 * (Amount). It looked fine for Notes only because iOS scrolled the page
 * to reveal Notes and Save came along (device check 2026-11-10).
 *
 * offsetTop is subtracted because that iOS scroll moves the visual
 * viewport down inside the layout viewport. Without it, the Notes case
 * would lift the sheet twice. Clamped at 0, because pinch-zoom also
 * shrinks the visual viewport and is not a keyboard. Rounded, because
 * fractional heights would make the sheet jitter by subpixels.
 */
export function keyboardInsetPx(layoutHeight: number, visualHeight: number, visualOffsetTop: number): number {
  return Math.max(0, Math.round(layoutHeight - visualHeight - visualOffsetTop));
}
