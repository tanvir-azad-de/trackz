import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Sheet } from "@/components/Sheet";
import { Delete, X } from "@/components/icons";
import { formatDayLabel, getLocalToday, isValidISODate, shiftDays } from "@/domain/dates";
import { ACCOUNT_TYPES, CATEGORY_TYPES, accountTypeLabel, categoryTypeLabel } from "@/domain/transaction";
import type { Account, AccountType, Category } from "@/domain/transaction";
import type { EntryDraft } from "@/features/entry/draft";
import { amountFromCents, appendDigit, deleteDigit, emptyAmount, entryToCents, entryToDisplay } from "@/features/entry/amount";
import type { AmountEntry } from "@/features/entry/amount";
import { directionLabel, entryTiles, tileLabel, type TileKey } from "@/features/entry/entryLayout";
import { merchantInScope, merchantsFor, pickerNames, sortedByLabel } from "@/features/entry/pickerOptions";
import type { MerchantOptions } from "@/features/entry/pickerOptions";
import "@/components/Sheet.css";
import "./EntryScreen.css";

// Alphabetical by visible label, like every other list on this screen.
const TYPE_OPTIONS = sortedByLabel(CATEGORY_TYPES, categoryTypeLabel);
const ACCOUNT_TYPE_OPTIONS = sortedByLabel(ACCOUNT_TYPES, accountTypeLabel);

type KeypadKey = { kind: "digit"; digit: string } | { kind: "clear" } | { kind: "delete" };
const digitKey = (d: string): KeypadKey => ({ kind: "digit", digit: d });
/** Row-major 3x4. Routed on `kind`, never on the glyph drawn (the old keypad's lesson, keypadKeys.ts). */
const KEYPAD_KEYS: readonly KeypadKey[] = [
  ..."123456789".split("").map(digitKey),
  { kind: "clear" },
  digitKey("0"),
  { kind: "delete" },
];

/** The fields that take typed text, in the top panel. */
type TextTarget = "notes" | "account" | "destination" | "category" | "merchant";
interface TextEdit {
  target: TextTarget;
  value: string;
  accountType: AccountType;
}

/** What fills the dock under the tiles. */
type DockMode = "keypad" | Exclude<TileKey, "notes">;

interface EntryScreenProps {
  open: boolean;
  title: string;
  draft: EntryDraft;
  onChange: (next: EntryDraft) => void;
  /** From features/entry/pickerOptions.ts, already alphabetical. */
  accounts: readonly Account[];
  categories: readonly Category[];
  merchants: MerchantOptions;
  saveLabel: string;
  canSave: boolean;
  onSave: () => void;
  onClose: () => void;
  /** Edit's Delete row, between the tiles and the dock at a fixed height. */
  actions?: ComponentChildren;
  /** Remounts the body (amount digits, dock mode) when a different row opens. */
  bodyKey?: string;
}

/**
 * The ONE transaction screen, shared by Add (EntrySheet) and Activity's
 * edit (TransactionDetailSheet). User decision 2026-11-15, option B of
 * docs/mockups/entry-form-no-shift.html, replacing the 2-column EntryForm.
 *
 * Built so the layout never moves (renovation doc section 5 "ENTRY
 * SCREEN"):
 *   - Full height, every block a fixed size except the dock, which takes
 *     what is left. Nothing on the screen changes size while it is open.
 *   - The amount is an in-app ATM keypad (amount.ts), not an input, so the
 *     common path never raises the iOS keyboard and iOS never pans.
 *   - Pickers replace the keypad INSIDE the dock, in the same box.
 *   - Note and "+ New" are the only typed text. They use one input at the
 *     TOP of the screen, so the keyboard covers empty space and iOS has no
 *     reason to scroll the field into view.
 */
export function EntryScreen(props: EntryScreenProps) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.title} class="entry-sheet">
      <EntryBody key={props.bodyKey} {...props} />
    </Sheet>
  );
}

