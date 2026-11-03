import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Transaction } from "@/domain/transaction";
import type { SyncDocument } from "@/sync/document";

/**
 * Tests for the sync CYCLE itself — what performSync does to local storage
 * and to Drive. coordinator.test.ts covers status/debounce/listener
 * bookkeeping without ever letting a sync run; this file runs the cycle
 * with Drive mocked.
 *
 * Separate file because this one has to mock @/sync/drive at module level,
 * and doing that in coordinator.test.ts would mean its debounce tests ran
 * against a mocked transport for no reason.
 *
 * Two behaviours here are regressions worth stating plainly, because both
 * were live bugs that no type check or existing test noticed:
 * - Sync used to re-trigger itself forever (see "does not re-arm").
 * - Sync had no way to detect a concurrent write at all (see "version").
 */

const driveMock = vi.hoisted(() => ({
  fetchFromDrive: vi.fn(),
  readVersion: vi.fn(),
  uploadToDrive: vi.fn(),
  deleteRemoteSyncFile: vi.fn(),
}));

vi.mock("@/sync/drive", () => driveMock);

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

function tx(id: string, updatedAt: string): Transaction {
  return {
    id,
    date: "2026-01-01",
    account: "Checking",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant: "Test Merchant",
    amountCents: 1000,
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt,
    deletedAt: null,
  };
}

function remoteDoc(transactions: Transaction[], revision = 1): SyncDocument {
  return { revision, device: "device-b", transactions };
}

beforeEach(async () => {
  installLocalStorageStub();
  // performSync bails out to "offline" unless navigator.onLine is true.
  // stubGlobal, not assignment: navigator is getter-only in Node.
  vi.stubGlobal("navigator", { onLine: true });

  driveMock.fetchFromDrive.mockReset();
  driveMock.readVersion.mockReset();
  driveMock.uploadToDrive.mockReset();
  driveMock.deleteRemoteSyncFile.mockReset();
  driveMock.deleteRemoteSyncFile.mockResolvedValue(true);
  driveMock.readVersion.mockResolvedValue("1");
  driveMock.uploadToDrive.mockResolvedValue({ version: "2", modifiedTime: "2026-01-01T00:00:00Z" });

  const { resetCoordinatorForTesting } = await import("@/sync/coordinator");
  const { resetAuthForTesting } = await import("@/sync/auth");
  resetCoordinatorForTesting();
  resetAuthForTesting();
});

afterEach(async () => {
  const { resetCoordinatorForTesting } = await import("@/sync/coordinator");
  const { resetAuthForTesting } = await import("@/sync/auth");
  resetCoordinatorForTesting();
  resetAuthForTesting();
  vi.unstubAllGlobals();
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("startup with a restored session", () => {
  it("syncs immediately instead of sitting on 'pending' forever", async () => {
    const { initializeSync, getSyncState } = await import("@/sync/coordinator");
    const { setAccessToken } = await import("@/sync/auth");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("local-1", "2026-01-02T00:00:00Z")]);
    driveMock.fetchFromDrive.mockResolvedValue(remoteDoc([]));

    // Exactly what app.tsx does on reload: restoreSession() resolves with a
    // surviving cookie, THEN initializeSync() runs.
    setAccessToken("restored-token", 3600, "person@example.com");
    initializeSync();
    await vi.waitFor(() => expect(getSyncState().status).toBe("synced"));

    // THE BUG: initializeSync set status "pending" and relied on its auth
    // subscription to start the sync — but that fires only on a CHANGE, and
    // restoreSession() had already resolved before the subscription
    // existed. So no sync ran and the indicator read "syncing…" forever.
    // Reported from live verification on the first reload of a signed-in
    // session; unreachable before then, because sign-in had never worked
    // end to end.
    expect(driveMock.uploadToDrive).toHaveBeenCalled();
  });

  it("stays signed-out and syncs nothing with no session", async () => {
    const { initializeSync, getSyncState } = await import("@/sync/coordinator");

    initializeSync();

    // The guard on the fix: a first-time visitor must not trigger a Drive
    // call that can only fail.
    expect(getSyncState().status).toBe("signed-out");
    expect(driveMock.fetchFromDrive).not.toHaveBeenCalled();
  });
});

