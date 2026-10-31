import type { Transaction } from "@/domain/transaction";
import { categoryTypeLabel } from "@/domain/transaction";
import { Money } from "@/components/Money";

interface TransactionRowProps {
  transaction: Transaction;
  onOpen: (transaction: Transaction) => void;
}

/**
 * A single Activity row. Deliberately a plain <button> (keyboard/a11y for
 * free) rather than a custom touch-gesture surface — swipe actions were
 * considered for Phase 11 but deferred to Phase 17's real-device pass
 * (hand-rolled touchstart/move/end tracking is the highest-risk, least
 * verifiable-in-this-session part of the old plan, and everything swipe
 * would do, the tap-through detail sheet already does).
 */
export function TransactionRow({ transaction, onOpen }: TransactionRowProps) {
  const tx = transaction;
  const primaryLabel = tx.merchant || tx.category;
  const isTransfer = tx.cashflow === "none";
  const secondaryLabel = isTransfer ? `${tx.account} → ${tx.destinationAccount}` : `${tx.category} · ${tx.account}`;
  const relabel = showsRelabel(tx.categoryType) ? categoryTypeLabel(tx.categoryType) : null;

  const amountClass =
    tx.cashflow === "in" ? "transaction-row__amount--in" : tx.cashflow === "out" ? "transaction-row__amount--out" : "transaction-row__amount--none";

  return (
    <button type="button" class="transaction-row" onClick={() => onOpen(tx)}>
      <div class="transaction-row__body">
        <div class="transaction-row__primary">{primaryLabel}</div>
        <div class="transaction-row__secondary">
          {secondaryLabel}
          {relabel && <span class="transaction-row__badge">{relabel}</span>}
        </div>
      </div>
      <Money
        cents={tx.cashflow === "out" ? -tx.amountCents : tx.amountCents}
        signed={tx.cashflow !== "none"}
        class={`transaction-row__amount ${amountClass}`}
      />
    </button>
  );
}

/** The four category types whose real meaning isn't obvious from amount sign alone (see the locked relabel decisions in docs/renovation_version_1.txt). */
function showsRelabel(categoryType: Transaction["categoryType"]): boolean {
  return (
    categoryType === "non_income" ||
    categoryType === "non_expense" ||
    categoryType === "receivable" ||
    categoryType === "payable"
  );
}
