import { describe, expect, it } from "vitest";
import { buildExportCsv, canCommit, exportFileName, previewImport } from "@/features/settings/exportImport";
import { CSV_HEADERS_V2, serializeTransactionsCsv } from "@/storage/csv";
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
  it("delegates to serializeTransactionsCsv (v2 header)", () => {
    const tx = makeTransaction();
    expect(buildExportCsv([tx])).toBe(serializeTransactionsCsv([tx]));
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
    ]);
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

  it("excludes investment accounts from liquidCashCents when given the current accountTypes map (regression: preview must match what Home shows after commit)", () => {
    // Caught live via Playwright during this phase's own verification:
    // re-importing the real backup showed "Liquid 3.147,07 €" in this
    // preview, but Home immediately showed "847,07 €" for the exact
    // same data once committed, because accountTypes.ts's SCLB=
    // investment classification is a SEPARATE store (keyed by account
    // name) that survives a transaction import untouched — the preview
    // must honor it too, or it's lying about what's about to happen.
    const csv = serializeTransactionsCsv([
      makeTransaction({ id: "txn_1", account: "CASH", amountCents: 1000 }),
      makeTransaction({
        id: "txn_2",
        account: "SCLB",
        category: "Salary",
        categoryType: "income",
        cashflow: "in",
        merchant: "Employer",
        amountCents: 500000,
      }),
    ]);

    const withoutClassification = previewImport("backup.csv", csv);
    expect(withoutClassification.liquidCashCents).toBe(500000 - 1000); // SCLB counted as cash by default

    const withClassification = previewImport("backup.csv", csv, { SCLB: "investment" });
    expect(withClassification.liquidCashCents).toBe(-1000); // SCLB excluded
    expect(withClassification.totalAssetsCents).toBe(500000 - 1000); // unaffected by classification
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
