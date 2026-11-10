import { describe, expect, it } from "vitest";
import { draftFromRemembered, rememberFromTransaction } from "@/features/entry/lastUsed";
import { buildTransaction, emptyDraft } from "@/features/entry/draft";

const TODAY = "2026-11-10";

describe("rememberFromTransaction -> draftFromRemembered", () => {
  it("round-trips every field except the amount, including the date", () => {
    const saved = buildTransaction({
      ...emptyDraft(TODAY, 1240),
      date: "2026-11-03",
      categoryType: "receivable",
      direction: "in",
      category: " Loans ",
      merchant: "Rafi",
      account: "ADVZ",
      notes: "half back",
    });
    const remembered = rememberFromTransaction(saved);
    expect(remembered).not.toHaveProperty("amountCents");

    // Through JSON, exactly like localStorage.
    const draft = draftFromRemembered(JSON.parse(JSON.stringify(remembered)), TODAY, 0);
    expect(draft).toEqual({
      amountCents: 0,
      date: "2026-11-03",
      categoryType: "receivable",
      direction: "in",
      // Blank, not "Loans": Lent out rows carry no category (usesCategory),
      // so buildTransaction dropped it before it was ever remembered.
      category: "",
      merchant: "Rafi",
      account: "ADVZ",
      destinationAccount: "",
      notes: "half back",
    });
  });

  it("remembers a transfer's destination account", () => {
    const saved = buildTransaction({
      ...emptyDraft(TODAY, 50000),
      categoryType: "transfer",
      category: "Transfer",
      account: "CMRZ",
      destinationAccount: "REVO",
    });
    expect(draftFromRemembered(rememberFromTransaction(saved), TODAY).destinationAccount).toBe("REVO");
  });
});

describe("draftFromRemembered with bad storage", () => {
  it("falls back to an empty draft dated today when nothing is stored", () => {
    expect(draftFromRemembered(null, TODAY, 500)).toEqual(emptyDraft(TODAY, 500));
  });

  it("keeps the good fields and replaces only the bad ones", () => {
    const draft = draftFromRemembered(
      { date: "10.11.2026", categoryType: "spending", direction: "sideways", category: "Groceries", merchant: 42, account: "ADVZ" },
      TODAY,
    );
    expect(draft).toEqual({ ...emptyDraft(TODAY), category: "Groceries", account: "ADVZ" });
  });
});
