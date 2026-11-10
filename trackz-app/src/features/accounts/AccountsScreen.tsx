import { useMemo } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { useAccountTypes } from "@/storage/useAccountTypes";
import {
  getAccountActivity,
  getAccountBalanceSeries,
  getLatestMonthKey,
  getPayableBalances,
  getReceivableBalances,
  getTotalAssetsCents,
  type AccountActivity,
} from "@/insights/engine";
import { formatDayLabel, getLocalToday, getMonthStartDate, getMonthEndDate } from "@/domain/dates";
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
 * as "Lent out"/"I owe" per the locked relabel decisions. A dedicated
 * total-assets header reconciles this screen with Home's hero card,
 * which (per the Phase 12 design decision) was relabeled "Liquid" rather
 * than made to include receivables — one concept per screen, see
 * docs/renovation_version_1.txt's Phase 12 write-up.
 *
 * Accounts are split into Cash / Investments sections (added after
 * Phase 12 shipped): SCLB (Scalable Capital, a real brokerage account)
 * was being counted as liquid cash, overstating "Liquid" on both this
 * screen and Home's hero by its full balance. The cash/investment
 * classification lives in storage/accountTypes.ts, defaulting every
 * account to "cash" so no other account's section changes.
 */
export function AccountsScreen({ onDrillDown }: AccountsScreenProps) {
  const transactions = useTransactions();
  const accountTypes = useAccountTypes();

  const data = useMemo(() => {
    const monthKey = getLatestMonthKey(transactions);
    if (!monthKey) return null;

    const allAccounts = getAccountActivity(transactions, accountTypes).map((acc) => ({
      ...acc,
      series: getAccountBalanceSeries(transactions, acc.account, monthKey, 6),
    }));
    const cashAccounts = allAccounts.filter((a) => a.accountType === "cash");
    const investmentAccounts = allAccounts.filter((a) => a.accountType === "investment");

    const liquidCents = cashAccounts.reduce((sum, a) => sum + a.balanceCents, 0);
    const investmentsCents = investmentAccounts.reduce((sum, a) => sum + a.balanceCents, 0);
    const receivables = getReceivableBalances(transactions);
    const payables = getPayableBalances(transactions);
    const totalAssetsCents = getTotalAssetsCents(transactions);
    const lentOutCents = receivables.reduce((sum, r) => sum + r.balanceCents, 0);

    return {
      cashAccounts,
      investmentAccounts,
      receivables,
      payables,
      liquidCents,
      investmentsCents,
      lentOutCents,
      totalAssetsCents,
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

      <Card class="total-assets-card">
        <div class="total-assets-card__row">
          <span class="total-assets-card__label">Liquid</span>
          <Money cents={data.liquidCents} class="total-assets-card__value" />
        </div>
        {data.investmentsCents !== 0 && (
          <div class="total-assets-card__row">
            <span class="total-assets-card__label">Investments</span>
            <Money cents={data.investmentsCents} class="total-assets-card__value" />
          </div>
        )}
        {data.lentOutCents > 0 && (
          <div class="total-assets-card__row">
            <span class="total-assets-card__label">Lent out</span>
            <Money cents={data.lentOutCents} class="total-assets-card__value total-assets-card__value--neutral" />
          </div>
        )}
        <div class="total-assets-card__divider" />
        <div class="total-assets-card__row total-assets-card__row--total">
          <span class="total-assets-card__label">Total</span>
          <Money cents={data.totalAssetsCents} class="total-assets-card__value total-assets-card__value--total" />
        </div>
      </Card>

      <h2 class="accounts-screen__section-title">Cash</h2>
      <div class="account-list">{data.cashAccounts.map(renderAccountCard)}</div>

      {data.investmentAccounts.length > 0 && (
        <>
          <h2 class="accounts-screen__section-title">Investments</h2>
          <div class="account-list">{data.investmentAccounts.map(renderAccountCard)}</div>
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
