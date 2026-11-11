import { useMemo } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { useAccountTypes } from "@/storage/useAccountTypes";
import {
  getAccountActivity,
  getAccountBalanceSeries,
  getPayableBalances,
  getReceivableBalances,
  type AccountActivity,
} from "@/insights/engine";
import { formatDayLabel, getLocalToday, getMonthStartDate, getMonthEndDate, toMonthKey } from "@/domain/dates";
import type { ActivityFilter } from "@/features/activity/filter";
import { emptyFilter } from "@/features/activity/filter";
import { Card } from "@/components/Card";
import { Money } from "@/components/Money";
import { Sparkline } from "@/components/Sparkline";
import "@/components/Sparkline.css";
import "./AccountsScreen.css";

interface AccountsScreenProps {
  /** Wired by app.tsx, same deep-link mechanism Home's InsightFeed uses (Phase 11). */
  onDrillDown?: (filter: ActivityFilter) => void;
}

type AccountRow = AccountActivity & { series: Array<{ monthKey: string; balanceCents: number }> };

/**
 * Phase 12: balance cards with sparklines, receivables/payables surfaced
 * as "Lent out"/"I owe" per the locked relabel decisions.
 *
 * Accounts are split into Cash / Investments / Credit cards sections by
 * the CSV-sourced classification in storage/accountTypes.ts (an account
 * with no entry is Cash). The Total Assets card that summed them was
 * removed on 2026-11-11 (user decision), with getTotalAssetsCents.
 */
export function AccountsScreen({ onDrillDown }: AccountsScreenProps) {
  const transactions = useTransactions();
  const accountTypes = useAccountTypes();

  const data = useMemo(() => {
    if (transactions.length === 0) return null;
    // The real date's month, not the latest transaction's (user decision
    // 2026-11-10), so Accounts and Home agree on "this month". It sets
    // where each sparkline ends and what counts as dormant: early in a
    // month with nothing logged yet, every account greys out until its
    // first row of the month, which is the accepted cost.
    const monthKey = toMonthKey(getLocalToday());

    const allAccounts = getAccountActivity(transactions, accountTypes).map((acc) => ({
      ...acc,
      series: getAccountBalanceSeries(transactions, acc.account, monthKey, 6),
    }));
    const cashAccounts = allAccounts.filter((a) => a.accountType === "cash");
    const investmentAccounts = allAccounts.filter((a) => a.accountType === "investment");
    const creditCardAccounts = allAccounts.filter((a) => a.accountType === "credit_card");

    return {
      cashAccounts,
      investmentAccounts,
      creditCardAccounts,
      receivables: getReceivableBalances(transactions),
      payables: getPayableBalances(transactions),
      monthKey,
    };
  }, [transactions, accountTypes]);

  if (!data) {
    return (
      <main class="accounts-screen">
        <p class="accounts-screen__empty">No transactions yet. Tap the + button to log your first one.</p>
      </main>
    );
  }

  function drillToAccount(account: string) {
    if (!onDrillDown || !data) return;
    onDrillDown({
      ...emptyFilter(),
      accounts: [account],
    });
  }

  function drillToCounterparty(categoryType: "receivable" | "payable", counterparty: string) {
    if (!onDrillDown) return;
    onDrillDown({
      ...emptyFilter(),
      categoryTypes: [categoryType],
      query: counterparty,
    });
  }

  function renderAccountCard(acc: AccountRow) {
    const dormant =
      acc.lastActivityDate !== null &&
      data !== null &&
      getMonthStartDate(data.monthKey) > getMonthEndDate(acc.lastActivityDate.slice(0, 7));
    const color = dormant ? "var(--text-tertiary)" : acc.balanceCents < 0 ? "var(--negative)" : "var(--positive)";
    return (
      <Card class="account-card" key={acc.account} onClick={onDrillDown ? () => drillToAccount(acc.account) : undefined}>
        <div class="account-card__row">
          <div class="account-card__identity">
            <div class="account-card__name">{acc.account}</div>
            <div class={`account-card__last-activity ${dormant ? "account-card__last-activity--dormant" : ""}`}>
              {acc.lastActivityDate ? formatDayLabel(acc.lastActivityDate, getLocalToday()) : "No activity"}
            </div>
          </div>
          <Sparkline values={acc.series.map((p) => p.balanceCents)} color={color} />
          <Money
            cents={acc.balanceCents}
            class={`account-card__balance ${acc.balanceCents < 0 ? "account-card__balance--negative" : ""}`}
          />
        </div>
      </Card>
    );
  }

  return (
    <main class="accounts-screen">
      <h2 class="accounts-screen__section-title">Cash</h2>
      <div class="account-list">{data.cashAccounts.map(renderAccountCard)}</div>

      {data.investmentAccounts.length > 0 && (
        <>
          <h2 class="accounts-screen__section-title">Investments</h2>
          <div class="account-list">{data.investmentAccounts.map(renderAccountCard)}</div>
        </>
      )}

      {data.creditCardAccounts.length > 0 && (
        <>
          <h2 class="accounts-screen__section-title">Credit cards</h2>
          <div class="account-list">{data.creditCardAccounts.map(renderAccountCard)}</div>
        </>
      )}

      <h2 class="accounts-screen__section-title">Lent out</h2>
      {data.receivables.length === 0 ? (
        <p class="accounts-screen__empty">Nothing currently lent out.</p>
      ) : (
        <div class="counterparty-list">
          {data.receivables.map((r) => (
            <Card
              class="counterparty-card"
              key={r.counterparty}
              onClick={onDrillDown ? () => drillToCounterparty("receivable", r.counterparty) : undefined}
            >
              <span class="counterparty-card__name">{r.counterparty}</span>
              <Money cents={r.balanceCents} class="counterparty-card__amount counterparty-card__amount--neutral" />
            </Card>
          ))}
        </div>
      )}

      <h2 class="accounts-screen__section-title">I owe</h2>
      {data.payables.length === 0 ? (
        <p class="accounts-screen__empty">You don't owe anyone right now.</p>
      ) : (
        <div class="counterparty-list">
          {data.payables.map((p) => (
            <Card
              class="counterparty-card"
              key={p.counterparty}
              onClick={onDrillDown ? () => drillToCounterparty("payable", p.counterparty) : undefined}
            >
              <span class="counterparty-card__name">{p.counterparty}</span>
              <Money cents={p.balanceCents} class="counterparty-card__amount counterparty-card__amount--negative" />
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
