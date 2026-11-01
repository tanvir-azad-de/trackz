import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAuthState,
  refreshAccessToken,
  restoreSession,
  setAccessToken,
  signOut,
  subscribeToAuth,
  resetAuthForTesting,
  type AuthState,
} from "@/sync/auth";

/**
 * Phase 15b: Tests for auth.ts (Google sign-in for Drive sync).
 *
 * The behaviour that matters most here is the token lifecycle across a
 * reload: restoreSession() must turn a surviving httpOnly refresh cookie
 * into a signed-in state, and must treat "no cookie" as the ordinary
 * signed-out case rather than an error. Those paths are what make sync
 * usable in a PWA, and they are invisible to a type checker.
 *
 * The client ID is stubbed via vi.mock rather than an env var so these
 * tests don't depend on a .env.local being present.
 */

vi.mock("@/app/config", () => ({
  googleClientId: "test-client-id.apps.googleusercontent.com",
  driveScope: "https://www.googleapis.com/auth/drive.file",
}));

/** Stand in for a fetch Response, with only the bits auth.ts reads. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetAuthForTesting();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  resetAuthForTesting();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getAuthState", () => {
  it("returns initial signed-out state", () => {
    const state = getAuthState();
    expect(state.isSignedIn).toBe(false);
    expect(state.accessToken).toBe(null);
    expect(state.userEmail).toBe(null);
  });

  it("returns a copy, so callers cannot mutate internal state", () => {
    setAccessToken("test-token", 3600);
    const state = getAuthState();
    state.accessToken = "tampered";

    expect(getAuthState().accessToken).toBe("test-token");
  });
});

describe("setAccessToken", () => {
  it("sets access token and marks as signed in", () => {
    setAccessToken("test-token", 3600);
    const state = getAuthState();

    expect(state.isSignedIn).toBe(true);
    expect(state.accessToken).toBe("test-token");
  });

  it("records the account email when given one", () => {
    setAccessToken("test-token", 3600, "person@example.com");
    expect(getAuthState().userEmail).toBe("person@example.com");
  });

  it("schedules a refresh 60s before expiry", () => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(global, "setTimeout");

    setAccessToken("test-token", 3600);

    // 3600 - 60 = 3540s. Refreshing early avoids a Drive call being cut
    // off mid-request by an expiry.
    expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 3_540_000);
    vi.useRealTimers();
  });

  it("never schedules a refresh sooner than 30s, even for an absurd expiry", () => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(global, "setTimeout");

    // A 10s expiry would otherwise compute to a negative delay and fire
    // immediately, spinning the refresh endpoint in a tight loop.
    setAccessToken("test-token", 10);

    expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    vi.useRealTimers();
  });

  it("refreshes automatically when the scheduled timer fires", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { access_token: "second-token", expires_in: 3600 }),
    );

    setAccessToken("first-token", 3600);
    await vi.advanceTimersByTimeAsync(3_540_000);

    expect(getAuthState().accessToken).toBe("second-token");
    vi.useRealTimers();
  });
});

describe("restoreSession", () => {
  it("signs in from a surviving refresh cookie", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { access_token: "restored-token", expires_in: 3600 }),
    );

    const restored = await restoreSession();

    expect(restored).toBe(true);
    expect(getAuthState().isSignedIn).toBe(true);
    expect(getAuthState().accessToken).toBe("restored-token");
  });

  it("sends the CSRF header and same-origin credentials", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { access_token: "restored-token", expires_in: 3600 }),
    );

    await restoreSession();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/refresh");
    expect(init.method).toBe("POST");
    // Without credentials the httpOnly cookie is never sent, so the
    // endpoint could only ever answer 401.
    expect(init.credentials).toBe("same-origin");
    // The backend rejects requests lacking this header (Google's
    // documented popup-mode CSRF defense).
    expect(init.headers).toMatchObject({ "X-Requested-With": "XmlHttpRequest" });
  });

  it("reports signed-out without error when there is no session", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "no_session" }));

    const restored = await restoreSession();

    // The common case for anyone who never connected Drive — must not be
    // surfaced to the user as a failure.
    expect(restored).toBe(false);
    expect(getAuthState().isSignedIn).toBe(false);
  });

  it("reports signed-out when the device is offline", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(restoreSession()).resolves.toBe(false);
    expect(getAuthState().isSignedIn).toBe(false);
  });

  it("rejects a malformed token response rather than claiming success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { expires_in: 3600 }));

    await expect(restoreSession()).resolves.toBe(false);
    expect(getAuthState().isSignedIn).toBe(false);
  });
});

describe("refreshAccessToken", () => {
  it("replaces the access token on success", async () => {
    setAccessToken("old-token", 3600);
    fetchMock.mockResolvedValue(
      jsonResponse(200, { access_token: "new-token", expires_in: 3600 }),
    );

    await expect(refreshAccessToken()).resolves.toBe(true);
    expect(getAuthState().accessToken).toBe("new-token");
  });

  it("signs the user out on 401, because the cookie is permanently dead", async () => {
    setAccessToken("old-token", 3600);
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "invalid_grant" }));

    await expect(refreshAccessToken()).resolves.toBe(false);
    expect(getAuthState().isSignedIn).toBe(false);
    expect(getAuthState().accessToken).toBe(null);
  });

  it("stays signed in when Google is briefly unavailable", async () => {
    setAccessToken("old-token", 3600);
    fetchMock.mockResolvedValue(jsonResponse(503, { error: "refresh_unavailable" }));

    await expect(refreshAccessToken()).resolves.toBe(false);
    // A transient 5xx is not proof the session is gone. Signing the user
    // out here would force a needless re-consent over a blip.
    expect(getAuthState().isSignedIn).toBe(true);
  });

  it("stays signed in on a network failure", async () => {
    setAccessToken("old-token", 3600);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(refreshAccessToken()).resolves.toBe(false);
    expect(getAuthState().isSignedIn).toBe(true);
  });
});

describe("signOut", () => {
  it("clears local auth state", async () => {
    setAccessToken("test-token", 3600, "person@example.com");
    fetchMock.mockResolvedValue(jsonResponse(204, null));

    await signOut();
    const state = getAuthState();

    expect(state.isSignedIn).toBe(false);
    expect(state.accessToken).toBe(null);
    expect(state.userEmail).toBe(null);
  });

  it("asks the server to expire the httpOnly cookie", async () => {
    setAccessToken("test-token", 3600);
    fetchMock.mockResolvedValue(jsonResponse(204, null));

    await signOut();

    // Script cannot delete an httpOnly cookie, so without this round trip
    // the browser would keep a months-long Drive credential that the next
    // page load would silently reuse.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/signout");
    expect(init.credentials).toBe("same-origin");
  });

  it("still reports signed out if the server is unreachable", async () => {
    setAccessToken("test-token", 3600);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await signOut();

    // The UI must not claim to still be connected after the user asked to
    // disconnect, even though the cookie may outlive this attempt.
    expect(getAuthState().isSignedIn).toBe(false);
  });

  it("cancels the scheduled token refresh", async () => {
    vi.useFakeTimers();
    setAccessToken("test-token", 3600);
    fetchMock.mockResolvedValue(jsonResponse(204, null));

    await signOut();
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(3_540_000);

    // A timer surviving sign-out would silently re-establish the session.
    expect(fetchMock).not.toHaveBeenCalled();
    vi.useRealTimers();
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

  it("notifies listeners on sign-out", async () => {
    setAccessToken("test-token", 3600);
    fetchMock.mockResolvedValue(jsonResponse(204, null));
    const listener = vi.fn();
    subscribeToAuth(listener);

    await signOut();

    const state = listener.mock.calls[0]?.[0] as AuthState;
    expect(state?.isSignedIn).toBe(false);
  });

  it("returns unsubscribe function", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAuth(listener);
    fetchMock.mockResolvedValue(jsonResponse(204, null));

    setAccessToken("test-token", 3600);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await signOut();

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
