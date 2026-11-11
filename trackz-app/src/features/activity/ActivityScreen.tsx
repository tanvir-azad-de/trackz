import { useMemo, useRef, useState } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { FunnelX, SlidersHorizontal, X } from "@/components/icons";
import { deriveAccounts, deriveCategories } from "@/storage/derive";
import { getLocalToday } from "@/domain/dates";
import { rankAccounts, rankCategories, rankMerchants } from "@/features/entry/rank";
import { deleteTransaction, updateTransaction, undeleteTransaction } from "@/storage/repository";
import {
  activeFacetCount,
  clearFacets,
  emptyFilter,
  filterTransactions,
  isFilterActive,
  type ActivityFilter,
} from "@/features/activity/filter";
import { groupByMonthAndDay } from "@/features/activity/group";
import { ActivityList, type MonthJump } from "./ActivityList";
import { MonthPills } from "./MonthPills";
import { FilterSheet } from "./FilterSheet";
import { TransactionDetailSheet } from "./TransactionDetailSheet";
import { categoryOrTypeLabel, type Transaction } from "@/domain/transaction";
import { updatedToast } from "@/features/activity/updatedToast";
import type { ToastState } from "@/components/Toast";
import "@/components/Sheet.css";
import "@/features/entry/EntryForm.css";
import "./TransactionRow.css";
import "./ActivityList.css";
import "./MonthPills.css";
import "./FilterSheet.css";
import "./TransactionDetailSheet.css";
import "./ActivityScreen.css";

interface ActivityScreenProps {
  initialFilter: ActivityFilter | null;
  onToast: (toast: ToastState) => void;
}

/**
 * Phase 11's Activity screen: instant search, a filter sheet (account /
 * category / category type / date range), sticky month pills, a list of
 * day cards with incremental rendering (see useIncrementalList.ts for
 * why this isn't true windowing), and a tap-through detail sheet for
 * edit/delete. No swipe gestures — see TransactionRow.tsx's comment and
 * the Phase 11 status note in docs/renovation_version_1.txt.
 */
export function ActivityScreen({ initialFilter, onToast }: ActivityScreenProps) {
  const transactions = useTransactions();
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter ?? emptyFilter());
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [openTransaction, setOpenTransaction] = useState<Transaction | null>(null);

  const accounts = useMemo(() => deriveAccounts(transactions), [transactions]);
  const categories = useMemo(() => deriveCategories(transactions), [transactions]);
  // The edit form's pickers want most-used-first; FilterSheet keeps the
  // alphabetical lists above, where scanning for a known name is the task.
  const today = getLocalToday();
  const rankedAccounts = useMemo(() => rankAccounts(transactions, today), [transactions, today]);
  const rankedCategories = useMemo(() => rankCategories(transactions, today), [transactions, today]);
  const rankedMerchants = useMemo(() => rankMerchants(transactions, today), [transactions, today]);

  const filtered = useMemo(() => filterTransactions(transactions, filter), [transactions, filter]);
  const months = useMemo(() => groupByMonthAndDay(filtered), [filtered]);
  // MonthGroup.netCents is the sum of the month's day-card nets (group.ts
  // builds both from the same rows), so a pill follows the active filter
  // exactly like the cards below it.
  const pillItems = useMemo(() => months.map((m) => ({ monthKey: m.monthKey, cents: m.netCents })), [months]);

  const headerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const [jump, setJump] = useState<MonthJump | null>(null);

  function handlePickMonth(monthKey: string) {
    // Highlight now rather than waiting for the scroll to arrive. The
    // scroll tracker takes over from here and agrees once it lands.
    setActiveMonth(monthKey);
    setJump({ monthKey, nonce: Date.now() });
  }

  // Changes whenever any facet (not the free-text query) changes, so
  // useIncrementalList resets its page size — a new filter result set
  // should start at the top, not stay scrolled 600 rows deep. Query
  // changes are intentionally included too: typing a new search is the
  // same "fresh result set" situation.
  const resetKey = JSON.stringify(filter);

  function handleSaveEdit(updated: Transaction) {
    updateTransaction(updated);
    setOpenTransaction(null);
    onToast(updatedToast(updated, Date.now()));
  }

  function handleDelete(target: Transaction) {
    deleteTransaction(target.id);
    setOpenTransaction(null);
    onToast({
      id: Date.now(),
      message: `Deleted ${categoryOrTypeLabel(target)}`,
      actionLabel: "Undo",
      // Phase 15a: the row never left storage, it was only tombstoned
      // (see repository.deleteTransaction). Undo clears the tombstone
      // in place — re-inserting the object via addTransaction() would
      // create a SECOND row sharing the same id, which sync's per-id
      // merge (sync/merge.ts) is not designed to handle.
      onAction: () => undeleteTransaction(target.id),
    });
  }

  const noTransactionsAtAll = transactions.length === 0;
  const filterIsActive = isFilterActive(filter);
  const hasFacets = activeFacetCount(filter) > 0;

  function handleClearSearch() {
    setFilter((f) => ({ ...f, query: "" }));
    // Tapping the button blurs the input; give focus back so the next
    // search can be typed straight away.
    searchRef.current?.focus();
  }

  return (
    <main class="activity-screen">

      <div class="activity-screen__sticky-header" ref={headerRef}>
        <div class="activity-screen__controls">
          <div class="activity-screen__search-wrap">
            <input
              ref={searchRef}
              type="search"
              class="activity-screen__search"
              placeholder="Search merchant, category, notes…"
              value={filter.query}
              onInput={(e) => setFilter((f) => ({ ...f, query: e.currentTarget.value }))}
            />
            {filter.query !== "" && (
              <button
                type="button"
                class="activity-screen__search-clear"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                <X size="1em" />
              </button>
            )}
          </div>
          <button
            type="button"
            class="activity-screen__filter-button"
            onClick={() => setFilterSheetOpen(true)}
            aria-label="Filter"
          >
            <SlidersHorizontal size="1em" />
            {filterIsActive && <span class="activity-screen__filter-badge" />}
          </button>
          {hasFacets && (
            <button
              type="button"
              class="activity-screen__filter-button"
              onClick={() => setFilter(clearFacets)}
              aria-label="Reset filters"
            >
              <FunnelX size="1em" />
            </button>
          )}
        </div>

        {months.length > 0 && (
          <MonthPills items={pillItems} tone="net" active={activeMonth} today={today} onPick={handlePickMonth} />
        )}
      </div>

      {noTransactionsAtAll ? (
        <p class="activity-screen__empty">No transactions yet. Tap the + button to log your first one.</p>
      ) : months.length === 0 ? (
        <div class="activity-screen__empty">
          <p>No transactions match these filters.</p>
          <button type="button" class="activity-screen__reset-link" onClick={() => setFilter(emptyFilter())}>
            Reset filters
          </button>
        </div>
      ) : (
        <ActivityList
          months={months}
          resetKey={resetKey}
          onOpenTransaction={setOpenTransaction}
          headerRef={headerRef}
          jump={jump}
          onActiveMonthChange={setActiveMonth}
        />
      )}

      <FilterSheet
        open={filterSheetOpen}
        filter={filter}
        accounts={accounts}
        categories={categories}
        onApply={setFilter}
        onClose={() => setFilterSheetOpen(false)}
      />

      <TransactionDetailSheet
        transaction={openTransaction}
        accounts={rankedAccounts}
        categories={rankedCategories}
        merchants={rankedMerchants}
        onClose={() => setOpenTransaction(null)}
        onSave={handleSaveEdit}
        onDelete={handleDelete}
      />
    </main>
  );
}
