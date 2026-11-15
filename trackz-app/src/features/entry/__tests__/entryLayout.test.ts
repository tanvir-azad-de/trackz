import { describe, expect, it } from "vitest";
import { CATEGORY_TYPES } from "@/domain/transaction";
import { directionLabel, entryTiles, tileLabel } from "@/features/entry/entryLayout";

describe("entryTiles", () => {
  it("gives the everyday types Category and Merchant", () => {
    for (const t of ["expense", "income", "non_expense", "non_income"] as const) {
      expect(entryTiles(t)).toEqual(["type", "date", "account", "category", "merchant", "notes"]);
    }
  });

  it("gives Transfer From/To and no Category or Merchant", () => {
    expect(entryTiles("transfer")).toEqual(["type", "date", "account", "destination", "notes"]);
  });

  it("gives Lent out / I owe a Direction in place of Category", () => {
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

  it("words Direction per type", () => {
    expect(directionLabel("receivable", "out")).toBe("Lending out");
    expect(directionLabel("receivable", "in")).toBe("Getting repaid");
    expect(directionLabel("payable", "out")).toBe("Borrowing");
    expect(directionLabel("payable", "in")).toBe("Repaying");
  });
});
