/**
 * Phase 15b Backend: access-token refresh endpoint.
 *
 * POST /api/auth/refresh
 *
 * Mints a new short-lived access token from the refresh token held in the
 * httpOnly `trackz_rt` cookie. The refresh token itself is never accepted
 * from, nor returned to, the client — see lib/apiAuth.ts.
 *
 * This endpoint doubles as session restore: on page load the frontend calls
 * it with no state at all, and a 200 means "this browser still holds a
 * valid refresh cookie, here is a fresh access token". That is what makes
 * sign-in survive a reload.
 *
 * Request body: none
 * Request header: X-Requested-With: XmlHttpRequest (CSRF, required)
 *
 * Response 200: { "access_token", "expires_in", "token_type" }
 * Response 401 { "error": "no_session" }: no cookie — never signed in, or
 *   signed out. Expected on first load; the frontend treats it as
 *   "signed out", not as an error worth showing the user.
 * Response 401 { "error": "invalid_grant" }: cookie present but rejected
 *   (revoked or expired). The cookie is cleared so we stop retrying it.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  clearRefreshCookie,
  readGoogleCredentials,
  readRefreshCookie,
  rejectUnlessSameOriginPost,
} from "../../lib/apiAuth";

interface GoogleRefreshResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export default async (req: VercelRequest, res: VercelResponse) => {
  if (rejectUnlessSameOriginPost(req, res)) return;

  const refreshToken = readRefreshCookie(req);
  if (!refreshToken) {
    return res.status(401).json({
      error: "no_session",
      error_description: "No sync session on this device. Sign in to enable syncing.",
    });
  }

  const credentials = readGoogleCredentials();
  if (!credentials) {
    console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
    return res.status(500).json({
      error: "server_misconfigured",
      error_description: "Google OAuth credentials are not configured on the server.",
    });
  }

  try {
    const googleResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!googleResponse.ok) {
      const failure = (await googleResponse.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      console.error(
        "Google token refresh rejected:",
        failure.error ?? googleResponse.status,
      );

      // invalid_grant means the refresh token is permanently dead (user
      // revoked access, or it aged out). Clear the cookie so subsequent
      // loads report a clean "signed out" instead of retrying a credential
      // that can never work again.
      if (failure.error === "invalid_grant") {
        clearRefreshCookie(req, res);
        return res.status(401).json({
          error: "invalid_grant",
          error_description: "Sync access expired or was revoked. Please sign in again.",
        });
      }

      // Anything else (5xx from Google, rate limiting) may well succeed on
      // a retry, so leave the cookie alone and report it as transient.
      return res.status(503).json({
        error: "refresh_unavailable",
        error_description: "Could not refresh sync access. Will retry.",
      });
    }

    const tokens = (await googleResponse.json()) as GoogleRefreshResponse;
    if (!tokens.access_token || typeof tokens.expires_in !== "number") {
      throw new Error("Refresh response missing access_token/expires_in");
    }

    return res.status(200).json({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
    });
  } catch (error) {
    console.error(
      "Token refresh error:",
      error instanceof Error ? error.message : String(error),
    );
    return res.status(500).json({
      error: "server_error",
      error_description: "Failed to refresh access token.",
    });
  }
};
