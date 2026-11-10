import { useMemo, useState } from "preact/hooks";
import { Sheet } from "@/components/Sheet";
import { getLocalToday } from "@/domain/dates";
import { addTransaction } from "@/storage/repository";
import { loadRememberedEntry, saveRememberedEntry } from "@/storage/entryMemory";
import {
  appendDigit,
  clearAmount,
  deleteDigit,
  emptyAmount,
  entryToCents,
  entryToDisplay,
  isEmptyAmount,
  type AmountEntry,
} from "@/features/entry/amount";
import { rankAccounts, rankCategories, rankMerchants } from "@/features/entry/rank";
import { buildTransaction, validateDraft, type EntryDraft } from "@/features/entry/draft";
import { draftFromRemembered, rememberFromTransaction } from "@/features/entry/lastUsed";
import { Keypad } from "./Keypad";
import { EntryForm } from "./EntryForm";
import type { Transaction } from "@/domain/transaction";
import { formatEUR } from "@/domain/money";
import "@/components/Sheet.css";
import "./Keypad.css";
import "./EntryForm.css";
import "./EntrySheet.css";

interface EntrySheetProps {
  open: boolean;
  transactions: Transaction[];
  onClose: () => void;
  /** Fires right after a transaction is saved, so the caller can show an undo toast. */
  onSaved: (tx: Transaction) => void;
}

type Mode = "keypad" | "form";

/**
 * Add transaction, two steps (user decision 2026-11-10, renovation doc
 * section 5 "ENTRY FORM REWORK", superseding Phase 8's recall-chip 3-tap
 * path): amount + keypad + date, then "Next" to the full form, which is the
 * ONLY save path. The draft is seeded from the last saved transaction
 * (every field but the amount, date included), so a repeat entry is
 * amount -> Next -> Save.
 */
export function EntrySheet({ open, transactions, onClose, onSaved }: EntrySheetProps) {
  const [mode, setMode] = useState<Mode>("keypad");
  const [amount, setAmount] = useState<AmountEntry>(emptyAmount());
  const [draft, setDraft] = useState<EntryDraft>(() => draftFromRemembered(loadRememberedEntry(), getLocalToday()));

  const today = getLocalToday();

  const accounts = useMemo(() => rankAccounts(transactions, today), [transactions, today]);
  const categories = useMemo(() => rankCategories(transactions, today), [transactions, today]);
  const merchants = useMemo(() => rankMerchants(transactions, today), [transactions, today]);

  function reset() {
    setMode("keypad");
    setAmount(emptyAmount());
    // Re-read rather than keep the closed draft: closing without saving
    // discards edits, and after a save this picks up what was just stored.
    setDraft(draftFromRemembered(loadRememberedEntry(), getLocalToday()));
  }

  function handleClose() {
    reset();
    onClose();
  }

  function goToForm() {
    setDraft((d) => ({ ...d, amountCents: entryToCents(amount) }));
    setMode("form");
  }

  function handleFormSave() {
    const tx = buildTransaction(draft);
    addTransaction(tx);
    // Before handleClose, whose reset() reads this back as the next draft.
    saveRememberedEntry(rememberFromTransaction(tx));
    handleClose();
    onSaved(tx);
  }

  const formErrors = mode === "form" ? validateDraft(draft, accounts) : [];

  return (
    <Sheet open={open} onClose={handleClose} title={mode === "keypad" ? "Add transaction" : "Transaction details"}>
      {mode === "keypad" ? (
        <div class="entry-sheet">
          <div class="entry-sheet__amount">
            <span class="entry-sheet__currency">€</span>
            <span class="tnum">{entryToDisplay(amount)}</span>
            {!isEmptyAmount(amount) && (
              <button type="button" class="entry-sheet__clear" onClick={() => setAmount(clearAmount())} aria-label="Clear amount">
                ✕
              </button>
            )}
          </div>

          <Keypad onDigit={(d) => setAmount((a) => appendDigit(a, d))} onDelete={() => setAmount((a) => deleteDigit(a))} />

          <label class="entry-form__field entry-sheet__date">
            <span class="entry-form__label">Date</span>
            <input
              class="entry-form__input"
              type="date"
              value={draft.date}
              onInput={(e) => setDraft((d) => ({ ...d, date: e.currentTarget.value }))}
            />
          </label>

          {/* Disabled at 0: the form's amount is read-only and has no way
              back to the keypad, so Next with no amount would strand the
              user on a form that can never save. */}
          <button type="button" class="entry-sheet__next" onClick={goToForm} disabled={isEmptyAmount(amount)}>
            Next
          </button>
        </div>
      ) : (
        <EntryForm
          amount={amount}
          draft={draft}
          onChange={setDraft}
          accounts={accounts}
          categories={categories}
          merchants={merchants}
          errors={formErrors}
          onSave={handleFormSave}
        />
      )}
    </Sheet>
  );
}

/** Formats the undo toast message shown by App after a save. */
export function savedToastMessage(tx: Transaction): string {
  return `Saved ${formatEUR(tx.amountCents)} · ${tx.category}`;
}
