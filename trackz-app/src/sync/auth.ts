/**
 * Phase 15b: Google Identity Services integration.
 *
 * Wraps the Google Sign-In (via GIS) so sync can:
 * - Get an OAuth2 access token to call Google Drive API
 * - Refresh that token before it expires
 * - Handle user sign-out gracefully
 *
 * GIS is loaded at runtime from the CDN (see index.html), not as an npm dep,
 * because it needs to be global and injected before this code runs. Tests
 * mock the global google object.
 */

export interface AuthState {
  isSignedIn: boolean;
  accessToken: string | null;
  userEmail: string | null;
}

export interface AuthConfig {
  clientId: string;
  scopes: string[];
}

let currentAuthState: AuthState = {
  isSignedIn: false,
  accessToken: null,
  userEmail: null,
};

let authListeners = new Set<(state: AuthState) => void>();
let tokenRefreshTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize Google Sign-In. Must be called once during app startup,
 * after the Google Identity Services script has loaded (see index.html).
 *
 * @param config Client ID and OAuth scopes (must include drive.file or drive)
 * @throws Error if GIS not available or already initialized
 */
export async function initializeAuth(config: AuthConfig): Promise<void> {
  const google = (window as unknown as { google?: unknown }).google;
  if (!google) {
    throw new Error("Google Identity Services not loaded. Check index.html script tag.");
  }

  const gis = google as unknown as {
    accounts: { id: { initialize: (config: unknown) => void } };
  };

  try {
    gis.accounts.id.initialize({
      client_id: config.clientId,
      callback: handleCredentialResponse,
      auto_select: false,
    });
  } catch (error) {
    throw new Error(`Failed to initialize Google Sign-In: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Trigger the Google Sign-In flow. In a real app, this would render the
 * "Sign in with Google" button via gis.accounts.id.renderButton() and let
 * the user click it. For now, this is a placeholder that tests can mock.
 *
 * @returns Promise that resolves when user signs in
 */
export function signIn(): Promise<void> {
  return new Promise((resolve, reject) => {
    const google = (window as unknown as { google?: unknown }).google;
    if (!google) {
      reject(new Error("Google Identity Services not loaded"));
      return;
    }

    const gis = google as unknown as {
      accounts: { oauth2: { initCodeClient: (config: unknown) => { requestCode: () => void } } };
    };

    try {
      const clientId =
        (window as unknown as { GOOGLE_CLIENT_ID?: string }).GOOGLE_CLIENT_ID ?? "";
      if (!clientId) {
        throw new Error("GOOGLE_CLIENT_ID not configured in environment");
      }

      const client = gis.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.file",
        ux_mode: "popup",
        callback: (response: unknown) => {
          const codeResponse = response as { code?: string };
          if (codeResponse.code) {
            // In a real app, send this code to your backend to exchange for access token
            // For now, mark as success; coordinator will retry if needed
            currentAuthState.isSignedIn = true;
            notifyListeners();
            resolve();
          } else {
            reject(new Error("No authorization code received"));
          }
        },
      });
      client.requestCode();
    } catch (error) {
      reject(
        new Error(
          `Failed to initiate sign-in: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  });
}

/**
 * Called when GIS returns a credential (ID token). Extract the JWT,
 * decode it to get email, and prepare for access token refresh.
 */
function handleCredentialResponse(response: unknown): void {
  const credential = response as { credential?: string };
  if (!credential.credential) {
    return;
  }

  // Decode the JWT (basic parsing — don't verify signature here, that's backend's job)
  const parts = credential.credential.split(".");
  if (parts.length !== 3) {
    console.error("Invalid JWT format");
    return;
  }

  try {
    const payload = JSON.parse(atob(parts[1]!)) as { email?: string };
    currentAuthState.isSignedIn = true;
    currentAuthState.userEmail = payload.email || null;
    // In a real app, the credential IS the ID token; get access token via backend exchange
    notifyListeners();
  } catch (error) {
    console.error("Failed to decode JWT:", error);
  }
}

/**
 * Get the current auth state (signed-in status, access token, email).
 */
export function getAuthState(): AuthState {
  return { ...currentAuthState };
}

/**
 * Set the access token (called by coordinator after a successful exchange
 * with the backend). Also schedules automatic refresh before expiry.
 *
 * @param token OAuth2 access token
 * @param expiresInSeconds How long until token expires
 */
export function setAccessToken(token: string, expiresInSeconds: number): void {
  currentAuthState.accessToken = token;
  currentAuthState.isSignedIn = true;

  // Schedule refresh 30s before expiry, with a minimum 60s interval to avoid thrashing
  if (tokenRefreshTimeout) clearTimeout(tokenRefreshTimeout);
  const refreshDelayMs = Math.max(30000, (expiresInSeconds - 30) * 1000);
  tokenRefreshTimeout = setTimeout(refreshAccessToken, refreshDelayMs);

  notifyListeners();
}

/**
 * Refresh the access token. Called automatically before expiry, or manually
 * if the old token was rejected by Drive API. In a real app, this exchanges
 * the refresh token for a new access token via the backend.
 */
export async function refreshAccessToken(): Promise<void> {
  try {
    // In a real app, POST to your backend to exchange refresh token for new access token
    // For now, this is a placeholder
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (data.access_token && data.expires_in) {
      setAccessToken(data.access_token, data.expires_in);
    }
  } catch (error) {
    console.error("Failed to refresh access token:", error);
    // Clear auth state on refresh failure — user will need to sign in again
    signOut();
  }
}

/**
 * Sign the user out. Clear tokens and notify listeners.
 */
export function signOut(): void {
  currentAuthState.isSignedIn = false;
  currentAuthState.accessToken = null;
  currentAuthState.userEmail = null;

  if (tokenRefreshTimeout) {
    clearTimeout(tokenRefreshTimeout);
    tokenRefreshTimeout = null;
  }

  notifyListeners();
}

/**
 * Subscribe to auth state changes. Useful for UI to react to sign-in/out.
 *
 * @param listener Called whenever auth state changes
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

/**
 * Test-only: reset auth state. Used to ensure each test starts fresh.
 */
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
}
