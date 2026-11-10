import { useEffect, useState } from "preact/hooks";
import { Sheet } from "@/components/Sheet";
import type { Transaction } from "@/domain/transaction";
import { applyDraftToTransaction, draftFromTransaction, validateDraft, type EntryDraft } from "@/features/entry/draft";
import { EntryForm } from "@/features/entry/EntryForm";
import type { Account, Category, Merchant } from "@/domain/transaction";

interface TransactionDetailSheetProps {
  transaction: Transaction | null;
  accounts: readonly Account[];
  categories: readonly Category[];
  merchants: readonly Merchant[];
  onClose: () => void;
  onSave: (updated: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}

/**
 * Tap-through edit/delete for a single row (Phase 11). Reuses Sheet and
 * EntryForm rather than building a second form — the same form Add
 * transaction uses (2026-11-10); the only UI of its own is the footer's
 * Delete with its inline confirm. Everything else is
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
    onSave(applyDraftToTransaction(transactionBeingEdited, draftInProgress));
  }

  function handleDeleteConfirmed() {
    onDelete(transactionBeingEdited);
  }

  // The confirm REPLACES the footer's two buttons rather than stacking
  // under them, so Save can't be tapped while a delete is pending.
  const footer = confirmingDelete ? (
    <div class="transaction-detail__confirm">
      <span>Delete this transaction?</span>
      <div class="transaction-detail__confirm-actions">
        <button type="button" class="transaction-detail__confirm-cancel" onClick={() => setConfirmingDelete(false)}>
          Cancel
        </button>
        <button type="button" class="transaction-detail__confirm-delete" onClick={handleDeleteConfirmed}>
          Delete
        </button>
      </div>
    </div>
  ) : (
    <>
      <button type="button" class="transaction-detail__delete" onClick={() => setConfirmingDelete(true)}>
        Delete
      </button>
      <button type="button" class="entry-form__save" onClick={handleSave} disabled={errors.length > 0}>
        Save changes
      </button>
    </>
  );

  return (
    <Sheet open={transaction !== null} onClose={onClose} title="Edit transaction" footer={footer}>
      {/* Keyed on id: EntryForm holds the amount's raw text in local state,
          seeded once from the draft, so a different row must remount it. */}
      <EntryForm
        key={transactionBeingEdited.id}
        draft={draftInProgress}
        onChange={setDraft}
        accounts={accounts}
        categories={categories}
        merchants={merchants}
        errors={errors}
      />
    </Sheet>
  );
}
