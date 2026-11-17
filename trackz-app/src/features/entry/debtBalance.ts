import { getSignedAmountCents, type Transaction } from "@/domain/transaction";
import { addCents, formatEUR, type Cents } from "@/domain/money";
import { counterpartyOf } from "@/insights/engine";

type DebtType = "receivable" | "payable";

function isDebt(tx: Transaction | null): tx is Transaction & { categoryType: DebtType } {
  return tx !== null && (tx.categoryType === "receivable" || tx.categoryType === "payable");
}

/**
 * The Lent / Borrowed rule (user decision 2026-11-17): a merchant's balance
 * may never go below zero. Lend Bob 10 and he can repay at most 10;
 * borrow 5 from him and you can repay at most 5.
 *
 * Checked on the FINAL total per merchant, not on each date (user decision,
 * same day): a repayment dated before the loan it repays is allowed.
 *
 * One function for Add (before = null), Edit (both set) and Delete
 * (after = null). Edit checks BOTH merchants and types: moving a loan from
 * Bob to Alice, or retyping it, empties Bob's side just as a delete would.
 * Returns why the change is refused, or null when it is fine.
 */
export function debtBalanceProblem(
  live: readonly Transaction[],
  before: Transaction | null,
  after: Transaction | null,
): string | null {
  const changedId = before?.id ?? after?.id;
  const others = live.filter((tx) => tx.id !== changedId);
  // after first: when it is the repayment that overdraws, its message names the limit.
  for (const side of [after, before]) {
    if (!isDebt(side)) continue;
    const type = side.categoryType;
    const name = counterpartyOf(side);
    const othersCents = balanceOf(others, type, name);
    const afterCents = isDebt(after) && after.categoryType === type && counterpartyOf(after) === name
      ? getSignedAmountCents(after, { kind: type })
      : 0;
    if (addCents(othersCents, afterCents) >= 0) continue;
    // "Only owes you X" fits a repayment that is too big. A loan shrunk
    // (or moved) under its repayments has no such limit to name.
    if (side === after && afterCents < 0) return overdrawnMessage(type, name, othersCents);
    return type === "receivable"
      ? `${name} has repaid more than this would leave lent. Remove the repayments first.`
      : `You have repaid ${name} more than this would leave borrowed. Remove the repayments first.`;
  }
  return null;
}

function balanceOf(rows: readonly Transaction[], type: DebtType, name: string): Cents {
  return addCents(
    ...rows
      .filter((tx) => tx.categoryType === type && counterpartyOf(tx) === name)
      .map((tx) => getSignedAmountCents(tx, { kind: type })),
  );
}

function overdrawnMessage(type: DebtType, name: string, maxCents: Cents): string {
  if (type === "receivable") {
    return maxCents > 0 ? `${name} only owes you ${formatEUR(maxCents)}.` : `${name} doesn't owe you anything.`;
  }
  return maxCents > 0 ? `You only owe ${name} ${formatEUR(maxCents)}.` : `You don't owe ${name} anything.`;
}
