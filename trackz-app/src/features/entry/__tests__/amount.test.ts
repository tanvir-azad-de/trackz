import { describe, expect, it } from "vitest";
import {
  appendDigit,
  clearAmount,
  deleteDigit,
  emptyAmount,
  entryToCents,
  entryToDisplay,
  isEmptyAmount,
} from "@/features/entry/amount";

describe("amount entry (ATM cent accumulator)", () => {
  it("starts empty / zero", () => {
    const e = emptyAmount();
    expect(entryToCents(e)).toBe(0);
    expect(isEmptyAmount(e)).toBe(true);
  });

  it("builds 12,40 from digits 1,2,4,0 (the common Groceries/Edeka case)", () => {
    let e = emptyAmount();
    for (const d of ["1", "2", "4", "0"]) e = appendDigit(e, d);
    expect(entryToCents(e)).toBe(1240);
    expect(entryToDisplay(e)).toBe("12,40");
    expect(isEmptyAmount(e)).toBe(false);
  });

  it("builds a whole-euro amount like rent (960,00)", () => {
    let e = emptyAmount();
    for (const d of ["9", "6", "0", "0", "0"]) e = appendDigit(e, d);
    expect(entryToCents(e)).toBe(96000);
    expect(entryToDisplay(e)).toBe("960,00");
  });

  it("collapses leading zeros instead of accumulating them", () => {
    let e = emptyAmount();
    e = appendDigit(e, "0");
    e = appendDigit(e, "0");
    e = appendDigit(e, "5");
    expect(entryToCents(e)).toBe(5);
    expect(entryToDisplay(e)).toBe("0,05");
  });

  it("rejects non-digit input", () => {
    const e = emptyAmount();
    expect(appendDigit(e, ".")).toEqual(e);
    expect(appendDigit(e, "a")).toEqual(e);
    expect(appendDigit(e, "-")).toEqual(e);
  });

  it("caps at 9 digits so it can never overflow a safe integer", () => {
    let e = emptyAmount();
    for (let i = 0; i < 12; i++) e = appendDigit(e, "9");
    expect(e.digits.length).toBe(9);
    const again = appendDigit(e, "9");
    expect(again).toEqual(e); // 10th digit rejected, no change
  });

  it("deletes from the right, one digit at a time", () => {
    let e = emptyAmount();
    for (const d of ["1", "2", "4", "0"]) e = appendDigit(e, d);
    e = deleteDigit(e);
    expect(entryToCents(e)).toBe(124);
    expect(entryToDisplay(e)).toBe("1,24");
  });

  it("delete past empty is a no-op", () => {
    const e = emptyAmount();
    expect(deleteDigit(e)).toEqual(e);
  });

  it("clear resets to empty regardless of prior state", () => {
    let e = emptyAmount();
    for (const d of ["5", "5", "5"]) e = appendDigit(e, d);
    expect(clearAmount()).toEqual(emptyAmount());
    expect(isEmptyAmount(clearAmount())).toBe(true);
    void e;
  });
});
