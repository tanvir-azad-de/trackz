import { Card } from "@/components/Card";
import { Sparkline } from "@/components/Sparkline";
import type { Cents } from "@/domain/money";
import { formatEUR } from "@/domain/money";
import { formatShortDay } from "@/domain/dates";
import "@/components/Sparkline.css";

interface SpendChartProps {
  /** getCumulativeExpenseSeries: index 0 is 0, the last index is today. */
  series: Cents[];
  today: string;
}

/**
 * Home's one chart (Phase 14, user decisions 2026-11-10): this month's
 * spending as a running-total line, between the account strip and the
 * insight feed. Deliberately plain: no axes, no tooltip, just the first
 * and last day under the line. The total itself is the hero's Spent tile.
 */
export function SpendChart({ series, today }: SpendChartProps) {
  const total = series[series.length - 1] ?? 0;
  return (
    <Card class="spend-chart">
      <Sparkline
        values={series}
        color="var(--negative)"
        height={96}
        label={`Spending so far this month: ${formatEUR(total)}`}
      />
      <div class="spend-chart__axis">
        <span>{formatShortDay(`${today.slice(0, 7)}-01`)}</span>
        <span>{formatShortDay(today)}</span>
      </div>
    </Card>
  );
}
