import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Tests for storage/accountTypes.ts — the cash / investment / credit-card
 * classification that decides what counts towards Home's "Liquid"
 * headline.
 *
 * MERGE GRANULARITY is the regression with real consequences: the map
 * syncs, so entries carry timestamps and merge per account. Whole-map
 * last-writer-wins would mean classifying account A here and account B
 * there loses one of them.
 *
 * The SCLB first-run seed was deleted on 2026-11-11: the CSV's
 * accountTypes config cell is now the only source (user decision), so a
 * hardcoded opinion here would be a second one.
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

describe("no seed", () => {
  it("reads an unclassified SCLB as cash on a first run", async () => {
    const { getAccountType, getAccountTypeEntries } = await import("@/storage/accountTypes");

    // The CSV is the only source now; nothing is invented on first run.
    expect(getAccountType("SCLB")).toBe("cash");
    expect(getAccountTypeEntries()).toEqual({});
  });
});

describe("replaceAccountTypes", () => {
  it("replaces the whole map and stamps every entry with the import time", async () => {
    const { getAccountTypeEntries, setAccountType, replaceAccountTypes } = await import("@/storage/accountTypes");

    setAccountType("Gone", "investment");
    replaceAccountTypes({ ADVZ: "credit_card", CMRZ: "cash" }, "2026-11-11T10:00:00.000Z");

    // "Gone" is not in the file, so it must not survive the import.
    expect(getAccountTypeEntries()).toEqual({
      ADVZ: { type: "credit_card", updatedAt: "2026-11-11T10:00:00.000Z" },
      CMRZ: { type: "cash", updatedAt: "2026-11-11T10:00:00.000Z" },
    });
  });
});

describe("credit_card", () => {
  it("survives a reload from storage", async () => {
    localStorage.setItem(
      "trackz.v2.accountTypes",
      JSON.stringify({ ADVZ: { type: "credit_card", updatedAt: "2026-11-11T00:00:00Z" }, OLD: "credit_card" }),
    );
    const { getAccountTypes } = await import("@/storage/accountTypes");

    // Both shapes: a validator that only knew cash/investment dropped these
    // as corrupt and ADVZ silently became cash again.
    expect(getAccountTypes()).toEqual({ ADVZ: "credit_card", OLD: "credit_card" });
  });

  it("is accepted from a remote map", async () => {
    const { getAccountType, mergeAccountTypes } = await import("@/storage/accountTypes");

    mergeAccountTypes({ ADVZ: { type: "credit_card", updatedAt: "2026-11-11T00:00:00Z" } });

    expect(getAccountType("ADVZ")).toBe("credit_card");
  });
});

describe("migration from the pre-sync flat shape", () => {
  it("keeps classifications a user already made", async () => {
    // What today's installs actually hold on disk.
    localStorage.setItem(
      "trackz.v2.accountTypes",
      JSON.stringify({ SCLB: "investment", Revolut: "cash" }),
    );

    const { getAccountType } = await import("@/storage/accountTypes");

    // A format change must not cost the user their settings.
    expect(getAccountType("SCLB")).toBe("investment");
    expect(getAccountType("Revolut")).toBe("cash");
  });

  it("backdates migrated entries so later edits win", async () => {
    localStorage.setItem("trackz.v2.accountTypes", JSON.stringify({ SCLB: "investment" }));

    const { getAccountTypeEntries } = await import("@/storage/accountTypes");

    // Stamping these "now" would make every pre-existing entry look
    // freshly authoritative and beat genuine recent edits from a device
    // that has already been syncing.
    expect(getAccountTypeEntries()["SCLB"]?.updatedAt).toBe(new Date(0).toISOString());
  });

  it("drops a corrupt entry without losing the rest of the map", async () => {
    localStorage.setItem(
      "trackz.v2.accountTypes",
      JSON.stringify({ SCLB: "investment", Broken: 42, Revolut: { type: "cash" } }),
    );

    const { getAccountTypes } = await import("@/storage/accountTypes");
    const types = getAccountTypes();

    expect(types["SCLB"]).toBe("investment");
    expect(types["Revolut"]).toBe("cash");
    expect(types["Broken"]).toBeUndefined();
  });
});

describe("mergeAccountTypes", () => {
  it("takes the remote entry when it is newer", async () => {
    const { getAccountType, setAccountType, mergeAccountTypes } = await import(
      "@/storage/accountTypes"
    );

    setAccountType("Trade", "cash");
    const changed = mergeAccountTypes({
      Trade: { type: "investment", updatedAt: "2099-01-01T00:00:00Z" },
    });

    expect(changed).toBe(true);
    expect(getAccountType("Trade")).toBe("investment");
  });

  it("keeps the local entry when it is newer", async () => {
    const { getAccountType, setAccountType, mergeAccountTypes } = await import(
      "@/storage/accountTypes"
    );

    setAccountType("Trade", "investment");
    const changed = mergeAccountTypes({
      Trade: { type: "cash", updatedAt: "2000-01-01T00:00:00Z" },
    });

    expect(changed).toBe(false);
    expect(getAccountType("Trade")).toBe("investment");
  });

  it("keeps the LOCAL entry on an exact timestamp tie", async () => {
    const { getAccountType, mergeAccountTypes, getAccountTypeEntries, setAccountType } =
      await import("@/storage/accountTypes");

    setAccountType("Trade", "investment");
    const localTime = getAccountTypeEntries()["Trade"]?.updatedAt ?? "";

    mergeAccountTypes({ Trade: { type: "cash", updatedAt: localTime } });

    // Same tie-break as sync/merge.ts uses for transactions, deliberately:
    // two different rules for the same question would be a bug generator.
    expect(getAccountType("Trade")).toBe("investment");
  });

  it("merges per account, so edits on two devices both survive", async () => {
    const { getAccountTypes, setAccountType, mergeAccountTypes } = await import(
      "@/storage/accountTypes"
    );

    // This device classified A; the other classified B.
    setAccountType("AccountA", "investment");
    mergeAccountTypes({
      AccountB: { type: "investment", updatedAt: "2026-05-05T00:00:00Z" },
    });

    // Whole-map last-writer-wins would have discarded one of these
    // outright, silently undoing a user's deliberate choice.
    const types = getAccountTypes();
    expect(types["AccountA"]).toBe("investment");
    expect(types["AccountB"]).toBe("investment");
  });

  it("adopts an account it has never seen", async () => {
    const { getAccountType, mergeAccountTypes } = await import("@/storage/accountTypes");

    const changed = mergeAccountTypes({
      Fresh: { type: "investment", updatedAt: "2026-05-05T00:00:00Z" },
    });

    expect(changed).toBe(true);
    expect(getAccountType("Fresh")).toBe("investment");
  });

  it("treats an absent remote map as 'nothing to say', not as empty", async () => {
    const { getAccountType, setAccountType, mergeAccountTypes } = await import(
      "@/storage/accountTypes"
    );

    setAccountType("Trade", "investment");

    // A document written before accountTypes existed has no opinion. Read
    // as "there are no classifications", it would wipe this device's.
    expect(mergeAccountTypes(undefined)).toBe(false);
    expect(getAccountType("Trade")).toBe("investment");
  });

  it("ignores a remote entry with a bogus type", async () => {
    const { getAccountType, setAccountType, mergeAccountTypes } = await import(
      "@/storage/accountTypes"
    );

    setAccountType("Trade", "investment");
    mergeAccountTypes({
      Trade: { type: "savings" as never, updatedAt: "2099-01-01T00:00:00Z" },
    });

    expect(getAccountType("Trade")).toBe("investment");
  });
});
