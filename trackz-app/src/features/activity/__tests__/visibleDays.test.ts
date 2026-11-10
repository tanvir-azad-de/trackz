import { describe, expect, it } from "vitest";
import { groupByMonthAndDay, takeVisibleDays } from "@/features/activity/group";
import type { Transaction } from "@/domain/transaction";

let seq = 0;
function tx(date: string, amountCents: number, cashflow: "in" | "out" = "out"): Transaction {
  seq += 1;
  return {
    id: `txn_${seq}`, date, account: "ADVZ", destinationAccount: "", cashflow,
    category: "Groceries", categoryType: cashflow === "in" ? "income" : "expense", merchant: "Edeka",
    amountCents, notes: "", createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", deletedAt: null,
  };
}

// Date-descending, as filterTransactions returns it. Two months, three days, 5 rows.
const months = groupByMonthAndDay([
  tx("2026-11-10", 2348), tx("2026-11-10", 420), tx("2026-11-10", 285000, "in"),
  tx("2026-11-07", 1890),
  tx("2026-10-31", 6120),
]);

describe("takeVisibleDays", () => {
  it("flattens days across months, newest first", () => {
    const { days, hasMore } = takeVisibleDays(months, 100);
    expect(days.map((d) => d.date)).toEqual(["2026-11-10", "2026-11-07", "2026-10-31"]);
    expect(hasMore).toBe(false);
  });

  it("cuts mid-day by rows, keeping the FULL day's net on the cut card", () => {
    const { days, hasMore } = takeVisibleDays(months, 2);
    expect(days).toHaveLength(1);
    expect(days[0]!.transactions).toHaveLength(2);
    expect(days[0]!.netCents).toBe(285000 - 2348 - 420); // 282232, all three rows
    expect(hasMore).toBe(true);
  });

  it("counts rows only, not day headers", () => {
    // 4 rows = the whole of 10 Nov (3) + 7 Nov (1). Counting headers would stop earlier.
    const { days, hasMore } = takeVisibleDays(months, 4);
    expect(days.map((d) => [d.date, d.transactions.length])).toEqual([["2026-11-10", 3], ["2026-11-07", 1]]);
    expect(hasMore).toBe(true);
  });

  it("reports no more when the budget ends exactly on the last row", () => {
    expect(takeVisibleDays(months, 5).hasMore).toBe(false);
  });

  it("reports more when the cut lands inside the last day", () => {
    const one = groupByMonthAndDay([tx("2026-11-10", 100), tx("2026-11-10", 200)]);
    const { days, hasMore } = takeVisibleDays(one, 1);
    expect(days[0]!.transactions).toHaveLength(1);
    expect(hasMore).toBe(true);
  });
});
