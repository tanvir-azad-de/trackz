import type { CategoryDelta } from "@/insights/engine";
import { Money } from "@/components/Money";

interface InsightFeedProps {
  deltas: CategoryDelta[];
}

function describeDelta(d: CategoryDelta): { icon: string; tone: "up" | "down"; title: string } {
  const pct = Math.round(Math.abs(d.deltaPercent ?? 0));
  if (d.deltaCents >= 0) {
    return { icon: "↑", tone: "up", title: `${d.category} is up ${pct}%` };
  }
  return { icon: "↓", tone: "down", title: `${d.category} is down ${pct}%` };
}

export function InsightFeed({ deltas }: InsightFeedProps) {
  if (deltas.length === 0) {
    return <p class="insight-feed__empty">Not enough history yet to compare this month.</p>;
  }
  return (
    <div class="insight-feed">
      {deltas.map((d) => {
        const { icon, tone, title } = describeDelta(d);
        return (
          <div class="insight" key={d.category}>
            <div class={`insight__icon insight__icon--${tone}`}>{icon}</div>
            <div class="insight__body">
              <div class="insight__title">{title}</div>
              <div class="insight__detail">
                <Money cents={d.thisMonthCents} /> this month vs <Money cents={d.baselineAvgCents} /> usual
              </div>
            </div>
            <div class={`insight__amount insight__amount--${tone === "up" ? "neg" : "pos"}`}>
              {tone === "up" ? "+" : "−"}
              <Money cents={Math.abs(d.deltaCents)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
