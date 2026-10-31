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
import { HeroCard } from "./HeroCard";
import { AccountStrip } from "./AccountStrip";
import { InsightFeed } from "./InsightFeed";
import "./HeroCard.css";
import "./AccountStrip.css";
import "./InsightFeed.css";
import "./HomeScreen.css";

export function HomeScreen() {
  const transactions = useTransactions();

  const data = useMemo(() => {
    const latestDate = getLatestDate(transactions);
    if (!latestDate) return null;
    const monthKey = latestDate.slice(0, 7);

    const summary = summarizeMonth(transactions, monthKey);
    const netWorthCents = getNetWorthCents(transactions);
    const accounts = getAccountBalances(transactions);
    const deltas = getMostSurprisingDeltas(getCategoryDeltasForMonth(transactions, monthKey, 6, latestDate));

    return { summary, netWorthCents, accounts, deltas };
  }, [transactions]);

  if (!data) {
    return (
      <main class="home-screen">
        <h1 class="home-screen__title">Home</h1>
        <p class="home-screen__empty">No transactions yet. Tap the + button to log your first one.</p>
      </main>
    );
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
      <InsightFeed deltas={data.deltas} />
    </main>
  );
}
