import { useMemo } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import {
  getAccountBalances,
  getCategoryDeltasForMonth,
  getLatestDate,
  getMostSurprisingDeltas,
  getNetWorthCents,
  summarizeMonth,
} from "@/insights/engine";
import { getMonthEndDate, getMonthStartDate } from "@/domain/dates";
import type { ActivityFilter } from "@/features/activity/filter";
import { emptyFilter } from "@/features/activity/filter";
import { HeroCard } from "./HeroCard";
import { AccountStrip } from "./AccountStrip";
import { InsightFeed } from "./InsightFeed";
import "./HeroCard.css";
import "./AccountStrip.css";
import "./InsightFeed.css";
import "./HomeScreen.css";

interface HomeScreenProps {
  /** Wired by app.tsx so an insight card can deep-link into a pre-filtered Activity view (Phase 11). */
  onDrillDown?: (filter: ActivityFilter) => void;
}

export function HomeScreen({ onDrillDown }: HomeScreenProps) {
  const transactions = useTransactions();

  const data = useMemo(() => {
    const latestDate = getLatestDate(transactions);
    if (!latestDate) return null;
    const monthKey = latestDate.slice(0, 7);

    const summary = summarizeMonth(transactions, monthKey);
    const netWorthCents = getNetWorthCents(transactions);
    const accounts = getAccountBalances(transactions);
    const deltas = getMostSurprisingDeltas(getCategoryDeltasForMonth(transactions, monthKey, 6, latestDate));

    return { summary, netWorthCents, accounts, deltas, monthKey };
  }, [transactions]);

  if (!data) {
    return (
      <main class="home-screen">
        <h1 class="home-screen__title">Home</h1>
        <p class="home-screen__empty">No transactions yet. Tap the + button to log your first one.</p>
      </main>
    );
  }

  function handleDrillDown(category: string) {
    if (!onDrillDown || !data) return;
    const filter: ActivityFilter = {
      ...emptyFilter(),
      categories: [category],
      from: getMonthStartDate(data.monthKey),
      to: getMonthEndDate(data.monthKey),
    };
    onDrillDown(filter);
  }

  return (
    <main class="home-screen">
      <h1 class="home-screen__title">Home</h1>
      <HeroCard
        netWorthCents={data.netWorthCents}
        incomeCents={data.summary.incomeCents}
        expenseCents={data.summary.expenseCents}
        surplusCents={data.summary.surplusCents}
      />
      <AccountStrip accounts={data.accounts} />
      <h2 class="home-screen__section-title">What changed this month</h2>
      <InsightFeed deltas={data.deltas} onSelectCategory={onDrillDown ? handleDrillDown : undefined} />
    </main>
  );
}
