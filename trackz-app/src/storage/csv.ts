import { toCents } from "@/domain/money";
import { isValidISODate } from "@/domain/dates";
import { newTransactionId } from "@/domain/id";
import type { CategoryType, Cashflow, Transaction } from "@/domain/transaction";
import { CATEGORY_TYPES } from "@/domain/transaction";

/**
 * CSV columns, matching dummyData/trackz-backup-2026-10-31.csv exactly:
 * date,account,destinationAccount,cashflow,category,category_type,subcategory,amount,currency,notes
 *
 * `subcategory` from the CSV maps to our `merchant` field (Phase 6 rename).
 * `currency` is read and validated but discarded — the app is EUR-only
 * (see decisions in docs/renovation_version_1.txt). Any non-EUR row is a
 * hard parse error, not a silent drop, so a future non-EUR import can't
 * sneak in unnoticed.
 */
export const CSV_HEADERS = [
  "date",
  "account",
  "destinationAccount",
  "cashflow",
  "category",
  "category_type",
  "subcategory",
  "amount",
  "currency",
  "notes",
] as const;

const CASHFLOWS: readonly Cashflow[] = ["in", "out", "none"];

export interface CsvParseError {
  line: number; // 1-indexed, matching a text editor's line numbers (header = line 1)
  message: string;
}

export interface CsvParseResult {
  transactions: Transaction[];
  errors: CsvParseError[];
}

/** Hand-rolled single-line CSV field splitter with RFC4180 quote handling. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function isCategoryType(value: string): value is CategoryType {
  return (CATEGORY_TYPES as readonly string[]).includes(value);
}

function isCashflow(value: string): value is Cashflow {
  return (CASHFLOWS as readonly string[]).includes(value);
}

export function parseTransactionsCsv(csvText: string): CsvParseResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length > 0);
  const transactions: Transaction[] = [];
  const errors: CsvParseError[] = [];

  if (lines.length === 0) {
    return { transactions, errors: [{ line: 1, message: "Empty CSV file" }] };
  }

  const header = parseCsvLine(lines[0]!);
  const headerOk = CSV_HEADERS.every((h, i) => header[i] === h);
  if (!headerOk) {
    errors.push({
      line: 1,
      message: `Unexpected header. Expected: ${CSV_HEADERS.join(",")}`,
    });
    return { transactions, errors };
  }

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const fields = parseCsvLine(lines[i]!);
    if (fields.length !== CSV_HEADERS.length) {
      errors.push({
        line: lineNumber,
        message: `Expected ${CSV_HEADERS.length} columns, got ${fields.length}`,
      });
      continue;
    }

    const [date, account, destinationAccount, cashflowRaw, category, categoryTypeRaw, merchant, amountRaw, currency, notes] =
      fields as [string, string, string, string, string, string, string, string, string, string];

    if (!isValidISODate(date)) {
      errors.push({ line: lineNumber, message: `Invalid date: "${date}"` });
      continue;
    }
    if (!account) {
      errors.push({ line: lineNumber, message: "Missing account" });
      continue;
    }
    if (!isCashflow(cashflowRaw)) {
      errors.push({ line: lineNumber, message: `Invalid cashflow: "${cashflowRaw}"` });
      continue;
    }
    if (!category) {
      errors.push({ line: lineNumber, message: "Missing category" });
      continue;
    }
    if (!isCategoryType(categoryTypeRaw)) {
      errors.push({ line: lineNumber, message: `Invalid category_type: "${categoryTypeRaw}"` });
      continue;
    }
    if (cashflowRaw === "none" && !destinationAccount) {
      errors.push({ line: lineNumber, message: "Transfer (cashflow=none) missing destinationAccount" });
      continue;
    }
    if (currency !== "EUR") {
      errors.push({
        line: lineNumber,
        message: `Non-EUR currency "${currency}" is not supported (app is EUR-only)`,
      });
      continue;
    }

    let amountCents: number;
    try {
      amountCents = toCents(amountRaw);
    } catch {
      errors.push({ line: lineNumber, message: `Invalid amount: "${amountRaw}"` });
      continue;
    }
    if (amountCents <= 0) {
      errors.push({ line: lineNumber, message: `Amount must be positive: "${amountRaw}"` });
      continue;
    }

    transactions.push({
      id: newTransactionId(),
      date,
      account,
      destinationAccount: cashflowRaw === "none" ? destinationAccount : "",
      cashflow: cashflowRaw,
      category,
      categoryType: categoryTypeRaw,
      merchant: merchant ?? "",
      amountCents,
      notes: notes ?? "",
      createdAt: `${date}T00:00:00.000Z`,
    });
  }

  return { transactions, errors };
}