function EntryBody({
  title,
  draft,
  onChange,
  accounts,
  categories,
  merchants,
  saveLabel,
  canSave,
  onSave,
  onClose,
  actions,
}: EntryScreenProps) {
  // Seeded once: the body remounts with each open (Sheet renders nothing
  // while closed) and per row in Edit (bodyKey).
  const [amount, setAmount] = useState<AmountEntry>(() =>
    draft.amountCents > 0 ? amountFromCents(draft.amountCents) : emptyAmount(),
  );
  const [dock, setDock] = useState<DockMode>("keypad");
  const [text, setTextState] = useState<TextEdit | null>(null);
  // Mirrors `text` for the input's blur handler, which can fire between a
  // setState and the re-render that would hand it the new closure.
  const textNow = useRef<TextEdit | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The latest props for the keydown listener, registered once.
  const latest = useRef({ draft, onChange, amount });
  latest.current = { draft, onChange, amount };

  function setText(next: TextEdit | null) {
    textNow.current = next;
    setTextState(next);
  }

  function set<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  // Category and Type decide the Merchant list, so changing either drops a
  // merchant the new list doesn't offer (merchantInScope).
  function setScope(patch: Pick<Partial<EntryDraft>, "category" | "categoryType">) {
    const next = { ...draft, ...patch };
    onChange({ ...next, merchant: merchantInScope(next.merchant, merchants, next.category, next.categoryType) });
  }

  function applyAmount(next: AmountEntry) {
    const { draft: d, onChange: change } = latest.current;
    setAmount(next);
    change({ ...d, amountCents: entryToCents(next) });
  }

  // A hardware keyboard (desktop, an iPad keyboard) types into the keypad
  // too. Ignored while the text panel has focus, which owns its own keys.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (textNow.current || e.metaKey || e.ctrlKey || e.altKey) return;
      // The date input owns its own digits.
      if (e.target instanceof HTMLInputElement) return;
      const current = latest.current.amount;
      if (/^[0-9]$/.test(e.key)) applyAmount(appendDigit(current, e.key));
      else if (e.key === "Backspace") applyAmount(deleteDigit(current));
      else return;
      e.preventDefault();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const accountNames = accounts.map((a) => a.name);
  const isNewAccount = (name: string) => name.trim() !== "" && !accountNames.includes(name.trim());
  const today = getLocalToday();

  /**
   * Load-bearing: focus() runs synchronously inside the tap. iOS raises the
   * keyboard only for a focus made during a user gesture; focusing from an
   * effect after the re-render (autoFocus included) would leave the input
   * focused with no keyboard. That is why the input is always mounted,
   * transparent until opened, instead of rendered on demand.
   */
  function openText(target: TextTarget, value: string, accountType: AccountType = "cash") {
    const input = inputRef.current;
    if (input) {
      input.value = value;
      input.focus();
    }
    setText({ target, value, accountType });
  }

  function commitText() {
    const edit = textNow.current;
    if (!edit) return;
    setText(null);
    setDock("keypad");
    const name = edit.value.trim();
    if (edit.target === "notes") return set("notes", edit.value);
    // A blank "+ New" keeps whatever was chosen before.
    if (name === "") return;
    if (edit.target === "category") return setScope({ category: name });
    if (edit.target === "merchant") return set("merchant", name);
    if (edit.target === "account") return onChange({ ...draft, account: name, accountType: edit.accountType });
    onChange({ ...draft, destinationAccount: name, destinationAccountType: edit.accountType });
  }

  function cancelText() {
    setText(null);
    inputRef.current?.blur();
  }

  function doneText() {
    commitText();
    inputRef.current?.blur();
  }

  function toggleDock(mode: DockMode) {
    setDock(dock === mode ? "keypad" : mode);
  }

  const tiles = entryTiles(draft.categoryType);

  function tileValue(tile: TileKey): { value: string; empty: boolean } {
    switch (tile) {
      case "type":
        return { value: categoryTypeLabel(draft.categoryType), empty: false };
      case "date":
        return { value: isValidISODate(draft.date) ? formatDayLabel(draft.date, today) : "Choose", empty: false };
      case "account":
        return named(draft.account, "Choose");
      case "destination":
        return named(draft.destinationAccount, "Choose");
      case "category":
        return named(draft.category, "Choose");
      case "merchant":
        return named(draft.merchant, "None");
      case "direction":
        return { value: directionLabel(draft.categoryType, draft.direction), empty: false };
      case "notes":
        return named(draft.notes, "Add");
    }
  }

  function tileSub(tile: TileKey): string | null {
    if (tile === "account" && isNewAccount(draft.account)) return accountTypeLabel(draft.accountType ?? "cash");
    if (tile === "destination" && isNewAccount(draft.destinationAccount)) {
      return accountTypeLabel(draft.destinationAccountType ?? "cash");
    }
    return null;
  }

  return (
    <div class="entry">
      <div class="entry__header">
        <button type="button" class="entry__close" onClick={onClose} aria-label="Close">
          <X size="1em" />
        </button>
        <h2 class="entry__title">{title}</h2>
        <button type="button" class="entry-form__save entry__save" onClick={onSave} disabled={!canSave}>
          {saveLabel}
        </button>
      </div>

      <button
        type="button"
        class={`entry__amount tnum ${dock === "keypad" ? "entry__amount--active" : ""}`}
        onClick={() => setDock("keypad")}
        aria-label="Amount"
      >
        <span class="entry__amount-currency" aria-hidden="true">
          €
        </span>
        <span class={amount.digits === "" ? "entry__amount-value entry__amount-value--empty" : "entry__amount-value"}>
          {entryToDisplay(amount)}
        </span>
      </button>

      <div class="entry__tiles">
        {tiles.map((tile) => {
          const { value, empty } = tileValue(tile);
          const sub = tileSub(tile);
          const active = dock === tile;
          return (
            <button
              key={tile}
              type="button"
              class={`entry__tile ${active ? "entry__tile--active" : ""}`}
              aria-pressed={active}
              onClick={() => (tile === "notes" ? openText("notes", draft.notes) : toggleDock(tile))}
            >
              <span class="entry__tile-label">
                {tileLabel(tile, draft.categoryType)}
                {sub && <span class="entry__tile-sub"> · new, {sub}</span>}
              </span>
              <span class={empty ? "entry__tile-value entry__tile-value--empty" : "entry__tile-value"}>{value}</span>
            </button>
          );
        })}
      </div>

      {actions && <div class="entry__actions">{actions}</div>}

      <div class="entry__dock">
        {dock === "keypad" ? (
          <div class="entry__keypad">
            {KEYPAD_KEYS.map((key) => {
              if (key.kind === "digit") {
                return (
                  <button
                    key={key.digit}
                    type="button"
                    class="entry__key"
                    onClick={() => applyAmount(appendDigit(amount, key.digit))}
                  >
                    {key.digit}
                  </button>
                );
              }
              if (key.kind === "clear") {
                return (
                  <button
                    key="clear"
                    type="button"
                    class="entry__key entry__key--fn"
                    onClick={() => applyAmount(emptyAmount())}
                    aria-label="Clear amount"
                  >
                    C
                  </button>
                );
              }
              return (
                <button
                  key="delete"
                  type="button"
                  class="entry__key entry__key--fn"
                  onClick={() => applyAmount(deleteDigit(amount))}
                  aria-label="Delete last digit"
                >
                  <Delete size="1em" />
                </button>
              );
            })}
          </div>
        ) : dock === "date" ? (
          <DatePanel date={draft.date} today={today} onPick={(d) => set("date", d)} onDone={() => setDock("keypad")} />
        ) : (
          <PickerPanel
            label={tileLabel(dock, draft.categoryType)}
            onDone={() => setDock("keypad")}
            wide={dock === "merchant"}
            options={pickerOptions(dock)}
          />
        )}
      </div>

      <TextPanel
        edit={text}
        inputRef={inputRef}
        label={text ? textLabel(text.target) : ""}
        showsAccountType={text !== null && (text.target === "account" || text.target === "destination")}
        onInput={(value) => text && setText({ ...text, value })}
        onAccountType={(accountType) => text && setText({ ...text, accountType })}
        onBlur={commitText}
        onCancel={cancelText}
        onDone={doneText}
      />
    </div>
  );

  function textLabel(target: TextTarget): string {
    if (target === "notes") return "Note";
    // Not tileLabel: Transfer's "From" / "To" would read "New to".
    if (target === "account" || target === "destination") return "New account";
    return target === "category" ? "New category" : "New merchant";
  }

  function pickerOptions(tile: Exclude<DockMode, "keypad" | "date">): PickerOption[] {
    const pick = (fn: () => void) => () => {
      fn();
      setDock("keypad");
    };
    const names = (current: string, list: readonly string[], onPick: (name: string) => void): PickerOption[] =>
      pickerNames(current, list).map((name) => ({
        key: name,
        label: name,
        selected: name === current.trim(),
        onPick: pick(() => onPick(name)),
      }));
    const addNew = (target: TextTarget): PickerOption => ({
      key: "\u0000new",
      label: "+ New",
      selected: false,
      isNew: true,
      // Not wrapped in pick(): the dock stays on this list behind the text
      // panel, so Cancel lands back where the user was.
      onPick: () => openText(target, ""),
    });
    switch (tile) {
      case "type":
        return TYPE_OPTIONS.map((t) => ({
          key: t,
          label: categoryTypeLabel(t),
          selected: t === draft.categoryType,
          onPick: pick(() => setScope({ categoryType: t })),
        }));
      case "direction":
        return (["out", "in"] as const).map((d) => ({
          key: d,
          label: directionLabel(draft.categoryType, d),
          selected: d === draft.direction,
          onPick: pick(() => set("direction", d)),
        }));
      case "account":
        return [...names(draft.account, accountNames, (n) => set("account", n)), addNew("account")];
      case "destination":
        return [...names(draft.destinationAccount, accountNames, (n) => set("destinationAccount", n)), addNew("destination")];
      case "category":
        return [...names(draft.category, categories.map((c) => c.name), (n) => setScope({ category: n })), addNew("category")];
      case "merchant":
        return [
          {
            key: "\u0000none",
            label: "None",
            selected: draft.merchant.trim() === "",
            onPick: pick(() => set("merchant", "")),
          },
          ...names(draft.merchant, merchantsFor(merchants, draft.category, draft.categoryType), (n) => set("merchant", n)),
          addNew("merchant"),
        ];
    }
  }
}

