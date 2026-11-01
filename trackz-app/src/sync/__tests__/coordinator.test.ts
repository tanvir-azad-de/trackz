import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSyncState,
  markLocalChanged,
  subscribeSyncState,
  resetCoordinatorForTesting,
  initializeSync,
  type SyncState,
} from "@/sync/coordinator";
import { resetAuthForTesting, setAccessToken } from "@/sync/auth";

/**
 * Phase 15b: Tests for coordinator.ts (sync orchestration).
 * Tests state management, debouncing, and listener subscriptions.
 *
 * Most tests sign in first (setAccessToken), because the coordinator
 * deliberately does nothing while signed out — see markLocalChanged.
 */

beforeEach(() => {
  resetCoordinatorForTesting();
  resetAuthForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetCoordinatorForTesting();
  resetAuthForTesting();
});

/** Sign in without touching the network, as the OAuth flow would. */
function signInForTest(): void {
  setAccessToken("test-token", 3600, "person@example.com");
}

describe("getSyncState", () => {
  it("starts signed-out, not synced, when no account is connected", () => {
    initializeSync();
    const state = getSyncState();

    // "synced" here would claim the data is safely on Drive when no Drive
    // account exists — the most misleading thing the indicator could say.
    expect(state.status).toBe("signed-out");
    expect(state.lastSyncTime).toBe(null);
    expect(state.lastError).toBe(null);
    expect(state.hasConflicts).toBe(false);
  });

  it("reports no error for the signed-out state", () => {
    initializeSync();
    // Running without Drive is a valid choice, not a fault to report.
    expect(getSyncState().lastError).toBe(null);
  });
});

describe("markLocalChanged", () => {
  it("sets status to pending immediately when signed in", () => {
    signInForTest();
    initializeSync();
    markLocalChanged();

    expect(getSyncState().status).toBe("pending");
  });

  it("stays signed-out and schedules nothing when not signed in", () => {
    initializeSync();
    const timerSpy = vi.spyOn(global, "setTimeout");

    markLocalChanged();

    expect(getSyncState().status).toBe("signed-out");
    expect(timerSpy).not.toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it("debounces sync for 5 seconds", () => {
    signInForTest();
    initializeSync();
    const syncSpy = vi.spyOn(global, "setTimeout");

    markLocalChanged();

    expect(syncSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it("resets debounce if called again within window", () => {
    signInForTest();
    initializeSync();
    const syncSpy = vi.spyOn(global, "setTimeout");

    markLocalChanged();
    syncSpy.mockClear();
    markLocalChanged();

    // Should have rescheduled
    expect(syncSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
  });
});

describe("initializeSync", () => {
  it("reports pending when a session was already restored", () => {
    signInForTest();
    initializeSync();

    expect(getSyncState().status).toBe("pending");
  });

  it("returns to signed-out when the user signs out", async () => {
    signInForTest();
    initializeSync();
    markLocalChanged();
    expect(getSyncState().status).toBe("pending");

    const { signOut } = await import("@/sync/auth");
    await signOut();

    expect(getSyncState().status).toBe("signed-out");
    expect(getSyncState().lastError).toBe(null);
  });

  it("is idempotent — repeat calls don't stack auth subscriptions", async () => {
    const { signOut } = await import("@/sync/auth");

    // Measured on the sign-OUT path: the sign-in branch is already guarded
    // by a status check, so a stacked listener there is invisible. Sign-out
    // notifies unconditionally, so duplicate subscriptions show up as
    // duplicate state updates.
    signInForTest();
    initializeSync();
    const once = vi.fn();
    subscribeSyncState(once);
    await signOut();
    const callsAfterOneInit = once.mock.calls.length;

    resetCoordinatorForTesting();
    resetAuthForTesting();

    signInForTest();
    initializeSync();
    initializeSync();
    initializeSync();
    const thrice = vi.fn();
    subscribeSyncState(thrice);
    await signOut();

    expect(thrice.mock.calls.length).toBe(callsAfterOneInit);
  });
});

describe("subscribeSyncState", () => {
  it("calls listener when sync state changes", () => {
    signInForTest();
    initializeSync();
    const listener = vi.fn();
    subscribeSyncState(listener);

    markLocalChanged();

    expect(listener).toHaveBeenCalled();
    const state = listener.mock.calls[0]?.[0] as SyncState;
    expect(state?.status).toBe("pending");
  });

  it("returns unsubscribe function", () => {
    signInForTest();
    initializeSync();
    const listener = vi.fn();
    const unsubscribe = subscribeSyncState(listener);

    markLocalChanged();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    markLocalChanged();

    // Should not be called again
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("resetCoordinatorForTesting", () => {
  it("clears all state and timers", () => {
    signInForTest();
    initializeSync();
    markLocalChanged();

    expect(getSyncState().status).toBe("pending");

    resetCoordinatorForTesting();

    expect(getSyncState().status).toBe("signed-out");
    expect(getSyncState().lastError).toBe(null);
  });
});
