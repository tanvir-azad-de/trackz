import { toCents, centsToFixed } from "@/domain/money";
import { isValidISODate } from "@/domain/dates";
import { contentDerivedTransactionId } from "@/domain/id";
import type { AccountType, CategoryType, Cashflow, Transaction } from "@/domain/transaction";
import { ACCOUNT_TYPES, CATEGORY_TYPES, isAccountType, usesCategory } from "@/domain/transaction";

/**
 * Legacy CSV columns, matching dummyData/trackz-backup-2026-10-31.csv
 * exactly: date,account,destinationAccount,cashflow,category,category_type,
 * subcategory,amount,currency,notes
 *
 * `subcategory` from the CSV maps to our `merchant` field (Phase 6 rename).
 * `currency` is read and validated but discarded — the app is EUR-only
 * (see decisions in docs/renovation_version_1.txt). Any non-EUR row is a
 * hard parse error, not a silent drop, so a future non-EUR import can't
 * sneak in unnoticed.
 *
 * This format has no `id`/`createdAt` columns, so parsing it mints a
 * fresh id and synthesizes createdAt as midnight-on-date for every row —
 * fine for a one-time historical import, but NOT a lossless round trip
 * (same-day ordering, which the Activity list sorts by createdAt desc,
 * would scramble on re-import). See CSV_HEADERS_V2 below for the format
 * this app's own export (Phase 13a) produces and re-parses losslessly.
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

/**
 * This app's own export format (Phase 13a): the legacy 10 columns plus
 * `id` and `createdAt` appended. Appending (rather than inserting them
 * in a "more natural" position) keeps every legacy column at the same
 * index, so the existing positional destructuring below needs no
 * branching on which header matched — only the two extra fields differ.
 */
export const CSV_HEADERS_V2 = [...CSV_HEADERS, "id", "createdAt"] as const;

/**
 * Phase 15a: adds updatedAt + deletedAt, needed once sync exists (the
 * last-writer-wins merge in sync/merge.ts keys on updatedAt; deletedAt is
 * the tombstone, see the Transaction.deletedAt doc comment). Appended
 * after V2's own two extra fields for the same reason V2 appended after
 * the legacy 10: every earlier column keeps its index, so parsing V1/V2
 * files needs no branching beyond "how many trailing fields are there".
 */
export const CSV_HEADERS_V3 = [...CSV_HEADERS_V2, "updatedAt", "deletedAt"] as const;

/**
 * 2026-11-11: adds `accountTypes`, a CONFIG CELL rather than a per-row
 * field (user decision). Exactly one row carries the whole
 * classification, e.g. `ADVZ=credit_card;CMRZ=cash;SCLB=investment`; on
 * every other row it is blank. Appended last, same reason as V2/V3.
 *
 * Why not a per-row column: SCLB never appears in `account`, only in
 * `destinationAccount`, so a column describing each row's account cannot
 * type it; and a per-row value can disagree with itself.
 *
 * Why "whichever row has it" instead of "the first row": the user edits
 * this file in a spreadsheet, and sorting moves the cell. Two rows with
 * the SAME value are accepted for the same reason (a copied row); two
 * DIFFERENT values are an error, since either choice would be a guess.
 */
export const CSV_HEADERS_V4 = [...CSV_HEADERS_V3, "accountTypes"] as const;

/** `ADVZ=credit_card;CMRZ=cash` -> map, or an error message. Names sorted on write so exports diff cleanly. */
export function parseAccountTypesCell(cell: string): { types: Record<string, AccountType> } | { error: string } {
  const types: Record<string, AccountType> = {};
  for (const part of cell.split(";")) {
    const pair = part.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const name = eq === -1 ? "" : pair.slice(0, eq).trim();
    const type = eq === -1 ? "" : pair.slice(eq + 1).trim();
    if (!name) return { error: `accountTypes: "${pair}" is not NAME=type` };
    if (!isAccountType(type)) {
      return { error: `accountTypes: "${name}" has type "${type}", expected one of ${ACCOUNT_TYPES.join(", ")}` };
    }
    if (types[name] !== undefined && types[name] !== type) {
      return { error: `accountTypes: "${name}" is listed as both ${types[name]} and ${type}` };
    }
    types[name] = type;
  }
  return { types };
}

