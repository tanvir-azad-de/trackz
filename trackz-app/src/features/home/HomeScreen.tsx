import { useMemo } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { useAccountTypes } from "@/storage/useAccountTypes";
import {
  getAccountBalances,
  getCategoryDeltasForMonth,
  getCumulativeExpenseSeries,
  getDailyExpenseAvgCents,
  getLatestDate,
  getLiquidCashCents,
  getLiquidVsSameDayAverage,
  getMostSurprisingDeltas,
  summarizeMonth,
} from "@/insights/engine";
import { getLocalToday, getMonthEndDate, getMonthStartDate, toMonthKey } from "@/domain/dates";
import type { ActivityFilter } from "@/features/activity/filter";
import { emptyFilter } from "@/features/activity/filter";
import { HeroCard } from "./HeroCard";
import { AccountStrip } from "./AccountStrip";
import { SpendChart } from "./SpendChart";
import { InsightFeed } from "./InsightFeed";
import "./HeroCard.css";
import "./AccountStrip.css";
import "./SpendChart.css";
import "./InsightFeed.css";
import "./HomeScreen.css";

interface HomeScreenProps {
  /** Wired by app.tsx so an insight card can deep-link into a pre-filtered Activity view (Phase 11). */
  onDrillDown?: (filter: ActivityFilter) => void;
}

export function HomeScreen({ onDrillDown }: HomeScreenProps) {
  const transactions = useTransactions();
  const accountTypes = useAccountTypes();

  const data = useMemo(() => {
    const latestDate = getLatestDate(transactions);
    if (!latestDate) return null;
    const liquidCashCents = getLiquidCashCents(transactions, accountTypes);
    const accounts = getAccountBalances(transactions).map((a) => ({
      ...a,
      accountType: accountTypes[a.account] ?? "cash",
    }));
    // The real date, not the latest transaction's (user decision
    // 2026-11-10): "so far this month" means up to today, and the
    // same-days baseline must stop at the same day. Early in a month with
    // nothing logged yet, this gives an empty feed rather than last
    // month's figures under this month's heading.
    // The hero's Spent and Daily avg follow the same rule, so all three
    // agree on what "this month" is.
    const today = getLocalToday();
    const insightMonthKey = toMonthKey(today);
    const deltas = getMostSurprisingDeltas(getCategoryDeltasForMonth(transactions, insightMonthKey, 6, today));
    const summary = summarizeMonth(transactions, insightMonthKey, today);
    const dailyExpenseAvgCents = getDailyExpenseAvgCents(transactions, today);
    const liquidComparison = getLiquidVsSameDayAverage(transactions, accountTypes, liquidCashCents, today);
    const dayOfMonth = Number(today.slice(8, 10));
    const spendSeries = getCumulativeExpenseSeries(transactions, today);

    return { today, spendSeries, summary, liquidCashCents, liquidComparison, dayOfMonth, dailyExpenseAvgCents, accounts, deltas, insightMonthKey };
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
      <HeroCard
        liquidCashCents={data.liquidCashCents}
        liquidComparison={data.liquidComparison}
        dayOfMonth={data.dayOfMonth}
        dailyExpenseAvgCents={data.dailyExpenseAvgCents}
        expenseCents={data.summary.expenseCents}
      />
      <AccountStrip accounts={data.accounts} />
      <h2 class="home-screen__section-title">Spending this month</h2>
      <SpendChart series={data.spendSeries} today={data.today} />
      <h2 class="home-screen__section-title">What changed this month</h2>
      <InsightFeed deltas={data.deltas} onSelectCategory={onDrillDown ? handleDrillDown : undefined} />
    </main>
  );
}
