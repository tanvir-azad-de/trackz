import { useMemo } from "preact/hooks";
import type { MonthGroup } from "@/features/activity/group";
import type { Transaction } from "@/domain/transaction";
import { formatDayLabel, formatMonthLabel, getLocalToday } from "@/domain/dates";
import { Money } from "@/components/Money";
import { TransactionRow } from "./TransactionRow";
import { useIncrementalList } from "./useIncrementalList";

interface ActivityListProps {
  months: MonthGroup[];
  resetKey: string;
  onOpenTransaction: (transaction: Transaction) => void;
}

type ListItem =
  | { kind: "month-header"; monthKey: string; inCents: number; outCents: number }
  | { kind: "day-header"; date: string; netCents: number }
  | { kind: "row"; transaction: Transaction };

/**
 * Flattens MonthGroup[] into a single list of header/row items and
 * renders `visibleCount` of them (see useIncrementalList). The sticky
 * month header is pure CSS (`position: sticky` on `.activity-list__month`)
 * — no scroll-position tracking or IntersectionObserver needed to decide
 * which month is "current", the browser's native sticky behaviour already
 * does that correctly as the user scrolls past a month boundary.
 */
export function ActivityList({ months, resetKey, onOpenTransaction }: ActivityListProps) {
  const today = getLocalToday();

  const items = useMemo(() => {
    const flat: ListItem[] = [];
    for (const month of months) {
      flat.push({ kind: "month-header", monthKey: month.monthKey, inCents: month.inCents, outCents: month.outCents });
      for (const day of month.days) {
        flat.push({ kind: "day-header", date: day.date, netCents: day.netCents });
        for (const tx of day.transactions) {
          flat.push({ kind: "row", transaction: tx });
        }
      }
    }
    return flat;
  }, [months]);

  const { visibleCount, sentinelRef } = useIncrementalList(resetKey);
  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  return (
    <div class="activity-list">
      {visibleItems.map((item) => {
        if (item.kind === "month-header") {
          return (
            <div class="activity-list__month" key={`m-${item.monthKey}`}>
              <span>{formatMonthLabel(item.monthKey)}</span>
              <span class="activity-list__month-totals">
                <span class="activity-list__month-in">+<Money cents={item.inCents} /></span>
                <span class="activity-list__month-out">−<Money cents={item.outCents} /></span>
              </span>
            </div>
          );
        }
        if (item.kind === "day-header") {
          return (
            <div class="activity-list__day" key={`d-${item.date}`}>
              <span>{formatDayLabel(item.date, today)}</span>
              <Money cents={item.netCents} signed class="activity-list__day-net" />
            </div>
          );
        }
        return <TransactionRow key={item.transaction.id} transaction={item.transaction} onOpen={onOpenTransaction} />;
      })}
      {hasMore && <div ref={sentinelRef} class="activity-list__sentinel" aria-hidden="true" />}
    </div>
  );
}
