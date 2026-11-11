import type { Cents } from "@/domain/money";

export interface CategoryShare {
  category: string;
  amountCents: Cents;
  /** Share of the month's expense total, 0..100 with one decimal; null when the total is not positive. */
  percent: number | null;
  /** Bar width in %, clamped to 0..100. */
  barPercent: number;
}

/**
 * Pure half of Home's category sheet. `totalCents` is passed in rather
 * than summed here, so the shares are of the SAME figure the pill and the
 * chart point show (summarizeMonth). Summing only the positive rows here
 * would drift from that figure in a month where a refund-heavy category
 * nets negative.
 */
export function categoryShares(rows: readonly { category: string; amountCents: Cents }[], totalCents: Cents): CategoryShare[] {
  return rows.map(({ category, amountCents }) => {
    const percent = totalCents > 0 ? Math.round((amountCents / totalCents) * 1000) / 10 : null;
    return { category, amountCents, percent, barPercent: Math.min(100, Math.max(0, percent ?? 0)) };
  });
}

/** "38,2%", de-style comma to match the amounts beside it. */
export function formatPercent(percent: number): string {
  return `${percent.toFixed(1).replace(".", ",")}%`;
}
