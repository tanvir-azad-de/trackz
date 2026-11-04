import { useMemo, useState } from "preact/hooks";
import type { Transaction } from "@/domain/transaction";
import { categoryTypeLabel, type CategoryType } from "@/domain/transaction";
import { findMergeGroups, normalizeMerchant, type MergeGroup } from "@/domain/merchant";
import { planMerge, validateMerge } from "@/features/settings/merchantMerge";
import { Sheet } from "@/components/Sheet";
import "./MerchantMergeSheet.css";

/**
 * Phase 6 part 2: the guided merchant-merge screen.
 *
 * Works through auto-detected duplicate groups ONE AT A TIME. Every
 * merge is an explicit confirmation and nothing is ever merged silently
 * — that is a locked renovation decision, not a UX preference.
 *
 * Detection is deliberately conservative (equality of normalized form
 * only; see domain/merchant.ts for the measured reasons first-token
 * matching was rejected), so some real duplicates are NOT proposed:
 * "Niemerszein" / "NIEMERSZEIN & CO.KG" and "Kaufland" / "KAUFLAND
 * HAMBURG BRAMF". Those are reachable through the manual tab, where the
 * user names both sides themselves.
 *
 * THE COUNTERPARTY WARNING is the one piece of domain knowledge this
 * sheet encodes. `merchant` does double duty: a shop on ordinary
 * expense rows, but a PERSON on non_expense / non_income / receivable /
 * payable rows. Per the user: non_expense means the money left their
 * account but the whole amount is not their expense (a loan to a friend,
 * or a bill partly reimbursed), and non_income is the mirror. Those rows
 * also feed the Accounts screen's Lent out / I owe totals, which group
 * by merchant. So a group containing them gets a visible warning rather
 * than being presented as routine tidying.
 */

interface MerchantMergeSheetProps {
  open: boolean;
  onClose: () => void;
  transactions: Transaction[];
  /** Applies the merge and reports what happened. Returns rows changed. */
  onMerge: (variants: string[], canonical: string) => number;
}

