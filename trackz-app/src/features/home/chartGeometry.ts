/**
 * Pure geometry for Home's 6-month spending chart (SpendChart.tsx is the
 * thin half). SVG y grows downward, so a bigger value is a SMALLER y.
 */

export interface ChartBox {
  width: number;
  height: number;
  /** Room above the tallest point for its value label. */
  padTop: number;
  /** Room below the baseline for the month labels. */
  padBottom: number;
  /** Left/right margin, so the edge points' centred labels stay inside. */
  padX: number;
}

export interface ChartPoint {
  x: number;
  y: number;
}

/** Evenly spaced points scaled 0..max, the max landing exactly on padTop. */
export function chartPoints(values: readonly number[], box: ChartBox): ChartPoint[] {
  const baseline = box.height - box.padBottom;
  const usableHeight = baseline - box.padTop;
  const usableWidth = box.width - box.padX * 2;
  // All-zero months (a new install, or a month with nothing logged yet)
  // would divide by zero; they sit on the baseline instead.
  const max = Math.max(0, ...values);
  const step = values.length > 1 ? usableWidth / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: values.length > 1 ? box.padX + i * step : box.width / 2,
    // Clamped at 0: a month whose refunds outweigh its spend nets negative,
    // and an unclamped point would drop into the month labels.
    y: max > 0 ? baseline - (Math.max(0, v) / max) * usableHeight : baseline,
  }));
}
