import { describe, expect, it } from "vitest";
import { getCategoryDeltasForMonth, getMostSurprisingDeltas, type CategoryDelta } from "@/insights/engine";
import type { Transaction } from "@/domain/transaction";

/**
 * Synthetic, so it runs without the gitignored real data. The real-data
 * check with exact cents is in engine.test.ts.
 */
let seq = 0;
function spend(date: string, category: string, amountCents: number): Transaction {
  seq++;
  return {
    id: `t${seq}`,
    date,
    account: "ADVZ",
    destinationAccount: "",
    cashflow: "out",
    category,
    categoryType: "expense",
    merchant: "",
    amountCents,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

function deltaFor(txs: Transaction[], category: string, asOf: string, monthKey = asOf.slice(0, 7)) {
  return getCategoryDeltasForMonth(txs, monthKey, 6, asOf).find((d) => d.category === category);
}

describe("getCategoryDeltasForMonth: same days of past months", () => {
  it("compares a bill paid on the same day each month like for like, not against a prorated average", () => {
    // 72 € on the 7th of each of the last 4 months, and of this one. On the
    // 9th the old proration said usual = 9/30 of 72 € and "up 233%".
    const txs = ["2026-07-07", "2026-08-07", "2026-09-07", "2026-10-07", "2026-11-07"].map((d) => spend(d, "Electricity", 7200));
    expect(deltaFor(txs, "Electricity", "2026-11-09")).toMatchObject({ thisMonthCents: 7200, baselineAvgCents: 7200, deltaCents: 0, deltaPercent: 0, isNew: false });
  });

  it("leaves out past spend after the as-of day, and this month's after it too", () => {
    const txs = [spend("2026-10-05", "Food", 1000), spend("2026-10-20", "Food", 9000), spend("2026-11-05", "Food", 3000), spend("2026-11-25", "Food", 50000)];
    expect(deltaFor(txs, "Food", "2026-11-10")).toMatchObject({ thisMonthCents: 3000, baselineAvgCents: 1000 });
  });

  it("divides by the months the category had ANY spend, counting a month whose spend falls outside the window", () => {
    // Oct: 1000 in the window. Sep: spend only on the 25th, so 0 in the
    // window but still a month the category was used. Jun-Aug: nothing,
    // so not counted. Usual = (1000 + 0) / 2.
    const txs = [spend("2026-10-03", "Food", 1000), spend("2026-09-25", "Food", 7000), spend("2026-11-03", "Food", 2000)];
    expect(deltaFor(txs, "Food", "2026-11-10")).toMatchObject({ baselineAvgCents: 500, deltaCents: 1500, deltaPercent: 300 });
  });

  it("ignores months older than the baseline window", () => {
    const txs = [spend("2026-04-03", "Food", 99900), spend("2026-10-03", "Food", 1000), spend("2026-11-03", "Food", 1000)];
    expect(deltaFor(txs, "Food", "2026-11-10")).toMatchObject({ baselineAvgCents: 1000 });
  });

  it("uses a shorter past month's whole length when the as-of day is past its end", () => {
    // On Oct 31, September's window is its full 30 days.
    const txs = [spend("2026-09-30", "Food", 4000), spend("2026-10-31", "Food", 4000)];
    expect(deltaFor(txs, "Food", "2026-10-31")).toMatchObject({ baselineAvgCents: 4000, deltaCents: 0 });
  });

  it("flags a category with no spend in any baseline month as new", () => {
    const txs = [spend("2026-11-02", "Health Insurance", 11000), spend("2026-10-02", "Food", 100)];
    expect(deltaFor(txs, "Health Insurance", "2026-11-10")).toMatchObject({ thisMonthCents: 11000, baselineAvgCents: 0, deltaCents: 11000, deltaPercent: null, isNew: true });
    expect(deltaFor(txs, "Food", "2026-11-10")).toBeUndefined(); // nothing yet this month: not listed
  });

  it("rounds the usual figure half-up to whole cents", () => {
    const txs = [spend("2026-10-01", "Food", 101), spend("2026-09-01", "Food", 100), spend("2026-11-01", "Food", 100)];
    expect(deltaFor(txs, "Food", "2026-11-10")!.baselineAvgCents).toBe(101); // 100.5 -> 101
  });
});

describe("getMostSurprisingDeltas", () => {
  function d(category: string, deltaCents: number, extra: Partial<CategoryDelta> = {}): CategoryDelta {
    return { category, thisMonthCents: 0, baselineAvgCents: 0, deltaCents, deltaPercent: 10, isNew: false, ...extra };
  }

  it("drops changes under 10 €, keeping exactly 10 €, in either direction", () => {
    const out = getMostSurprisingDeltas([d("a", 999), d("b", 1000), d("c", -999), d("e", -1000)]);
    expect(out.map((x) => x.category)).toEqual(["b", "e"]);
  });

  it("keeps new categories and no-percentage changes, ranked by size, top 4", () => {
    const out = getMostSurprisingDeltas([
      d("new", 11000, { isNew: true, deltaPercent: null }),
      d("early bill", 7200, { deltaPercent: null }),
      d("down", -20000),
      d("small", 1500),
      d("mid", 3000),
    ]);
    expect(out.map((x) => x.category)).toEqual(["down", "new", "early bill", "mid"]);
  });
});
