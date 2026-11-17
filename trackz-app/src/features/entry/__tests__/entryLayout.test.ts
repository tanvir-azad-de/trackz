import { describe, expect, it } from "vitest";
import { CATEGORY_TYPES } from "@/domain/transaction";
import { DIRECTIONS, directionLabel, entryTiles, tileLabel } from "@/features/entry/entryLayout";

describe("entryTiles", () => {
  it("gives the everyday types Category and Merchant", () => {
    for (const t of ["expense", "income", "non_expense", "non_income"] as const) {
      expect(entryTiles(t)).toEqual(["type", "date", "account", "category", "merchant", "notes"]);
    }
  });

  it("gives Transfer From/To and no Category or Merchant", () => {
    expect(entryTiles("transfer")).toEqual(["type", "date", "account", "destination", "notes"]);
  });

  it("gives Lent / Borrowed a Direction in place of Category", () => {
    expect(entryTiles("receivable")).toEqual(["type", "date", "account", "direction", "merchant", "notes"]);
    expect(entryTiles("payable")).toEqual(["type", "date", "account", "direction", "merchant", "notes"]);
  });

  it("never needs a 4th row, so the keypad height never changes with the type", () => {
    for (const t of CATEGORY_TYPES) expect(Math.ceil(entryTiles(t).length / 2)).toBe(3);
  });
});

describe("tileLabel / directionLabel", () => {
  it("names the transfer accounts From and To", () => {
    expect(tileLabel("account", "transfer")).toBe("From");
    expect(tileLabel("account", "expense")).toBe("Account");
    expect(tileLabel("destination", "transfer")).toBe("To");
  });

  it("words Direction as Cash in / Cash out", () => {
    // The direction IS the stored cashflow (draft.test.ts pins that), so
    // Lent's Cash out is lending and Borrowed's Cash in is borrowing.
    expect(DIRECTIONS.map(directionLabel)).toEqual(["Cash in", "Cash out"]);
  });

  it("calls the merchant tile Merchant on Lent / Borrowed too, which can name a bank or a company", () => {
    expect(tileLabel("merchant", "receivable")).toBe("Merchant");
    expect(tileLabel("merchant", "payable")).toBe("Merchant");
  });

});