/**
 * Sign in and wire the repository notifier, as app startup would, then let
 * the startup sync finish and forget it happened.
 *
 * The settle-and-reset is required, not tidiness: initializeSync() syncs
 * immediately when it finds a restored session (see the startup describe
 * block). Without draining that here, it would consume the
 * mockResolvedValueOnce queues that individual tests set up for their own
 * syncNow() call, and every per-round assertion would be off by one sync.
 */
async function startSignedIn(): Promise<void> {
  const { setAccessToken } = await import("@/sync/auth");
  const { initializeSync } = await import("@/sync/coordinator");
  setAccessToken("test-token", 3600, "person@example.com");
  initializeSync();

  // Let the startup sync run to completion before anyone measures anything.
  await vi.waitFor(() => expect(driveMock.fetchFromDrive).toHaveBeenCalled());
  driveMock.fetchFromDrive.mockClear();
  driveMock.readVersion.mockClear();
  driveMock.uploadToDrive.mockClear();
}

describe("the sync loop", () => {
  it("does not re-arm the debounce from its own write", async () => {
    const { syncNow, markLocalChanged } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("local-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();

    driveMock.fetchFromDrive.mockResolvedValue(
      remoteDoc([tx("remote-1", "2026-01-03T00:00:00Z")]),
    );

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    await syncNow();

    // THE BUG THIS LOCKS DOWN: performSync writes the merge result, that
    // write used to call markLocalChanged unconditionally, which set
    // status "pending" and armed a fresh 5s debounce, which ran
    // performSync again — a full Drive round trip every five seconds for
    // as long as the app stayed open, and a status indicator that could
    // never settle on "Synced".
    const armedDebounce = setTimeoutSpy.mock.calls.some((call) => call[1] === 5000);
    expect(armedDebounce).toBe(false);
    expect((await import("@/sync/coordinator")).getSyncState().status).toBe("synced");

    // Guard against over-correcting: a genuine LOCAL edit must still arm it.
    setTimeoutSpy.mockClear();
    markLocalChanged();
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 5000)).toBe(true);
  });

  it("still notifies UI subscribers about merged remote changes", async () => {
    const { syncNow } = await import("@/sync/coordinator");
    const { subscribe, getTransactions } = await import("@/storage/repository");

    await startSignedIn();
    driveMock.fetchFromDrive.mockResolvedValue(
      remoteDoc([tx("remote-1", "2026-01-03T00:00:00Z")]),
    );

    const listener = vi.fn();
    subscribe(listener);
    await syncNow();

    // Silencing the sync notifier must not silence the UI: a transaction
    // that arrived from another device has to appear on screen without a
    // manual refresh.
    expect(listener).toHaveBeenCalled();
    expect(getTransactions().map((t) => t.id)).toContain("remote-1");
  });

  it("skips the local write entirely when the merge changed nothing", async () => {
    const { syncNow } = await import("@/sync/coordinator");
    const { subscribe, replaceAllTransactions } = await import("@/storage/repository");

    const same = tx("same-1", "2026-01-02T00:00:00Z");
    replaceAllTransactions([same]);
    await startSignedIn();
    driveMock.fetchFromDrive.mockResolvedValue(remoteDoc([same]));

    const listener = vi.fn();
    subscribe(listener);
    await syncNow();

    // Re-rendering every screen on a timer that found no news is pure
    // waste, so a no-op merge should not notify at all.
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not upload when local has nothing the remote lacks", async () => {
    const { syncNow } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");
    const { getAccountTypeEntries } = await import("@/storage/accountTypes");

    const same = tx("same-1", "2026-01-02T00:00:00Z");
    replaceAllTransactions([same]);
    await startSignedIn();
    // Account types have to match too, or the upload is legitimately
    // needed — see the accountTypes describe block below.
    driveMock.fetchFromDrive.mockResolvedValue({
      ...remoteDoc([same]),
      accountTypes: getAccountTypeEntries(),
    });

    await syncNow();

    expect(driveMock.uploadToDrive).not.toHaveBeenCalled();
  });
});

