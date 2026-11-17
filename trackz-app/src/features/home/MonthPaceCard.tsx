import { Money } from "@/components/Money";
import type { MonthPace } from "@/insights/engine";

interface MonthPaceCardProps {
  pace: MonthPace;
  /** The baseline window, for "based on N months" when a category has fewer. */
  baselineMonths: number;
  /** The total row: opens the full category sheet. */
  onOpenAll?: () => void;
  /** A category row: Activity filtered to it, this month. */
  onSelectCategory?: (category: string) => void;
}

/** "50%" of a usual month; null when there is no usual month to be a share of. */
function share(spent: number, usual: number): number | null {
  return usual > 0 ? Math.round((spent / usual) * 100) : null;
}

/**
 * Home's "This month so far" (user decisions 2026-11-17, replacing the
 * "what changed" InsightFeed). Figures from insights/engine.ts getMonthPace.
 * One bar, on the total only, coloured --negative like the category
 * sheet's: it is spend, and every bar of spend means the same thing.
 */
export function MonthPaceCard({ pace, baselineMonths, onOpenAll, onSelectCategory }: MonthPaceCardProps) {
  const totalShare = share(pace.spentCents, pace.usualCents);
  const Total = onOpenAll ? "button" : "div";
  const Row = onSelectCategory ? "button" : "div";
  return (
    <div class="month-pace">
      <Total class="month-pace__total" type={onOpenAll ? "button" : undefined} onClick={onOpenAll}>
        <div class="month-pace__headline">
          Spent <Money cents={pace.spentCents} /> so far
        </div>
        <div class="month-pace__usual">
          {pace.usualMonths > 0 ? (
            <>
              usually <Money cents={pace.usualCents} /> a month ({pace.usualMonths}{" "}
              {pace.usualMonths === 1 ? "month" : "months"})
            </>
          ) : (
            "no earlier months to compare with yet"
          )}
        </div>
        {totalShare !== null && (
          <div class="month-pace__bar-row">
            <div class="month-pace__track">
              <div class="month-pace__fill" style={{ width: `${Math.min(100, totalShare)}%` }} />
            </div>
            <span class="month-pace__share tnum">{totalShare}%</span>
          </div>
        )}
      </Total>
      {pace.categories.map((c) => {
        const pct = share(c.spentCents, c.usualCents);
        return (
          <Row
            key={c.category}
            class="month-pace__row"
            type={onSelectCategory ? "button" : undefined}
            onClick={onSelectCategory ? () => onSelectCategory(c.category) : undefined}
          >
            <span class="month-pace__row-main">
              <span class="month-pace__name">{c.category}</span>
              {c.months === 0 ? (
                <span class="month-pace__note">new, none in the last {baselineMonths} months</span>
              ) : (
                c.months < baselineMonths && (
                  <span class="month-pace__note">
                    based on {c.months} {c.months === 1 ? "month" : "months"}
                  </span>
                )
              )}
            </span>
            <span class="month-pace__figures tnum">
              <Money cents={c.spentCents} />
              {c.months > 0 && (
                <span class="month-pace__of">
                  {" "}
                  of <Money cents={c.usualCents} />
                </span>
              )}
            </span>
            <span class="month-pace__share tnum">{pct === null ? "" : `${pct}%`}</span>
          </Row>
        );
      })}
    </div>
  );
}
