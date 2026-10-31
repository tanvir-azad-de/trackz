import { describe, expect, it } from "vitest";
import { addCents, centsToFixed, formatEUR, toCents } from "@/domain/money";

describe("money (integer cents)", () => {
  it("converts decimal strings to exact cents", () => {
    expect(toCents("12.40")).toBe(1240);
    expect(toCents("0.1")).toBe(10);
    expect(toCents("9")).toBe(900);
  });

  it("sums many small amounts without float drift (old bug: 0.1 x10 != 1.00)", () => {
    const tenDimes = Array.from({ length: 10 }, () => toCents("0.1"));
    expect(addCents(...tenDimes)).toBe(100); // exactly 1.00 EUR, not 0.9999999999999999
  });

  it("formats negative zero as a plain zero, never '-0,00 €' (old formatMoney bug)", () => {
    const negativeZeroCents = Math.round(-0.001 * 100); // old code's reproduction path
    expect(formatEUR(negativeZeroCents)).not.toContain("-0,00");
  });

  it("centsToFixed renders without a currency symbol", () => {
    expect(centsToFixed(123456)).toBe("1234.56");
    expect(centsToFixed(-500)).toBe("5.00"); // caller applies sign separately
  });
});
