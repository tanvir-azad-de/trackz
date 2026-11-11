import { describe, expect, it } from "vitest";
import { netWorthSegments } from "@/features/home/netWorthBar";
import type { BalanceSheet } from "@/insights/engine";

function sheet(liquid: number, other: number, liabilities: number): BalanceSheet {
  return {
    netWorthCents: liquid + other - liabilities,
    liquid: { totalCents: liquid, rows: [] },
    other: { totalCents: other, rows: [] },
    liabilities: { totalCents: liabilities, rows: [] },
  };
}

describe("netWorthSegments", () => {
  it("weights each segment by its bucket total, in Liquid, Other, Owed order", () => {
    expect(netWorthSegments(sheet(432100, 900000, 47533))).toEqual([
      { key: "liquid", weightCents: 432100 },
      { key: "other", weightCents: 900000 },
      { key: "liabilities", weightCents: 47533 },
    ]);
  });

  it("drops zero and negative totals: no liabilities, an overdrawn cash total", () => {
    expect(netWorthSegments(sheet(-5000, 900000, 0))).toEqual([{ key: "other", weightCents: 900000 }]);
  });
});
