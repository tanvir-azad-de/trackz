import { useState } from "preact/hooks";
import { pickerNames } from "@/features/entry/rank";

/**
 * Sentinel <option> value for "+ New…". A NUL character can't appear in a
 * real name (csv.ts parses text fields and nothing in the UI can type one),
 * so this can never collide with a category/merchant/account literally
 * called "+ New…" — matching on the visible label would.
 */
const NEW_VALUE = "\u0000new";

interface NamePickerProps {
  label: string;
  value: string;
  /** Already ranked most-used first (features/entry/rank.ts). */
  ranked: readonly string[];
  onChange: (value: string) => void;
  placeholder: string;
  /** Merchant may be blank ("no counterparty"); category and account may not. */
  allowBlank?: boolean;
}

/**
 * A real dropdown of existing names with "+ New…" last (user decision
 * 2026-11-10). Replaces the free-text <datalist> inputs, which let a typo
 * silently create a near-duplicate name. Creating a new one is still
 * possible, but has to be chosen on purpose.
 */
export function NamePicker({ label, value, ranked, onChange, placeholder, allowBlank = false }: NamePickerProps) {
  const [adding, setAdding] = useState(false);
  const [valueBeforeAdding, setValueBeforeAdding] = useState("");

  if (adding) {
    return (
      <div class="entry-form__field">
        <span class="entry-form__label">{label} (new)</span>
        <div class="entry-form__picker-new">
          <input
            class="entry-form__input"
            value={value}
            onInput={(e) => onChange(e.currentTarget.value)}
            placeholder={placeholder}
            aria-label={`New ${label.toLowerCase()}`}
            autoFocus
          />
          <button
            type="button"
            class="entry-form__picker-back"
            onClick={() => {
              onChange(valueBeforeAdding);
              setAdding(false);
            }}
          >
            List
          </button>
        </div>
      </div>
    );
  }

  const names = pickerNames(value, ranked);
  return (
    <label class="entry-form__field">
      <span class="entry-form__label">{label}</span>
      <select
        class="entry-form__input"
        value={value.trim()}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (next === NEW_VALUE) {
            setValueBeforeAdding(value);
            onChange("");
            setAdding(true);
          } else {
            onChange(next);
          }
        }}
      >
        <option value="" disabled={!allowBlank}>
          {allowBlank ? "None" : "Choose…"}
        </option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={NEW_VALUE}>+ New…</option>
      </select>
    </label>
  );
}
