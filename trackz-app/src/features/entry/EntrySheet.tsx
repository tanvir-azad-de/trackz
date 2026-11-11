import { useMemo, useState } from "preact/hooks";
import { Sheet } from "@/components/Sheet";
import { getLocalToday } from "@/domain/dates";
import { addTransaction } from "@/storage/repository";
import { loadRememberedEntry, saveRememberedEntry } from "@/storage/entryMemory";
import { rankAccounts, rankCategories, rankMerchants } from "@/features/entry/rank";
import { buildTransaction, newAccountTypes, validateDraft, type EntryDraft } from "@/features/entry/draft";
import { setAccountType } from "@/storage/accountTypes";
import { draftFromRemembered, rememberFromTransaction } from "@/features/entry/lastUsed";
import { EntryForm } from "./EntryForm";
import type { Transaction } from "@/domain/transaction";
import "@/components/Sheet.css";
import "./EntryForm.css";

interface EntrySheetProps {
  open: boolean;
  transactions: Transaction[];
  onClose: () => void;
  /** Fires right after a transaction is saved, so the caller can show a confirmation toast. */
  onSaved: (tx: Transaction) => void;
}

/**
 * Add transaction: the shared EntryForm, one step (user decision
 * 2026-11-10, renovation doc section 5 "FORM + SETTINGS REWORK",
 * superseding the keypad -> Next -> form flow). The draft is seeded from
 * the last saved transaction (every field but the amount, date included),
 * so a repeat entry is amount -> Save.
 */
export function EntrySheet({ open, transactions, onClose, onSaved }: EntrySheetProps) {
  const [draft, setDraft] = useState<EntryDraft>(() => draftFromRemembered(loadRememberedEntry(), getLocalToday()));

  const today = getLocalToday();

  const accounts = useMemo(() => rankAccounts(transactions, today), [transactions, today]);
  const categories = useMemo(() => rankCategories(transactions, today), [transactions, today]);
  const merchants = useMemo(() => rankMerchants(transactions, today), [transactions, today]);

  function handleClose() {
    // Re-read rather than keep the closed draft: closing without saving
    // discards edits, and after a save this picks up what was just stored.
    setDraft(draftFromRemembered(loadRememberedEntry(), getLocalToday()));
    onClose();
  }

  const errors = validateDraft(draft, accounts);

  function handleSave() {
    if (errors.length > 0) return;
    const tx = buildTransaction(draft);
    // Before addTransaction: its write arms the sync debounce, and that
    // sync reads the account-type map, so the new type rides along.
    for (const [name, type] of Object.entries(newAccountTypes(draft, accounts))) setAccountType(name, type);
    addTransaction(tx);
    // Before handleClose, which reads this back as the next draft.
    saveRememberedEntry(rememberFromTransaction(tx));
    handleClose();
    onSaved(tx);
  }

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title="Add transaction"
      footer={
        <button type="button" class="entry-form__save" onClick={handleSave} disabled={errors.length > 0}>
          Save
        </button>
      }
    >
      <EntryForm
        draft={draft}
        onChange={setDraft}
        accounts={accounts}
        categories={categories}
        merchants={merchants}
        errors={errors}
      />
    </Sheet>
  );
}
