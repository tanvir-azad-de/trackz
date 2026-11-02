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
