import { useMemo } from "preact/hooks";
import { useTransactions } from "@/storage/useTransactions";
import { getPayableBalances, getReceivableBalances } from "@/insights/engine";
import type { ActivityFilter } from "@/features/activity/filter";
import { emptyFilter } from "@/features/activity/filter";
import { Card } from "@/components/Card";
import { Money } from "@/components/Money";
import "./AccountsScreen.css";

interface AccountsScreenProps {
  /** Wired by app.tsx, same deep-link mechanism Home's InsightFeed uses (Phase 11). */
  onDrillDown?: (filter: ActivityFilter) => void;
}

/**
 * Phase 12: receivables/payables surfaced as "Lent out"/"I owe" per the
 * locked relabel decisions.
 *
 * The Cash / Investments / Credit cards balance sections were removed on
 * 2026-11-11 (user decision) — Home's balance cards now carry per-account
 * balances. The Total Assets card went the same day.
 */
export function AccountsScreen({ onDrillDown }: AccountsScreenProps) {
  const transactions = useTransactions();

  const data = useMemo(() => {
    if (transactions.length === 0) return null;
    return {
      receivables: getReceivableBalances(transactions),
      payables: getPayableBalances(transactions),
    };
  }, [transactions]);

  if (!data) {
    return (
      <main class="accounts-screen">
        <p class="accounts-screen__empty">No transactions yet. Tap the + button to log your first one.</p>
      </main>
    );
  }

  function drillToCounterparty(categoryType: "receivable" | "payable", counterparty: string) {
    if (!onDrillDown) return;
    onDrillDown({
      ...emptyFilter(),
      categoryTypes: [categoryType],
      query: counterparty,
    });
  }

  return (
    <main class="accounts-screen">
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
