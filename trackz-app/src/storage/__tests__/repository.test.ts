import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Transaction } from "@/domain/transaction";

/**
 * Phase 15a: tests repository.ts's soft-delete contract — the
 * foundation sync/merge.ts depends on (a "deleted" row must still exist
 * in storage, with a deletedAt tombstone, so a delete can propagate to
 * another device instead of just vanishing locally).
 *
 * vitest.config.ts runs tests under environment: "node" (no jsdom — see
 * that file's comment for why: this app has no other reason to pull in
 * a DOM shim). localStorage doesn't exist in plain Node, so this file
 * installs a minimal in-memory polyfill before each test rather than
 * adding jsdom as a dependency just for this one module.
 */
function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage;
}

beforeEach(() => {
  installLocalStorageStub();
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

// Imported after the beforeEach/afterEach above are registered, but
// module-level import ordering doesn't matter here since the functions
// only touch localStorage when actually called (not at import time).
const {
  getTransactions,
  getTransactionsIncludingDeleted,
  addTransaction,
  updateTransaction,
  updateTransactions,
  deleteTransaction,
  undeleteTransaction,
  purgeOldTombstones,
  isEmpty,
  subscribe,
} = await import("@/storage/repository");

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_1",
    date: "2026-10-17",
    account: "CMRZ",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant: "Edeka",
    amountCents: 1240,
    notes: "",
    createdAt: "2026-10-17T08:00:00.000Z",
    updatedAt: "2026-10-17T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("deleteTransaction / undeleteTransaction (Phase 15a soft delete)", () => {
  it("deleteTransaction sets deletedAt instead of removing the row", () => {
    addTransaction(makeTransaction());
    deleteTransaction("txn_1");

    expect(getTransactions()).toEqual([]); // filtered from the live view
    const [stored] = getTransactionsIncludingDeleted();
    expect(stored!.id).toBe("txn_1");
    expect(stored!.deletedAt).not.toBeNull();
  });

  it("deleteTransaction bumps updatedAt (the field sync's merge keys on)", () => {
    addTransaction(makeTransaction({ updatedAt: "2026-10-17T08:00:00.000Z" }));
    deleteTransaction("txn_1");
    const [stored] = getTransactionsIncludingDeleted();
    expect(stored!.updatedAt).not.toBe("2026-10-17T08:00:00.000Z");
  });

  it("deleteTransaction throws on an unknown id (matches updateTransaction's contract)", () => {
    expect(() => deleteTransaction("does_not_exist")).toThrow(/no transaction with id/);
  });

  it("undeleteTransaction clears the tombstone and the row reappears in getTransactions()", () => {
    addTransaction(makeTransaction());
    deleteTransaction("txn_1");
    expect(getTransactions()).toEqual([]);

    undeleteTransaction("txn_1");
    expect(getTransactions()).toHaveLength(1);
    expect(getTransactions()[0]!.deletedAt).toBeNull();
  });

  it("a deleted-then-undeleted row keeps the SAME id (no duplicate row is ever created)", () => {
    addTransaction(makeTransaction());
    deleteTransaction("txn_1");
    undeleteTransaction("txn_1");
    expect(getTransactionsIncludingDeleted()).toHaveLength(1);
  });
});

