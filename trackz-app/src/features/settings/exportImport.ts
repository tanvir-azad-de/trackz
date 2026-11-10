import type { Transaction, AccountType } from "@/domain/transaction";
import { parseTransactionsCsv, serializeTransactionsCsv, type CsvParseError } from "@/storage/csv";
import { deriveAccounts, deriveCategories, deriveMerchants } from "@/storage/derive";
import { getLiquidCashCents, getTotalAssetsCents } from "@/insights/engine";

/**
 * Pure logic for the Settings "Data" section (Phase 13a): building the
 * export filename/body, and summarizing a CSV file BEFORE it is
 * committed to the repository so the import UI can show "here's what
 * you're about to replace your data with" rather than committing blind.
 * No DOM here (no Blob, no FileReader) — those live in SettingsScreen
 * itself, kept thin and untested; this module is what's actually
 * tested, same split as storage/csv.ts vs its consumers.
 */

export function exportFileName(today: string): string {
  return `trackz-backup-${today}.csv`;
}

export function buildExportCsv(transactions: Transaction[]): string {
  return serializeTransactionsCsv(transactions);
}

export interface ImportPreview {
  fileName: string;
  totalRows: number; // data rows attempted (excludes header)
  validCount: number;
  errors: CsvParseError[];
  errorPreview: CsvParseError[]; // first N errors, for display
  transactions: Transaction[]; // only populated when errors.length === 0 — see canCommit
  accountCount: number;
  categoryCount: number;
  merchantCount: number;
  liquidCashCents: number;
  totalAssetsCents: number;
}

const MAX_ERROR_PREVIEW = 5;

/**
 * All-or-nothing: if ANY row fails to parse, `transactions` is left
 * empty and `canCommit` (see below) is false. A half-imported ledger
 * (silently dropping the bad rows) is worse than refusing the whole
 * file — the user fixes the source file and tries again instead of
 * discovering missing rows days later.
 *
 * `accountTypes` must be the CURRENT classification map (see
 * storage/accountTypes.ts) — account-type is keyed by account NAME and
 * is a separate store from transactions (storage/accountTypes.ts,
 * trackz.v2.accountTypes), so it survives a transaction import
 * untouched. Without threading it through, this preview's "Liquid"
 * figure would count every account (including e.g. SCLB/Scalable
 * Capital, classified "investment") as spendable cash, while Home
 * would immediately show a different, correct number the moment the
 * import actually commits — caught live in this phase's own Playwright
 * verification pass: a bare re-import of the real backup showed a
 * higher "Liquid" figure in the preview than Home showed one tap later, a user-visible contradiction for the exact same data.
 */
export function previewImport(fileName: string, csvText: string, accountTypes: Record<string, AccountType> = {}): ImportPreview {
  const { transactions, errors } = parseTransactionsCsv(csvText);
  const totalRows = csvText.split(/\r?\n/).filter((l) => l.length > 0).length - 1;
  const committed = errors.length === 0 ? transactions : [];

  return {
    fileName,
    totalRows: Math.max(totalRows, 0),
    validCount: transactions.length,
    errors,
    errorPreview: errors.slice(0, MAX_ERROR_PREVIEW),
    transactions: committed,
    accountCount: deriveAccounts(committed).length,
    categoryCount: deriveCategories(committed).length,
    merchantCount: deriveMerchants(committed).length,
    liquidCashCents: getLiquidCashCents(committed, accountTypes),
    totalAssetsCents: getTotalAssetsCents(committed),
  };
}

export function canCommit(preview: ImportPreview): boolean {
  return preview.errors.length === 0 && preview.transactions.length > 0;
}
