import { describe, expect, it, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTransactionsCsv } from "@/storage/csv";
import { findMergeGroups, normalizeMerchant } from "@/domain/merchant";
import type { Transaction } from "@/domain/transaction";

/**
 * Phase 6: merchant normalization + duplicate detection.
 *
 * Mixes synthetic-only tests with real-CSV-dependent ones, so
 * hasFixture gates only the blocks that actually touch `transactions` —
 * the same posture as features/activity/__tests__/filter.test.ts, and
 * for the same reason (dummyData/ is gitignored real financial data, so
 * it is absent on a fresh clone; a whole-file skip would wrongly drop
 * the synthetic coverage too).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../.."); // src/domain/__tests__ -> trackz-app -> trackz
const csvPath = resolve(repoRoot, "dummyData/snapshot-2026-10-31/transactions.csv");
const hasFixture = existsSync(csvPath);

let transactions: Transaction[];

beforeAll(() => {
  if (!hasFixture) return;
  const result = parseTransactionsCsv(readFileSync(csvPath, "utf-8"));
  expect(result.errors).toEqual([]);
  transactions = result.transactions;
});

function makeTransaction(merchant: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `txn_${merchant}_${Math.random().toString(36).slice(2, 8)}`,
    date: "2026-10-17",
    account: "CMRZ",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant,
    amountCents: 1240,
    notes: "",
    createdAt: "2026-10-17T14:32:00.000Z",
    updatedAt: "2026-10-17T14:32:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("normalizeMerchant", () => {
  it("folds case", () => {
    expect(normalizeMerchant("EDEKA")).toBe("edeka");
    expect(normalizeMerchant("Edeka")).toBe("edeka");
    expect(normalizeMerchant("TEDi")).toBe("tedi");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeMerchant("  Edeka  ")).toBe("edeka");
  });

  it("discards spaces and punctuation", () => {
    // The real 7th group in the backup: a hand-typed name and the raw
    // bank string for the same shop differ only by "*" vs " ".
    expect(normalizeMerchant("SPC*Indian Wholesales")).toBe("spcindianwholesales");
    expect(normalizeMerchant("Spc Indian Wholesales")).toBe("spcindianwholesales");
    expect(normalizeMerchant("NIEMERSZEIN & CO.KG")).toBe("niemerszeincokg");
  });

  /**
   * Guards the ORDER of the fold, not just its output. If the NFD
   * decomposition is removed or moved after the alphanumeric filter,
   * the filter deletes the combining mark and leaves the base letter
   * stripped: "cafe" becomes "caf" and "muller" becomes "mller". That
   * both splits an accented name from its unaccented spelling and
   * merges it with unrelated names sharing the truncated prefix.
   *
   * There are no non-ASCII merchants in the real data today — this is
   * a latent-bug guard, since merchants are hand-typed free text.
   */
  it("folds accents to their base letters rather than deleting them", () => {
    expect(normalizeMerchant("Café")).toBe("cafe");
    expect(normalizeMerchant("Müller")).toBe("muller");
    expect(normalizeMerchant("Zoë")).toBe("zoe");
  });

  it("treats precomposed and decomposed spellings of the same name as equal", () => {
    // U+00E9 vs "e" + U+0301 — indistinguishable to a human, different strings.
    expect(normalizeMerchant("Caf\u00e9")).toBe(normalizeMerchant("Cafe\u0301"));
  });

  it("normalizes a punctuation-only name to the empty string", () => {
    // findMergeGroups relies on this to skip such names (see its test below).
    expect(normalizeMerchant("***")).toBe("");
    expect(normalizeMerchant("   ")).toBe("");
  });

  it("keeps digits, which real bank strings contain", () => {
    expect(normalizeMerchant("THYO00000 0000000005CZUCO")).toBe("thyo000000000000005czuco");
  });
});

