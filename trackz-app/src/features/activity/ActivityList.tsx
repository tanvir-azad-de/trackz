import { useEffect, useMemo, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { takeVisibleDays, type DayGroup, type MonthGroup } from "@/features/activity/group";
import { activeMonthAt, rowsBeforeMonth } from "@/features/activity/monthNav";
import type { Transaction } from "@/domain/transaction";
import { formatDayHeading, getLocalToday } from "@/domain/dates";
import { Money } from "@/components/Money";
import { ChevronDown, ChevronRight } from "@/components/icons";
import { TransactionRow } from "./TransactionRow";
import { PAGE_SIZE, useIncrementalList } from "./useIncrementalList";

export interface MonthJump {
  monthKey: string;
  /** Changes on every tap, so tapping the same month twice jumps twice. */
  nonce: number;
}

interface ActivityListProps {
  months: MonthGroup[];
  /**
   * Days-only view (2026-11-19) when non-null: the rows to show, from
   * group.ts collapsedDays. null is the normal card-per-day list.
   */
  collapsed: DayGroup[] | null;
  resetKey: string;
  onOpenTransaction: (transaction: Transaction) => void;
  /** The sticky search + month pill block. Day cards scroll under it. */
  headerRef: RefObject<HTMLElement | null>;
  jump: MonthJump | null;
  onActiveMonthChange: (monthKey: string | null) => void;
}

/** Space between the sticky header and a jumped-to day title. */
const JUMP_GAP_PX = 8;

/**
 * One card per day, titled "Today" / "Yesterday" / "7. November" with the
 * day's net (2026-11-10 redesign, approved as docs/mockups/
 * activity-list-v2.html). There is no month header; the month pills in
 * ActivityScreen's sticky block stand in for it.
 *
 * Renders the first `visibleCount` ROWS (see useIncrementalList and
 * takeVisibleDays). A day cut at the page edge shows a short card that
 * fills in as the next page loads.
 */
export function ActivityList({ months, collapsed, resetKey, onOpenTransaction, headerRef, jump, onActiveMonthChange }: ActivityListProps) {
  const today = getLocalToday();
  const { visibleCount, sentinelRef, ensureAtLeast } = useIncrementalList(resetKey);
  const { days, hasMore } = useMemo(() => takeVisibleDays(months, visibleCount), [months, visibleCount]);
  // Days are open by date. Cleared on any search/filter change (user
  // decision), and implicitly on toggling, which unmounts the list.
  const [openDays, setOpenDays] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setOpenDays(new Set()), [resetKey]);

  function toggleDay(date: string) {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }
  const [pendingJump, setPendingJump] = useState<string | null>(null);

  // Step 1 of a jump: render far enough to include the month, plus a page
  // so the screen below it is filled. Scrolling waits for that render.
  useEffect(() => {
    if (!jump) return;
    const before = rowsBeforeMonth(months, jump.monthKey);
    if (before < 0) return;
    ensureAtLeast(before + PAGE_SIZE);
    setPendingJump(jump.monthKey);
  }, [jump]);

  // Step 2: the month's first card is in the DOM, scroll it under the header.
  useEffect(() => {
    if (!pendingJump) return;
    const el = document.querySelector<HTMLElement>(`[data-month-start="${pendingJump}"]`);
    const header = headerRef.current;
    if (!el || !header) return; // not rendered yet: this effect reruns when `days` grows
    setPendingJump(null);
    // The header is sticky at `top: var(--safe-top)`, so once stuck its
    // bottom is that offset plus its height. Its live rect is wrong here:
    // at scrollY 0 it still sits lower, below the screen title.
    const stuckBottom = parseFloat(getComputedStyle(header).top) + header.offsetHeight;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - stuckBottom - JUMP_GAP_PX,
      behavior: smooth ? "smooth" : "auto",
    });
  }, [pendingJump, days, collapsed]);

  // Active month follows the scroll. rAF-throttled, reads only the ~1 card
  // per month that starts a month, not every row.
  useEffect(() => {
    let frame = 0;
    function update() {
      frame = 0;
      const header = headerRef.current;
      if (!header) return;
      const line = header.getBoundingClientRect().bottom + JUMP_GAP_PX;
      const starts = [...document.querySelectorAll<HTMLElement>("[data-month-start]")].map((el) => ({
        monthKey: el.dataset.monthStart!,
        top: el.getBoundingClientRect().top,
      }));
      onActiveMonthChange(activeMonthAt(starts, line));
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [days, collapsed, openDays, onActiveMonthChange]);

  if (collapsed) {
    // Every day row at once, no incremental paging: one short row per
    // day is a few hundred buttons at most, and a pill jump then never
    // has to grow the list first. Expanded days add their rows on top.
    return (
      <div class="activity-list">
        <div class="activity-day__card activity-collapsed">
          {collapsed.map((day, i) => {
            const open = openDays.has(day.date);
            return (
              <div
                class="activity-collapsed__day"
                key={day.date}
                data-month-start={i === 0 || collapsed[i - 1]!.monthKey !== day.monthKey ? day.monthKey : undefined}
              >
                <button
                  type="button"
                  class="activity-collapsed__head"
                  aria-expanded={open}
                  onClick={() => toggleDay(day.date)}
                >
                  <span class="activity-collapsed__chevron">
                    {open ? <ChevronDown size="1em" /> : <ChevronRight size="1em" />}
                  </span>
                  <span class="activity-collapsed__title">{formatDayHeading(day.date, today)}</span>
                  <Money cents={day.netCents} signed class="activity-day__net" />
                </button>
                {open && (
                  <div class="activity-collapsed__rows">
                    {day.transactions.map((tx) => (
                      <TransactionRow key={tx.id} transaction={tx} onOpen={onOpenTransaction} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Day rows are short, so the oldest month can be under a screen
            tall: its pill jump hit the page bottom with the month's first
            row still below the header line, and the month above stayed
            highlighted (Playwright, 2026-11-19). This space lets every
            month's start scroll up to the line (user choice over
            highlighting the last month at the bottom, which mislabels a
            jump to the second-to-last month when both fit on screen). */}
        <div class="activity-collapsed__end-space" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div class="activity-list">
      {days.map((day, i) => (
        <section
          class="activity-day"
          key={day.date}
          aria-label={formatDayHeading(day.date, today)}
          data-month-start={i === 0 || days[i - 1]!.monthKey !== day.monthKey ? day.monthKey : undefined}
        >
          <div class="activity-day__head">
            <h3 class="activity-day__title">{formatDayHeading(day.date, today)}</h3>
            <Money cents={day.netCents} signed class="activity-day__net" />
          </div>
          <div class="activity-day__card">
            {day.transactions.map((tx) => (
              <TransactionRow key={tx.id} transaction={tx} onOpen={onOpenTransaction} />
            ))}
          </div>
        </section>
      ))}
      {hasMore && <div ref={sentinelRef} class="activity-list__sentinel" aria-hidden="true" />}
    </div>
  );
}