describe("updateTransaction stamps updatedAt", () => {
  it("overwrites whatever updatedAt the caller passed in with the current time", () => {
    addTransaction(makeTransaction({ updatedAt: "2020-01-01T00:00:00.000Z" }));
    updateTransaction(makeTransaction({ notes: "edited", updatedAt: "2020-01-01T00:00:00.000Z" }));
    const [stored] = getTransactions();
    expect(stored!.notes).toBe("edited");
    expect(stored!.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("isEmpty (Phase 15a: must reflect tombstones, not just array length)", () => {
  it("is true with zero rows", () => {
    expect(isEmpty()).toBe(true);
  });

  it("is true when the only row is a tombstone — a fully-deleted ledger should still offer to reseed/reimport", () => {
    addTransaction(makeTransaction());
    deleteTransaction("txn_1");
    expect(isEmpty()).toBe(true);
  });

  it("is false once a live row exists", () => {
    addTransaction(makeTransaction());
    expect(isEmpty()).toBe(false);
  });
});

describe("purgeOldTombstones", () => {
  it("removes tombstones older than the retention window and leaves live rows untouched", () => {
    const old = makeTransaction({ id: "old", deletedAt: "2000-01-01T00:00:00.000Z" });
    const recent = makeTransaction({ id: "recent", deletedAt: new Date().toISOString() });
    const live = makeTransaction({ id: "live", deletedAt: null });
    addTransaction(old);
    addTransaction(recent);
    addTransaction(live);

    const purged = purgeOldTombstones(90);

    expect(purged).toBe(1);
    const remainingIds = getTransactionsIncludingDeleted().map((t) => t.id);
    expect(remainingIds).toEqual(["recent", "live"]);
  });

  it("returns 0 and writes nothing when there is nothing to purge", () => {
    addTransaction(makeTransaction());
    expect(purgeOldTombstones(90)).toBe(0);
  });
});

describe("updateTransactions (Phase 6: bulk write for merchant merge)", () => {
  it("applies every change in one write", () => {
    addTransaction(makeTransaction({ id: "a", merchant: "EDEKA" }));
    addTransaction(makeTransaction({ id: "b", merchant: "EDEKA" }));
    addTransaction(makeTransaction({ id: "c", merchant: "Aldi" }));

    const all = getTransactions();
    updateTransactions(
      all.filter((t) => t.merchant === "EDEKA").map((t) => ({ ...t, merchant: "Edeka" })),
    );

    const after = getTransactions();
    expect(after.filter((t) => t.merchant === "Edeka")).toHaveLength(2);
    expect(after.find((t) => t.id === "c")!.merchant).toBe("Aldi");
    expect(after).toHaveLength(3); // renames, never removes
  });

  /**
   * updatedAt is what carries the rename to other devices through
   * sync/merge.ts's last-writer-wins resolution. Without the bump the
   * merge would be local-only and could be silently undone by the next
   * sync.
   */
  it("bumps updatedAt on every row it writes", () => {
    addTransaction(makeTransaction({ id: "a", updatedAt: "2020-01-01T00:00:00.000Z" }));

    const [row] = getTransactions();
    updateTransactions([{ ...row!, merchant: "Edeka" }]);

    expect(getTransactions()[0]!.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("notifies subscribers exactly once for the whole batch", () => {
    addTransaction(makeTransaction({ id: "a", merchant: "EDEKA" }));
    addTransaction(makeTransaction({ id: "b", merchant: "EDEKA" }));

    let notifications = 0;
    const unsubscribe = subscribe(() => notifications++);
    updateTransactions(getTransactions().map((t) => ({ ...t, merchant: "Edeka" })));
    unsubscribe();

    // One write, one re-render, one armed sync debounce — not one per row.
    expect(notifications).toBe(1);
  });

  it("writes nothing and notifies nobody for an empty batch", () => {
    addTransaction(makeTransaction({ id: "a" }));

    let notifications = 0;
    const unsubscribe = subscribe(() => notifications++);
    updateTransactions([]);
    unsubscribe();

    expect(notifications).toBe(0);
  });

  /**
   * All-or-nothing: a half-applied merchant merge (some rows renamed,
   * some not, no record of how far it got) is a genuinely bad state, so
   * ids are validated before anything is written.
   */
  it("throws on an unknown id without writing any of the batch", () => {
    addTransaction(makeTransaction({ id: "a", merchant: "EDEKA" }));
    const [row] = getTransactions();

    expect(() =>
      updateTransactions([
        { ...row!, merchant: "Edeka" },
        { ...makeTransaction({ id: "ghost" }), merchant: "Edeka" },
      ]),
    ).toThrow(/ghost/);

    // The valid row in the same batch must NOT have been written.
    expect(getTransactions()[0]!.merchant).toBe("EDEKA");
  });

  it("preserves fields it was not asked to change", () => {
    addTransaction(
      makeTransaction({ id: "a", merchant: "EDEKA", amountCents: 999, categoryType: "non_expense" }),
    );
    const [row] = getTransactions();
    updateTransactions([{ ...row!, merchant: "Edeka" }]);

    const after = getTransactions()[0]!;
    expect(after.amountCents).toBe(999);
    expect(after.categoryType).toBe("non_expense");
    expect(after.createdAt).toBe(row!.createdAt);
    expect(after.id).toBe("a");
  });
});
