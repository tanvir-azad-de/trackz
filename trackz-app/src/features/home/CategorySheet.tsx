import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Sheet } from "@/components/Sheet";
import { Money } from "@/components/Money";
import type { Cents } from "@/domain/money";
import { shortMonthName, toMonthKey } from "@/domain/dates";
import type { Transaction } from "@/domain/transaction";
import { getTopCategoriesForMonth } from "@/insights/engine";
import { MonthPills } from "@/features/activity/MonthPills";
import { categoryShares, formatPercent } from "./categoryShares";

interface CategorySheetProps {
  open: boolean;
  onClose: () => void;
  transactions: Transaction[];
  /** The chart's series (getMonthlyExpenseSeries capped at today), oldest first. */
  series: Array<{ monthKey: string; expenseCents: Cents }>;
  today: string;
}

/**
 * Opened by tapping Home's 6-month chart (user decisions 2026-11-11): one
 * pinned OK that only closes it, month pills showing each month's EXPENSE total (the chart point's
 * figure, so the bars below add up to it), and every category of the
 * picked month ranked with its share. One bar colour, --negative, because
 * colour carries meaning here and every bar means the same thing. Always
 * opens on the current month.
 */
export function CategorySheet({ open, onClose, transactions, series, today }: CategorySheetProps) {
  const currentMonth = toMonthKey(today);
  const [selected, setSelected] = useState(currentMonth);

  // Re-opening starts on this month again rather than where it was left.
  // Reset on CLOSE, not on open: an effect runs after the first paint, so
  // resetting on open drew the old month for a frame (measured: the
  // reopened sheet still read Aug when first queried).
  useEffect(() => {
    if (!open) setSelected(currentMonth);
  }, [open, currentMonth]);

  // A new month is a new list: start it at the top, not at the scroll
  // position the previous month's (longer) list was left at.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [selected]);

  const items = useMemo(() => [...series].reverse().map((s) => ({ monthKey: s.monthKey, cents: s.expenseCents })), [series]);
  const totalCents = series.find((s) => s.monthKey === selected)?.expenseCents ?? 0;
  const shares = useMemo(
    () => (open ? categoryShares(getTopCategoriesForMonth(transactions, selected, Infinity, today), totalCents) : []),
    [open, transactions, selected, today, totalCents],
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Spending by category"
      class="category-sheet"
      footer={
        // The same primary button as the Add/Edit sheets, in Sheet's
        // footer slot, which pins it below the scrolling list.
        <button type="button" class="entry-form__save" onClick={onClose}>
          OK
        </button>
      }
    >
      <div class="category-sheet__pills">
        <MonthPills items={items} tone="expense" active={selected} today={today} onPick={setSelected} />
      </div>
      {/* The only vertical scroller: the pills above stay put while the
          list moves (user request 2026-11-11). */}
      <div class="category-sheet__scroll" ref={scrollRef}>
        {shares.length === 0 ? (
          <p class="category-sheet__empty">No spending logged in {shortMonthName(selected)}.</p>
        ) : (
          <ul class="category-sheet__list">
            {shares.map((s) => (
              <li key={s.category} class="category-sheet__item">
                <div class="category-sheet__head">
                  <span class="category-sheet__name">{s.category}</span>
                  <span class="category-sheet__stats">
                    <Money cents={s.amountCents} class="category-sheet__total" />
                    {s.percent !== null && <span class="category-sheet__percent tnum">{formatPercent(s.percent)}</span>}
                  </span>
                </div>
                <div class="category-sheet__track">
                  <div class="category-sheet__fill" style={{ width: `${s.barPercent}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
