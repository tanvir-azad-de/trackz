import { useMemo, useRef, useState, type Dispatch, type StateUpdater } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { FunnelX, ListCollapse, SlidersHorizontal, X } from "@/components/icons";
import { loadDaysOnly, saveDaysOnly } from "@/storage/activityView";
import { deriveAccounts, deriveCategories } from "@/storage/derive";
import { getLocalToday } from "@/domain/dates";
import { pickerAccounts, pickerCategories, pickerMerchants } from "@/features/entry/pickerOptions";
import { deleteTransaction, getTransactions, updateTransaction, undeleteTransaction } from "@/storage/repository";
import { recordHistory } from "@/storage/history";
import { debtBalanceProblem } from "@/features/entry/debtBalance";
import {
  emptyFilter,
  filterTransactions,
  isFilterActive,
  type ActivityFilter,
} from "@/features/activity/filter";
import { collapsedDays, groupByMonthAndDay } from "@/features/activity/group";
import { ActivityList, type MonthJump } from "./ActivityList";
import { MonthPills } from "./MonthPills";
import { FilterSheet } from "./FilterSheet";
import { TransactionDetailSheet } from "./TransactionDetailSheet";
import type { Transaction } from "@/domain/transaction";
import { updatedToast } from "@/features/activity/updatedToast";
import { deletedToast } from "@/features/activity/deletedToast";
import type { ToastState } from "@/components/Toast";
import "@/components/Sheet.css";
import "@/features/entry/EntryScreen.css";
import "./TransactionRow.css";
import "./ActivityList.css";
import "./MonthPills.css";
import "./FilterSheet.css";
import "./TransactionDetailSheet.css";
import "./ActivityScreen.css";

interface ActivityScreenProps {
  /**
   * Owned by App, not by this screen. Tabs unmount on switch, so local
   * state seeded from a deep link re-seeded on every return: clearing a
   * Debts drill-down's name, leaving and coming back brought the name
   * back (bug 2026-11-11). Writing every edit up to App makes the filter
   * the user last saw the one they return to.
   */
  filter: ActivityFilter;
  setFilter: Dispatch<StateUpdater<ActivityFilter>>;
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
export function ActivityScreen({ filter, setFilter, onToast }: ActivityScreenProps) {
  const transactions = useTransactions();
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [openTransaction, setOpenTransaction] = useState<Transaction | null>(null);

  const accounts = useMemo(() => deriveAccounts(transactions), [transactions]);
  const categories = useMemo(() => deriveCategories(transactions), [transactions]);
  // The edit form's pickers: alphabetical like FilterSheet's lists above,
  // but trimmed and blank-free (features/entry/pickerOptions.ts).
  const today = getLocalToday();
  const pickerAccountList = useMemo(() => pickerAccounts(transactions), [transactions]);
  const pickerCategoryList = useMemo(() => pickerCategories(transactions), [transactions]);
  const pickerMerchantList = useMemo(() => pickerMerchants(transactions), [transactions]);

  const filtered = useMemo(() => filterTransactions(transactions, filter), [transactions, filter]);
  const months = useMemo(() => groupByMonthAndDay(filtered), [filtered]);
  const [daysOnly, setDaysOnly] = useState(loadDaysOnly);
  const shownDays = useMemo(() => (daysOnly ? collapsedDays(months) : null), [daysOnly, months]);
  // MonthGroup.netCents is the sum of the month's day-card nets (group.ts
  // builds both from the same rows), so a pill follows the active filter
  // exactly like the cards below it. Days-only drops transfer-only days,
  // so a month of nothing but transfers loses its pill too: it would jump
  // to a card that isn't there. Its net is 0 either way.
  const pillItems = useMemo(() => {
    const visible = shownDays ? new Set(shownDays.map((d) => d.monthKey)) : null;
    return months.filter((m) => !visible || visible.has(m.monthKey)).map((m) => ({ monthKey: m.monthKey, cents: m.netCents }));
  }, [months, shownDays]);

  function handleToggleDaysOnly() {
    const next = !daysOnly;
    setDaysOnly(next);
    saveDaysOnly(next);
  }

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
    recordHistory("updated", updated);
    setOpenTransaction(null);
    onToast(updatedToast(updated, Date.now()));
  }

  function handleDelete(target: Transaction) {
    deleteTransaction(target.id);
    setOpenTransaction(null);
    // Phase 15a: the row never left storage, it was only tombstoned
    // (see repository.deleteTransaction). Undo clears the tombstone
    // in place — re-inserting the object via addTransaction() would
    // create a SECOND row sharing the same id, which sync's per-id
    // merge (sync/merge.ts) is not designed to handle.
    onToast(
      deletedToast(target, Date.now(), () => {
        // A repayment's Undo can arrive after its loan was deleted, which
        // the balance rule allows once the repayment is gone. Read fresh
        // rows: `transactions` is this render's, from before the delete.
        const problem = debtBalanceProblem(getTransactions(), null, target);
        if (problem) return onToast({ id: Date.now(), message: problem });
        undeleteTransaction(target.id);
      }),
    );
  }

  const noTransactionsAtAll = transactions.length === 0;
  const filterIsActive = isFilterActive(filter);

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
          <button
            type="button"
            class={`activity-screen__filter-button${daysOnly ? " activity-screen__filter-button--on" : ""}`}
            onClick={handleToggleDaysOnly}
            aria-label="Show days only"
            aria-pressed={daysOnly}
          >
            <ListCollapse size="1em" />
          </button>
          {/* Resets everything, search text included (user request
              2026-11-17, reversing 2026-11-11's keep-the-search). */}
          {filterIsActive && (
            <button
              type="button"
              class="activity-screen__filter-button"
              onClick={() => setFilter(emptyFilter())}
              aria-label="Reset filters"
            >
              <FunnelX size="1em" />
            </button>
          )}
        </div>

        {pillItems.length > 0 && (
          <MonthPills items={pillItems} tone="net" active={activeMonth} today={today} onPick={handlePickMonth} />
        )}
      </div>

      {noTransactionsAtAll ? (
        <p class="activity-screen__empty">No transactions yet. Tap the + button to log your first one.</p>
      ) : shownDays?.length === 0 && months.length > 0 ? (
        <p class="activity-screen__empty">Only transfers match, and days only hides transfer days.</p>
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
          collapsed={shownDays}
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
        accounts={pickerAccountList}
        categories={pickerCategoryList}
        merchants={pickerMerchantList}
        onClose={() => setOpenTransaction(null)}
        onSave={handleSaveEdit}
        onDelete={handleDelete}
        transactions={transactions}
        onRejected={(message) => onToast({ id: Date.now(), message })}
      />
    </main>
  );
}
