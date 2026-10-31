import { categoryTypeLabel } from "@/domain/transaction";
import { Money } from "@/components/Money";
import type { RecallCombo } from "@/features/entry/recall";

interface RecallChipsProps {
  combos: RecallCombo[];
  disabled: boolean;
  onPick: (combo: RecallCombo) => void;
}

function chipLabel(combo: RecallCombo): string {
  if (combo.categoryType === "transfer") {
    return `${combo.account} → ${combo.destinationAccount}`;
  }
  const parts = [combo.category];
  if (combo.merchant) parts.push(combo.merchant);
  return parts.join(" · ");
}

/**
 * Recall chips — the "chip" step of the locked 3-tap happy path
 * (FAB -> amount -> chip -> saved). Ranked by features/entry/recall.ts's
 * recency-weighted frequency. Disabled until an amount has been entered,
 * since tapping one saves a transaction immediately (see EntrySheet).
 */
export function RecallChips({ combos, disabled, onPick }: RecallChipsProps) {
  if (combos.length === 0) {
    return <p class="recall-chips__empty">No history yet — use "More options" below.</p>;
  }
  return (
    <div class="recall-chips" aria-disabled={disabled}>
      {combos.map((combo) => (
        <button
          key={combo.key}
          type="button"
          class="recall-chip"
          disabled={disabled}
          onClick={() => onPick(combo)}
        >
          <span class="recall-chip__label">{chipLabel(combo)}</span>
          <span class="recall-chip__meta">
            {combo.categoryType !== "transfer" && (
              <>
                {combo.account} ·{" "}
              </>
            )}
            <Money cents={combo.medianAmountCents} class="recall-chip__amount" />
          </span>
          {combo.categoryType !== "expense" && (
            <span class="recall-chip__type">{categoryTypeLabel(combo.categoryType)}</span>
          )}
        </button>
      ))}
    </div>
  );
}
