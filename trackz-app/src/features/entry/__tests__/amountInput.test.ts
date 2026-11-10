import { describe, expect, it } from "vitest";
import { amountInputFromCents, parseAmountInput } from "@/features/entry/amountInput";

describe("parseAmountInput", () => {
  it("reads a comma as the decimal separator", () => {
    expect(parseAmountInput("12,40")).toBe(1240);
  });

  it("reads a dot as the decimal separator", () => {
    expect(parseAmountInput("12.40")).toBe(1240);
  });

  it("pads a single decimal to tens of cents, not cents", () => {
    expect(parseAmountInput("12,4")).toBe(1240);
    expect(parseAmountInput("0,05")).toBe(5);
  });

  it("accepts whole euros, a trailing separator, and a leading one", () => {
    expect(parseAmountInput("7")).toBe(700);
    expect(parseAmountInput("7,")).toBe(700);
    expect(parseAmountInput(",5")).toBe(50);
    expect(parseAmountInput(" 3,10 ")).toBe(310);
  });

  it("parses exact cents for float-unfriendly values", () => {
    // 4.35 * 100 is 434.99999999999994 in floats; the digit-string parse never goes there.
    expect(parseAmountInput("4,35")).toBe(435);
    expect(parseAmountInput("1234567,89")).toBe(123456789);
  });

  it("rejects blank, negatives, 3 decimals, thousands separators and junk", () => {
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput(",")).toBeNull();
    expect(parseAmountInput("-5")).toBeNull();
    expect(parseAmountInput("1,234")).toBeNull();
    expect(parseAmountInput("1.234,50")).toBeNull();
    expect(parseAmountInput("12a")).toBeNull();
    expect(parseAmountInput("1e3")).toBeNull();
  });

  it("caps at 8 integer digits", () => {
    expect(parseAmountInput("99999999,99")).toBe(9999999999);
    expect(parseAmountInput("100000000")).toBeNull();
  });
});

describe("amountInputFromCents", () => {
  it("formats with a comma and 2 decimals, and 0 as blank", () => {
    expect(amountInputFromCents(1240)).toBe("12,40");
    expect(amountInputFromCents(5)).toBe("0,05");
    expect(amountInputFromCents(0)).toBe("");
  });
});
