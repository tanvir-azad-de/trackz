import type { ComponentType } from "preact";
import { Card } from "@/components/Card";
import { Money } from "@/components/Money";
import { ArrowDown, CreditCard, Handshake, Landmark, TrendingUp } from "@/components/icons";
import type { BalanceSheet, BalanceSheetRowKind } from "@/insights/engine";
import { netWorthSegments } from "./netWorthBar";

/** One icon per account type, not per account (user decision 2026-11-11). */
const ROW_ICONS: Record<BalanceSheetRowKind, ComponentType<{ size?: string }>> = {
  cash: Landmark,
  investment: TrendingUp,
  credit_card: CreditCard,
  lent_out: Handshake,
  borrowed: ArrowDown,
};

interface BalanceCardsProps {
  sheet: BalanceSheet;
}

/**
 * Home's top section (user decision 2026-11-11, replacing the Liquid hero
 * and the account strip): a Net worth card, then ONE card listing every
 * account, Lent out and Borrowed. The figures and their rules live in
 * getBalanceSheet (insights/engine.ts).
 *
 * The Net worth card's bar shows how the three totals compare (user
 * pick 2026-11-11, "A" of three mockups); netWorthSegments has the rules.
 *
 * The list was three cards with headers and totals until the user merged
 * them (2026-11-11): the totals already sit in the Net worth legend, and
 * the group shows by colour — white Liquid, amber Other, red Owed.
 * Not tappable: the Accounts tab already drills into each account.
 */
export function BalanceCards({ sheet }: BalanceCardsProps) {
  const segments = netWorthSegments(sheet);
  // One list, Liquid then Other then Owed; the amount colour (matching
  // the legend dots above) is the only thing marking the group.
  const rows = [
    ...sheet.liquid.rows.map((row) => ({ row, tone: "liquid" })),
    ...sheet.other.rows.map((row) => ({ row, tone: "other" })),
    ...sheet.liabilities.rows.map((row) => ({ row, tone: "liabilities" })),
  ];
  return (
    <div class="balance-cards">
      <Card class="net-worth">
        <div class="net-worth__label">Net worth</div>
        <Money
          cents={sheet.netWorthCents}
          class={`net-worth__amount ${sheet.netWorthCents < 0 ? "net-worth__amount--negative" : ""}`}
        />
        {segments.length > 0 && (
          <div class="net-worth__bar" aria-hidden="true">
            {segments.map((s) => (
              <span key={s.key} class={`net-worth__segment net-worth__segment--${s.key}`} style={{ flexGrow: s.weightCents }} />
            ))}
          </div>
        )}
        <div class="net-worth__legend">
          <LegendItem tone="liquid" label="Liquid" cents={sheet.liquid.totalCents} />
          <LegendItem tone="other" label="Other" cents={sheet.other.totalCents} />
          <LegendItem tone="liabilities" label="Owed" cents={sheet.liabilities.totalCents} />
        </div>
      </Card>
      {rows.length > 0 && (
        <Card class="balance-list">
          {rows.map(({ row, tone }) => {
            const Icon = ROW_ICONS[row.kind];
            return (
              <div class={`balance-list__row balance-list__row--${tone}`} key={`${row.kind}:${row.label}`}>
                <span class="balance-list__name">
                  <span class="balance-list__icon">
                    <Icon size="1em" />
                  </span>
                  {row.label}
                </span>
                <Money cents={row.amountCents} class="balance-list__amount" />
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function LegendItem({ tone, label, cents }: { tone: string; label: string; cents: number }) {
  return (
    <div class="net-worth__legend-item">
      <span class="net-worth__legend-label">
        <span class={`net-worth__dot net-worth__segment--${tone}`} />
        {label}
      </span>
      <Money cents={cents} class="net-worth__legend-amount" />
    </div>
  );
}
