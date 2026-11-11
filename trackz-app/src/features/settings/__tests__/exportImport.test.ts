import { describe, expect, it } from "vitest";
import { buildExportCsv, canCommit, exportFileName, previewImport } from "@/features/settings/exportImport";
import { CSV_HEADERS_V2, CSV_HEADERS_V3, parseTransactionsCsv, serializeTransactionsCsv } from "@/storage/csv";
import type { Transaction } from "@/domain/transaction";

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_1",
    date: "2026-10-17",
    account: "CMRZ",
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
    ...overrides,
  };
}

describe("exportFileName", () => {
  it("embeds the given date into a trackz-backup-*.csv name", () => {
    expect(exportFileName("2026-10-31")).toBe("trackz-backup-2026-10-31.csv");
  });
});

describe("buildExportCsv", () => {
  it("writes a type for EVERY account, defaulting the unclassified ones to cash", () => {
    const csv = buildExportCsv(
      [
        makeTransaction({ id: "txn_1", account: "ADVZ" }),
        // SCLB only as a destination, as in the real data.
        makeTransaction({ id: "txn_2", account: "CMRZ", cashflow: "none", categoryType: "transfer", category: "", destinationAccount: "SCLB" }),
      ],
      { ADVZ: "credit_card", SCLB: "investment", Unused: "investment" },
    );

    // CMRZ has no entry and is written as cash, else the app's own export
    // would fail its own import ("no type for CMRZ"). Unused has no rows
    // and is dropped.
    expect(parseTransactionsCsv(csv).accountTypes).toEqual({ ADVZ: "credit_card", CMRZ: "cash", SCLB: "investment" });
    expect(canCommit(previewImport("backup.csv", csv))).toBe(true);
  });
});

describe("previewImport", () => {
  it("summarizes a clean v2 CSV: valid count, derived counts, and KPI figures", () => {
    const csv = serializeTransactionsCsv([
      makeTransaction({ id: "txn_1", account: "CMRZ", category: "Groceries", merchant: "Edeka", amountCents: 1000 }),
      makeTransaction({
        id: "txn_2",
        account: "CMRZ",
        category: "Salary",
        categoryType: "income",
        cashflow: "in",
        merchant: "Employer",
        amountCents: 500000,
      }),
    ], { CMRZ: "cash" });
    const preview = previewImport("backup.csv", csv);

    expect(preview.fileName).toBe("backup.csv");
    expect(preview.totalRows).toBe(2);
    expect(preview.validCount).toBe(2);
    expect(preview.errors).toEqual([]);
    expect(preview.transactions).toHaveLength(2);
    expect(preview.accountCount).toBe(1); // CMRZ only
    expect(preview.categoryCount).toBe(2); // Groceries, Salary
    expect(preview.merchantCount).toBe(2); // Edeka, Employer
    expect(preview.liquidCashCents).toBe(500000 - 1000);
    expect(canCommit(preview)).toBe(true);
  });

  it("takes account types from the FILE, so Liquid excludes its investment and credit-card accounts", () => {
    const csv = serializeTransactionsCsv(
      [
        makeTransaction({ id: "txn_1", account: "CASH", amountCents: 1000 }),
        makeTransaction({ id: "txn_2", account: "SCLB", category: "Salary", categoryType: "income", cashflow: "in", amountCents: 500000 }),
        makeTransaction({ id: "txn_3", account: "ADVZ", amountCents: 7000 }),
      ],
      { CASH: "cash", SCLB: "investment", ADVZ: "credit_card" },
    );

    const preview = previewImport("backup.csv", csv);

    expect(preview.liquidCashCents).toBe(-1000); // CASH only
    expect(preview.accountTypes).toEqual({ CASH: "cash", SCLB: "investment", ADVZ: "credit_card" });
    expect(canCommit(preview)).toBe(true);
  });

  it("rejects a file with no accountTypes cell (user decision: no default to cash)", () => {
    const v3 = [
      CSV_HEADERS_V3.join(","),
      "2026-10-17,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,,txn_1,2026-10-17T00:00:00.000Z,2026-10-17T00:00:00.000Z,",
    ].join("\n");

    const preview = previewImport("old.csv", v3);

    expect(preview.errors.map((e) => e.message)).toEqual([expect.stringContaining("No accountTypes config cell")]);
    expect(canCommit(preview)).toBe(false);
  });

  it("rejects a file whose cell leaves an account untyped, naming it", () => {
    const csv = serializeTransactionsCsv(
      [
        makeTransaction({ id: "txn_1", account: "CMRZ" }),
        makeTransaction({ id: "txn_2", account: "CMRZ", cashflow: "none", categoryType: "transfer", category: "", destinationAccount: "SCLB" }),
      ],
      { CMRZ: "cash" },
    );

    const preview = previewImport("backup.csv", csv);

    // SCLB is only a destination; checking `account` alone would miss it
    // and SCLB would land in Liquid.
    expect(preview.errors.map((e) => e.message)).toEqual(["accountTypes: no type for SCLB"]);
    expect(preview.transactions).toEqual([]);
    expect(preview.accountTypes).toEqual({});
  });

  it("is all-or-nothing: any row error empties transactions and blocks commit", () => {
    const badCsv = [CSV_HEADERS_V2.join(","), "not-a-date,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,,txn_1,2026-10-17T00:00:00.000Z"].join(
      "\n",
    );
    const preview = previewImport("bad.csv", badCsv);

    expect(preview.errors).toHaveLength(1);
    expect(preview.transactions).toEqual([]);
    expect(preview.accountCount).toBe(0);
    expect(canCommit(preview)).toBe(false);
  });

  it("caps the displayed error list at 5 but reports the true total count", () => {
    const rows = Array.from({ length: 8 }, () => "not-a-date,CMRZ,,out,Groceries,expense,Edeka,12.40,EUR,,txn_1,2026-10-17T00:00:00.000Z");
    const badCsv = [CSV_HEADERS_V2.join(","), ...rows].join("\n");
    const preview = previewImport("bad.csv", badCsv);

    expect(preview.errors).toHaveLength(8);
    expect(preview.errorPreview).toHaveLength(5);
  });

  it("rejects an unrecognized header as a single preview-level error, zero valid rows", () => {
    const preview = previewImport("wrong.csv", "a,b,c\n1,2,3");
    expect(preview.errors).toHaveLength(1);
    expect(canCommit(preview)).toBe(false);
  });

  it("an empty file (header only) is a valid, empty import, not an error — but cannot be committed", () => {
    const preview = previewImport("empty.csv", CSV_HEADERS_V2.join(",") + "\n");
    expect(preview.errors).toEqual([]);
    expect(preview.validCount).toBe(0);
    expect(canCommit(preview)).toBe(false); // nothing to replace data WITH
  });
});
