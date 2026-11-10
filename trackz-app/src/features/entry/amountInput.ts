import { centsToFixed, type Cents } from "@/domain/money";

/**
 * Typed amount (the entry form's text field) -> integer cents.
 *
 * Accepts "," OR "." as the decimal separator: iOS's decimal keyboard
 * shows "," under a de-DE locale and "." elsewhere, and <input
 * type="number"> silently rejects the comma — which is why the field is
 * type="text" inputMode="decimal" and parsing lives here.
 *
 * Returns null for anything that is not unambiguously an amount: blank,
 * negative, more than 2 decimals, or a thousands separator ("1.234,50"
 * would otherwise read as 1,23 € or 1.234,50 € depending on the guess).
 * Parsed from the digit strings, not via parseFloat, so no float ever
 * touches the value.
 *
 * Capped at 8 integer digits (99.999.999,99 €), the same ceiling the
 * removed keypad had.
 */
export function parseAmountInput(raw: string): Cents | null {
  const match = /^(\d{0,8})(?:[.,](\d{0,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const [, euros, fraction = ""] = match;
  if (euros === "" && fraction === "") return null;
  return Number(euros || "0") * 100 + Number(fraction.padEnd(2, "0"));
}

/** Cents -> the text the amount field starts with. 0 is blank, so a new entry shows the placeholder. */
export function amountInputFromCents(cents: Cents): string {
  return cents === 0 ? "" : centsToFixed(cents).replace(".", ",");
}
