/**
 * The keypad's key layout as data. Before the icon migration the delete key
 * was the string "⌫" and Keypad.tsx routed on `key === "⌫"` — the visible
 * glyph WAS the control flow, so swapping it for an icon component would
 * have silently turned delete into "append digit ⌫". Keys are now a
 * discriminated union and the render decides what to draw per `kind`.
 */
export type KeypadKey = { kind: "digit"; digit: string } | { kind: "delete" } | { kind: "blank" };

const digit = (d: string): KeypadKey => ({ kind: "digit", digit: d });

/** Row-major 3x4 grid. Bottom-left is blank on purpose — see Keypad.tsx. */
export const KEYPAD_KEYS: readonly KeypadKey[] = [
  digit("1"), digit("2"), digit("3"),
  digit("4"), digit("5"), digit("6"),
  digit("7"), digit("8"), digit("9"),
  { kind: "blank" }, digit("0"), { kind: "delete" },
];
