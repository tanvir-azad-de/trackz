import { describe, expect, it } from "vitest";
import { categoryShares, formatPercent } from "@/features/home/categoryShares";

describe("categoryShares", () => {
  it("gives each category's share of the passed total to one decimal", () => {
    const shares = categoryShares(
      [
        { category: "Rent", amountCents: 150000 },
        { category: "Food", amountCents: 48000 },
        { category: "Bus", amountCents: 12000 },
      ],
      210000,
    );
    expect(shares.map((s) => s.percent)).toEqual([71.4, 22.9, 5.7]);
    expect(shares.map((s) => s.barPercent)).toEqual([71.4, 22.9, 5.7]);
  });

  it("measures against the passed total, not the sum of positive rows, and clamps the bar of a negative row", () => {
    const shares = categoryShares(
      [
        { category: "Food", amountCents: 10000 },
        { category: "Returns", amountCents: -2000 },
      ],
      8000,
    );
    expect(shares.map((s) => s.percent)).toEqual([125, -25]);
    expect(shares.map((s) => s.barPercent)).toEqual([100, 0]);
  });

  it("has no percent when the month's total is zero", () => {
    expect(categoryShares([{ category: "Food", amountCents: 0 }], 0)[0]).toEqual({ category: "Food", amountCents: 0, percent: null, barPercent: 0 });
  });

  it("formats with a de-style comma", () => {
    expect(formatPercent(38.2)).toBe("38,2%");
    expect(formatPercent(100)).toBe("100,0%");
  });
});
