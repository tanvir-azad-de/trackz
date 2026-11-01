import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv, serializeTransactionsCsv, CSV_HEADERS, CSV_HEADERS_V2, CSV_HEADERS_V3 } from "@/storage/csv";
import type { Transaction } from "@/domain/transaction";

/**
 * Phase 13a (CSV import/export), extended in Phase 15a: proves
 * serializeTransactionsCsv is a true inverse of parseTransactionsCsv,
 * including the fields the legacy 10-column format cannot round-trip
 * (id, createdAt, and — since Phase 15a — updatedAt/deletedAt) — see the
 * header comments in storage/csv.ts for why that matters (same-day
 * ordering in the Activity list sorts by createdAt desc; updatedAt is
 * sync/merge.ts's last-writer-wins key).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../.."); // src/storage/__tests__ -> trackz-app -> trackz
const realCsvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_test-1",
    date: "2026-10-17",
    account: "CMRZ",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant: "Edeka",
    amountCents: 1240,
    notes: "",
    createdAt: "2026-10-17T14:32:00.000Z",
    updatedAt: "2026-10-17T14:32:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("serializeTransactionsCsv", () => {
  it("writes the v3 header (legacy 10 columns + id + createdAt + updatedAt + deletedAt)", () => {
    const csv = serializeTransactionsCsv([]);
    const [header] = csv.split("\r\n");
    expect(header).toBe(CSV_HEADERS_V3.join(","));
  });

  it("round-trips a single transaction through parse, including id/createdAt/updatedAt/deletedAt", () => {
    const original = makeTransaction();
    const csv = serializeTransactionsCsv([original]);
    const { transactions, errors } = parseTransactionsCsv(csv);
    expect(errors).toEqual([]);
    expect(transactions).toEqual([original]);
  });

  it("round-trips a tombstoned transaction (deletedAt set) — a delete must not get silently dropped on export", () => {
    const original = makeTransaction({ deletedAt: "2026-10-18T09:00:00.000Z" });
    const csv = serializeTransactionsCsv([original]);
    const { transactions, errors } = parseTransactionsCsv(csv);
    expect(errors).toEqual([]);
    expect(transactions[0]!.deletedAt).toBe("2026-10-18T09:00:00.000Z");
  });

  it("quotes a comma inside notes (real data has this: 'Hamburg Service vor Or, Hamburg DE')", () => {
    const original = makeTransaction({ notes: "Hamburg Service vor Or, Hamburg DE" });
    const csv = serializeTransactionsCsv([original]);
    expect(csv).toContain('"Hamburg Service vor Or, Hamburg DE"');
    const { transactions, errors } = parseTransactionsCsv(csv);
    expect(errors).toEqual([]);
    expect(transactions[0]!.notes).toBe("Hamburg Service vor Or, Hamburg DE");
  });

  it("doubles an embedded quote and round-trips it correctly", () => {
    const original = makeTransaction({ notes: 'He said "hi" there' });
    const csv = serializeTransactionsCsv([original]);
    const { transactions, errors } = parseTransactionsCsv(csv);
    expect(errors).toEqual([]);
    expect(transactions[0]!.notes).toBe('He said "hi" there');
  });

  it("preserves a transfer's destinationAccount", () => {
    const original = makeTransaction({
      cashflow: "none",
      categoryType: "transfer",
      category: "Transfer",
      account: "CMRZ",
      destinationAccount: "REVO",
      merchant: "",
    });
    const csv = serializeTransactionsCsv([original]);
    const { transactions, errors } = parseTransactionsCsv(csv);
    expect(errors).toEqual([]);
    expect(transactions[0]).toEqual(original);
  });

  it("round-trips the entire real 1,456-row backup byte-for-byte equal, id and createdAt included", () => {
    if (!existsSync(realCsvPath)) {
      // dummyData/ is gitignored real financial data — absent on CI/fresh
      // clone. Skip rather than fail; the single-transaction cases above
      // already cover the same logic.
      return;
    }
    const realCsv = readFileSync(realCsvPath, "utf-8");
    const first = parseTransactionsCsv(realCsv);
    expect(first.errors).toEqual([]);

    const exported = serializeTransactionsCsv(first.transactions);
    const second = parseTransactionsCsv(exported);
    expect(second.errors).toEqual([]);
    expect(second.transactions).toEqual(first.transactions);
  });
});

describe("parseTransactionsCsv accepts v1/v2/v3 header formats", () => {
  it("still parses the legacy 10-column format (old backups must keep working)", () => {
    const legacyCsv = [
      CSV_HEADERS.join(","),
      "2026-10-17,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,",
    ].join("\n");
    const { transactions, errors } = parseTransactionsCsv(legacyCsv);
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.merchant).toBe("Edeka");
    expect(transactions[0]!.amountCents).toBe(1240);
    // Legacy format has none of id/createdAt/updatedAt/deletedAt: all
    // must be synthesized to sane defaults, not left undefined.
    expect(transactions[0]!.id).toMatch(/^txn_/);
    expect(transactions[0]!.createdAt).toBe("2026-10-17T00:00:00.000Z");
    expect(transactions[0]!.updatedAt).toBe("2026-10-17T00:00:00.000Z");
    expect(transactions[0]!.deletedAt).toBeNull();
  });

  it("parses the v2 format (id+createdAt, no updatedAt/deletedAt) and defaults updatedAt to createdAt", () => {
    const v2Csv = [
      CSV_HEADERS_V2.join(","),
      "2026-10-17,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,,txn_fixed-id,2026-10-17T09:15:00.000Z",
    ].join("\n");
    const { transactions, errors } = parseTransactionsCsv(v2Csv);
    expect(errors).toEqual([]);
    expect(transactions[0]!.id).toBe("txn_fixed-id");
    expect(transactions[0]!.createdAt).toBe("2026-10-17T09:15:00.000Z");
    // No updatedAt column in v2 — a v1/v2 file predates any edit tracking,
    // so "last updated" can only mean "at creation".
    expect(transactions[0]!.updatedAt).toBe("2026-10-17T09:15:00.000Z");
    expect(transactions[0]!.deletedAt).toBeNull();
  });

  it("parses the v3 format and preserves its explicit updatedAt/deletedAt rather than defaulting them", () => {
    const v3Csv = [
      CSV_HEADERS_V3.join(","),
      "2026-10-17,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,,txn_fixed-id,2026-10-17T09:15:00.000Z,2026-10-18T11:00:00.000Z,",
    ].join("\n");
    const { transactions, errors } = parseTransactionsCsv(v3Csv);
    expect(errors).toEqual([]);
    expect(transactions[0]!.updatedAt).toBe("2026-10-18T11:00:00.000Z");
    expect(transactions[0]!.deletedAt).toBeNull();
  });

  it("parses a v3 tombstone row (deletedAt populated)", () => {
    const v3Csv = [
      CSV_HEADERS_V3.join(","),
      "2026-10-17,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,,txn_fixed-id,2026-10-17T09:15:00.000Z,2026-10-18T11:00:00.000Z,2026-10-18T11:00:00.000Z",
    ].join("\n");
    const { transactions, errors } = parseTransactionsCsv(v3Csv);
    expect(errors).toEqual([]);
    expect(transactions[0]!.deletedAt).toBe("2026-10-18T11:00:00.000Z");
  });

  it("rejects an unrecognized header", () => {
    const badCsv = ["date,account,amount", "2026-10-17,CMRZ,12.40"].join("\n");
    const { errors } = parseTransactionsCsv(badCsv);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/Unexpected header/);
  });

  it("rejects a v2-shaped file with the wrong column count per row", () => {
    const malformed = [CSV_HEADERS_V2.join(","), "2026-10-17,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR"].join("\n");
    const { errors } = parseTransactionsCsv(malformed);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/Expected 12 columns, got 9/);
  });
});