describe("account types", () => {
  it("uploads them alongside transactions", async () => {
    const { syncNow } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");
    const { setAccountType } = await import("@/storage/accountTypes");

    replaceAllTransactions([tx("local-1", "2026-01-02T00:00:00Z")]);
    setAccountType("SCLB", "investment");
    await startSignedIn();
    driveMock.fetchFromDrive.mockResolvedValue(remoteDoc([]));

    await syncNow();

    // Without this, two devices holding identical transactions show
    // different "Liquid" headline figures, because the classification is
    // what decides which balances count as spendable cash.
    const uploaded = driveMock.uploadToDrive.mock.calls[0]?.[0] as SyncDocument;
    expect(uploaded.accountTypes?.["SCLB"]?.type).toBe("investment");
  });

  it("adopts a classification made on another device", async () => {
    const { syncNow } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");
    const { getAccountType } = await import("@/storage/accountTypes");

    const shared = tx("shared-1", "2026-01-02T00:00:00Z");
    replaceAllTransactions([shared]);
    await startSignedIn();
    driveMock.fetchFromDrive.mockResolvedValue({
      ...remoteDoc([shared]),
      accountTypes: { Broker: { type: "investment", updatedAt: "2099-01-01T00:00:00Z" } },
    });

    await syncNow();

    expect(getAccountType("Broker")).toBe("investment");
  });

  it("uploads a classification even when no transaction changed", async () => {
    const { syncNow } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");
    const { setAccountType } = await import("@/storage/accountTypes");

    const shared = tx("shared-1", "2026-01-02T00:00:00Z");
    replaceAllTransactions([shared]);
    await startSignedIn();
    driveMock.fetchFromDrive.mockResolvedValue(remoteDoc([shared]));

    setAccountType("Broker", "investment");
    await syncNow();

    // A device where the user ONLY reclassified an account has nothing new
    // in `transactions`. Gating the upload on that alone would strand the
    // classification on this device forever.
    expect(driveMock.uploadToDrive).toHaveBeenCalled();
    const uploaded = driveMock.uploadToDrive.mock.calls[0]?.[0] as SyncDocument;
    expect(uploaded.accountTypes?.["Broker"]?.type).toBe("investment");
  });

  it("parses a document written before the field existed", async () => {
    const { syncNow, getSyncState } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");
    const { setAccountType, getAccountType } = await import("@/storage/accountTypes");

    const shared = tx("shared-1", "2026-01-02T00:00:00Z");
    replaceAllTransactions([shared]);
    setAccountType("Broker", "investment");
    await startSignedIn();
    // No accountTypes key at all — what today's deployed code writes.
    driveMock.fetchFromDrive.mockResolvedValue(remoteDoc([shared]));

    await syncNow();

    // Absent must mean "this writer had no opinion", not "there are none".
    // Read as empty, an older device would wipe this device's settings.
    expect(getAccountType("Broker")).toBe("investment");
    expect(getSyncState().status).toBe("synced");
  });
});

