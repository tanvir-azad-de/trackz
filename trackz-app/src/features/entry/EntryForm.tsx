import { useState } from "preact/hooks";
import { ACCOUNT_TYPES, CATEGORY_TYPES, accountTypeLabel, categoryTypeLabel, usesCategory } from "@/domain/transaction";
import type { Account, AccountType, Category, Merchant } from "@/domain/transaction";
import type { EntryDraft } from "@/features/entry/draft";
import { amountInputFromCents, parseAmountInput } from "@/features/entry/amountInput";
import { NamePicker } from "./NamePicker";
import { SelectInput } from "./SelectInput";

interface EntryFormProps {
  draft: EntryDraft;
  onChange: (next: EntryDraft) => void;
  /** These three must arrive RANKED most-used first (features/entry/rank.ts) — the pickers show them in the order given. */
  accounts: readonly Account[];
  categories: readonly Category[];
  merchants: readonly Merchant[];
  errors: string[];
}

/**
 * The ONE transaction form, shared by Add transaction (EntrySheet) and
 * Activity's edit sheet (TransactionDetailSheet) — user decision
 * 2026-11-10, which removed the keypad step. Fields only: each caller puts
 * its own CTAs in the Sheet footer, so they stay pinned.
 *
 * A 2-column grid, so the common case is 4 rows and the sheet needs no
 * scroll: Amount|Date, Type|Account, Category|Merchant, Notes. Category
 * is hidden for the types that carry none (domain usesCategory): Transfer
 * shows To account alone in row 3, and Lent out / I owe show Merchant
 * (the person) alone, plus a full-width Direction row.
 */
export function EntryForm({ draft, onChange, accounts, categories, merchants, errors }: EntryFormProps) {
  // The raw text, not the parsed cents: re-deriving the field from
  // amountCents on every keystroke would turn a half-typed "12," into
  // "12,00" under the cursor. The form remounts with each sheet open
  // (Sheet renders nothing while closed), so this never goes stale.
  const [amountText, setAmountText] = useState(() => amountInputFromCents(draft.amountCents));

  function set<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  const categoryNames = categories.map((c) => c.name);
  const merchantNames = merchants.map((m) => m.name);
  const accountNames = accounts.map((a) => a.name);

  const isTransfer = draft.categoryType === "transfer";
  const showsCategory = usesCategory(draft.categoryType);
  const isBidirectional = draft.categoryType === "receivable" || draft.categoryType === "payable";
  // Only a brand-new account gets a type picker (user decision 2026-11-11);
  // an existing one's type is the CSV's and is not editable here.
  const isNewName = (name: string) => name.trim() !== "" && !accountNames.includes(name.trim());
  const accountIsNew = isNewName(draft.account);
  const destinationIsNew = isTransfer && isNewName(draft.destinationAccount);

  return (
    <div class="entry-form">
      <label class="entry-form__field">
        <span class="entry-form__label">Amount</span>
        <span class="entry-form__amount">
          <span class="entry-form__amount-currency" aria-hidden="true">
            €
          </span>
          <input
            class="entry-form__input entry-form__amount-input tnum"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={amountText}
            onInput={(e) => {
              const text = e.currentTarget.value;
              setAmountText(text);
              // Unparseable text saves as 0, which validateDraft already
              // blocks ("Enter an amount greater than 0") — so a typo can
              // disable Save but never store a wrong amount.
              set("amountCents", parseAmountInput(text) ?? 0);
            }}
          />
        </span>
      </label>

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
        <span class="entry-form__label">Type</span>
        <SelectInput
          value={draft.categoryType}
          onChange={(e) => set("categoryType", e.currentTarget.value as EntryDraft["categoryType"])}
        >
          {CATEGORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {categoryTypeLabel(t)}
            </option>
          ))}
        </SelectInput>
      </label>

      <NamePicker
        label={isTransfer ? "From account" : "Account"}
        value={draft.account}
        ranked={accountNames}
        onChange={(v) => set("account", v)}
        placeholder="e.g. ADVZ"
      />

      {accountIsNew && (
        <AccountTypeField
          label={isTransfer ? "From account type" : "Account type"}
          value={draft.accountType ?? "cash"}
          onChange={(t) => set("accountType", t)}
        />
      )}

      {showsCategory && (
        <NamePicker
          label="Category"
          value={draft.category}
          ranked={categoryNames}
          onChange={(v) => set("category", v)}
          placeholder="e.g. Groceries"
        />
      )}

      {/* Full width when Category is hidden, so the row doesn't end in a gap. */}
      <div class={showsCategory ? "entry-form__cell" : "entry-form__full"}>
        {isTransfer ? (
          <NamePicker
            label="To account"
            value={draft.destinationAccount}
            ranked={accountNames}
            onChange={(v) => set("destinationAccount", v)}
            placeholder="e.g. REVO"
          />
        ) : (
          <NamePicker
            label="Merchant"
            value={draft.merchant}
            ranked={merchantNames}
            onChange={(v) => set("merchant", v)}
            placeholder="e.g. Edeka"
            allowBlank
          />
        )}
      </div>

      {destinationIsNew && (
        <AccountTypeField
          label="To account type"
          value={draft.destinationAccountType ?? "cash"}
          onChange={(t) => set("destinationAccountType", t)}
        />
      )}

      {isBidirectional && (
        <div class="entry-form__field entry-form__full">
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

      <label class="entry-form__field entry-form__full">
        <span class="entry-form__label">Notes</span>
        <input
          class="entry-form__input"
          value={draft.notes}
          onInput={(e) => set("notes", e.currentTarget.value)}
          placeholder="Optional"
        />
      </label>

      {/* Hidden while the amount is still blank: a fresh Add sheet would
          otherwise open on a red "Enter an amount" before anything was
          typed. Save stays disabled either way (the caller checks
          errors, not this list), and once the amount is typed every
          remaining problem shows. Not filtered by message text, which
          would break silently the day validateDraft rewords it. */}
      {errors.length > 0 && amountText.trim() !== "" && (
        <ul class="entry-form__errors entry-form__full">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Full width, so the two-column rows around it keep their pairs. */
function AccountTypeField({ label, value, onChange }: { label: string; value: AccountType; onChange: (t: AccountType) => void }) {
  return (
    <label class="entry-form__field entry-form__full">
      <span class="entry-form__label">{label}</span>
      <SelectInput value={value} onChange={(e) => onChange(e.currentTarget.value as AccountType)}>
        {ACCOUNT_TYPES.map((t) => (
          <option key={t} value={t}>
            {accountTypeLabel(t)}
          </option>
        ))}
      </SelectInput>
    </label>
  );
}
