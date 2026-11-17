import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, historyEventFrom, historyFilter, parseHistory, pushHistory } from "@/features/settings/history";
import { emptyFilter } from "@/features/activity/filter";
import type { Transaction } from "@/domain/transaction";

const tx: Transaction = {
  id: "a1",
  date: "2026-11-16",
  account: "ADVZ",
  destinationAccount: "",
  cashflow: "out",
  category: "Groceries",
  categoryType: "expense",
  merchant: "Edeka",
  amountCents: 1240,
  notes: "",
  createdAt: "2026-11-16T10:00:00.000Z",
  updatedAt: "2026-11-16T10:00:00.000Z",
  deletedAt: null,
};

describe("pushHistory", () => {
  it("keeps the newest 10, newest first", () => {
    let list = parseHistory(null);
    for (let i = 0; i < 12; i++) list = pushHistory(list, historyEventFrom("added", { ...tx, id: `t${i}` }, `2026-11-16T10:00:${String(i).padStart(2, "0")}.000Z`));
    expect(HISTORY_LIMIT).toBe(10);
    expect(list.map((e) => e.id)).toEqual(["t11", "t10", "t9", "t8", "t7", "t6", "t5", "t4", "t3", "t2"]);
  });
});

describe("historyEventFrom", () => {
  it("snapshots the row as saved, titled by merchant, else category or type", () => {
    expect(historyEventFrom("updated", tx, "2026-11-17T09:00:00.000Z")).toEqual({
      kind: "updated",
      at: "2026-11-17T09:00:00.000Z",
      id: "a1",
      date: "2026-11-16",
      title: "Edeka",
      merchant: "Edeka",
      category: "Groceries",
      amountCents: 1240,
    });
    expect(historyEventFrom("added", { ...tx, merchant: "" }, "x").title).toBe("Groceries");
    expect(historyEventFrom("added", { ...tx, merchant: "", category: "", categoryType: "transfer" }, "x").title).toBe("Transfer");
  });
});

describe("parseHistory", () => {
  it("drops malformed entries but keeps the good ones", () => {
    const good = historyEventFrom("added", tx, "2026-11-17T09:00:00.000Z");
    expect(parseHistory([good, { ...good, kind: "deleted" }, { ...good, amountCents: 12.4 }, { ...good, date: "16.11.2026" }, null])).toEqual([good]);
    expect(parseHistory({ not: "a list" })).toEqual([]);
  });
});

describe("historyFilter", () => {
  const event = historyEventFrom("added", tx, "2026-11-17T09:00:00.000Z");

  it("opens that day with the merchant as search", () => {
    expect(historyFilter(event)).toEqual({ ...emptyFilter(), from: "2026-11-16", to: "2026-11-16", query: "Edeka" });
  });

  it("falls back to the category facet, then to the whole day", () => {
    expect(historyFilter({ ...event, merchant: "" })).toEqual({
      ...emptyFilter(),
      from: "2026-11-16",
      to: "2026-11-16",
      categories: ["Groceries"],
    });
    expect(historyFilter({ ...event, merchant: "", category: "" })).toEqual({ ...emptyFilter(), from: "2026-11-16", to: "2026-11-16" });
  });
});
