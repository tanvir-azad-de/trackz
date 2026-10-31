import type { Cents } from "@/domain/money";

/**
 * Numeric keypad state for the quick-entry sheet (Phase 8). Modeled as an
 * ATM-style cent accumulator, not a text/decimal input: every digit tap
 * shifts the existing digits left and appends the new one at the cents
 * place, so "1", "2", "4", "0" produces 12,40 €, not "1240,00 €" then a
 * decimal-point re-parse. This was chosen over a decimal-point keypad
 * because real usage data (dummyData/snapshot-2026-10-31) shows 921 of
 * 1,174 expenses carry non-zero cents (median Groceries/Edeka = 12,40 €) —
 * the accumulator makes the common case the short one, and it is
 * structurally impossible to produce a malformed amount (no "12..4" or
 * "12.405" to validate against).
 *
 * `digits` holds only the decimal-digit string with leading zeros
 * collapsed, e.g. "1240" -> 12,40 €. Capped at 9 digits (99.999.999,99 €),
 * comfortably above any realistic personal-finance entry and far below
 * the integer-cents safe range documented in domain/money.ts.
 */
export interface AmountEntry {
  digits: string; // "" means empty/zero
}

const MAX_DIGITS = 9;

export function emptyAmount(): AmountEntry {
  return { digits: "" };
}

export function appendDigit(entry: AmountEntry, digit: string): AmountEntry {
  if (!/^[0-9]$/.test(digit)) return entry;
  if (entry.digits.length >= MAX_DIGITS) return entry;
  const next = entry.digits === "0" ? digit : entry.digits + digit;
  // Collapse leading zeros (e.g. "0" + "0" + "5" should settle at "5", not "005").
  const collapsed = next.replace(/^0+(?=\d)/, "");
  return { digits: collapsed };
}

export function deleteDigit(entry: AmountEntry): AmountEntry {
  if (entry.digits.length === 0) return entry;
  return { digits: entry.digits.slice(0, -1) };
}

export function clearAmount(): AmountEntry {
  return emptyAmount();
}

/**
 * Builds an AmountEntry directly from a known cents value — used by the
 * Activity detail sheet (Phase 11) to preload the amount preview when
 * editing an existing transaction, where there's no sequence of keypad
 * taps to replay. `cents` is clamped to the same non-negative, 9-digit
 * range appendDigit enforces, so a pre-existing (already-valid) amount
 * can't somehow produce an AmountEntry invariant-breaking state.
 */
export function amountFromCents(cents: Cents): AmountEntry {
  const nonNegative = Math.max(0, Math.round(cents));
  const digits = String(nonNegative).slice(0, 9);
  return { digits: digits === "0" ? "" : digits };
}

export function isEmptyAmount(entry: AmountEntry): boolean {
  return entry.digits.length === 0 || entryToCents(entry) === 0;
}

/** The accumulated digits ARE the cents value, left-padded conceptually to at least 3 digits (0,00). */
export function entryToCents(entry: AmountEntry): Cents {
  if (entry.digits.length === 0) return 0;
  return Number.parseInt(entry.digits, 10);
}

/** Display string for the live amount, e.g. "12,40" (no currency symbol — the sheet renders its own € glyph). */
export function entryToDisplay(entry: AmountEntry): string {
  const cents = entryToCents(entry);
  const euros = Math.trunc(cents / 100);
  const remainder = cents % 100;
  return `${euros.toLocaleString("de-DE")},${remainder.toString().padStart(2, "0")}`;
}