describe("version-based convergence", () => {
  it("uploads when the remote version held still", async () => {
    const { syncNow } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("local-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();
    driveMock.fetchFromDrive.mockResolvedValue(remoteDoc([]));
    driveMock.readVersion.mockResolvedValue("7");

    await syncNow();

    expect(driveMock.uploadToDrive).toHaveBeenCalledTimes(1);
    expect((await import("@/sync/coordinator")).getSyncState().status).toBe("synced");
  });

  it("re-merges instead of overwriting when another device wrote mid-sync", async () => {
    const { syncNow, getSyncState } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("local-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();

    // Round 1: version moves between the read and the pre-upload check —
    // device B wrote while we were merging. Round 2: steady.
    driveMock.readVersion
      .mockResolvedValueOnce("7") // round 1, at fetch
      .mockResolvedValueOnce("8") // round 1, before upload -> stale, restart
      .mockResolvedValueOnce("8") // round 2, at fetch
      .mockResolvedValueOnce("8"); // round 2, before upload -> safe
    driveMock.fetchFromDrive
      .mockResolvedValueOnce(remoteDoc([]))
      .mockResolvedValueOnce(remoteDoc([tx("remote-b", "2026-01-04T00:00:00Z")], 2));

    await syncNow();

    // Uploading the first merge would have erased device B's write, which
    // that merge never saw. Drive v3 offers no compare-and-swap (no ETag,
    // no If-Match), so re-reading the version counter is the only way to
    // notice at all.
    expect(driveMock.fetchFromDrive).toHaveBeenCalledTimes(2);
    expect(driveMock.uploadToDrive).toHaveBeenCalledTimes(1);

    const uploaded = driveMock.uploadToDrive.mock.calls[0]?.[0] as SyncDocument;
    expect(uploaded.transactions.map((t) => t.id).sort()).toEqual(["local-1", "remote-b"]);
    expect(getSyncState().status).toBe("synced");
  });

  it("reports a conflict rather than 'Synced' when rounds run out", async () => {
    const { syncNow, getSyncState } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("local-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();
    driveMock.fetchFromDrive.mockResolvedValue(remoteDoc([]));

    // A different version on every single read: the other device never stops.
    let version = 0;
    driveMock.readVersion.mockImplementation(async () => String(++version));

    await syncNow();

    // Bounded rounds, so two devices writing continuously cannot spin
    // Drive forever. And the status must be honest: our changes really are
    // still only local, so "Synced" would be precisely the lie this status
    // set exists to prevent.
    expect(driveMock.uploadToDrive).not.toHaveBeenCalled();
    expect(driveMock.fetchFromDrive).toHaveBeenCalledTimes(3);
    expect(getSyncState().status).toBe("conflict");
  });

  it("reads the version BEFORE the content, not after", async () => {
    const { syncNow } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    const order: string[] = [];
    replaceAllTransactions([tx("local-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();
    driveMock.readVersion.mockImplementation(async () => {
      order.push("version");
      return "7";
    });
    driveMock.fetchFromDrive.mockImplementation(async () => {
      order.push("content");
      return remoteDoc([]);
    });

    await syncNow();

    // Order is load-bearing, not incidental. Reading the version AFTER the
    // content would mean a write landing in between leaves us holding
    // stale content stamped with the writer's NEW version — the pre-upload
    // check then sees no change and we overwrite their write. Reading
    // first can only cause a spurious restart, which is the harmless way
    // to be wrong.
    expect(order.slice(0, 2)).toEqual(["version", "content"]);
  });
});

describe("overwriteRemoteWithLocal", () => {
  it("uploads local data without reading the remote document", async () => {
    const { overwriteRemoteWithLocal } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("keep-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();

    await overwriteRemoteWithLocal();

    // Not consulting the remote is the entire point. Normal sync is a
    // union by id, so a remote document full of unreconcilable junk can
    // only ever grow — merging it in is what made the bad state
    // unrecoverable in the first place.
    expect(driveMock.fetchFromDrive).not.toHaveBeenCalled();

    const uploaded = driveMock.uploadToDrive.mock.calls[0]?.[0] as SyncDocument;
    expect(uploaded.transactions.map((t) => t.id)).toEqual(["keep-1"]);
  });

  it("deletes the remote file before uploading", async () => {
    const { overwriteRemoteWithLocal } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("keep-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();

    // Record order only from here: startSignedIn's own startup sync
    // uploads too, and counting that would mask the ordering under test.
    const order: string[] = [];
    driveMock.deleteRemoteSyncFile.mockImplementation(async () => {
      order.push("delete");
      return true;
    });
    driveMock.uploadToDrive.mockImplementation(async () => {
      order.push("upload");
      return { version: "1", modifiedTime: "2026-01-01T00:00:00Z" };
    });

    await overwriteRemoteWithLocal();

    // A fresh file makes "did this work?" answerable by row count alone.
    expect(order).toEqual(["delete", "upload"]);
  });

  it("uploads as revision 0, not a continuation of the discarded history", async () => {
    const { overwriteRemoteWithLocal } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("keep-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();

    await overwriteRemoteWithLocal();

    // A higher revision would imply the old document was an ancestor of
    // this one. It is not; it is being thrown away.
    const uploaded = driveMock.uploadToDrive.mock.calls[0]?.[0] as SyncDocument;
    expect(uploaded.revision).toBe(0);
  });

  it("cannot be beaten by a pending debounced merge", async () => {
    const { overwriteRemoteWithLocal, markLocalChanged } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("keep-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();
    driveMock.fetchFromDrive.mockResolvedValue(remoteDoc([tx("junk-1", "2026-01-03T00:00:00Z")]));

    // Fake timers only for this test — the rest of the file relies on real
    // ones, and startSignedIn above awaits a real promise chain.
    vi.useFakeTimers();
    try {
      // Arm the debounce, then reset while it is still pending.
      markLocalChanged();
      await overwriteRemoteWithLocal();

      // Let any surviving timer fire.
      await vi.advanceTimersByTimeAsync(10_000);
    } finally {
      vi.useRealTimers();
    }

    // THE RACE THIS CLOSES: the previous version deleted the file and then
    // called syncNow(), so a debounce firing in between could re-upload
    // the union and undo the reset. Whether recovery worked depended on
    // how fast the user clicked.
    expect(driveMock.fetchFromDrive).not.toHaveBeenCalled();
    expect(driveMock.uploadToDrive).toHaveBeenCalledTimes(1);
    const uploaded = driveMock.uploadToDrive.mock.calls[0]?.[0] as SyncDocument;
    expect(uploaded.transactions.map((t) => t.id)).toEqual(["keep-1"]);
  });

  it("refuses when signed out instead of silently doing nothing", async () => {
    const { overwriteRemoteWithLocal } = await import("@/sync/coordinator");

    await expect(overwriteRemoteWithLocal()).rejects.toThrow(/Not signed in/);
    expect(driveMock.deleteRemoteSyncFile).not.toHaveBeenCalled();
  });

  it("reports an error rather than claiming success on failure", async () => {
    const { overwriteRemoteWithLocal, getSyncState } = await import("@/sync/coordinator");
    const { replaceAllTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("keep-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();
    driveMock.uploadToDrive.mockRejectedValue(new Error("Failed to upload to Drive: 500"));

    // Claiming success here would be the worst outcome: the user believes
    // the junk is gone, reconnects another device, and it merges back in.
    await expect(overwriteRemoteWithLocal()).rejects.toThrow();
    expect(getSyncState().status).toBe("error");
  });
});

/**
 * CSV import, and whether it survives contact with sync.
 *
 * These exist because the import path promised something it did not
 * deliver: the UI says "This will permanently replace your current N
 * transactions" and labels the button "Replace anyway", but a plain
 * replaceAllTransactions() armed the 5s debounce, and the resulting merge
 * is a union by id — so every row that was on Drive but absent from the
 * imported file came back a few seconds later. Reproduced before fixing:
 * a 2-row import over 3 synced rows returned to 3.
 *
 * features/settings/commitImport.ts is the fix. Tested here rather than
 * beside it because the bug was never in the commit itself — it was in
 * what the coordinator did afterwards, which is what this file's harness
 * (mocked Drive, real repository, real debounce) can actually observe.
 */
describe("committing a CSV import", () => {
  it("does not let the debounced union restore rows the import dropped", async () => {
    const { commitImport } = await import("@/features/settings/commitImport");
    const { replaceAllTransactions, getTransactions } = await import("@/storage/repository");

    const synced = [
      tx("row-1", "2026-01-02T00:00:00Z"),
      tx("row-2", "2026-01-02T00:00:00Z"),
      tx("row-3", "2026-01-02T00:00:00Z"),
    ];
    replaceAllTransactions(synced);
    await startSignedIn();

    // Drive holds all three. If anything merges after the import, row-3
    // is what comes back.
    driveMock.fetchFromDrive.mockResolvedValue(remoteDoc(synced));

    vi.useFakeTimers();
    try {
      // The user imports a file that deliberately omits row-3.
      await commitImport([synced[0]!, synced[1]!]);

      // Drain any timer the commit might have armed. THE BUG: a
      // non-silent write arms the debounce here, performSync unions local
      // with Drive, and row-3 returns.
      await vi.advanceTimersByTimeAsync(10_000);
    } finally {
      vi.useRealTimers();
    }

    expect(getTransactions().map((t) => t.id)).toEqual(["row-1", "row-2"]);
    // And Drive was told, so another device won't reintroduce it either.
    expect(driveMock.deleteRemoteSyncFile).toHaveBeenCalled();
    const uploaded = driveMock.uploadToDrive.mock.calls.at(-1)?.[0] as SyncDocument;
    expect(uploaded.transactions.map((t) => t.id)).toEqual(["row-1", "row-2"]);
  });

  it("touches Drive not at all when signed out", async () => {
    const { commitImport } = await import("@/features/settings/commitImport");
    const { getTransactions } = await import("@/storage/repository");

    const result = await commitImport([tx("row-1", "2026-01-02T00:00:00Z")]);

    // Sync is optional; the app is fully usable on localStorage alone. An
    // import must not require it, nor report a Drive problem there isn't one.
    expect(result.kind).toBe("local-only");
    expect(driveMock.deleteRemoteSyncFile).not.toHaveBeenCalled();
    expect(driveMock.uploadToDrive).not.toHaveBeenCalled();
    expect(getTransactions().map((t) => t.id)).toEqual(["row-1"]);
  });

  it("reports a failed Drive overwrite instead of implying the import is synced", async () => {
    const { commitImport } = await import("@/features/settings/commitImport");
    const { replaceAllTransactions, getTransactions } = await import("@/storage/repository");

    replaceAllTransactions([tx("row-1", "2026-01-02T00:00:00Z")]);
    await startSignedIn();
    driveMock.uploadToDrive.mockRejectedValue(new Error("Failed to upload to Drive: 500"));

    const result = await commitImport([tx("row-2", "2026-01-02T00:00:00Z")]);

    // The local import stands — it already committed, and throwing it away
    // because the network blinked would be worse.
    expect(getTransactions().map((t) => t.id)).toEqual(["row-2"]);
    // But this MUST be distinguishable from success. Drive still holds the
    // old copy and nothing will retry: the local write was silent, so no
    // debounce is armed. Unreported, the next ordinary edit would merge
    // against stale remote data and resurrect the dropped rows — the
    // original bug, just delayed.
    expect(result.kind).toBe("local-but-drive-failed");
  });

  it("still lets a brand-new device pull Drive's data down", async () => {
    const { syncNow } = await import("@/sync/coordinator");
    const { getTransactions } = await import("@/storage/repository");

    // Empty local store, as on a freshly installed second device.
    await startSignedIn();
    driveMock.fetchFromDrive.mockResolvedValue(
      remoteDoc([tx("remote-1", "2026-01-02T00:00:00Z"), tx("remote-2", "2026-01-02T00:00:00Z")]),
    );

    await syncNow();

    // THE GUARD on the fix above: union-by-id must stay intact for
    // ordinary sync. It is what makes adding a device safe — an empty
    // store can only pull data down, never delete Drive's copy. If the
    // import fix ever leaked into the normal path, this is what would
    // catch it, and the symptom would be data loss rather than a stale row.
    expect(getTransactions().map((t) => t.id)).toEqual(["remote-1", "remote-2"]);
    expect(driveMock.deleteRemoteSyncFile).not.toHaveBeenCalled();
  });
});
