import { Card } from "@/components/Card";
import { Money } from "@/components/Money";
import { ArrowDown, ArrowUp } from "@/components/icons";
import type { Cents } from "@/domain/money";
import type { LiquidComparison } from "@/insights/engine";
import { formatOrdinalDay } from "@/domain/dates";

interface HeroCardProps {
  liquidCashCents: Cents;
  /** From getLiquidVsSameDayAverage; null percent hides the line. */
  liquidComparison: LiquidComparison;
  /** Today's day of the month, for "for the 10th". */
  dayOfMonth: number;
  dailyExpenseAvgCents: Cents;
  expenseCents: Cents;
}

/**
 * Matches the locked Mockup B ("Flat Minimal", docs/mockups/home-b-flat-minimal.html):
 * flat var(--surface-1) card, liquid cash as the big number, a comparison
 * line under it, and two raised var(--surface-2) stat tiles.
 * No gradient — that was Mockup A, explicitly rejected.
 *
 * The line under the number used to be "X surplus/deficit this month",
 * which read as a deficit for most of every month because income lands
 * once and spending is daily (user decision 2026-11-10). It now compares
 * Liquid with the same day of the last 6 months.
 *
 * Labeled "Liquid" rather than "Net worth" (Phase 12 decision): this
 * figure is CASH account balances only (getLiquidCashCents, which
 * excludes accounts classified "investment" — e.g. SCLB/Scalable
 * Capital, caught live during Phase 12 QA overstating this number by its
 * full balance before the account-type classification was
 * added). Outstanding "Lent out" receivables and investment balances are
 * real assets but aren't spendable cash, so folding them in here would
 * make the headline number silently drift from what the Accounts
 * screen's own math shows unless every reader remembered the
 * distinction. The Accounts screen's total-assets card is the one place
 * Liquid + Investments + Lent out are added together.
 */
export function HeroCard({ liquidCashCents, liquidComparison, dayOfMonth, dailyExpenseAvgCents, expenseCents }: HeroCardProps) {
  const { deltaPercent, monthsUsed } = liquidComparison;
  const rounded = deltaPercent === null ? null : Math.round(deltaPercent);
  // Short form on purpose: "your 6-month average" wrapped to two lines at 390px.
  const baseline = `${monthsUsed}-month avg for the ${formatOrdinalDay(dayOfMonth)}`;
  return (
    <Card class="hero-card">
      <div class="hero-card__label">Liquid</div>
      <div class="hero-card__amount">
        <Money cents={liquidCashCents} />
      </div>
      {rounded !== null &&
        (rounded === 0 ? (
          <div class="hero-card__delta">In line with {baseline}</div>
        ) : (
          <div class={`hero-card__delta ${rounded > 0 ? "hero-card__delta--positive" : "hero-card__delta--negative"}`}>
            {rounded > 0 ? <ArrowUp size="1em" /> : <ArrowDown size="1em" />} {Math.abs(rounded)}% {rounded > 0 ? "above" : "below"} {baseline}
          </div>
        ))}
      <div class="hero-card__stats">
        <div class="stat-tile">
          <div class="stat-tile__label">Daily avg</div>
          <div class="stat-tile__value stat-tile__value--negative">
            <Money cents={dailyExpenseAvgCents} />
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile__label">Spent</div>
          <div class="stat-tile__value stat-tile__value--negative">
            <Money cents={expenseCents} />
          </div>
        </div>
      </div>
    </Card>
  );
}
