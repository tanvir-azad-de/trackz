import type { CategoryDelta } from "@/insights/engine";
import { Money } from "@/components/Money";
import { ArrowDown, ArrowUp } from "@/components/icons";

interface InsightFeedProps {
  deltas: CategoryDelta[];
  /** When provided, each row becomes tappable and drills into Activity filtered to that category+month (Phase 11). */
  onSelectCategory?: (category: string) => void;
}

function describeDelta(d: CategoryDelta): { tone: "up" | "down"; title: string } {
  if (d.isNew) return { tone: "up", title: `New: ${d.category}` };
  const tone = d.deltaCents >= 0 ? "up" : "down";
  // No percentage when usual-by-today is 0 but the category isn't new
  // (e.g. a bill paid earlier in the month than usual): "+∞%" says nothing.
  const pct = d.deltaPercent === null ? "" : ` ${Math.round(Math.abs(d.deltaPercent))}%`;
  return { tone, title: `${d.category} is ${tone}${pct}` };
}

export function InsightFeed({ deltas, onSelectCategory }: InsightFeedProps) {
  if (deltas.length === 0) {
    return <p class="insight-feed__empty">Nothing is more than 10 € off its usual so far this month.</p>;
  }
  return (
    <div class="insight-feed">
      {deltas.map((d) => {
        const { tone, title } = describeDelta(d);
        const Tag = onSelectCategory ? "button" : "div";
        return (
          <Tag
            class="insight"
            key={d.category}
            type={onSelectCategory ? "button" : undefined}
            onClick={onSelectCategory ? () => onSelectCategory(d.category) : undefined}
          >
            <div class={`insight__icon insight__icon--${tone}`}>
              {tone === "up" ? <ArrowUp size="1em" /> : <ArrowDown size="1em" />}
            </div>
            <div class="insight__body">
              <div class="insight__title">{title}</div>
              <div class="insight__detail">
                {d.isNew ? (
                  <>
                    <Money cents={d.thisMonthCents} /> so far, none in the last 6 months
                  </>
                ) : (
                  <>
                    <Money cents={d.thisMonthCents} /> so far vs <Money cents={d.baselineAvgCents} /> usual by now
                  </>
                )}
              </div>
            </div>
            <div class={`insight__amount insight__amount--${tone === "up" ? "neg" : "pos"}`}>
              {tone === "up" ? "+" : "−"}
              <Money cents={Math.abs(d.deltaCents)} />
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
