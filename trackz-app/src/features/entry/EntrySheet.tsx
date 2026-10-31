import { useMemo, useState } from "preact/hooks";
import { Sheet } from "@/components/Sheet";
import { getLocalToday } from "@/domain/dates";
import { addTransaction } from "@/storage/repository";
import { deriveAccounts, deriveCategories, deriveMerchants } from "@/storage/derive";
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
import { getRecallCombos, type RecallCombo } from "@/features/entry/recall";
import { buildTransaction, draftFromCombo, emptyDraft, validateDraft, type EntryDraft } from "@/features/entry/draft";
import { Keypad } from "./Keypad";
import { RecallChips } from "./RecallChips";
import { EntryForm } from "./EntryForm";
import type { Transaction } from "@/domain/transaction";
import { formatEUR } from "@/domain/money";
import "@/components/Sheet.css";
import "./Keypad.css";
import "./RecallChips.css";
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
 * Phase 8's quick-entry sheet: amount-first keypad with ranked recall
 * chips, 3-tap happy path (FAB -> amount -> chip -> saved — see
 * App.onFabPress in app.tsx), falling back to a full manual form for any
 * combo that has no history yet.
 */
export function EntrySheet({ open, transactions, onClose, onSaved }: EntrySheetProps) {
  const [mode, setMode] = useState<Mode>("keypad");
  const [amount, setAmount] = useState<AmountEntry>(emptyAmount());
  const [formDraft, setFormDraft] = useState<EntryDraft | null>(null);

  const today = getLocalToday();

  const combos = useMemo(() => getRecallCombos(transactions, today, 6), [transactions, today]);
  const accounts = useMemo(() => deriveAccounts(transactions), [transactions]);
  const categories = useMemo(() => deriveCategories(transactions), [transactions]);
  const merchants = useMemo(() => deriveMerchants(transactions), [transactions]);

  function reset() {
    setMode("keypad");
    setAmount(emptyAmount());
    setFormDraft(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleDigit(d: string) {
    setAmount((a) => appendDigit(a, d));
  }

  function handleDelete() {
    setAmount((a) => deleteDigit(a));
  }

  function handleChipPick(combo: RecallCombo) {
    const amountCents = entryToCents(amount);
    if (amountCents <= 0) return; // chips are disabled in this state, but guard anyway
    const draft = draftFromCombo(combo, amountCents, today);
    const tx = buildTransaction(draft);
    addTransaction(tx);
    handleClose();
    onSaved(tx);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      // iOS Safari doesn't implement the Vibration API — this is a no-op
      // there. Left in for Android/desktop Chrome where it does fire;
      // there is no web API for real iOS haptics (see Phase 8 writeup).
      navigator.vibrate(10);
    }
  }

  function openForm() {
    setFormDraft(emptyDraft(today, entryToCents(amount)));
    setMode("form");
  }

  function handleFormSave() {
    if (!formDraft) return;
    const tx = buildTransaction(formDraft);
    addTransaction(tx);
    handleClose();
    onSaved(tx);
  }

  const formErrors = formDraft ? validateDraft(formDraft, accounts) : [];

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

          <Keypad onDigit={handleDigit} onDelete={handleDelete} />

          <RecallChips combos={combos} disabled={isEmptyAmount(amount)} onPick={handleChipPick} />

          <button type="button" class="entry-sheet__more" onClick={openForm}>
            More options
          </button>
        </div>
      ) : (
        formDraft && (
          <EntryForm
            amount={amount}
            draft={formDraft}
            onChange={setFormDraft}
            accounts={accounts}
            categories={categories}
            merchants={merchants}
            errors={formErrors}
            onSave={handleFormSave}
          />
        )
      )}
    </Sheet>
  );
}

/** Formats the undo toast message shown by App after a chip-tap save. */
export function savedToastMessage(tx: Transaction): string {
  return `Saved ${formatEUR(tx.amountCents)} · ${tx.category}`;
}
