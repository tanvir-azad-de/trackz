import { CATEGORY_TYPES, categoryTypeLabel } from "@/domain/transaction";
import type { Account, Category, Merchant } from "@/domain/transaction";
import type { EntryDraft } from "@/features/entry/draft";
import { entryToDisplay, type AmountEntry } from "@/features/entry/amount";
import type { Cents } from "@/domain/money";
import { centsToFixed, toCents } from "@/domain/money";
import { NamePicker } from "./NamePicker";

interface EntryFormProps {
  amount: AmountEntry;
  draft: EntryDraft;
  onChange: (next: EntryDraft) => void;
  /** These three must arrive RANKED most-used first (features/entry/rank.ts) — the pickers show them in the order given. */
  accounts: readonly Account[];
  categories: readonly Category[];
  merchants: readonly Merchant[];
  errors: string[];
  onSave: () => void;
  /** Defaults to "Save" — the Activity detail sheet (Phase 11) passes "Save changes" instead. */
  saveLabel?: string;
  /**
   * When provided, the amount preview becomes an editable decimal input
   * instead of a read-only display of the keypad's current value. The
   * quick-entry sheet (Phase 8) doesn't pass this — by the time its form
   * mode opens, the amount was already locked in on the keypad, and
   * re-editing it there would need a second ATM-accumulator UI. The
   * Activity detail sheet (Phase 11) does pass it, since editing the
   * amount of an existing transaction has no keypad step to go back to.
   */
  onAmountChange?: (cents: Cents) => void;
}

/**
 * The full entry form: the second step of Add transaction (after "Next")
 * and the Activity detail sheet's edit form. Category / Merchant / Account
 * are NamePicker dropdowns with "+ New…" (user decision 2026-11-10), not
 * free text.
 */
export function EntryForm({
  amount,
  draft,
  onChange,
  accounts,
  categories,
  merchants,
  errors,
  onSave,
  saveLabel = "Save",
  onAmountChange,
}: EntryFormProps) {
  function set<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  const categoryNames = categories.map((c) => c.name);
  const merchantNames = merchants.map((m) => m.name);
  const accountNames = accounts.map((a) => a.name);

  const isTransfer = draft.categoryType === "transfer";
  const isBidirectional = draft.categoryType === "receivable" || draft.categoryType === "payable";

  return (
    <div class="entry-form">
      {onAmountChange ? (
        <label class="entry-form__amount-preview entry-form__amount-preview--editable">
          <Euro />
          <input
            class="entry-form__amount-input"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={centsToFixed(draft.amountCents)}
            onInput={(e) => {
              const value = e.currentTarget.value;
              if (value === "") return;
              onAmountChange(toCents(value));
            }}
          />
        </label>
      ) : (
        <div class="entry-form__amount-preview">
          <Euro /> <span class="tnum">{entryToDisplay(amount)}</span>
        </div>
      )}

      <label class="entry-form__field">
        <span class="entry-form__label">Type</span>
        <select
          class="entry-form__input"
          value={draft.categoryType}
          onChange={(e) => set("categoryType", e.currentTarget.value as EntryDraft["categoryType"])}
        >
          {CATEGORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {categoryTypeLabel(t)}
            </option>
          ))}
        </select>
      </label>

      {isBidirectional && (
        <div class="entry-form__field">
          <span class="entry-form__label">Direction</span>
          <div class="entry-form__toggle">
            <button
              type="button"
              class={`entry-form__toggle-btn ${draft.direction === "out" ? "entry-form__toggle-btn--active" : ""}`}
              onClick={() => set("direction", "out")}
            >
              {draft.categoryType === "receivable" ? "Lending out" : "Borrowing"}
            </button>
            <button
              type="button"
              class={`entry-form__toggle-btn ${draft.direction === "in" ? "entry-form__toggle-btn--active" : ""}`}
              onClick={() => set("direction", "in")}
            >
              {draft.categoryType === "receivable" ? "Getting repaid" : "Repaying"}
            </button>
          </div>
        </div>
      )}

      <NamePicker
        label="Category"
        value={draft.category}
        ranked={categoryNames}
        onChange={(v) => set("category", v)}
        placeholder="e.g. Groceries"
      />

      {!isTransfer && (
        <NamePicker
          label="Merchant"
          value={draft.merchant}
          ranked={merchantNames}
          onChange={(v) => set("merchant", v)}
          placeholder="e.g. Edeka"
          allowBlank
        />
      )}

      <NamePicker
        label={isTransfer ? "From account" : "Account"}
        value={draft.account}
        ranked={accountNames}
        onChange={(v) => set("account", v)}
        placeholder="e.g. ADVZ"
      />

      {isTransfer && (
        <NamePicker
          label="To account"
          value={draft.destinationAccount}
          ranked={accountNames}
          onChange={(v) => set("destinationAccount", v)}
          placeholder="e.g. REVO"
        />
      )}

      <label class="entry-form__field">
        <span class="entry-form__label">Date</span>
        <input
          class="entry-form__input"
          type="date"
          value={draft.date}
          onInput={(e) => set("date", e.currentTarget.value)}
        />
      </label>

      <label class="entry-form__field">
        <span class="entry-form__label">Notes</span>
        <input
          class="entry-form__input"
          value={draft.notes}
          onInput={(e) => set("notes", e.currentTarget.value)}
          placeholder="Optional"
        />
      </label>

      {errors.length > 0 && (
        <ul class="entry-form__errors">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <button type="button" class="entry-form__save" onClick={onSave} disabled={errors.length > 0}>
        {saveLabel}
      </button>
    </div>
  );
}

function Euro() {
  return <span aria-hidden="true">€</span>;
}