export function formatAccountTypesCell(types: Record<string, AccountType>): string {
  return Object.keys(types)
    .sort()
    .map((name) => `${name}=${types[name]}`)
    .join(";");
}

const CASHFLOWS: readonly Cashflow[] = ["in", "out", "none"];

export interface CsvParseError {
  line: number; // 1-indexed, matching a text editor's line numbers (header = line 1)
  message: string;
}

export interface CsvParseResult {
  transactions: Transaction[];
  errors: CsvParseError[];
  /**
   * The file's accountTypes config cell, or null when it has none (a
   * V1-V3 file, or a V4 file whose cell is blank on every row). Whether
   * null is acceptable is the importer's call, not the parser's — see
   * features/settings/exportImport.ts.
   */
  accountTypes: Record<string, AccountType> | null;
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

  let accountTypes: Record<string, AccountType> | null = null;
  let accountTypesCell: string | null = null;

  if (lines.length === 0) {
    return { transactions, errors: [{ line: 1, message: "Empty CSV file" }], accountTypes };
  }

  const header = parseCsvLine(lines[0]!);
  const isV4 = header.length === CSV_HEADERS_V4.length && CSV_HEADERS_V4.every((h, i) => header[i] === h);
  const isV3 = !isV4 && header.length === CSV_HEADERS_V3.length && CSV_HEADERS_V3.every((h, i) => header[i] === h);
  const isV2 = !isV4 && !isV3 && header.length === CSV_HEADERS_V2.length && CSV_HEADERS_V2.every((h, i) => header[i] === h);
  const isV1 = !isV4 && !isV3 && !isV2 && header.length === CSV_HEADERS.length && CSV_HEADERS.every((h, i) => header[i] === h);
  if (!isV1 && !isV2 && !isV3 && !isV4) {
    errors.push({
      line: 1,
      message: `Unexpected header. Expected: ${CSV_HEADERS.join(",")} (optionally with id,createdAt[,updatedAt,deletedAt[,accountTypes]] appended)`,
    });
    return { transactions, errors, accountTypes };
  }
  const expectedColumns = isV4
    ? CSV_HEADERS_V4.length
    : isV3
      ? CSV_HEADERS_V3.length
      : isV2
        ? CSV_HEADERS_V2.length
        : CSV_HEADERS.length;

  /** How many rows with each content-identity we've seen so far in this file. */
  const identityCounts = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const fields = parseCsvLine(lines[i]!);
    if (fields.length !== expectedColumns) {
      errors.push({
        line: lineNumber,
        message: `Expected ${expectedColumns} columns, got ${fields.length}`,
      });
      continue;
    }

