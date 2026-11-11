import type { Cents } from "./money";
import type { ISODate } from "./dates";

/**
 * Category "types" as used by the old app's data model, kept 1:1 for
 * compatibility with the CSV (dummyData/trackz-backup-2026-10-31.csv
 * column `category_type`). UI labels are plain-English per the renovation
 * decisions (see docs/renovation_version_1.txt) and live in categoryLabel()
 * below, NOT by renaming these identifiers.
 *
 * WHAT non_expense / non_income ACTUALLY MEAN — confirmed with the user,
 * and load-bearing rather than trivia:
 *
 *   non_expense  Money LEFT my account, but the whole amount is not my
 *                expense. It can be entirely someone else's (a loan to a
 *                friend) or only PARTLY mine (a shared bill I paid in
 *                full and will be partly reimbursed for).
 *   non_income   The mirror: money ARRIVED, but it is not my income —
 *                a reimbursement or refund of money I had already spent.
 *
 * Two consequences the code depends on:
 *
 * 1. These rows are NOT spending, so they must never be summed into an
 *    expense total or a "what did I spend this month" insight. That is
 *    why getSignedAmountCents' "net-worth" perspective treats
 *    non_income as +amount and non_expense as -amount (a real cash
 *    movement) while the insight engine's category deltas filter on
 *    categoryType === "expense" only.
 * 2. On these rows the `merchant` field names a COUNTERPARTY — a
 *    PERSON (a friend or flatmate), not a shop. Same for
 *    receivable/payable, which is where insights/engine.ts gets the
 *    names for Lent out / I owe. Anything that rewrites merchant in
 *    bulk (Phase 6's merchant merge) is therefore touching people and
 *    partly-not-mine amounts, not just tidying shop spellings — see
 *    domain/merchant.ts's CategoryTypeBreakdown.
 */
export type CategoryType =
  | "income"
  | "expense"
  | "transfer"
  | "non_income" // UI: "Non income"
  | "non_expense" // UI: "Non expense"
  | "receivable" // UI: "Lent out"
  | "payable"; // UI: "I owe"

export const CATEGORY_TYPES: readonly CategoryType[] = [
  "income",
  "expense",
  "transfer",
  "non_income",
  "non_expense",
  "receivable",
  "payable",
];

export function categoryTypeLabel(type: CategoryType): string {
  switch (type) {
    case "income":
      return "Income";
    case "expense":
      return "Expense";
    case "transfer":
      return "Transfer";
    case "non_income":
      return "Non income";
    case "non_expense":
      return "Non expense";
    case "receivable":
      return "Lent out";
    case "payable":
      return "I owe";
  }
}

/**
 * Whether rows of this type carry a category at all (user decision
 * 2026-11-10). A transfer between my own accounts has nothing to
 * categorise, and on Lent out / I owe the counterparty in `merchant` says
 * everything: the old "Transfer" / "Lent" categories only repeated the
 * type. These rows store category "". The form hides the field, the draft
 * blanks it, and CSV import accepts it blank for these types alone.
 */
export function usesCategory(type: CategoryType): boolean {
  return type !== "transfer" && type !== "receivable" && type !== "payable";
}

/** A row's category, or its type label when it has none (see usesCategory). For toasts and list rows. */
export function categoryOrTypeLabel(tx: Pick<Transaction, "category" | "categoryType">): string {
  return tx.category || categoryTypeLabel(tx.categoryType);
}

export type Cashflow = "in" | "out" | "none"; // "none" = transfer between own accounts

export interface Transaction {
  id: string;
  date: ISODate;
  account: string; // account name (FK by name, matches old model)
  destinationAccount: string; // only set when cashflow === "none"
  cashflow: Cashflow;
  category: string; // category name (FK by name)
  categoryType: CategoryType;
  merchant: string; // was "subcategory" in the old model; renamed (see Phase 6)
  amountCents: Cents; // always positive; sign is derived from cashflow + categoryType
  notes: string;
  createdAt: string; // ISO timestamp, set once at creation, never changes
  /**
   * ISO timestamp, bumped on every create/edit/delete (Phase 15a). This is
   * the field sync/merge.ts's last-writer-wins resolution keys on when two
   * devices hold different versions of the same id — NOT createdAt, which
   * is immutable and would make every edit lose to the original write.
   */
  updatedAt: string;
  /**
   * Tombstone (Phase 15a), ISO timestamp of deletion or null if live.
   * repository.deleteTransaction() sets this instead of removing the row,
   * because a hard delete is invisible to a merge: a device that hasn't
   * seen the delete yet would resurrect the row on its next sync simply by
   * still having it. The tombstone is a real record with its own
   * updatedAt, so it can win or lose a merge like any other edit, and
   * getTransactions() filters it out for every normal read path.
   */
  deletedAt: string | null;
}

export interface Account {
  name: string;
  // No separately-persisted opening balance: confirmed with the user that
  // accounts/categories are always derived from transactions, there is no
  // opening-balance feature in use (see Phase 0 note in renovation plan).
}

