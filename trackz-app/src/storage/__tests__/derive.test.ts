import { describe, expect, it } from "vitest";
import { deriveAccounts, deriveCategories, deriveMerchants } from "@/storage/derive";
import type { CategoryType, Transaction } from "@/domain/transaction";

/**
 * Phase 13b: derive.ts had NO test file before this, which is why
 * deriveCategories' lossy categoryType field survived so long — it set
 * the type from whichever transaction came first in array order, and
 * nothing asserted otherwise. The first test below is the regression
 * guard for that.
 */

let seq = 0;
function makeTransaction(
  overrides: Partial<Transaction> & { categoryType?: CategoryType } = {},
): Transaction {
  seq++;
  return {
    id: `txn_${seq}`,
    date: "2026-10-17",
    account: "CMRZ",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant: "Edeka",
    amountCents: 1240,
    notes: "",
    createdAt: "2026-10-17T14:32:00.000Z",
    updatedAt: "2026-10-17T14:32:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("deriveCategories", () => {
  it("returns one entry per name even when the name carries several types", () => {
    // The real data's WiFi: 14 non_expense rows (a shared flat contract)
    // then 4 expense rows (a sole contract after moving). Both correct.
    // This used to return ONE entry stamped with whichever type appeared
    // first, silently discarding the other.
    const categories = deriveCategories([
      makeTransaction({ category: "WiFi", categoryType: "non_expense" }),
      makeTransaction({ category: "WiFi", categoryType: "expense" }),
    ]);

    expect(categories).toEqual([{ name: "WiFi" }]);
  });

  it("carries no categoryType at all, since a category does not have one", () => {
    const [category] = deriveCategories([makeTransaction({ category: "Rent" })]);
    expect(Object.keys(category!)).toEqual(["name"]);
  });

  it("is order-independent", () => {
    const a = makeTransaction({ category: "WiFi", categoryType: "non_expense" });
    const b = makeTransaction({ category: "WiFi", categoryType: "expense" });

    expect(deriveCategories([a, b])).toEqual(deriveCategories([b, a]));
  });

  it("treats names differing only by surrounding whitespace as one", () => {
    // features/entry/draft.ts trims `category` on write; an imported row
    // may carry whitespace. Untrimmed keying showed these as two
    // categories that looked identical on screen.
    const categories = deriveCategories([
      makeTransaction({ category: "Rent" }),
      makeTransaction({ category: " Rent" }),
      makeTransaction({ category: "Rent " }),
    ]);

    expect(categories).toEqual([{ name: "Rent" }]);
  });

  it("skips blank names rather than inventing an empty category", () => {
    // Four DISTINCT blank spellings, so this stays falsifiable: without
    // the guard they all trim to "" and collapse into ONE empty-named
    // category, which would then be offered in every category picker.
    const categories = deriveCategories([
      makeTransaction({ category: "Rent" }),
      makeTransaction({ category: "" }),
      makeTransaction({ category: "   " }),
      makeTransaction({ category: "\t" }),
    ]);

    expect(categories).toEqual([{ name: "Rent" }]);
  });

  it("sorts by name", () => {
    const categories = deriveCategories([
      makeTransaction({ category: "Smokes" }),
      makeTransaction({ category: "Groceries" }),
      makeTransaction({ category: "Rent" }),
    ]);

    expect(categories.map((c) => c.name)).toEqual(["Groceries", "Rent", "Smokes"]);
  });
});

describe("deriveAccounts", () => {
  it("includes destination accounts, so a transfer-only account still exists", () => {
    const accounts = deriveAccounts([
      makeTransaction({ account: "CMRZ", destinationAccount: "SCLB", cashflow: "none", categoryType: "transfer" }),
    ]);

    expect(accounts.map((a) => a.name)).toEqual(["CMRZ", "SCLB"]);
  });

  it("ignores the empty destination on a non-transfer row", () => {
    const accounts = deriveAccounts([makeTransaction({ account: "CMRZ", destinationAccount: "" })]);
    expect(accounts.map((a) => a.name)).toEqual(["CMRZ"]);
  });
});

describe("deriveMerchants", () => {
  it("skips blank merchants, which are legitimate (no counterparty)", () => {
    // Unlike a blank category, a blank merchant is real data: 265 rows in
    // the real backup (Transfer, Restaurant) have no counterparty name.
    const merchants = deriveMerchants([
      makeTransaction({ merchant: "Edeka" }),
      makeTransaction({ merchant: "" }),
    ]);

    expect(merchants.map((m) => m.name)).toEqual(["Edeka"]);
  });
});
