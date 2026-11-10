import { useEffect, useRef } from "preact/hooks";
import uPlot from "uplot";
import type { Cents } from "@/domain/money";
import { centsToDecimal } from "@/domain/money";

interface SparklineProps {
  /** Values oldest first, drawn at evenly spaced x positions. */
  values: Cents[];
  /** Stroke color, a CSS color or `var(--token)`; caller decides positive/negative/dormant. */
  color: string;
  height?: number;
  /** Set when the chart carries meaning (Home's spend line); omitted = decorative, aria-hidden. */
  label?: string;
}

/**
 * The custom-property name in a `var(--token)` color, or null for a plain
 * color. Canvas strokeStyle does NOT understand var(): it silently ignores
 * the assignment and keeps its default black. That is what every Accounts
 * sparkline drew from Phase 12 until 2026-11-10, measured by reading the
 * canvas pixels: all seven were rgb(0,0,0) on a near-black card, i.e.
 * invisible. So the token must be resolved to a real color first.
 */
export function cssVarName(color: string): string | null {
  const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(color.trim());
  return match ? match[1]! : null;
}

/**
 * A decorative 6-point balance line for the Accounts screen (Phase 12).
 * Pulls uPlot forward from Phase 14 so there's one charting path in the
 * codebase — but this costs real bytes: uPlot is one monolithic class
 * that doesn't tree-shake, so a 6-point sparkline pulls the whole library
 * (axes/cursor/legend/tooltips, none of which this component uses).
 * Measured: +22.3KB gzipped to the production bundle, confirmed with a
 * standalone build before committing to this choice (see
 * docs/renovation_version_1.txt's Phase 12 write-up).
 *
 * uPlot does NOT auto-size to its container — it needs an explicit pixel
 * width at construction and on every resize, verified by reproducing the
 * failure (a 390px chart left static after a 390->320px viewport change
 * overflowed its card). The ResizeObserver below is the fix; every
 * consumer of this component gets it for free rather than re-solving it
 * (Phase 14's net-worth line and ranked bars should use this same
 * pattern, not hand-roll their own sizing).
 */
export function Sparkline({ values: cents, color, height = 24, label }: SparklineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);

  const values = cents.map(centsToDecimal);
  const xs = cents.map((_, i) => i);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const width = Math.max(1, host.clientWidth);
    const varName = cssVarName(color);
    const stroke = varName ? getComputedStyle(host).getPropertyValue(varName).trim() : color;
    const plot = new uPlot(
      {
        width,
        height,
        series: [{}, { stroke, width: 1.5, points: { show: false } }],
        axes: [{ show: false }, { show: false }],
        legend: { show: false },
        cursor: { show: false },
        scales: { x: { time: false } },
        padding: [2, 0, 2, 0],
      },
      [xs, values],
      host,
    );
    plotRef.current = plot;

    const resizeObserver = new ResizeObserver(() => {
      const w = host.clientWidth;
      if (w > 0) plot.setSize({ width: w, height });
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Re-create on data/color change rather than diffing in place — these
    // sparklines are small and change only when the underlying account's
    // transaction list changes, so a full rebuild is cheap and simpler
    // than threading uPlot's setData API through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), color, height]);

  return label ? (
    <div ref={hostRef} class="sparkline" role="img" aria-label={label} style={{ height: `${height}px` }} />
  ) : (
    <div ref={hostRef} class="sparkline" aria-hidden="true" style={{ height: `${height}px` }} />
  );
}