function named(value: string, placeholder: string): { value: string; empty: boolean } {
  return value.trim() === "" ? { value: placeholder, empty: true } : { value, empty: false };
}

interface PickerOption {
  key: string;
  label: string;
  selected: boolean;
  isNew?: boolean;
  onPick: () => void;
}

function PickerPanel({
  label,
  options,
  wide,
  onDone,
}: {
  label: string;
  options: PickerOption[];
  wide: boolean;
  onDone: () => void;
}) {
  return (
    <div class="entry__panel">
      <div class="entry__panel-head">
        <span>{label}</span>
        <button type="button" class="entry__panel-done" onClick={onDone}>
          Keypad
        </button>
      </div>
      <div class={`entry__options ${wide ? "entry__options--wide" : ""}`}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            class={`entry__option ${o.selected ? "entry__option--selected" : ""} ${o.isNew ? "entry__option--new" : ""}`}
            aria-pressed={o.selected}
            onClick={o.onPick}
          >
            <span class="entry__option-text">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DatePanel({
  date,
  today,
  onPick,
  onDone,
}: {
  date: string;
  today: string;
  onPick: (date: string) => void;
  onDone: () => void;
}) {
  const valid = isValidISODate(date);
  const base = valid ? date : today;
  const yesterday = shiftDays(today, -1);
  return (
    <div class="entry__panel">
      <div class="entry__panel-head">
        <span>Date</span>
        <button type="button" class="entry__panel-done" onClick={onDone}>
          Keypad
        </button>
      </div>
      <div class="entry__date">
        <div class="entry__date-step">
          <button type="button" class="entry__option" onClick={() => onPick(shiftDays(base, -1))} aria-label="Previous day">
            ‹
          </button>
          <span class="entry__date-current">{valid ? formatDayLabel(date, today) : "No date"}</span>
          <button type="button" class="entry__option" onClick={() => onPick(shiftDays(base, 1))} aria-label="Next day">
            ›
          </button>
        </div>
        <div class="entry__date-quick">
          <button
            type="button"
            class={`entry__option ${date === yesterday ? "entry__option--selected" : ""}`}
            onClick={() => onPick(yesterday)}
          >
            Yesterday
          </button>
          <button
            type="button"
            class={`entry__option ${date === today ? "entry__option--selected" : ""}`}
            onClick={() => onPick(today)}
          >
            Today
          </button>
        </div>
        {/* The native date picker, as a transparent input stretched over a
            button-looking label: iOS opens its own calendar popover, which
            raises no keyboard and shifts nothing. */}
        <label class="entry__option entry__date-pick">
          Pick a date
          <input
            type="date"
            class="entry__date-input"
            value={valid ? date : ""}
            // Load-bearing on desktop Chrome: a click on a date input's
            // text only focuses its day/month/year segments, and the picker
            // opens from the calendar icon alone, which opacity:0 hides.
            // iOS opens its picker on tap either way. Try/catch: showPicker
            // throws on browsers without it, and without a user gesture.
            onClick={(e) => {
              try {
                e.currentTarget.showPicker();
              } catch {
                // The native tap behaviour still applies.
              }
            }}
            onInput={(e) => {
              const next = e.currentTarget.value;
              if (isValidISODate(next)) onPick(next);
            }}
            aria-label="Pick a date"
          />
        </label>
      </div>
    </div>
  );
}

function TextPanel({
  edit,
  inputRef,
  label,
  showsAccountType,
  onInput,
  onAccountType,
  onBlur,
  onCancel,
  onDone,
}: {
  edit: TextEdit | null;
  inputRef: { current: HTMLInputElement | null };
  label: string;
  showsAccountType: boolean;
  onInput: (value: string) => void;
  onAccountType: (t: AccountType) => void;
  onBlur: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  // Buttons here must not take focus from the input: a blur would commit
  // first, then Cancel would have nothing left to cancel.
  const keepFocus = (e: Event) => e.preventDefault();
  return (
    <div class={`entry__text ${edit ? "entry__text--open" : ""}`} aria-hidden={!edit}>
      <span class="entry__text-label">{label}</span>
      <input
        ref={inputRef}
        class="entry__text-input"
        value={edit?.value ?? ""}
        tabIndex={edit ? 0 : -1}
        autoComplete="off"
        enterKeyHint="done"
        placeholder={edit?.target === "notes" ? "Optional" : "Name"}
        onInput={(e) => onInput(e.currentTarget.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone();
          if (e.key === "Escape") {
            // The Sheet's own Escape would close the whole screen.
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {showsAccountType && edit && (
        <div class="entry__text-types">
          {ACCOUNT_TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              class={`entry__option ${edit.accountType === t ? "entry__option--selected" : ""}`}
              onPointerDown={keepFocus}
              onClick={() => onAccountType(t)}
            >
              {accountTypeLabel(t)}
            </button>
          ))}
        </div>
      )}
      <div class="entry__text-actions">
        <button type="button" class="entry__option" onPointerDown={keepFocus} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" class="entry-form__save" onPointerDown={keepFocus} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
