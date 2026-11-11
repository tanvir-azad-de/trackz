import { Card } from "@/components/Card";
import type { Cents } from "@/domain/money";
import { formatCompactEUR, formatEUR } from "@/domain/money";
import { shortMonthName } from "@/domain/dates";
import { chartPoints, type ChartBox } from "./chartGeometry";

interface SpendChartProps {
  /** getMonthlyExpenseSeries capped at today: six months, oldest first. */
  series: Array<{ monthKey: string; expenseCents: Cents }>;
  /** Opens the category sheet; the whole card is the tap target. */
  onOpen: () => void;
}

// viewBox units are close to CSS px at 390px wide (the card's content box
// is ~318px), so the font sizes below read as real px on a phone.
const BOX: ChartBox = { width: 320, height: 140, padTop: 24, padBottom: 28, padX: 24 };

/**
 * Home's one chart (user decision 2026-11-11, from their reference HTML):
 * total expense for each of the last six months, this month so far being
 * the last point, with the amount above each point and the month below.
 * Plain inline SVG rather than the old Sparkline: uPlot drew to a canvas with no
 * text labels, and the labels are the point of this chart.
 */
export function SpendChart({ series, onOpen }: SpendChartProps) {
  const points = chartPoints(series.map((s) => s.expenseCents), BOX);
  const label = `Spending by month: ${series.map((s) => `${shortMonthName(s.monthKey)} ${formatEUR(s.expenseCents)}`).join(", ")}`;
  return (
    <Card class="spend-chart" onClick={onOpen}>
      <svg class="spend-chart__svg" viewBox={`0 0 ${BOX.width} ${BOX.height}`} role="img" aria-label={label}>
        <polyline class="spend-chart__line" points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
        {points.map((p, i) => (
          <g key={series[i]!.monthKey}>
            <text class="spend-chart__value tnum" x={p.x} y={p.y - 10}>
              {formatCompactEUR(series[i]!.expenseCents)}
            </text>
            <circle class="spend-chart__point" cx={p.x} cy={p.y} r={3.5} />
            <text class="spend-chart__month" x={p.x} y={BOX.height - 6}>
              {shortMonthName(series[i]!.monthKey)}
            </text>
          </g>
        ))}
      </svg>
    </Card>
  );
}
