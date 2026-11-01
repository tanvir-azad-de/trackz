import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSyncState,
  markLocalChanged,
  subscribeSyncState,
  resetCoordinatorForTesting,
  initializeSync,
  type SyncState,
} from "@/sync/coordinator";
import { resetAuthForTesting } from "@/sync/auth";

/**
 * Phase 15b: Tests for coordinator.ts (sync orchestration).
 * Tests state management, debouncing, and listener subscriptions.
 */

beforeEach(() => {
  resetCoordinatorForTesting();
  resetAuthForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSyncState", () => {
  it("returns initial synced state", () => {
    initializeSync();
    const state = getSyncState();

    expect(state.status).toBe("synced");
    expect(state.lastSyncTime).toBe(null);
    expect(state.lastError).toBe(null);
    expect(state.hasConflicts).toBe(false);
  });
});

describe("markLocalChanged", () => {
  it("sets status to pending immediately", () => {
    initializeSync();
    markLocalChanged();

    const state = getSyncState();
    expect(state.status).toBe("pending");
  });

  it("debounces sync for 5 seconds", () => {
    initializeSync();
    const syncSpy = vi.spyOn(global, "setTimeout");

    markLocalChanged();

    expect(syncSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it("resets debounce if called again within window", () => {
    initializeSync();
    const syncSpy = vi.spyOn(global, "setTimeout");

    markLocalChanged();
    syncSpy.mockClear();
    markLocalChanged();

    // Should have rescheduled
    expect(syncSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
  });
});

describe("subscribeSyncState", () => {
  it("calls listener when sync state changes", () => {
    initializeSync();
    const listener = vi.fn();
    subscribeSyncState(listener);

    markLocalChanged();

    expect(listener).toHaveBeenCalled();
    const state = listener.mock.calls[0]?.[0] as SyncState;
    expect(state?.status).toBe("pending");
  });

  it("returns unsubscribe function", () => {
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
    initializeSync();
    markLocalChanged();

    expect(getSyncState().status).toBe("pending");

    resetCoordinatorForTesting();

    expect(getSyncState().status).toBe("synced");
    expect(getSyncState().lastError).toBe(null);
  });
});
