import { useEffect, useState } from "preact/hooks";
import type { Transaction } from "@/domain/transaction";
import {
  applyDraftToTransaction,
  draftFromTransaction,
  newAccountTypes,
  validateDraft,
  type EntryDraft,
} from "@/features/entry/draft";
import { setAccountType } from "@/storage/accountTypes";
import { EntryScreen } from "@/features/entry/EntryScreen";
import { debtBalanceProblem } from "@/features/entry/debtBalance";
import type { Account, Category } from "@/domain/transaction";
import type { MerchantOptions } from "@/features/entry/pickerOptions";

interface TransactionDetailSheetProps {
  transaction: Transaction | null;
  accounts: readonly Account[];
  categories: readonly Category[];
  merchants: MerchantOptions;
  onClose: () => void;
  onSave: (updated: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
  /** Every live row, for the Lent / Borrowed balance check (debtBalance.ts). */
  transactions: readonly Transaction[];
  onRejected: (message: string) => void;
}

/**
 * Tap-through edit/delete for a single row (Phase 11). Reuses EntryScreen
 * rather than building a second form — the same screen Add transaction
 * uses; the only UI of its own is the Delete row with its inline confirm. Everything else is
 * the exact same validity rules a quick-entry transaction is held to
 * (features/entry/draft.ts), so an edited transaction can't drift from
 * what CSV import/export (Phase 13) considers valid.
 *
 * No swipe gesture — tap-to-open covers delete and edit both, and this
 * is reachable with a keyboard/screen reader for free. See
 * docs/renovation_version_1.txt Phase 11 status for why swipe itself was
 * deferred to Phase 17's real-device pass.
 */
export function TransactionDetailSheet({
  transaction,
  accounts,
  categories,
  merchants,
  onClose,
  onSave,
  onDelete,
  transactions,
  onRejected,
}: TransactionDetailSheetProps) {
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset local edit state whenever a *different* transaction is opened
  // (keyed on id, not object identity) — useTransactions() hands back a
  // freshly-parsed object on every repository write (see
  // storage/useTransactions.ts), including writes unrelated to this row,
  // so keying on the object reference itself would wipe an in-progress
  // edit out from under the user the moment any other transaction
  // changed while this sheet was still open.
  const activeTransaction = transaction;
  useEffect(() => {
    setDraft(activeTransaction ? draftFromTransaction(activeTransaction) : null);
    setConfirmingDelete(false);
  }, [activeTransaction?.id]);

  if (!activeTransaction || !draft) {
    return null;
  }

  const transactionBeingEdited: Transaction = activeTransaction;
  const draftInProgress: EntryDraft = draft;
  const errors = validateDraft(draftInProgress, accounts);

  function handleSave() {
    if (errors.length > 0) return;
    const updated = applyDraftToTransaction(transactionBeingEdited, draftInProgress);
    // A toast on tap rather than a disabled Save, as in EntrySheet.
    const problem = debtBalanceProblem(transactions, transactionBeingEdited, updated);
    if (problem) return onRejected(problem);
    // Before onSave, for the same sync-ordering reason as EntrySheet.
    for (const [name, type] of Object.entries(newAccountTypes(draftInProgress, accounts))) setAccountType(name, type);
    onSave(updated);
  }

  function handleDeleteConfirmed() {
    // Deleting the loan under its repayments would leave the person below zero (user decision 2026-11-17).
    const problem = debtBalanceProblem(transactions, transactionBeingEdited, null);
    if (problem) {
      setConfirmingDelete(false);
      return onRejected(problem);
    }
    onDelete(transactionBeingEdited);
  }

  // The confirm REPLACES the Delete button in the same fixed-height row,
  // so the keypad under it doesn't move and Delete can't be double-tapped
  // through to the real delete.
  const actions = confirmingDelete ? (
    <div class="transaction-detail__confirm">
      <span>Delete this transaction?</span>
      <button type="button" class="transaction-detail__confirm-cancel" onClick={() => setConfirmingDelete(false)}>
        Cancel
      </button>
      <button type="button" class="transaction-detail__confirm-delete" onClick={handleDeleteConfirmed}>
        Delete
      </button>
    </div>
  ) : (
    <button type="button" class="transaction-detail__delete" onClick={() => setConfirmingDelete(true)}>
      Delete transaction
    </button>
  );

  return (
    <EntryScreen
      open={transaction !== null}
      title="Edit transaction"
      // The body holds the amount digits, seeded once, so a different row must remount it.
      bodyKey={transactionBeingEdited.id}
      draft={draftInProgress}
      onChange={setDraft}
      accounts={accounts}
      categories={categories}
      merchants={merchants}
      saveLabel="Save"
      canSave={errors.length === 0}
      onSave={handleSave}
      onClose={onClose}
      actions={actions}
    />
  );
}
