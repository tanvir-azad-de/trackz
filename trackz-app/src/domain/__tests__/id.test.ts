import { describe, it, expect } from "vitest";
import { contentDerivedTransactionId, newTransactionId } from "@/domain/id";

/**
 * Tests for transaction id minting.
 *
 * The content-derived half exists because of a live data incident: import
 * used to mint a RANDOM id for rows from a CSV with no id column, so the
 * same 1456-row backup imported on the dev origin and the production
 * origin (separate localStorage per origin) produced two unrelated id
 * sets. sync/merge.ts dedupes by id and correctly saw them as different
 * transactions, leaving 4368 rows on Drive — three copies of everything.
 *
 * So "the same input gives the same id" is not a nicety here, it is the
 * property that makes import and sync safe to combine.
 */

const base = {
  date: "2026-01-15",
  account: "N26",
  destinationAccount: "",
  cashflow: "out",
  category: "Groceries",
  categoryType: "expense",
  merchant: "Rewe",
  amountCents: 1234,
  notes: "",
};

describe("newTransactionId", () => {
  it("is unique per call", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newTransactionId()));

    // Rows the user creates now have nothing to derive from, so random is
    // right here — but it must not repeat.
    expect(ids.size).toBe(500);
  });
});

describe("contentDerivedTransactionId", () => {
  it("gives the same id for the same row every time", () => {
    // THE WHOLE POINT: re-importing a file must converge, not accumulate.
    expect(contentDerivedTransactionId(base, 0)).toBe(contentDerivedTransactionId(base, 0));
  });

  it("gives different ids when any field differs", () => {
    const fields: Array<[string, unknown]> = [
      ["date", "2026-01-16"],
      ["account", "Revolut"],
      ["destinationAccount", "Savings"],
      ["cashflow", "in"],
      ["category", "Transport"],
      ["categoryType", "income"],
      ["merchant", "Aldi"],
      ["amountCents", 1235],
      ["notes", "x"],
    ];

    const baseId = contentDerivedTransactionId(base, 0);
    for (const [field, value] of fields) {
      const changed = contentDerivedTransactionId({ ...base, [field]: value }, 0);
      // Every identity field must affect the id. If one were omitted from
      // the hash, two genuinely different transactions would merge and one
      // would be silently lost on the next sync.
      expect(changed, `changing ${field} must change the id`).not.toBe(baseId);
    }
  });

  it("keeps two genuinely identical rows distinct via the occurrence index", () => {
    // Two identical coffees on the same day at the same shop is ordinary
    // data, not an error. A pure content hash would merge them and lose
    // one, so the Nth identical row gets its own id.
    expect(contentDerivedTransactionId(base, 1)).not.toBe(contentDerivedTransactionId(base, 0));
    expect(contentDerivedTransactionId(base, 2)).not.toBe(contentDerivedTransactionId(base, 1));
  });

  it("cannot be fooled by shifting a field boundary", () => {
    // Concatenating with no separator would make these two DIFFERENT rows
    // hash identically: date+account are adjacent in the hashed material,
    // so moving one character across their boundary yields the same byte
    // sequence ("2026-01-15"+"XN26" === "2026-01-15X"+"N26"). The
    // separator is a unit-separator byte, which cannot appear in CSV data.
    //
    // Note the fields must be ADJACENT for this to test anything — an
    // earlier version of this test shifted between category and merchant,
    // which are separated by categoryType, so the concatenations differed
    // anyway and the assertion passed even with the separator removed.
    const left = contentDerivedTransactionId({ ...base, date: "2026-01-15", account: "XN26" }, 0);
    const right = contentDerivedTransactionId({ ...base, date: "2026-01-15X", account: "N26" }, 0);

    expect(left).not.toBe(right);
  });

  it("spreads ids widely enough to avoid collisions at ledger scale", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      ids.add(contentDerivedTransactionId({ ...base, amountCents: i }, 0));
    }

    // A 32-bit hash would be expected to collide well before this on a
    // plausible ledger size; the id uses 64 bits for that reason.
    expect(ids.size).toBe(5000);
  });

  it("is prefixed so a derived id is recognisable", () => {
    // Distinguishable from txn_<uuid> when reading stored data by hand,
    // which matters when diagnosing exactly this class of bug.
    expect(contentDerivedTransactionId(base, 0)).toMatch(/^txn_c[0-9a-f]{16}$/);
  });
});
