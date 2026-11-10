import { useMemo, useState } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { deriveAccounts, deriveCategories } from "@/storage/derive";
import { getLocalToday } from "@/domain/dates";
import { rankAccounts, rankCategories, rankMerchants } from "@/features/entry/rank";
import { deleteTransaction, updateTransaction, undeleteTransaction } from "@/storage/repository";
import {
  emptyFilter,
  filterTransactions,
  isFilterActive,
  summarizeFiltered,
  type ActivityFilter,
} from "@/features/activity/filter";
import { groupByMonthAndDay } from "@/features/activity/group";
import { ActivityList } from "./ActivityList";
import { FilterSheet } from "./FilterSheet";
import { TransactionDetailSheet } from "./TransactionDetailSheet";
import type { Transaction } from "@/domain/transaction";
import { Money } from "@/components/Money";
import type { ToastState } from "@/components/Toast";
import "@/components/Sheet.css";
import "@/features/entry/EntryForm.css";
import "./TransactionRow.css";
import "./ActivityList.css";
import "./FilterSheet.css";
import "./TransactionDetailSheet.css";
import "./ActivityScreen.css";

interface ActivityScreenProps {
  initialFilter: ActivityFilter | null;
  onToast: (toast: ToastState) => void;
}

/**
 * Phase 11's Activity screen: instant search, a filter sheet (account /
 * category / category type / date range), a day-grouped, sticky-month-
 * headered list with incremental rendering (see useIncrementalList.ts for
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
  const summary = useMemo(() => summarizeFiltered(filtered), [filtered]);

  // Changes whenever any facet (not the free-text query) changes, so
  // useIncrementalList resets its page size — a new filter result set
  // should start at the top, not stay scrolled 600 rows deep. Query
  // changes are intentionally included too: typing a new search is the
  // same "fresh result set" situation.
  const resetKey = JSON.stringify(filter);

  function handleSaveEdit(updated: Transaction) {
    const before = openTransaction;
    updateTransaction(updated);
    setOpenTransaction(null);
    onToast({
      id: Date.now(),
      message: `Updated ${updated.category}`,
      actionLabel: before ? "Undo" : undefined,
      onAction: before ? () => updateTransaction(before) : undefined,
    });
  }

  function handleDelete(target: Transaction) {
    deleteTransaction(target.id);
    setOpenTransaction(null);
    onToast({
      id: Date.now(),
      message: `Deleted ${target.category}`,
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

  return (
    <main class="activity-screen">
      <h1 class="activity-screen__title">Activity</h1>

      <div class="activity-screen__sticky-header">
        <div class="activity-screen__controls">
          <input
            type="search"
            class="activity-screen__search"
            placeholder="Search merchant, category, notes…"
            value={filter.query}
            onInput={(e) => setFilter((f) => ({ ...f, query: e.currentTarget.value }))}
          />
          <button
            type="button"
            class="activity-screen__filter-button"
            onClick={() => setFilterSheetOpen(true)}
            aria-label="Filter"
          >
            ▤
            {filterIsActive && <span class="activity-screen__filter-badge" />}
          </button>
        </div>

        {!noTransactionsAtAll && (
          <div class="activity-screen__summary">
            <span>
              {summary.count} transaction{summary.count === 1 ? "" : "s"}
            </span>
            <span class="activity-screen__summary-totals">
              <span class="activity-screen__summary-in">+<Money cents={summary.inCents} /></span>
              <span class="activity-screen__summary-out">−<Money cents={summary.outCents} /></span>
            </span>
          </div>
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
        <ActivityList months={months} resetKey={resetKey} onOpenTransaction={setOpenTransaction} />
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
