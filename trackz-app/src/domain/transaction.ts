import type { Cents } from "./money";
import type { ISODate } from "./dates";

/**
 * Category "types" as used by the old app's data model, kept 1:1 for
 * compatibility with the CSV (dummyData/trackz-backup-2026-10-31.csv
 * column `category_type`). UI labels are plain-English per the renovation
 * decisions (see docs/renovation_version_1.txt) and live in categoryLabel()
 * below, NOT by renaming these identifiers.
 */
export type CategoryType =
  | "income"
  | "expense"
  | "transfer"
  | "non_income" // UI: "Money back"
  | "non_expense" // UI: "Paying someone back"
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
      return "Money back";
    case "non_expense":
      return "Paying someone back";
    case "receivable":
      return "Lent out";
    case "payable":
      return "I owe";
  }
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
  createdAt: string; // ISO timestamp
}

export interface Account {
  name: string;
  // No separately-persisted opening balance: confirmed with the user that
  // accounts/categories are always derived from transactions, there is no
  // opening-balance feature in use (see Phase 0 note in renovation plan).
}

/**
 * "cash" (spendable, counted in Home's "Liquid" hero) vs "investment"
 * (a real asset, but not spendable cash — e.g. a brokerage account).
 * Unlike Account above, this IS persisted (see storage/accountTypes.ts):
 * it's a user classification with no transaction-derivable signal, not
 * something Phase 0's "always derive from transactions" rule covers.
 * Defaults to "cash" for any account with no explicit entry, so every
 * pre-Phase-12 account keeps behaving exactly as before unless a user
 * (or a seed, like SCLB below) says otherwise.
 */
export type AccountType = "cash" | "investment";

export interface Category {
  name: string;
  categoryType: CategoryType;
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