function TypeBreakdown({ categoryTypes }: { categoryTypes: MergeGroup["categoryTypes"] }) {
  const entries = Object.entries(categoryTypes) as Array<[CategoryType, number]>;
  return (
    <ul class="merge-group__types">
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

function CounterpartyWarning() {
  return (
    <p class="merge-group__warning" role="note">
      Some of these rows aren't plain expenses — the name is a person, and part or all of the amount
      isn't your own money. Merging also changes how they're grouped under Lent out / I owe.
    </p>
  );
}

export function MerchantMergeSheet({ open, onClose, transactions, onMerge }: MerchantMergeSheetProps) {
  const groups = useMemo(() => findMergeGroups(transactions), [transactions]);
  const merchants = useMemo(() => {
    const names = new Set<string>();
    for (const tx of transactions) {
      const name = tx.merchant.trim();
      if (name !== "") names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const [mode, setMode] = useState<"suggested" | "manual">("suggested");
  // Groups the user chose to skip this session, by normalized key. Kept
  // in state rather than persisted: skipping means "not now", and a
  // persisted skip would silently hide a real duplicate forever.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [canonicalDraft, setCanonicalDraft] = useState<string | null>(null);

  // Manual-merge state.
  const [manualA, setManualA] = useState("");
  const [manualB, setManualB] = useState("");
  const [manualCanonical, setManualCanonical] = useState("");

  const pending = groups.filter((g) => !skipped.has(g.normalized));
  const current = pending[0];

  // The draft follows the current group unless the user has edited it.
  const canonical = canonicalDraft ?? current?.suggestedCanonical ?? "";

  function resetDraft() {
    setCanonicalDraft(null);
  }

  function handleMergeCurrent() {
    if (!current) return;
    const variants = current.variants.map((v) => v.name);
    if (validateMerge(variants, canonical) !== null) return;
    onMerge(variants, canonical);
    resetDraft();
  }

  function handleSkipCurrent() {
    if (!current) return;
    setSkipped((prev) => new Set(prev).add(current.normalized));
    resetDraft();
  }

  const manualVariants = [manualA, manualB].filter((v) => v.trim() !== "");
  const manualError =
    manualVariants.length < 2
      ? null // don't shout before the user has filled both fields
      : validateMerge(manualVariants, manualCanonical || manualA);
  const manualPlan =
    manualVariants.length === 2 && manualError === null
      ? planMerge(transactions, manualVariants, manualCanonical || manualA)
      : null;

  function handleManualMerge() {
    if (!manualPlan) return;
    onMerge(manualVariants, manualPlan.canonical);
    setManualA("");
    setManualB("");
    setManualCanonical("");
  }

  const currentError = current ? validateMerge(current.variants.map((v) => v.name), canonical) : null;

  return (
    <Sheet open={open} onClose={onClose} title="Tidy up merchants">
      <div class="merge-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "suggested"}
          class={`merge-tabs__tab${mode === "suggested" ? " merge-tabs__tab--active" : ""}`}
          onClick={() => setMode("suggested")}
        >
          Suggested{pending.length > 0 ? ` (${pending.length})` : ""}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          class={`merge-tabs__tab${mode === "manual" ? " merge-tabs__tab--active" : ""}`}
          onClick={() => setMode("manual")}
        >
          Merge manually
        </button>
      </div>

      {mode === "suggested" ? (
        !current ? (
          <div class="merge-empty">
            <p>
              {groups.length === 0
                ? "No duplicate merchant names found."
                : "Nothing left to review."}
            </p>
            <p class="merge-empty__hint">
              Only names that differ by capitalisation or punctuation are suggested here. For
              anything else — like "Kaufland" and "KAUFLAND HAMBURG BRAMF" — use Merge manually.
            </p>
            <button type="button" class="merge-button merge-button--secondary" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <div class="merge-group">
            <p class="merge-group__progress">
              {pending.length} {pending.length === 1 ? "group" : "groups"} to review
            </p>

            <ul class="merge-group__variants">
              {current.variants.map((v) => (
                <li key={v.name}>
                  <span class="merge-group__variant-name">{v.name}</span>
                  <span class="merge-group__variant-count">
                    {v.rowCount} {v.rowCount === 1 ? "row" : "rows"}
                  </span>
                </li>
              ))}
            </ul>

            <TypeBreakdown categoryTypes={current.categoryTypes} />
            {current.touchesCounterpartyRows && <CounterpartyWarning />}

            <label class="merge-group__label">
              Merge into
              <input
                class="merge-group__input"
                type="text"
                value={canonical}
                onInput={(e) => setCanonicalDraft(e.currentTarget.value)}
              />
            </label>
            {currentError && <p class="merge-group__error">{currentError}</p>}

            <p class="merge-group__summary">
              {(() => {
                const plan = planMerge(
                  transactions,
                  current.variants.map((v) => v.name),
                  canonical,
                );
                if (currentError) return "\u00a0";
                return plan.changed.length === 0
                  ? "Every row already uses this name."
                  : `Renames ${plan.changed.length} ${plan.changed.length === 1 ? "row" : "rows"}. Amounts and categories don't change.`;
              })()}
            </p>

            <div class="merge-group__actions">
              <button
                type="button"
                class="merge-button merge-button--secondary"
                onClick={handleSkipCurrent}
              >
                Skip
              </button>
              <button
                type="button"
                class="merge-button merge-button--primary"
                disabled={currentError !== null}
                onClick={handleMergeCurrent}
              >
                Merge
              </button>
            </div>
          </div>
        )
      ) : (
        <div class="merge-manual">
          <p class="merge-manual__hint">
            Pick two names that mean the same merchant. Useful for names the suggestions can't
            safely detect, like "Niemerszein" and "NIEMERSZEIN & CO.KG".
          </p>

          <label class="merge-group__label">
            First name
            <input
              class="merge-group__input"
              type="text"
              list="merge-manual-merchants"
              value={manualA}
              onInput={(e) => setManualA(e.currentTarget.value)}
            />
          </label>
          <label class="merge-group__label">
            Second name
            <input
              class="merge-group__input"
              type="text"
              list="merge-manual-merchants"
              value={manualB}
              onInput={(e) => setManualB(e.currentTarget.value)}
            />
          </label>
          <datalist id="merge-manual-merchants">
            {merchants.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          <label class="merge-group__label">
            Merge into
            <input
              class="merge-group__input"
              type="text"
              placeholder={manualA || "name to keep"}
              value={manualCanonical}
              onInput={(e) => setManualCanonical(e.currentTarget.value)}
            />
          </label>

          {manualError && <p class="merge-group__error">{manualError}</p>}

          {manualPlan && (
            <>
              {(() => {
                // Warn on a manual merge too: the user can reach a
                // counterparty name here that the safe detector never
                // proposes, which is exactly when the warning matters most.
                const touched = new Set(
                  transactions
                    .filter((tx) => manualVariants.includes(tx.merchant.trim()))
                    .map((tx) => tx.categoryType),
                );
                const counterparty = (["non_expense", "non_income", "receivable", "payable"] as const).some(
                  (t) => touched.has(t),
                );
                return counterparty ? <CounterpartyWarning /> : null;
              })()}
              <p class="merge-group__summary">
                {manualPlan.changed.length === 0
                  ? "Nothing to rename — those names are already the same."
                  : `Renames ${manualPlan.changed.length} ${manualPlan.changed.length === 1 ? "row" : "rows"} to "${manualPlan.canonical}".`}
              </p>
            </>
          )}

          <div class="merge-group__actions">
            <button type="button" class="merge-button merge-button--secondary" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              class="merge-button merge-button--primary"
              disabled={!manualPlan || manualPlan.changed.length === 0}
              onClick={handleManualMerge}
            >
              Merge
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Exported for the Settings summary line, so it doesn't re-derive the rule. */
export function countDuplicateMerchantGroups(transactions: Transaction[]): number {
  return findMergeGroups(transactions).length;
}

/** Exported for tests: the normalized form powering the sheet's grouping. */
export { normalizeMerchant };