    const [
      date,
      account,
      destinationAccount,
      cashflowRaw,
      category,
      categoryTypeRaw,
      merchant,
      amountRaw,
      currency,
      notes,
      idField,
      createdAtField,
      updatedAtField,
      deletedAtField,
      accountTypesField,
    ] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string?,
      string?,
      string?,
      string?,
      string?,
    ];

    // Before the row checks, so a row that fails them still contributes
    // its config cell; the import is rejected anyway, but the cell's own
    // errors then show alongside the row's.
    if (accountTypesField && accountTypesField.trim()) {
      const cell = accountTypesField.trim();
      if (accountTypesCell !== null && accountTypesCell !== cell) {
        errors.push({ line: lineNumber, message: "accountTypes: a second, different config cell (only one row may set it)" });
      } else if (accountTypesCell === null) {
        accountTypesCell = cell;
        const parsed = parseAccountTypesCell(cell);
        if ("error" in parsed) errors.push({ line: lineNumber, message: parsed.error });
        else accountTypes = parsed.types;
      }
    }

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
    if (!isCategoryType(categoryTypeRaw)) {
      errors.push({ line: lineNumber, message: `Invalid category_type: "${categoryTypeRaw}"` });
      continue;
    }
    // Type first, then category: a blank category is how transfer and Lent
    // out / I owe rows are stored (domain usesCategory), so whether it is
    // missing depends on the type. Rejecting it for every type would make
    // the app's own export fail to re-import.
    if (!category && usesCategory(categoryTypeRaw)) {
      errors.push({ line: lineNumber, message: "Missing category" });
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

    const createdAt = createdAtField || `${date}T00:00:00.000Z`;

    // No id column (V1/V2): derive one from the row's content so that
    // importing this same file again — on this device, another device, or
    // another origin — produces the SAME id and sync can recognise it as
    // the same transaction. A random id here is what put three copies of
    // one 1456-row backup on Drive; see contentDerivedTransactionId.
    const identity = {
      date,
      account,
      destinationAccount: cashflowRaw === "none" ? destinationAccount : "",
      cashflow: cashflowRaw,
      category,
      categoryType: categoryTypeRaw,
      merchant: merchant ?? "",
      amountCents,
      notes: notes ?? "",
    };
    // Count identical earlier rows in THIS file, so two genuinely separate
    // but identical-looking transactions keep distinct ids.
    const identityKey = JSON.stringify(identity);
    const occurrence = identityCounts.get(identityKey) ?? 0;
    identityCounts.set(identityKey, occurrence + 1);

    transactions.push({
      id: idField || contentDerivedTransactionId(identity, occurrence),
      date,
      account,
      destinationAccount: cashflowRaw === "none" ? destinationAccount : "",
      cashflow: cashflowRaw,
      category,
      categoryType: categoryTypeRaw,
      merchant: merchant ?? "",
      amountCents,
      notes: notes ?? "",
      createdAt,
      // V1/V2 files predate Phase 15a and have neither field — default
      // updatedAt to createdAt (the row has never been edited since
      // import) and deletedAt to null (a tombstone is only ever written
      // by this app itself; no legacy format could represent one, so a
      // missing column always means "not deleted", never "unknown").
      updatedAt: updatedAtField || createdAt,
      deletedAt: deletedAtField ? deletedAtField : null,
    });
  }

  return { transactions, errors, accountTypes };
}

/**
 * RFC4180 field quoting: wrap in quotes and double any inner quote
 * whenever the field contains a comma, quote, or newline — exactly the
 * three characters parseCsvLine above treats specially. Three real rows
 * in the actual data have a comma inside `notes` (e.g. "Hamburg Service
 * vor Or, Hamburg DE"), so this is not a theoretical edge case.
 */
function quoteCsvField(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * The inverse of parseTransactionsCsv, producing CSV_HEADERS_V4 (legacy 10
 * columns + id + createdAt + updatedAt + deletedAt, Phase 15a, +
 * accountTypes 2026-11-11). `accountTypes` lands in the first row's last
 * cell; with no transactions there is no row to hold it, which is fine
 * because an empty file cannot be imported anyway. Round-trip
 * tested against the real 1,456-row backup (storage/__tests__/csv.test.ts):
 * parse -> serialize -> re-parse yields byte-for-byte identical Transaction
 * objects, INCLUDING id/createdAt/updatedAt/deletedAt — the fields the
 * legacy 10-column format cannot preserve. Callers decide whether to pass
 * tombstones in: Settings' human-facing export (features/settings) passes
 * only live transactions (useTransactions() already filters them), so a
 * deleted row doesn't reappear in a CSV someone opens in a spreadsheet;
 * a future sync/backup path that needs tombstone fidelity (e.g. a full
 * local-backup-before-import) would call
 * repository.getTransactionsIncludingDeleted() instead. This function
 * itself is agnostic — it serializes whatever array it's given. Always
 * writes amount as a positive decimal and currency=EUR (the app is
 * EUR-only; see decisions doc).
 */
export function serializeTransactionsCsv(
  transactions: Transaction[],
  accountTypes: Record<string, AccountType> = {},
): string {
  const lines = [CSV_HEADERS_V4.join(",")];
  const configCell = formatAccountTypesCell(accountTypes);
  for (const [index, tx] of transactions.entries()) {
    const fields = [
      tx.date,
      tx.account,
      tx.destinationAccount,
      tx.cashflow,
      tx.category,
      tx.categoryType,
      tx.merchant,
      centsToFixed(tx.amountCents),
      "EUR",
      tx.notes,
      tx.id,
      tx.createdAt,
      tx.updatedAt,
      tx.deletedAt ?? "",
      index === 0 ? configCell : "",
    ];
    lines.push(fields.map(quoteCsvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
