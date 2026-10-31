import { useEffect, useState } from "preact/hooks";
import { Sheet } from "@/components/Sheet";
import { Money } from "@/components/Money";
import type { Transaction } from "@/domain/transaction";
import { formatDayLabel, getLocalToday } from "@/domain/dates";
import { amountFromCents } from "@/features/entry/amount";
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
 * EntryForm rather than building a second form — the only new UI here is
 * the read-only summary strip and the Delete button; everything else is
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
  const amount = amountFromCents(draftInProgress.amountCents);
  const errors = validateDraft(draftInProgress, accounts);
  const today = getLocalToday();

  function handleSave() {
    if (errors.length > 0) return;
    onSave(applyDraftToTransaction(transactionBeingEdited, draftInProgress));
  }

  function handleDeleteConfirmed() {
    onDelete(transactionBeingEdited);
  }

  return (
    <Sheet open={transaction !== null} onClose={onClose} title="Transaction details">
      <div class="transaction-detail">
        <div class="transaction-detail__summary">
          <span>Logged {formatDayLabel(transactionBeingEdited.date, today)}</span>
          <Money cents={transactionBeingEdited.amountCents} class="transaction-detail__summary-amount" />
        </div>

        <EntryForm
          amount={amount}
          draft={draftInProgress}
          onChange={setDraft}
          accounts={accounts}
          categories={categories}
          merchants={merchants}
          errors={errors}
          onSave={handleSave}
          saveLabel="Save changes"
          onAmountChange={(cents) => setDraft((d) => (d ? { ...d, amountCents: cents } : d))}
        />

        {confirmingDelete ? (
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
          <button type="button" class="transaction-detail__delete" onClick={() => setConfirmingDelete(true)}>
            Delete transaction
          </button>
        )}
      </div>
    </Sheet>
  );
}
