import { describe, it, expect } from "vitest";
import type { Transaction } from "@/domain/transaction";
import {
  localToSync,
  getTransactionsFromSync,
  compareRevisions,
  type SyncDocument,
} from "@/sync/document";

/**
 * Phase 15a: tests sync/document.ts's payload serialization.
 * These are straightforward helpers that convert between local storage and
 * the synced format, so tests are mostly about ensuring the shape is
 * preserved and revision comparison works correctly.
 */

function tx(id: string, merchant = "Test"): Transaction {
  return {
    id,
    date: "2026-01-01",
    account: "Checking",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant,
    amountCents: 1000,
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
  };
}

describe("localToSync", () => {
  it("creates a SyncDocument with the provided revision and device", () => {
    const transactions = [tx("id-1")];
    const revision = 5;
    const deviceId = "iphone-abc123";

    const result = localToSync(transactions, revision, deviceId);

    expect(result.revision).toBe(5);
    expect(result.device).toBe("iphone-abc123");
    expect(result.transactions).toEqual(transactions);
  });

  it("includes all transactions (live and tombstones)", () => {
    const transactions = [
      tx("id-1"),
      { ...tx("id-2"), deletedAt: "2026-01-02T00:00:00Z" }, // tombstone
    ];
    const result = localToSync(transactions, 1, "device-1");

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.id).toBe("id-1");
    expect(result.transactions[1]?.id).toBe("id-2");
    expect(result.transactions[1]?.deletedAt).toBe("2026-01-02T00:00:00Z");
  });

  it("makes a shallow copy to prevent caller from mutating the SyncDocument", () => {
    const originalTransactions = [tx("id-1")];
    const sync = localToSync(originalTransactions, 1, "device-1");

    // Mutating sync.transactions shouldn't affect the original
    sync.transactions.push(tx("id-2"));

    expect(originalTransactions).toHaveLength(1);
    expect(sync.transactions).toHaveLength(2);
  });

  it("handles empty transaction list", () => {
    const result = localToSync([], 0, "device-1");

    expect(result.revision).toBe(0);
    expect(result.device).toBe("device-1");
    expect(result.transactions).toEqual([]);
  });

  it("increments revision correctly from previous states", () => {
    const transactions = [tx("id-1")];

    const v0 = localToSync(transactions, 0, "device-1");
    const v1 = localToSync(transactions, 1, "device-1");
    const v42 = localToSync(transactions, 42, "device-1");

    expect(v0.revision).toBe(0);
    expect(v1.revision).toBe(1);
    expect(v42.revision).toBe(42);
  });
});

describe("getTransactionsFromSync", () => {
  it("extracts transactions from a SyncDocument", () => {
    const transactions = [tx("id-1"), tx("id-2")];
    const sync: SyncDocument = {
      revision: 1,
      device: "remote-device",
      transactions,
    };

    const result = getTransactionsFromSync(sync);

    expect(result).toEqual(transactions);
  });

  it("includes tombstones when extracting", () => {
    const transactions = [
      tx("id-1"),
      { ...tx("id-2"), deletedAt: "2026-01-02T00:00:00Z" },
    ];
    const sync: SyncDocument = {
      revision: 1,
      device: "remote-device",
      transactions,
    };

    const result = getTransactionsFromSync(sync);

    expect(result).toHaveLength(2);
    expect(result[1]?.deletedAt).toBe("2026-01-02T00:00:00Z");
  });

  it("returns empty list when SyncDocument has no transactions", () => {
    const sync: SyncDocument = {
      revision: 1,
      device: "remote-device",
      transactions: [],
    };

    const result = getTransactionsFromSync(sync);

    expect(result).toEqual([]);
  });
});

describe("compareRevisions", () => {
  it("returns negative when left is older", () => {
    const left: SyncDocument = {
      revision: 1,
      device: "device-1",
      transactions: [],
    };
    const right: SyncDocument = {
      revision: 2,
      device: "device-2",
      transactions: [],
    };

    const result = compareRevisions(left, right);

    expect(result).toBeLessThan(0);
  });

  it("returns 0 when revisions are equal", () => {
    const left: SyncDocument = {
      revision: 5,
      device: "device-1",
      transactions: [],
    };
    const right: SyncDocument = {
      revision: 5,
      device: "device-2",
      transactions: [],
    };

    const result = compareRevisions(left, right);

    expect(result).toBe(0);
  });

  it("returns positive when left is newer", () => {
    const left: SyncDocument = {
      revision: 10,
      device: "device-1",
      transactions: [],
    };
    const right: SyncDocument = {
      revision: 3,
      device: "device-2",
      transactions: [],
    };

    const result = compareRevisions(left, right);

    expect(result).toBeGreaterThan(0);
  });

  it("handles large revision numbers", () => {
    const left: SyncDocument = {
      revision: 1000000,
      device: "device-1",
      transactions: [],
    };
    const right: SyncDocument = {
      revision: 999999,
      device: "device-2",
      transactions: [],
    };

    const result = compareRevisions(left, right);

    expect(result).toBeGreaterThan(0);
  });

  it("handles revision 0", () => {
    const left: SyncDocument = {
      revision: 0,
      device: "device-1",
      transactions: [],
    };
    const right: SyncDocument = {
      revision: 1,
      device: "device-2",
      transactions: [],
    };

    const result = compareRevisions(left, right);

    expect(result).toBeLessThan(0);
  });
});