describe("findMergeGroups (synthetic)", () => {
  it("groups spellings that differ only by case", () => {
    const groups = findMergeGroups([
      makeTransaction("Edeka"),
      makeTransaction("Edeka"),
      makeTransaction("EDEKA"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.normalized).toBe("edeka");
    expect(groups[0]!.totalRows).toBe(3);
    expect(groups[0]!.variants).toEqual([
      { name: "Edeka", rowCount: 2 },
      { name: "EDEKA", rowCount: 1 },
    ]);
  });

  it("ignores merchants with only one spelling", () => {
    const groups = findMergeGroups([makeTransaction("Edeka"), makeTransaction("Aldi")]);
    expect(groups).toEqual([]);
  });

  it("suggests the most-used spelling as canonical", () => {
    const groups = findMergeGroups([
      makeTransaction("EDEKA"),
      makeTransaction("EDEKA"),
      makeTransaction("EDEKA"),
      makeTransaction("Edeka"),
    ]);
    // Most-used wins even though it is the shouting variant — the
    // tie-break below only applies when counts are equal.
    expect(groups[0]!.suggestedCanonical).toBe("EDEKA");
  });

  /**
   * The real data contains a genuine 1-vs-1 tie, so without an explicit
   * rule the suggestion would fall out of Map insertion order (i.e. CSV
   * row order) and this function's output would be unstable. Asserted
   * in BOTH input orders: an order-dependent implementation passes one
   * and fails the other.
   */
  it("breaks a row-count tie deterministically, regardless of input order", () => {
    const forward = findMergeGroups([
      makeTransaction("SPC*Indian Wholesales"),
      makeTransaction("Spc Indian Wholesales"),
    ]);
    const reversed = findMergeGroups([
      makeTransaction("Spc Indian Wholesales"),
      makeTransaction("SPC*Indian Wholesales"),
    ]);

    expect(forward[0]!.suggestedCanonical).toBe("Spc Indian Wholesales");
    expect(reversed[0]!.suggestedCanonical).toBe(forward[0]!.suggestedCanonical);
  });

  /**
   * Covers the punctuation tie-break specifically. This case is the
   * reason that rule exists: localeCompare on its own picks "*Aldi"
   * (leading punctuation sorts first), which is exactly the raw
   * bank-statement spelling that should NOT be suggested. Found by
   * mutation testing — an earlier version of this file only tested
   * plain-case ties, which localeCompare already handles, so the rule
   * looked like dead code.
   */
  it("prefers a punctuation-free spelling when counts tie", () => {
    const groups = findMergeGroups([makeTransaction("*Aldi"), makeTransaction("Aldi")]);
    expect(groups[0]!.suggestedCanonical).toBe("Aldi");
  });

  /**
   * No separate all-caps rule is needed: names within a group differ
   * only by case and punctuation, and localeCompare already ranks
   * mixed-case ahead of all-caps. Asserted so nobody re-adds a
   * redundant rule believing this case is uncovered.
   */
  it("prefers the mixed-case spelling over all-caps when counts tie", () => {
    expect(
      findMergeGroups([makeTransaction("ALDI"), makeTransaction("Aldi")])[0]!.suggestedCanonical,
    ).toBe("Aldi");
    expect(
      findMergeGroups([makeTransaction("EDEKA"), makeTransaction("Edeka")])[0]!.suggestedCanonical,
    ).toBe("Edeka");
  });

  /**
   * Blank is a legitimate merchant value (a transfer or a restaurant
   * with no counterparty recorded), not a misspelling. 265 rows of the
   * real 1,456 are blank, so grouping them would offer to merge a fifth
   * of the ledger into one invented merchant.
   *
   * The variants must be DISTINCT STRINGS that all normalize to "",
   * otherwise this test proves nothing: "" and "   " both trim to "",
   * so they collapse to a single spelling and the 2+-variants rule
   * suppresses the group on its own, with or without the blank guard.
   * Mutation testing caught exactly that — an earlier version of this
   * test passed with the guard deleted.
   */
  it("skips blank and whitespace-only merchants", () => {
    const groups = findMergeGroups([
      makeTransaction(""),
      makeTransaction(" "),
      makeTransaction("\t"),
      makeTransaction("  "),
    ]);
    expect(groups).toEqual([]);
  });

  it("skips punctuation-only merchants instead of grouping them with blanks", () => {
    const groups = findMergeGroups([makeTransaction("***"), makeTransaction("---")]);
    expect(groups).toEqual([]);
  });

  it("orders groups by affected row count, largest first", () => {
    const groups = findMergeGroups([
      makeTransaction("Aldi"),
      makeTransaction("ALDI"),
      makeTransaction("Edeka"),
      makeTransaction("Edeka"),
      makeTransaction("EDEKA"),
    ]);

    expect(groups.map((g) => g.normalized)).toEqual(["edeka", "aldi"]);
  });

  it("groups across differing categories and category types", () => {
    // Normalization keys on the merchant name alone. Two spellings of
    // one shop used for different categories are still one merchant.
    const groups = findMergeGroups([
      makeTransaction("Edeka", { category: "Groceries", categoryType: "expense" }),
      makeTransaction("EDEKA", { category: "Shopping", categoryType: "expense" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.totalRows).toBe(2);
  });
});

describe("category-type breakdown (counterparty warning)", () => {
  /**
   * Confirmed with the user: non_expense means "this money left my
   * account but the whole amount is not my expense" — e.g. a loan to a
   * friend, or a bill partly reimbursed by someone else — and non_income
   * is its mirror. On those rows (plus receivable/payable) the `merchant`
   * field names a PERSON, not a shop, and insights/engine.ts groups
   * Lent out / I owe by it. So the sheet must be able to warn.
   */
  it("flags a group touching non_expense rows", () => {
    const groups = findMergeGroups([
      makeTransaction("Jamie Doe", { categoryType: "non_expense" }),
      makeTransaction("JAMIE DOE", { categoryType: "non_expense" }),
    ]);

    expect(groups[0]!.touchesCounterpartyRows).toBe(true);
    expect(groups[0]!.categoryTypes).toEqual({ non_expense: 2 });
  });

  it("flags a group touching non_income rows", () => {
    const groups = findMergeGroups([
      makeTransaction("Sam Roe", { categoryType: "non_income", cashflow: "in" }),
      makeTransaction("sam roe", { categoryType: "non_income", cashflow: "in" }),
    ]);
    expect(groups[0]!.touchesCounterpartyRows).toBe(true);
  });

  it("flags receivable and payable groups too", () => {
    for (const categoryType of ["receivable", "payable"] as const) {
      const groups = findMergeGroups([
        makeTransaction("Alex", { categoryType }),
        makeTransaction("ALEX", { categoryType }),
      ]);
      expect(groups[0]!.touchesCounterpartyRows).toBe(true);
    }
  });

  it("does NOT flag a plain expense group", () => {
    const groups = findMergeGroups([makeTransaction("Edeka"), makeTransaction("EDEKA")]);
    expect(groups[0]!.touchesCounterpartyRows).toBe(false);
    expect(groups[0]!.categoryTypes).toEqual({ expense: 2 });
  });

  it("flags a MIXED group, where only some rows are counterparty rows", () => {
    // The dangerous case: 10 harmless expense rows make the group look
    // routine, and one non_expense row means a merge still moves a
    // partly-someone-else's-money row.
    const groups = findMergeGroups([
      makeTransaction("Amazon"),
      makeTransaction("AMAZON", { categoryType: "non_expense" }),
    ]);

    expect(groups[0]!.touchesCounterpartyRows).toBe(true);
    expect(groups[0]!.categoryTypes).toEqual({ expense: 1, non_expense: 1 });
  });

  it("counts every category type present in the group", () => {
    const groups = findMergeGroups([
      makeTransaction("Shop"),
      makeTransaction("SHOP"),
      makeTransaction("shop", { categoryType: "non_income", cashflow: "in" }),
    ]);
    expect(groups[0]!.categoryTypes).toEqual({ expense: 2, non_income: 1 });
  });
});

describe.skipIf(!hasFixture)("findMergeGroups (real 1,456-row backup)", () => {
  it("finds exactly 7 groups covering exactly 150 rows", () => {
    const groups = findMergeGroups(transactions);

    // Measured directly from the real CSV with an independent python
    // script, not derived from this implementation's own output. Note
    // the renovation plan's "7 groups / 150 rows" figure is only
    // reachable WITH punctuation stripping: pure case-folding gives 6
    // groups / 148 rows, because the Spc/SPC* pair differs by "*".
    expect(groups).toHaveLength(7);
    expect(groups.reduce((sum, g) => sum + g.totalRows, 0)).toBe(150);
  });

  it("matches the per-group variant breakdown measured from the raw CSV", () => {
    const groups = findMergeGroups(transactions);
    const summary = groups.map((g) => ({
      normalized: g.normalized,
      totalRows: g.totalRows,
      variants: g.variants.map((v) => [v.name, v.rowCount] as const),
    }));

    expect(summary).toEqual([
      { normalized: "edeka", totalRows: 64, variants: [["Edeka", 53], ["EDEKA", 11]] },
      { normalized: "rossmann", totalRows: 21, variants: [["Rossmann", 18], ["ROSSMANN", 3]] },
      { normalized: "tedi", totalRows: 18, variants: [["Tedi", 16], ["TEDi", 2]] },
      { normalized: "aldi", totalRows: 17, variants: [["Aldi", 13], ["ALDI", 4]] },
      { normalized: "penny", totalRows: 17, variants: [["Penny", 16], ["PENNY", 1]] },
      { normalized: "euroshop", totalRows: 11, variants: [["Euroshop", 8], ["EuroShop", 3]] },
      {
        normalized: "spcindianwholesales",
        totalRows: 2,
        // Tied counts, so these fall back to localeCompare, which orders
        // "Spc Indian Wholesales" before "SPC*Indian Wholesales".
        variants: [["Spc Indian Wholesales", 1], ["SPC*Indian Wholesales", 1]],
      },
    ]);
  });

  it("suggests the most-used spelling for every real group", () => {
    const groups = findMergeGroups(transactions);
    const suggestions = Object.fromEntries(groups.map((g) => [g.normalized, g.suggestedCanonical]));

    expect(suggestions).toEqual({
      edeka: "Edeka",
      rossmann: "Rossmann",
      tedi: "Tedi",
      aldi: "Aldi",
      penny: "Penny",
      euroshop: "Euroshop",
      spcindianwholesales: "Spc Indian Wholesales", // 1-vs-1 tie, broken by rule
    });
  });

  /**
   * THE LOAD-BEARING NEGATIVE TEST. Encodes the locked decision that
   * detection is equality-of-normalized-form ONLY. The tempting
   * extension — also grouping by first token, which would catch
   * "Niemerszein"/"NIEMERSZEIN & CO.KG" and "Kaufland"/"KAUFLAND
   * HAMBURG BRAMF" — was measured against this same data and rejected,
   * because it ALSO proposes these three merges, each of which would
   * destroy a real distinction:
   *
   *   "Vodafone" is Mobile/expense while "Vodafone Frankfurt" is
   *   WiFi/non_expense; "DM" is Shopping while "dm drogerie" is
   *   Groceries; "Amazon" is Shopping+Refunds while "Amazon Prime" is
   *   Subscriptions.
   *
   * If someone adds fuzzy/first-token matching later, this test fails
   * and points at why. Niemerszein and Kaufland are meant to be reached
   * by an explicit manual merge, not by a rule that also breaks these.
   */
  it("does NOT group merchants that merely share a first token", () => {
    const groups = findMergeGroups(transactions);

    const groupedTogether = (a: string, b: string) =>
      groups.some((g) => {
        const names = g.variants.map((v) => v.name);
        return names.includes(a) && names.includes(b);
      });

    expect(groupedTogether("Vodafone", "Vodafone Frankfurt")).toBe(false);
    expect(groupedTogether("DM", "dm drogerie")).toBe(false);
    expect(groupedTogether("Amazon", "Amazon Prime")).toBe(false);
    expect(groupedTogether("Niemerszein", "NIEMERSZEIN & CO.KG")).toBe(false);
    expect(groupedTogether("Kaufland", "KAUFLAND HAMBURG BRAMF")).toBe(false);
  });

  /**
   * insights/engine.ts groups "Lent out"/"I owe" BY MERCHANT (that is
   * where the counterparty name lives for receivable/payable rows), so
   * a merge touching one would silently move money between
   * counterparties on the Accounts screen. Verified that all 7 real
   * groups are 100% expense rows, i.e. this phase cannot disturb that.
   */
  it("proposes no group touching a receivable or payable row", () => {
    const groups = findMergeGroups(transactions);
    const groupedNames = new Set(groups.flatMap((g) => g.variants.map((v) => v.name)));

    const counterpartyRows = transactions.filter(
      (tx) => tx.categoryType === "receivable" || tx.categoryType === "payable",
    );
    expect(counterpartyRows.length).toBeGreaterThan(0); // fixture sanity

    for (const tx of counterpartyRows) {
      expect(groupedNames.has(tx.merchant)).toBe(false);
    }
  });

  /**
   * Today none of the 7 auto-detected groups touches a counterparty row
   * (all 150 are plain expense). That is a fact about THIS data, not a
   * guarantee of the algorithm — a counterparty gaining a second spelling
   * would legitimately produce a flagged group. Asserted so that if it
   * ever changes, it changes visibly here rather than silently in the UI.
   */
  it("flags no auto-detected group as touching counterparty rows (true of this data today)", () => {
    const groups = findMergeGroups(transactions);

    expect(groups.every((g) => g.touchesCounterpartyRows === false)).toBe(true);
    for (const g of groups) {
      expect(Object.keys(g.categoryTypes)).toEqual(["expense"]);
    }
  });

  it("leaves the 265 blank-merchant rows out of every group", () => {
    const groups = findMergeGroups(transactions);
    const blankRows = transactions.filter((tx) => tx.merchant.trim() === "");

    expect(blankRows).toHaveLength(265); // fixture sanity
    for (const g of groups) {
      for (const v of g.variants) expect(v.name).not.toBe("");
    }
  });

  it("counts each group's rows consistently with the raw transaction list", () => {
    const groups = findMergeGroups(transactions);

    // Independent recount straight off the transaction list, so a bug in
    // the grouping accumulator cannot agree with itself.
    for (const g of groups) {
      const recounted = transactions.filter((tx) => normalizeMerchant(tx.merchant) === g.normalized).length;
      expect(recounted).toBe(g.totalRows);
    }
  });
});
