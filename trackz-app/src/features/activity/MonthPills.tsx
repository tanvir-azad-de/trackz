import { useEffect, useRef } from "preact/hooks";
import { monthPillLabel } from "@/features/activity/monthNav";
import type { Cents } from "@/domain/money";
import { Money } from "@/components/Money";

export interface MonthPillItem {
  /** "YYYY-MM". */
  monthKey: string;
  cents: Cents;
}

interface MonthPillsProps {
  /** Newest first. */
  items: readonly MonthPillItem[];
  active: string | null;
  today: string;
  onPick: (monthKey: string) => void;
  /**
   * "net": a signed net, green when money came in and red when it went
   * out (Activity: the month's net, the sum of its day cards' nets).
   * "expense": a spending total, unsigned and red when non-zero (Home's
   * category sheet: the same figure as the chart point).
   */
  tone: "net" | "expense";
}

function amountClass(cents: Cents, tone: MonthPillsProps["tone"]): string {
  if (cents === 0) return "";
  if (tone === "expense") return "month-pills__amount--negative";
  return cents > 0 ? "month-pills__amount--positive" : "month-pills__amount--negative";
}

/**
 * Horizontally scrolling month pills: under Activity's search row
 * (2026-11-10, docs/mockups/activity-month-pills.html; restyled
 * 2026-11-11 from the user's two-span mockup) and atop Home's category
 * sheet. Highlights `active` and reports taps; the caller owns what a tap
 * means. This only renders and keeps the active pill in view.
 */
export function MonthPills({ items, active, today, onPick, tone }: MonthPillsProps) {
  const stripRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const pill = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !pill) return;
    // strip.scrollTo, NOT pill.scrollIntoView: scrollIntoView also scrolls
    // every scrollable ancestor, so it would yank the page vertically
    // while the user is scrolling it.
    strip.scrollTo({ left: pill.offsetLeft - strip.clientWidth / 2 + pill.offsetWidth / 2, behavior: "smooth" });
  }, [active]);

  return (
    <nav class="month-pills" ref={stripRef} aria-label="Jump to month">
      {items.map(({ monthKey: key, cents }) => (
        <button
          key={key}
          type="button"
          class="month-pills__pill"
          aria-current={key === active ? "true" : undefined}
          onClick={() => onPick(key)}
        >
          <span class="month-pills__month">{monthPillLabel(key, today)}</span>
          <Money cents={cents} signed={tone === "net"} class={`month-pills__amount ${amountClass(cents, tone)}`} />
        </button>
      ))}
    </nav>
  );
}
