import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAuthState,
  setAccessToken,
  signOut,
  subscribeToAuth,
  resetAuthForTesting,
  type AuthState,
} from "@/sync/auth";

/**
 * Phase 15b: Tests for auth.ts (Google Sign-In integration).
 * Tests the auth state machine, token management, and listener subscriptions.
 */

beforeEach(() => {
  resetAuthForTesting();
});

afterEach(() => {
  resetAuthForTesting();
});

describe("getAuthState", () => {
  it("returns initial signed-out state", () => {
    const state = getAuthState();
    expect(state.isSignedIn).toBe(false);
    expect(state.accessToken).toBe(null);
    expect(state.userEmail).toBe(null);
  });
});

describe("setAccessToken", () => {
  it("sets access token and marks as signed in", () => {
    setAccessToken("test-token", 3600);
    const state = getAuthState();

    expect(state.isSignedIn).toBe(true);
    expect(state.accessToken).toBe("test-token");
  });

  it("schedules token refresh before expiry", () => {
    vi.useFakeTimers();
    const refreshSpy = vi.spyOn(global, "setTimeout");

    setAccessToken("test-token", 100);

    // Should schedule refresh ~70 seconds later (100 - 30)
    expect(refreshSpy).toHaveBeenCalled();
    expect(refreshSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));

    vi.useRealTimers();
  });
});

describe("signOut", () => {
  it("clears auth state", () => {
    setAccessToken("test-token", 3600);
    expect(getAuthState().isSignedIn).toBe(true);

    signOut();
    const state = getAuthState();

    expect(state.isSignedIn).toBe(false);
    expect(state.accessToken).toBe(null);
    expect(state.userEmail).toBe(null);
  });
});

describe("subscribeToAuth", () => {
  it("calls listener when auth state changes", () => {
    const listener = vi.fn();
    subscribeToAuth(listener);

    setAccessToken("test-token", 3600);

    expect(listener).toHaveBeenCalled();
    const state = listener.mock.calls[0]?.[0] as AuthState;
    expect(state?.isSignedIn).toBe(true);
  });

  it("returns unsubscribe function", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAuth(listener);

    setAccessToken("test-token", 3600);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    signOut();

    // Should not be called again after unsubscribe
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("resetAuthForTesting", () => {
  it("clears all state and listeners", () => {
    const listener = vi.fn();
    subscribeToAuth(listener);
    setAccessToken("test-token", 3600);

    resetAuthForTesting();

    expect(getAuthState().isSignedIn).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1); // Only from setAccessToken
  });
});
