import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv, serializeTransactionsCsv, CSV_HEADERS, CSV_HEADERS_V2, CSV_HEADERS_V3, CSV_HEADERS_V4 } from "@/storage/csv";
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
  it("writes the v4 header (legacy 10 columns + id + createdAt + updatedAt + deletedAt + accountTypes)", () => {
    const csv = serializeTransactionsCsv([]);
    const [header] = csv.split("\r\n");
    expect(header).toBe(CSV_HEADERS_V4.join(","));
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

  it("round-trips the blank category that transfer and Lent out / I owe rows carry", () => {
    const rows = [
      makeTransaction({ id: "txn_t", cashflow: "none", categoryType: "transfer", category: "", destinationAccount: "REVO", merchant: "" }),
      makeTransaction({ id: "txn_r", categoryType: "receivable", category: "", merchant: "Friend" }),
      makeTransaction({ id: "txn_p", cashflow: "in", categoryType: "payable", category: "", merchant: "Friend" }),
    ];
    const { transactions, errors } = parseTransactionsCsv(serializeTransactionsCsv(rows));
    expect(errors).toEqual([]);
    expect(transactions).toEqual(rows);
  });

  it("still rejects a blank category on every type that uses one", () => {
    for (const categoryType of ["expense", "income", "non_expense", "non_income"] as const) {
      const csv = serializeTransactionsCsv([makeTransaction({ categoryType, category: "" })]);
      expect(parseTransactionsCsv(csv).errors.map((e) => e.message)).toEqual(["Missing category"]);
    }
  });

  // dummyData/ is gitignored real financial data — absent on a fresh clone.
  // skipIf, NOT an early `return` inside the test: a bare return reported
  // this as a PASS with zero assertions, hiding it even from the skip tally.
  it.skipIf(!existsSync(realCsvPath))("round-trips the entire real 1,456-row backup byte-for-byte equal, id and createdAt included", () => {
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

describe("import is idempotent across devices", () => {
  /**
   * The property that failed in production. A V1 file carries no id
   * column, so import has to invent one; it used to invent a RANDOM one.
   * The same backup imported on two origins therefore produced two
   * disjoint id sets, and because sync/merge.ts dedupes by id it kept both
   * — 1456 rows became 4368 on Drive, three copies of everything, with
   * nothing in the sync layer able to detect it.
   */
  const v1Csv = [
    CSV_HEADERS.join(","),
    "2026-10-17,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,",
    "2026-10-18,CMRZ,,out,Transport,expense,BVG,2.90,EUR,ticket",
  ].join("\n");

  it("assigns the same ids when the same file is imported twice", () => {
    const first = parseTransactionsCsv(v1Csv).transactions.map((t) => t.id);
    const second = parseTransactionsCsv(v1Csv).transactions.map((t) => t.id);

    // Two separate imports stand in for two devices or two origins: each
    // starts from nothing but the file itself.
    expect(first).toEqual(second);
  });

  it("keeps identical rows distinct, so no real transaction is lost", () => {
    const withDuplicate = [
      CSV_HEADERS.join(","),
      "2026-10-17,CMRZ,,out,Coffee,expense,Shop,3.00,EUR,",
      "2026-10-17,CMRZ,,out,Coffee,expense,Shop,3.00,EUR,",
    ].join("\n");

    const { transactions } = parseTransactionsCsv(withDuplicate);

    // Two identical coffees on one day is ordinary data. Collapsing them
    // would be the opposite failure to the one being fixed: quietly
    // deleting a real transaction instead of quietly duplicating one.
    expect(transactions).toHaveLength(2);
    expect(transactions[0]!.id).not.toBe(transactions[1]!.id);

    // And that pairing must itself be reproducible.
    const again = parseTransactionsCsv(withDuplicate).transactions;
    expect(again.map((t) => t.id)).toEqual(transactions.map((t) => t.id));
  });

  it("still honours an explicit id column when the file has one", () => {
    const v2Csv = [
      CSV_HEADERS_V2.join(","),
      "2026-10-17,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,,txn_explicit,2026-10-17T00:00:00.000Z",
    ].join("\n");

    const { transactions } = parseTransactionsCsv(v2Csv);

    // A file that already carries ids is authoritative; deriving over the
    // top would break round-tripping an export.
    expect(transactions[0]!.id).toBe("txn_explicit");
  });
});

describe("the accountTypes config cell (V4)", () => {
  const header = CSV_HEADERS_V4.join(",");
  const row = (cell: string, date = "2026-10-17") =>
    `${date},CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,,,,,,${cell}`;

  it("round-trips through serialize, on the first row only", () => {
    const tx: Transaction = {
      id: "txn_1",
      date: "2026-10-17",
      account: "ADVZ",
      destinationAccount: "",
      cashflow: "out",
      category: "Groceries",
      categoryType: "expense",
      merchant: "Edeka",
      amountCents: 1240,
      notes: "",
      createdAt: "2026-10-17T14:00:00.000Z",
      updatedAt: "2026-10-17T14:00:00.000Z",
      deletedAt: null,
    };
    const csv = serializeTransactionsCsv([tx, { ...tx, id: "txn_2" }], { SCLB: "investment", ADVZ: "credit_card" });
    const [, first, second] = csv.split("\r\n");

    // Sorted, so two exports of the same data diff cleanly.
    expect(first!.endsWith(",ADVZ=credit_card;SCLB=investment")).toBe(true);
    expect(second!.endsWith(",")).toBe(true);
    expect(parseTransactionsCsv(csv).accountTypes).toEqual({ ADVZ: "credit_card", SCLB: "investment" });
  });

  it("reads the cell from whichever row holds it (a spreadsheet sort moves it)", () => {
    const csv = [header, row(""), row(" CMRZ = cash ; ADVZ=credit_card ;")].join("\n");
    const result = parseTransactionsCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.accountTypes).toEqual({ CMRZ: "cash", ADVZ: "credit_card" });
  });

  it("is null when no row holds it, so the importer can reject the file", () => {
    expect(parseTransactionsCsv([header, row("")].join("\n")).accountTypes).toBeNull();
  });

  it("accepts the same cell twice but rejects two different ones", () => {
    const same = parseTransactionsCsv([header, row("CMRZ=cash"), row("CMRZ=cash")].join("\n"));
    expect(same.errors).toEqual([]);

    const different = parseTransactionsCsv([header, row("CMRZ=cash"), row("CMRZ=investment")].join("\n"));
    expect(different.errors).toEqual([
      { line: 3, message: "accountTypes: a second, different config cell (only one row may set it)" },
    ]);
  });

  it("rejects an unknown type, a pair without =, and one account given two types", () => {
    const msg = (cell: string) => parseTransactionsCsv([header, row(cell)].join("\n")).errors.map((e) => e.message);

    expect(msg("CMRZ=savings")).toEqual([
      'accountTypes: "CMRZ" has type "savings", expected one of cash, investment, credit_card',
    ]);
    expect(msg("CMRZ")).toEqual(['accountTypes: "CMRZ" is not NAME=type']);
    expect(msg("CMRZ=cash;CMRZ=investment")).toEqual(['accountTypes: "CMRZ" is listed as both cash and investment']);
  });
});
