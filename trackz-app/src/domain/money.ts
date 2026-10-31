/**
 * Money is always stored as an integer number of cents.
 *
 * The old app summed raw floats (`+= amount`) across 1,456+ rows, which
 * drifts (see docs/renovation_version_1.txt, "money math" section).
 * Integer cents make every sum exact for amounts well below
 * Number.MAX_SAFE_INTEGER (2^53 - 1 cents ≈ 90 trillion EUR).
 */

export type Cents = number;

/** Parse a decimal string/number (e.g. "12.40", 12.4) into integer cents. */
export function toCents(amount: string | number): Cents {
  const value = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(value)) {
    throw new RangeError(`toCents: not a finite number: ${amount}`);
  }
  // Round at the cent boundary to absorb float noise from parseFloat,
  // e.g. 0.1 + 0.2 artifacts never survive past this line.
  return Math.round(value * 100);
}

/** Integer cents -> decimal number (for calculations that need a float, e.g. charting). */
export function centsToDecimal(cents: Cents): number {
  return cents / 100;
}

/** Integer cents -> a display string with 2 decimals, no currency symbol, no sign. */
export function centsToFixed(cents: Cents): string {
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100);
  const remainder = abs % 100;
  return `${euros}.${remainder.toString().padStart(2, "0")}`;
}

const EUR_FORMATTER = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Integer cents -> localized EUR currency string, e.g. "1.234,56 €". Always EUR (see decisions). */
export function formatEUR(cents: Cents): string {
  if (!Number.isFinite(cents)) return EUR_FORMATTER.format(0);
  // -0 cents must never render as "-0,00 €" (old bug: formatMoney(-0.001) -> "€-0.00").
  const normalized = cents === 0 ? 0 : cents;
  return EUR_FORMATTER.format(normalized / 100);
}

export function addCents(...values: Cents[]): Cents {
  return values.reduce((sum, v) => sum + v, 0);
}

export function isZeroCents(cents: Cents): boolean {
  return cents === 0;
}
