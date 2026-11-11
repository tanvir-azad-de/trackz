import type { Cents } from "@/domain/money";
import type { BalanceSheet } from "@/insights/engine";

export type NetWorthSegmentKey = "liquid" | "other" | "liabilities";

export interface NetWorthSegment {
  key: NetWorthSegmentKey;
  /** The bucket's total; becomes the segment's flex-grow, so widths are proportional. */
  weightCents: Cents;
}

/**
 * The Net worth card's composition bar: Liquid, Other, Owed side by side,
 * each as wide as its bucket's share of the three together.
 *
 * Negative totals are DROPPED, not clamped to a sliver: a negative Liquid
 * (overdrawn cash) or a negative Liabilities (an overpaid card) has no
 * width to show, and flex-grow treats a negative value as invalid anyway.
 * Zero totals are dropped too, so an empty bucket leaves no 2px gap. The
 * legend still lists every bucket with its real, signed total.
 */
export function netWorthSegments(sheet: BalanceSheet): NetWorthSegment[] {
  const all: NetWorthSegment[] = [
    { key: "liquid", weightCents: sheet.liquid.totalCents },
    { key: "other", weightCents: sheet.other.totalCents },
    { key: "liabilities", weightCents: sheet.liabilities.totalCents },
  ];
  return all.filter((s) => s.weightCents > 0);
}
