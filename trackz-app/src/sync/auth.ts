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

// Store refresh token in memory (in production, should use httpOnly cookie via backend)
let refreshToken: string | null = null;

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
 * Trigger the Google Sign-In flow. This initiates OAuth2 authorization code flow:
 * 1. User clicks "Sign in" button
 * 2. Google redirects to auth screen
 * 3. User approves access
 * 4. GIS calls our callback with authorization code
 * 5. We exchange the code with our backend for access token
 *
 * @returns Promise that resolves when user signs in and token is obtained
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
        callback: async (response: unknown) => {
          const codeResponse = response as { code?: string };
          if (!codeResponse.code) {
            reject(new Error("No authorization code received"));
            return;
          }

          try {
            // Exchange authorization code for access token via backend
            const exchangeResponse = await fetch("/api/auth/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: codeResponse.code }),
            });

            if (!exchangeResponse.ok) {
              const error = (await exchangeResponse.json()) as { error_description?: string };
              throw new Error(
                `Authorization failed: ${error.error_description || "unknown error"}`,
              );
            }

            const tokenData = (await exchangeResponse.json()) as {
              access_token?: string;
              expires_in?: number;
              refresh_token?: string;
            };

            if (!tokenData.access_token || !tokenData.expires_in) {
              throw new Error("Invalid response from auth endpoint");
            }

            // Store the access token and set up auto-refresh
            setAccessToken(tokenData.access_token, tokenData.expires_in, tokenData.refresh_token);

            resolve();
          } catch (error) {
            reject(error);
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
 * Set the access token (called after successful OAuth exchange with the backend).
 * Also schedules automatic refresh before expiry.
 *
 * @param token OAuth2 access token
 * @param expiresInSeconds How long until token expires
 * @param newRefreshToken Optional refresh token to store (for refresh flow)
 */
export function setAccessToken(
  token: string,
  expiresInSeconds: number,
  newRefreshToken?: string,
): void {
  currentAuthState.accessToken = token;
  currentAuthState.isSignedIn = true;

  // Store refresh token if provided
  if (newRefreshToken) {
    refreshToken = newRefreshToken;
  }

  // Schedule refresh 30s before expiry, with a minimum 60s interval to avoid thrashing
  if (tokenRefreshTimeout) clearTimeout(tokenRefreshTimeout);
  const refreshDelayMs = Math.max(30000, (expiresInSeconds - 30) * 1000);
  tokenRefreshTimeout = setTimeout(refreshAccessToken, refreshDelayMs);

  notifyListeners();
}

/**
 * Refresh the access token. Called automatically before expiry, or manually
 * if the old token was rejected by Drive API. Exchanges the refresh token
 * for a new access token via the backend.
 */
export async function refreshAccessToken(): Promise<void> {
  try {
    if (!refreshToken) {
      throw new Error("No refresh token available - user must sign in again");
    }

    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      // Check for specific error (e.g., refresh token expired)
      const error = (await response.json()) as { error?: string };
      if (error.error === "invalid_grant") {
        // Refresh token expired - need to sign in again
        signOut();
        throw new Error("Refresh token expired - please sign in again");
      }
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (data.access_token && data.expires_in) {
      setAccessToken(data.access_token, data.expires_in);
    } else {
      throw new Error("Invalid response from refresh endpoint");
    }
  } catch (error) {
    console.error("Failed to refresh access token:", error);
    // Clear auth state on refresh failure — user will need to sign in again
    signOut();
  }
}

/**
 * Sign the user out. Clear all tokens and notify listeners.
 */
export function signOut(): void {
  currentAuthState.isSignedIn = false;
  currentAuthState.accessToken = null;
  currentAuthState.userEmail = null;
  refreshToken = null;

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
  refreshToken = null;
  authListeners.clear();
  if (tokenRefreshTimeout) {
    clearTimeout(tokenRefreshTimeout);
    tokenRefreshTimeout = null;
  }
}
