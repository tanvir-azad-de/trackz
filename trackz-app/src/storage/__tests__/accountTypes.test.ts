import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Tests for storage/accountTypes.ts — the cash/investment classification
 * that decides what counts towards Home's "Liquid" headline.
 *
 * Two things here are regressions with real consequences:
 *
 * 1. THE PHANTOM SEED WRITER. readRaw() used to merge SEED_DEFAULTS into
 *    the result on EVERY read, so SCLB: "investment" was effectively
 *    hardcoded. Harmless while the map was device-local; destructive once
 *    it syncs, because a device with cleared storage would re-seed
 *    "investment" and overwrite a deliberate "cash" from another device.
 *
 * 2. MERGE GRANULARITY. The map now syncs, so entries carry timestamps and
 *    merge per account. Whole-map last-writer-wins would mean classifying
 *    account A here and account B there loses one of them.
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

describe("the SCLB seed", () => {
  it("classifies SCLB as investment on a first run", async () => {
    const { getAccountType } = await import("@/storage/accountTypes");

    // The Phase 12 QA finding: counted as cash, SCLB overstated spendable
    // cash by its full balance (3.147,07 € shown vs 847,07 € true).
    expect(getAccountType("SCLB")).toBe("investment");
  });

  it("does not resurrect itself after the user sets SCLB to cash", async () => {
    const { getAccountType, setAccountType } = await import("@/storage/accountTypes");

    getAccountType("SCLB"); // first run, seeds
    setAccountType("SCLB", "cash");

    // The old every-read merge put SEED_DEFAULTS FIRST, so a stored value
    // did win — but the seed was still re-written on every read, which is
    // what made it a third writer once syncing began.
    expect(getAccountType("SCLB")).toBe("cash");
  });

  it("does not re-seed after the user has cleared the classification", async () => {
    const { getAccountType, setAccountType } = await import("@/storage/accountTypes");

    getAccountType("SCLB");
    setAccountType("SCLB", "cash");

    // Many reads, to catch a seed that re-applies on each one.
    for (let i = 0; i < 5; i++) getAccountType("SCLB");

    expect(getAccountType("SCLB")).toBe("cash");
  });

  it("dates the seed at the epoch so any real edit outranks it", async () => {
    const { getAccountTypeEntries } = await import("@/storage/accountTypes");

    // A seed is the weakest possible claim. Stamped "now", it would beat a
    // genuine classification made moments earlier on another device.
    expect(getAccountTypeEntries()["SCLB"]?.updatedAt).toBe(new Date(0).toISOString());
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
