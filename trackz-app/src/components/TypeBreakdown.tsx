import { categoryTypeLabel, type CategoryType } from "@/domain/transaction";
import type { CategoryTypeBreakdown } from "@/domain/merchant";
import "./TypeBreakdown.css";

/**
 * Renders a per-category-type row count: "14 × Paying someone back,
 * 4 × Expense", most-used first.
 *
 * Extracted from MerchantMergeSheet.tsx in Phase 13b, where the category
 * editor needed the same readout. Shared rather than copied because the
 * list of types that mean "this amount isn't simply mine" was already
 * hardcoded in three separate places (domain/merchant.ts's
 * COUNTERPARTY_TYPES, TransactionRow.tsx's showsRelabel, and
 * MerchantMergeSheet's own manual-merge check) — a fourth copy of the
 * rendering on top of that was not worth it.
 *
 * Deliberately NOT given a "this is a problem" styling: the same
 * component serves the merchant merge sheet (where a mixed breakdown is
 * a warning sign, and the warning is rendered separately alongside it)
 * and the category editor (where a mixed breakdown is normal and
 * correct — see domain/transaction.ts's Category doc for why WiFi and
 * Shopping legitimately span several types). The caller decides whether
 * a breakdown deserves a warning, not this component.
 */
export function TypeBreakdown({ categoryTypes }: { categoryTypes: CategoryTypeBreakdown }) {
  const entries = Object.entries(categoryTypes) as Array<[CategoryType, number]>;
  return (
    <ul class="type-breakdown">
      {entries
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => (
          <li key={type}>
            {count} × {categoryTypeLabel(type)}
          </li>
        ))}
    </ul>
  );
}