/**
 * "cash" (spendable, the only type in Home's "Liquid assets" card),
 * "investment" (a real asset, not spendable — e.g. a brokerage account)
 * and "credit_card" (spending happens here, but the balance is money
 * owed, not money held — e.g. ADVZ). Unlike Account above, this IS
 * persisted (see storage/accountTypes.ts): it has no
 * transaction-derivable signal.
 *
 * The CSV is its source of truth (user decision 2026-11-11): import sets
 * it from the file's `accountTypes` config cell (storage/csv.ts), and the
 * only in-app writer is the entry form's picker for a brand-new account.
 * An account with no entry reads as "cash".
 */
export const ACCOUNT_TYPES = ["cash", "investment", "credit_card"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export function isAccountType(value: unknown): value is AccountType {
  return (ACCOUNT_TYPES as readonly unknown[]).includes(value);
}

export function accountTypeLabel(type: AccountType): string {
  switch (type) {
    case "cash":
      return "Cash";
    case "investment":
      return "Investment";
    case "credit_card":
      return "Credit card";
  }
}

/**
 * A category is identified by NAME ALONE. `categoryType` is deliberately
 * NOT a field here: it is a property of each TRANSACTION, not of the
 * category, so one category legitimately carries different types on
 * different rows (Phase 13b decision, confirmed with the user against the
 * real data).
 *
 * WHY, from the real 1,456-row backup — two names carry multiple types and
 * BOTH are correct, not data-entry slips:
 *
 *   WiFi    14 x non_expense (2025-02 -> 2026-03, "Vodafone West GmbH
 *           KdNr. 1315385071" — a flat share, partly reimbursed) then
 *           4 x expense (2026-06 onward, "Vodafone GmbH KdNr. 134029559"
 *           — a different contract after a flat move, wholly the user's).
 *           Same concept, "my internet bill"; the circumstance changed.
 *   Shopping 151 x expense, 2 x non_expense, 1 x non_income — a purchase
 *           partly not the user's money, and a refund of one.
 *
 * The LEGACY app (deleted; git tag legacy-app-final) proves the opposite
 * model fails: public/js/db.js:460-467
 * pinned one categoryType per category and threw "Category type must
 * match the selected category" on any mismatch, so it could not re-enter
 * 10 of its own rows. Those rows only existed because CSV import bypassed
 * that validation. Its category list also collapsed duplicates
 * first-writer-wins (db.js:132-143,550-553), silently discarding the
 * second type.
 *
 * Consequence for consumers: anything needing a type must read it from
 * the transaction (or compute a per-type breakdown over rows, as
 * features/settings/nameRename.ts does). Nothing can ask a Category
 * what type it "is", because that question has no single answer.
 */
export interface Category {
  name: string;
}

export interface Merchant {
  name: string; // canonical display name after the one-time merge (Phase 6)
}

/**
 * The "perspective" a balance/amount is computed from. Mirrors the 4
 * independent copies of this logic found in the old codebase
 * (db.js:getTransactionImpact, dashboard.js x2, transactions.js's unused
 * getTransactionSignedAmount) — this is now the ONLY place this math lives.
 */
export type BalancePerspective =
  | { kind: "account"; name: string } // net effect on one account's balance
  | { kind: "net-worth" } // income +, expense/non_expense -, transfer net 0, receivable/payable per their own sign
  | { kind: "receivable" } // "out" (lending money) = +, "in" (getting repaid) = -
  | { kind: "payable" }; // "in" (borrowing) = +, "out" (repaying) = -

/**
 * The single source of truth for "is this transaction's amount a + or - in
 * the given perspective?". Every balance, chart, and KPI in the app must
 * go through this function instead of re-deriving sign locally.
 */
export function getSignedAmountCents(tx: Transaction, perspective: BalancePerspective): Cents {
  switch (perspective.kind) {
    case "account": {
      if (tx.cashflow === "in" && tx.account === perspective.name) return tx.amountCents;
      if (tx.cashflow === "out" && tx.account === perspective.name) return -tx.amountCents;
      if (tx.cashflow === "none") {
        if (tx.account === perspective.name) return -tx.amountCents;
        if (tx.destinationAccount === perspective.name) return tx.amountCents;
      }
      return 0;
    }
    case "net-worth": {
      switch (tx.categoryType) {
        case "income":
        case "non_income":
          return tx.amountCents;
        case "expense":
        case "non_expense":
          return -tx.amountCents;
        case "receivable":
          // lending money reduces liquid cash but creates an asset of equal
          // value, so it nets to 0 on total net worth; handled separately
          // by the receivables balance, not here.
          return 0;
        case "payable":
          return 0;
        case "transfer":
          return 0;
      }
    }
    case "receivable": {
      if (tx.categoryType !== "receivable") return 0;
      return tx.cashflow === "out" ? tx.amountCents : tx.cashflow === "in" ? -tx.amountCents : 0;
    }
    case "payable": {
      if (tx.categoryType !== "payable") return 0;
      return tx.cashflow === "in" ? tx.amountCents : tx.cashflow === "out" ? -tx.amountCents : 0;
    }
  }
}
