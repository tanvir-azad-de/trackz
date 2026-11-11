import { useMemo } from "preact/hooks";
import type { Transaction } from "@/domain/transaction";
import { summarizeNames, type NameField } from "@/features/settings/nameSummary";
import { Sheet } from "@/components/Sheet";
import { Money } from "@/components/Money";
import "./NamesSheet.css";

/**
 * Settings' Categories and Merchants sheets: a list of every name in
 * `field`, each tapping through to Activity filtered to it (via
 * `onSelect`; SettingsScreen builds the filter).
 *
 * Was RenameSheet until 2026-11-11, when rename/merge was removed (user
 * decision). The merchant merge ("Tidy up Merchants") went the same day,
 * so the app has no way left to rewrite a name in bulk.
 *
 * MIXED TYPES ARE SHOWN, NOT FLAGGED AS WRONG. A category carrying
 * several category types is normal (WiFi, Shopping in the real data) —
 * see domain/transaction.ts's Category doc.
 */

const TITLES: Record<NameField, string> = {
  category: "Categories",
  merchant: "Merchants",
};

interface NamesSheetProps {
  field: NameField;
  open: boolean;
  onClose: () => void;
  transactions: Transaction[];
  onSelect: (name: string) => void;
}

export function NamesSheet({ field, open, onClose, transactions, onSelect }: NamesSheetProps) {
  const names = useMemo(() => summarizeNames(transactions, field), [transactions, field]);

  return (
    <Sheet open={open} onClose={onClose} title={TITLES[field]}>
      <div class="names-sheet">
        <ul class="names-sheet__list">
          {names.map((c) => (
            <li key={c.name}>
              <button type="button" class="names-sheet__row" onClick={() => onSelect(c.name)}>
                <span class="names-sheet__row-main">
                  <span class="names-sheet__row-name">{c.name}</span>
                  <span class="names-sheet__row-meta">
                    {c.rowCount} {c.rowCount === 1 ? "row" : "rows"}
                    {c.hasMixedTypes && <span class="names-sheet__mixed"> · mixed types</span>}
                  </span>
                </span>
                <span class="names-sheet__row-amount">
                  <Money cents={c.totalCents} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" class="names-sheet__button" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}

/** Distinct name count in `field`, for the Settings row summary. */
export function countNames(transactions: Transaction[], field: NameField): number {
  return summarizeNames(transactions, field).length;
}
