import { Card } from "@/components/Card";
import { Money } from "@/components/Money";
import type { Cents } from "@/domain/money";

interface HeroCardProps {
  netWorthCents: Cents;
  incomeCents: Cents;
  expenseCents: Cents;
  surplusCents: Cents;
}

/**
 * Matches the locked Mockup B ("Flat Minimal", docs/mockups/home-b-flat-minimal.html):
 * flat var(--surface-1) card, net worth as the big number, a positive/negative
 * surplus line, and two raised var(--surface-2) stat tiles for income/expense.
 * No gradient — that was Mockup A, explicitly rejected.
 */
export function HeroCard({ netWorthCents, incomeCents, expenseCents, surplusCents }: HeroCardProps) {
  const isSurplus = surplusCents >= 0;
  return (
    <Card class="hero-card">
      <div class="hero-card__label">Net worth</div>
      <div class="hero-card__amount">
        <Money cents={netWorthCents} />
      </div>
      <div class={`hero-card__delta ${isSurplus ? "hero-card__delta--positive" : "hero-card__delta--negative"}`}>
        {isSurplus ? "↑" : "↓"} <Money cents={Math.abs(surplusCents)} /> {isSurplus ? "surplus" : "deficit"} this month
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
