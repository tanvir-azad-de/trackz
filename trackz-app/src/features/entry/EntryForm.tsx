import { CATEGORY_TYPES, categoryTypeLabel } from "@/domain/transaction";
import type { Account, Category, Merchant } from "@/domain/transaction";
import type { EntryDraft } from "@/features/entry/draft";
import { entryToDisplay, type AmountEntry } from "@/features/entry/amount";

interface EntryFormProps {
  amount: AmountEntry;
  draft: EntryDraft;
  onChange: (next: EntryDraft) => void;
  accounts: readonly Account[];
  categories: readonly Category[];
  merchants: readonly Merchant[];
  errors: string[];
  onSave: () => void;
}

/**
 * The manual-entry fallback for a combo that has no history yet — without
 * this, a brand-new category/merchant/account is literally unenterable,
 * since Activity/Settings (where you might otherwise add one) are still
 * placeholders (Phase 11/13). Free-text + <datalist> autocomplete now;
 * Phase 6's merchant similarity/merge screen replaces this with something
 * smarter later, this is not the final merchant UI.
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
}: EntryFormProps) {
  function set<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  const isTransfer = draft.categoryType === "transfer";
  const isBidirectional = draft.categoryType === "receivable" || draft.categoryType === "payable";

  return (
    <div class="entry-form">
      <div class="entry-form__amount-preview">
        <Euro /> <span class="tnum">{entryToDisplay(amount)}</span>
      </div>

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

      <label class="entry-form__field">
        <span class="entry-form__label">Category</span>
        <input
          class="entry-form__input"
          list="entry-form-categories"
          value={draft.category}
          onInput={(e) => set("category", e.currentTarget.value)}
          placeholder="e.g. Groceries"
        />
        <datalist id="entry-form-categories">
          {categories.map((c) => (
            <option key={c.name} value={c.name} />
          ))}
        </datalist>
      </label>

      {!isTransfer && (
        <label class="entry-form__field">
          <span class="entry-form__label">Merchant</span>
          <input
            class="entry-form__input"
            list="entry-form-merchants"
            value={draft.merchant}
            onInput={(e) => set("merchant", e.currentTarget.value)}
            placeholder="e.g. Edeka"
          />
          <datalist id="entry-form-merchants">
            {merchants.map((m) => (
              <option key={m.name} value={m.name} />
            ))}
          </datalist>
        </label>
      )}

      <label class="entry-form__field">
        <span class="entry-form__label">{isTransfer ? "From account" : "Account"}</span>
        <input
          class="entry-form__input"
          list="entry-form-accounts"
          value={draft.account}
          onInput={(e) => set("account", e.currentTarget.value)}
          placeholder="e.g. ADVZ"
        />
        <datalist id="entry-form-accounts">
          {accounts.map((a) => (
            <option key={a.name} value={a.name} />
          ))}
        </datalist>
      </label>

      {isTransfer && (
        <label class="entry-form__field">
          <span class="entry-form__label">To account</span>
          <input
            class="entry-form__input"
            list="entry-form-accounts"
            value={draft.destinationAccount}
            onInput={(e) => set("destinationAccount", e.currentTarget.value)}
            placeholder="e.g. REVO"
          />
        </label>
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
        Save
      </button>
    </div>
  );
}

function Euro() {
  return <span aria-hidden="true">€</span>;
}
