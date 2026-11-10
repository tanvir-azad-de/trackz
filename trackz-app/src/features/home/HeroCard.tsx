import { Card } from "@/components/Card";
import { Money } from "@/components/Money";
import { ArrowDown, ArrowUp } from "@/components/icons";
import type { Cents } from "@/domain/money";

interface HeroCardProps {
  liquidCashCents: Cents;
  incomeCents: Cents;
  expenseCents: Cents;
  surplusCents: Cents;
}

/**
 * Matches the locked Mockup B ("Flat Minimal", docs/mockups/home-b-flat-minimal.html):
 * flat var(--surface-1) card, liquid cash as the big number, a positive/negative
 * surplus line, and two raised var(--surface-2) stat tiles for income/expense.
 * No gradient — that was Mockup A, explicitly rejected.
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
export function HeroCard({ liquidCashCents, incomeCents, expenseCents, surplusCents }: HeroCardProps) {
  const isSurplus = surplusCents >= 0;
  return (
    <Card class="hero-card">
      <div class="hero-card__label">Liquid</div>
      <div class="hero-card__amount">
        <Money cents={liquidCashCents} />
      </div>
      <div class={`hero-card__delta ${isSurplus ? "hero-card__delta--positive" : "hero-card__delta--negative"}`}>
        {isSurplus ? <ArrowUp size="1em" /> : <ArrowDown size="1em" />} <Money cents={Math.abs(surplusCents)} /> {isSurplus ? "surplus" : "deficit"} this month
      </div>
      <div class="hero-card__stats">
        <div class="stat-tile">
          <div class="stat-tile__label">Income</div>
          <div class="stat-tile__value stat-tile__value--positive">
            <Money cents={incomeCents} />
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
