import { useMemo, useState } from "preact/hooks";
import { getLocalToday } from "@/domain/dates";
import { addTransaction } from "@/storage/repository";
import { loadRememberedEntry, saveRememberedEntry } from "@/storage/entryMemory";
import { pickerAccounts, pickerCategories, pickerMerchants } from "@/features/entry/pickerOptions";
import { buildTransaction, newAccountTypes, validateDraft, type EntryDraft } from "@/features/entry/draft";
import { setAccountType } from "@/storage/accountTypes";
import { draftFromRemembered, rememberFromTransaction } from "@/features/entry/lastUsed";
import { EntryScreen } from "./EntryScreen";
import type { Transaction } from "@/domain/transaction";

interface EntrySheetProps {
  open: boolean;
  transactions: Transaction[];
  onClose: () => void;
  /** Fires right after a transaction is saved, so the caller can show a confirmation toast. */
  onSaved: (tx: Transaction) => void;
}

/**
 * Add transaction: the shared EntryScreen. The draft is seeded from the
 * last saved transaction (every field but the amount, date included), so a
 * repeat entry is FAB -> digits -> Save.
 */
export function EntrySheet({ open, transactions, onClose, onSaved }: EntrySheetProps) {
  const [draft, setDraft] = useState<EntryDraft>(() => draftFromRemembered(loadRememberedEntry(), getLocalToday()));

  const accounts = useMemo(() => pickerAccounts(transactions), [transactions]);
  const categories = useMemo(() => pickerCategories(transactions), [transactions]);
  const merchants = useMemo(() => pickerMerchants(transactions), [transactions]);

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
    <EntryScreen
      open={open}
      title="Add transaction"
      draft={draft}
      onChange={setDraft}
      accounts={accounts}
      categories={categories}
      merchants={merchants}
      saveLabel="Save"
      canSave={errors.length === 0}
      onSave={handleSave}
      onClose={handleClose}
    />
  );
}
