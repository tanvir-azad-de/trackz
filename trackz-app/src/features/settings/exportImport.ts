import type { Transaction, AccountType } from "@/domain/transaction";
import { parseTransactionsCsv, serializeTransactionsCsv, type CsvParseError } from "@/storage/csv";
import { deriveAccounts, deriveCategories, deriveMerchants } from "@/storage/derive";
import { getLiquidCashCents } from "@/insights/engine";

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

/**
 * Every account in `transactions` gets an entry, defaulting to "cash":
 * import rejects a file that leaves any account untyped, so an export
 * that omitted one (an account never classified, which reads as cash)
 * would not re-import.
 */
export function buildExportCsv(transactions: Transaction[], accountTypes: Record<string, AccountType> = {}): string {
  const complete: Record<string, AccountType> = {};
  for (const name of accountNamesIn(transactions)) complete[name] = accountTypes[name] ?? "cash";
  return serializeTransactionsCsv(transactions, complete);
}

/** Both columns: SCLB only ever appears as a transfer's destinationAccount. */
function accountNamesIn(transactions: Transaction[]): Set<string> {
  const names = new Set<string>();
  for (const tx of transactions) {
    if (tx.account) names.add(tx.account);
    if (tx.destinationAccount) names.add(tx.destinationAccount);
  }
  return names;
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
  /** The file's accountTypes config cell; empty unless the file is committable. Import replaces the stored map with it. */
  accountTypes: Record<string, AccountType>;
}

const MAX_ERROR_PREVIEW = 5;

/**
 * All-or-nothing: if ANY row fails to parse, `transactions` is left
 * empty and `canCommit` (see below) is false. A half-imported ledger
 * (silently dropping the bad rows) is worse than refusing the whole
 * file — the user fixes the source file and tries again instead of
 * discovering missing rows days later.
 *
 * Account types come from the FILE, not from this device (user decision
 * 2026-11-11: the CSV is their only source). A file with no accountTypes
 * config cell, or one that leaves an account in its rows untyped, is
 * rejected like any other bad row — that is also the user's decision,
 * over defaulting to cash, which would have quietly put a credit card or
 * a brokerage balance back into Liquid. Old V1-V3 backups therefore need
 * the cell added before they import.
 */
export function previewImport(fileName: string, csvText: string): ImportPreview {
  const parsed = parseTransactionsCsv(csvText);
  const { transactions } = parsed;
  const errors = [...parsed.errors];
  const accountTypes = parsed.accountTypes ?? {};
  // Skipped when the header failed (that file already has its one useful
  // error), when the cell itself was malformed (already reported, and
  // "missing" would be false), and when there are no rows (the UI's
  // "nothing to import" says it better).
  const cellAlreadyReported = parsed.errors.some((e) => e.line === 1 || e.message.startsWith("accountTypes:"));
  if (!cellAlreadyReported && transactions.length > 0) {
    if (parsed.accountTypes === null) {
      errors.push({
        line: 1,
        message: "No accountTypes config cell. Add an accountTypes column and, on one row, e.g. CMRZ=cash;ADVZ=credit_card;SCLB=investment",
      });
    } else {
      const untyped = [...accountNamesIn(transactions)].filter((name) => accountTypes[name] === undefined).sort();
      if (untyped.length > 0) errors.push({ line: 1, message: `accountTypes: no type for ${untyped.join(", ")}` });
    }
  }
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
    accountTypes: errors.length === 0 ? accountTypes : {},
  };
}

export function canCommit(preview: ImportPreview): boolean {
  return preview.errors.length === 0 && preview.transactions.length > 0;
}
