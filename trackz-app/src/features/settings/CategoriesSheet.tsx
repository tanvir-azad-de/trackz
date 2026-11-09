import { useMemo, useState } from "preact/hooks";
import type { Transaction } from "@/domain/transaction";
import {
  planCategoryRename,
  summarizeCategories,
  validateCategoryRename,
  type CategorySummary,
} from "@/features/settings/categoryRename";
import { Sheet } from "@/components/Sheet";
import { Money } from "@/components/Money";
import { TypeBreakdown } from "@/components/TypeBreakdown";
import "./CategoriesSheet.css";

/**
 * Phase 13b: the category editor.
 *
 * ONE OPERATION: rename, which merges when the target name already
 * exists. There is deliberately no delete — Phase 0 locked categories as
 * DERIVED from transactions, so an empty category cannot exist to be
 * deleted, and deleting one with rows means moving those rows, which is
 * what a rename already does. See categoryRename.ts's header.
 *
 * TWO-STEP: a list of every category, then a rename form for the one
 * picked. Unlike MerchantMergeSheet, which walks auto-detected duplicate
 * groups one at a time, there is nothing to auto-detect here: the real
 * data has ZERO case- or punctuation-duplicate category names (all 36 are
 * distinct even normalized), so a suggestion list would always be empty.
 * Every genuine category tidy-up is a semantic judgement only the user
 * can make ("Dining" into "Restaurant"), so this screen's job is to show
 * the data clearly and get out of the way.
 *
 * MIXED TYPES ARE SHOWN, NOT FLAGGED AS WRONG. A category carrying
 * several category types is normal: WiFi spans a shared flat contract
 * (non_expense) and a later sole one (expense); Shopping spans a
 * purchase, a partly-reimbursed purchase and a refund. The breakdown is
 * displayed as information with nothing to action — see
 * domain/transaction.ts's Category doc. This is the opposite stance from
 * the merchant sheet's counterparty warning, and deliberately so: there
 * a mixed breakdown means "you are about to move money between people",
 * here it means "this category has a history".
 */

interface CategoriesSheetProps {
  open: boolean;
  onClose: () => void;
  transactions: Transaction[];
  /** Applies the rename and reports how many rows changed. */
  onRename: (from: string, to: string) => number;
}

export function CategoriesSheet({ open, onClose, transactions, onRename }: CategoriesSheetProps) {
  const categories = useMemo(() => summarizeCategories(transactions), [transactions]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const current = selected === null ? null : (categories.find((c) => c.name === selected) ?? null);

  function handleSelect(category: CategorySummary) {
    setSelected(category.name);
    setDraft(category.name);
  }

  function handleBack() {
    setSelected(null);
    setDraft("");
  }

  function handleClose() {
    handleBack();
    onClose();
  }

  function handleRename() {
    if (!current) return;
    onRename(current.name, draft);
    // Back to the list rather than closing: the sheet stays open so
    // several renames can be done in a row, which is also why Toast.css
    // must out-rank Sheet.css (see the z-index comment there).
    handleBack();
  }

  const error = current === null ? null : validateCategoryRename(transactions, current.name, draft);

  return (
    <Sheet open={open} onClose={handleClose} title={current ? "Rename category" : "Categories"}>
      {current === null ? (
        <div class="categories">
          <p class="categories__hint">
            {categories.length} {categories.length === 1 ? "category" : "categories"}. Tap one to
            rename it — renaming it to a name that already exists merges the two.
          </p>
          <ul class="categories__list">
            {categories.map((c) => (
              <li key={c.name}>
                <button type="button" class="categories__row" onClick={() => handleSelect(c)}>
                  <span class="categories__row-main">
                    <span class="categories__row-name">{c.name}</span>
                    <span class="categories__row-meta">
                      {c.rowCount} {c.rowCount === 1 ? "row" : "rows"}
                      {c.hasMixedTypes && <span class="categories__mixed"> · mixed types</span>}
                    </span>
                  </span>
                  <span class="categories__row-amount">
                    <Money cents={c.totalCents} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" class="categories__button" onClick={handleClose}>
            Close
          </button>
        </div>
      ) : (
        <div class="categories">
          <p class="categories__current">
            {current.name} · {current.rowCount} {current.rowCount === 1 ? "row" : "rows"} ·{" "}
            <Money cents={current.totalCents} />
          </p>

          <TypeBreakdown categoryTypes={current.categoryTypes} />
          {current.hasMixedTypes && (
            <p class="categories__note" role="note">
              This category is used with more than one type. That's fine — renaming it keeps every
              row's type exactly as it is.
            </p>
          )}

          <label class="categories__label">
            New name
            <input
              class="categories__input"
              type="text"
              value={draft}
              onInput={(e) => setDraft(e.currentTarget.value)}
            />
          </label>
          {error && <p class="categories__error">{error}</p>}

          <p class="categories__summary">
            {(() => {
              if (error) return "\u00a0";
              const plan = planCategoryRename(transactions, current.name, draft);
              const rows = `${plan.changed.length} ${plan.changed.length === 1 ? "row" : "rows"}`;
              if (plan.isMerge) {
                return `Moves ${rows} into ${plan.canonical}, which has ${plan.mergedIntoCount}. Amounts and types don't change.`;
              }
              return `Renames ${rows}. Amounts and types don't change.`;
            })()}
          </p>

          <div class="categories__actions">
            <button
              type="button"
              class="categories__button categories__button--secondary"
              onClick={handleBack}
            >
              Back
            </button>
            <button
              type="button"
              class="categories__button categories__button--primary"
              disabled={error !== null}
              onClick={handleRename}
            >
              Rename
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Distinct category count, for the Settings section summary. */
export function countCategories(transactions: Transaction[]): number {
  return summarizeCategories(transactions).length;
}
