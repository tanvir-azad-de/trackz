/**
 * Phase 15b: Google sign-in for Drive sync.
 *
 * Owns exactly one thing: whether this browser currently holds a usable
 * Google access token, and how to get one. Everything else in sync/ asks
 * this module via getAuthState() and never touches OAuth directly.
 *
 * The flow is GIS popup-mode authorization code:
 *   1. signIn() opens Google's popup and gets a one-time auth code.
 *   2. The code goes to POST /api/auth/exchange, which holds the client
 *      secret. That endpoint returns a short-lived access token and parks
 *      the long-lived refresh token in an httpOnly cookie.
 *   3. restoreSession() POSTs /api/auth/refresh on startup. A 200 means the
 *      cookie survived, so the user is still signed in without a popup.
 *
 * Why no refresh token in this file: it is a ~6-month credential for the
 * user's Drive, and anything JavaScript can read, XSS can steal. Only the
 * access token (≈1h, re-mintable) lives in memory here. See lib/apiAuth.ts.
 *
 * Why the access token is NOT persisted: it would buy nothing. It expires
 * in an hour, and restoreSession() can mint a fresh one from the cookie on
 * every load anyway, so storing it would add an exfiltration target for no
 * gain in reliability.
 */

import { driveScope, googleClientId } from "@/app/config";

export interface AuthState {
  isSignedIn: boolean;
  accessToken: string | null;
  userEmail: string | null;
}

export interface AuthConfig {
  clientId: string;
  scopes: string[];
}

/**
 * Google's documented CSRF defense for popup-mode code flow: a header that
 * cross-site HTML forms cannot set, and that cross-site fetch cannot set
 * without a preflight the API never grants. The backend requires it.
 */
const CSRF_HEADER = { "X-Requested-With": "XmlHttpRequest" } as const;

/**
 * The signed-in account's email, kept in localStorage purely so Settings
 * can render "Connected as ..." immediately on load instead of flashing a
 * blank row while /api/auth/refresh is in flight. It is display-only
 * metadata and confers no access — unlike a token, which is why this one
 * is allowed to be persisted.
 */
const EMAIL_KEY = "trackz.sync.email";

function readStoredEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

function writeStoredEmail(email: string | null): void {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email);
    else localStorage.removeItem(EMAIL_KEY);
  } catch {
    // Private browsing or a full quota. Losing a cached display string is
    // not worth failing sign-in over.
  }
}

let currentAuthState: AuthState = {
  isSignedIn: false,
  accessToken: null,
  userEmail: readStoredEmail(),
};

let authListeners = new Set<(state: AuthState) => void>();
let tokenRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  email?: string | null;
}

/** Shape of the GIS global we rely on. */
interface GisCodeClient {
  requestCode: () => void;
}
interface GisGlobal {
  accounts: {
    oauth2: {
      initCodeClient: (config: {
        client_id: string;
        scope: string;
        ux_mode: "popup" | "redirect";
        callback: (response: { code?: string; error?: string }) => void;
      }) => GisCodeClient;
    };
  };
}

function readGis(): GisGlobal | null {
  const google = (window as unknown as { google?: GisGlobal }).google;
  return google?.accounts?.oauth2 ? google : null;
}

/**
 * True once the GIS script from index.html has loaded. It is `async defer`,
 * so it may not be ready at first paint; the sign-in button uses this to
 * stay disabled rather than throwing on click.
 */
export function isGoogleScriptReady(): boolean {
  return readGis() !== null;
}

/** True if this build has a client ID at all (VITE_GOOGLE_CLIENT_ID). */
export function isSyncConfigured(): boolean {
  return googleClientId !== null;
}

/**
 * Restore a previous session, if the refresh cookie is still valid.
 *
 * Call once on startup. Resolves to true when a fresh access token was
 * obtained. A false result is the ordinary "not signed in" case — a user
 * who never connected Drive hits this on every load, so it must not
 * surface as an error.
 */
export async function restoreSession(): Promise<boolean> {
  if (!isSyncConfigured()) return false;

  try {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: CSRF_HEADER,
      credentials: "same-origin",
    });

    if (!response.ok) return false;

    const data = (await response.json()) as TokenResponse;
    if (!data.access_token || typeof data.expires_in !== "number") return false;

    setAccessToken(data.access_token, data.expires_in);
    return true;
  } catch {
    // Offline at startup. Not signed in *right now*, but the cookie is
    // untouched, so a later retry can still succeed.
    return false;
  }
}

/**
 * Initialize Google sign-in. Must be called after the GIS script has
 * loaded. Kept for symmetry with the GIS lifecycle and to fail loudly on a
 * misconfigured build; the code client itself is created per sign-in
 * attempt, since it is single-use.
 *
 * @throws if GIS is not loaded or the build has no client ID
 */
export async function initializeAuth(config?: AuthConfig): Promise<void> {
  const clientId = config?.clientId ?? googleClientId;
  if (!clientId) {
    throw new Error(
      "VITE_GOOGLE_CLIENT_ID is not set — Drive sync is unavailable in this build.",
    );
  }
  if (!readGis()) {
    throw new Error("Google Identity Services not loaded. Check index.html script tag.");
  }
}

/**
 * Run the Google sign-in popup and exchange the resulting code for tokens.
 * Resolves once this device holds an access token and a refresh cookie.
 */
