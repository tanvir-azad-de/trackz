import { useCallback, useMemo, useState } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { useAccountTypes } from "@/storage/useAccountTypes";
import {
  getBalanceSheet,
  getCategoryDeltasForMonth,
  getMonthlyExpenseSeries,
  getMostSurprisingDeltas,
} from "@/insights/engine";
import { getLocalToday, getMonthEndDate, getMonthStartDate, toMonthKey } from "@/domain/dates";
import type { ActivityFilter } from "@/features/activity/filter";
import { emptyFilter } from "@/features/activity/filter";
import { BalanceCards } from "./BalanceCards";
import { SpendChart } from "./SpendChart";
import { CategorySheet } from "./CategorySheet";
import { InsightFeed } from "./InsightFeed";
import "./BalanceCards.css";
import "./SpendChart.css";
import "@/components/Sheet.css";
import "@/features/activity/MonthPills.css";
import "@/features/entry/EntryForm.css";
import "./CategorySheet.css";
import "./InsightFeed.css";
import "./HomeScreen.css";

interface HomeScreenProps {
  /** Wired by app.tsx so an insight card can deep-link into a pre-filtered Activity view (Phase 11). */
  onDrillDown?: (filter: ActivityFilter) => void;
}

export function HomeScreen({ onDrillDown }: HomeScreenProps) {
  const transactions = useTransactions();
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  // Stable identity: Sheet re-runs its scroll-lock effect whenever onClose
  // changes, and Home re-renders on every storage change.
  const closeCategorySheet = useCallback(() => setCategorySheetOpen(false), []);
  const accountTypes = useAccountTypes();

  const data = useMemo(() => {
    if (transactions.length === 0) return null;
    const balanceSheet = getBalanceSheet(transactions, accountTypes);
    // The real date, not the latest transaction's (user decision
    // 2026-11-10): "so far this month" means up to today, and the
    // same-days baseline must stop at the same day. Early in a month with
    // nothing logged yet, this gives an empty feed rather than last
    // month's figures under this month's heading.
    // The chart's last point follows the same rule, so both agree on
    // what "this month" is.
    const today = getLocalToday();
    const insightMonthKey = toMonthKey(today);
    const deltas = getMostSurprisingDeltas(getCategoryDeltasForMonth(transactions, insightMonthKey, 6, today));
    const spendSeries = getMonthlyExpenseSeries(transactions, insightMonthKey, 6, today);

    return { today, spendSeries, balanceSheet, deltas, insightMonthKey };
  }, [transactions, accountTypes]);

  if (!data) {
    return (
      <main class="home-screen">
        <p class="home-screen__empty">No transactions yet. Tap the + button to log your first one.</p>
      </main>
    );
  }

  /**
   * Deep-link an insight card into Activity.
   *
   * categoryTypes: ["expense"] is LOAD-BEARING, not a default. The delta
   * that produced this card was computed over expense rows ONLY
   * (insights/engine.ts's getCategoryDeltasForMonth filters
   * categoryType !== "expense" before keying by name), so a drill-down
   * without it filtered on the bare NAME and pulled in every other type
   * sharing it. Real data: tapping Shopping showed a delta over 151 rows
   * and landed on 154 (+2 non_expense, +1 non_income), so the figure on
   * the card could not be reconciled with the screen it opened — the
   * extra rows moved the in/out totals too. A card whose number
   * disagrees with its own destination is worse than one that scopes
   * the destination, so the type constraint now travels with the name.
   */
  function handleDrillDown(category: string) {
    if (!onDrillDown || !data) return;
    const filter: ActivityFilter = {
      ...emptyFilter(),
      categories: [category],
      categoryTypes: ["expense"],
      from: getMonthStartDate(data.insightMonthKey),
      to: getMonthEndDate(data.insightMonthKey),
    };
    onDrillDown(filter);
  }

  return (
    <main class="home-screen">
      <BalanceCards sheet={data.balanceSheet} />
      <h2 class="home-screen__section-title">Spending, last 6 months</h2>
      <SpendChart series={data.spendSeries} onOpen={() => setCategorySheetOpen(true)} />
      <h2 class="home-screen__section-title">What changed this month</h2>
      <InsightFeed deltas={data.deltas} onSelectCategory={onDrillDown ? handleDrillDown : undefined} />
      <CategorySheet
        open={categorySheetOpen}
        onClose={closeCategorySheet}
        transactions={transactions}
        series={data.spendSeries}
        today={data.today}
      />
    </main>
  );
}
