import { useEffect, useRef } from "preact/hooks";
import { monthPillLabel } from "@/features/activity/monthNav";

interface MonthPillsProps {
  /** "YYYY-MM", newest first: only months present in the current (filtered) list. */
  monthKeys: readonly string[];
  active: string | null;
  today: string;
  onPick: (monthKey: string) => void;
}

/**
 * Horizontally scrolling month pills under Activity's search row
 * (2026-11-10, docs/mockups/activity-month-pills.html). Highlights the
 * month in view and jumps to a month on tap; ActivityList does both of
 * those, this only renders and keeps the active pill in view.
 */
export function MonthPills({ monthKeys, active, today, onPick }: MonthPillsProps) {
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
      {monthKeys.map((key) => (
        <button
          key={key}
          type="button"
          class="month-pills__pill"
          aria-current={key === active ? "true" : undefined}
          onClick={() => onPick(key)}
        >
          {monthPillLabel(key, today)}
        </button>
      ))}
    </nav>
  );
}