export function signIn(config?: AuthConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const clientId = config?.clientId ?? googleClientId;
    if (!clientId) {
      reject(
        new Error(
          "VITE_GOOGLE_CLIENT_ID is not set — Drive sync is unavailable in this build.",
        ),
      );
      return;
    }

    const gis = readGis();
    if (!gis) {
      reject(new Error("Google Identity Services not loaded"));
      return;
    }

    try {
      const client = gis.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: config?.scopes?.join(" ") ?? driveScope,
        ux_mode: "popup",
        callback: (response) => {
          // The user closing the popup or declining consent arrives here as
          // an error, not a rejected promise — treat it as a cancellation.
          if (response.error) {
            reject(new Error(`Google sign-in was cancelled (${response.error}).`));
            return;
          }
          if (!response.code) {
            reject(new Error("Google sign-in returned no authorization code."));
            return;
          }
          exchangeCode(response.code).then(resolve, reject);
        },
      });
      client.requestCode();
    } catch (error) {
      reject(
        new Error(
          `Failed to start Google sign-in: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }
  });
}

/** Trade a one-time authorization code for an access token + refresh cookie. */
async function exchangeCode(code: string): Promise<void> {
  const response = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...CSRF_HEADER },
    credentials: "same-origin",
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      error_description?: string;
    };
    throw new Error(
      `Could not complete Google sign-in: ${
        failure.error_description ?? `server returned ${response.status}`
      }`,
    );
  }

  const data = (await response.json()) as TokenResponse;
  if (!data.access_token || typeof data.expires_in !== "number") {
    throw new Error("Could not complete Google sign-in: malformed server response.");
  }

  if (data.email) writeStoredEmail(data.email);
  setAccessToken(data.access_token, data.expires_in, data.email ?? undefined);
}

/** Current auth state. */
export function getAuthState(): AuthState {
  return { ...currentAuthState };
}

/**
 * Record a newly-obtained access token and schedule its replacement.
 *
 * @param token OAuth2 access token
 * @param expiresInSeconds Lifetime as reported by Google
 * @param email Optional account email, when the server supplied one
 */
export function setAccessToken(
  token: string,
  expiresInSeconds: number,
  email?: string,
): void {
  currentAuthState.accessToken = token;
  currentAuthState.isSignedIn = true;
  if (email) currentAuthState.userEmail = email;

  // Renew 60s early so an in-flight Drive call can't be cut off by expiry
  // mid-request, and never schedule shorter than 30s — a surprisingly
  // short expires_in would otherwise spin the refresh endpoint.
  if (tokenRefreshTimeout) clearTimeout(tokenRefreshTimeout);
  const refreshDelayMs = Math.max(30_000, (expiresInSeconds - 60) * 1000);
  tokenRefreshTimeout = setTimeout(() => {
    void refreshAccessToken();
  }, refreshDelayMs);

  notifyListeners();
}

/**
 * Mint a new access token from the refresh cookie. Called automatically
 * before expiry, and by the Drive layer if a token is rejected early.
 *
 * @returns true if a new token was obtained
 */
export async function refreshAccessToken(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: CSRF_HEADER,
      credentials: "same-origin",
    });

    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { error?: string };

      // 401 means the cookie is gone or permanently rejected: the user must
      // sign in again, so drop local state to match reality.
      if (response.status === 401) {
        clearLocalAuthState();
        return false;
      }

      // Anything else (Google 5xx, rate limit) is transient. Keep the
      // signed-in state and let the sync coordinator's backoff retry —
      // signing the user out over a blip would be a worse lie.
      console.warn("Access token refresh deferred:", failure.error ?? response.status);
      return false;
    }

    const data = (await response.json()) as TokenResponse;
    if (!data.access_token || typeof data.expires_in !== "number") return false;

    setAccessToken(data.access_token, data.expires_in);
    return true;
  } catch (error) {
    // Network failure: same reasoning as a 5xx, don't sign out.
    console.warn(
      "Access token refresh failed:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/**
 * Sign out on this device: clear the in-memory token AND ask the server to
 * expire the refresh cookie. The server round-trip is not optional —
 * httpOnly means script cannot delete that cookie, so skipping it would
 * leave a months-long Drive credential in the browser for the next load to
 * silently reuse.
 */
export async function signOut(): Promise<void> {
  clearLocalAuthState();
  try {
    await fetch("/api/auth/signout", {
      method: "POST",
      headers: CSRF_HEADER,
      credentials: "same-origin",
    });
  } catch (error) {
    // Local state is already cleared, so the UI is honest about being
    // signed out; the cookie will be retried on the next sign-out or expire
    // on its own.
    console.warn(
      "Sign-out could not reach the server; the sync cookie may persist until it expires:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function clearLocalAuthState(): void {
  currentAuthState.isSignedIn = false;
  currentAuthState.accessToken = null;
  currentAuthState.userEmail = null;
  writeStoredEmail(null);

  if (tokenRefreshTimeout) {
    clearTimeout(tokenRefreshTimeout);
    tokenRefreshTimeout = null;
  }

  notifyListeners();
}

/**
 * Subscribe to auth state changes.
 *
 * @returns Unsubscribe function
 */
export function subscribeToAuth(listener: (state: AuthState) => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function notifyListeners(): void {
  const state = { ...currentAuthState };
  for (const listener of authListeners) {
    listener(state);
  }
}

/** Test-only: reset auth state so each test starts fresh. */
export function resetAuthForTesting(): void {
  currentAuthState = {
    isSignedIn: false,
    accessToken: null,
    userEmail: null,
  };
  authListeners.clear();
  if (tokenRefreshTimeout) {
    clearTimeout(tokenRefreshTimeout);
    tokenRefreshTimeout = null;
  }
  try {
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    // no-op
  }
}
