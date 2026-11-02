/**
 * Phase 15b Backend: Google OAuth2 code exchange endpoint.
 *
 * POST /api/auth/exchange
 *
 * Receives an authorization code from Google Identity Services (obtained in
 * the browser via GIS popup-mode `initCodeClient`) and exchanges it for
 * tokens using the client secret, which must never reach the frontend.
 *
 * The access token is returned in the JSON body: it is short-lived (~1h)
 * and the frontend genuinely needs it to call the Drive API directly.
 *
 * The refresh token is NOT returned. It is set as an httpOnly cookie
 * (see lib/apiAuth.ts for the reasoning) so that script cannot read a
 * long-lived Drive credential, and so the session survives a page reload.
 * That lifetime is ~6 months only while the OAuth app is PUBLISHED; in
 * Testing status Google issues a 7-day token instead (see
 * COOKIE_MAX_AGE_SECONDS in lib/apiAuth.ts).
 *
 * Request body: { "code": "4/0AX4XfWh..." }
 * Request header: X-Requested-With: XmlHttpRequest (CSRF, required)
 *
 * Response 200: { "access_token", "expires_in", "token_type", "email"? }
 * Errors: 4xx/5xx with { "error", "error_description" }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  callerOrigin,
  readGoogleCredentials,
  rejectUnlessSameOriginPost,
  setRefreshCookie,
} from "../../lib/apiAuth";

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

/** Validate the request body and extract the authorization code. */
function readCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const { code } = body as { code?: unknown };
  if (typeof code !== "string" || code.length < 10 || code.length > 2048) {
    return null;
  }
  return code;
}

/**
 * Pull the email claim out of an ID token so the UI can show which account
 * is connected.
 *
 * Deliberately NOT verifying the signature: this token came straight from
 * Google's token endpoint over TLS in the response to our own
 * client-secret-authenticated request, so there is no untrusted hop to
 * guard against. The email is used for display only and never for
 * authorization, so a bad parse just means we show no address.
 */
function readEmailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

export default async (req: VercelRequest, res: VercelResponse) => {
  if (rejectUnlessSameOriginPost(req, res)) return;

  const code = readCode(req.body);
  if (!code) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Missing or invalid authorization code.",
    });
  }

  const credentials = readGoogleCredentials();
  if (!credentials) {
    // A deployment problem, not the caller's fault — and worth saying so
    // plainly rather than hiding it behind a generic 500, since this is
    // the single most likely first-run failure.
    console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
    return res.status(500).json({
      error: "server_misconfigured",
      error_description: "Google OAuth credentials are not configured on the server.",
    });
  }

  const redirectUri = callerOrigin(req);
  if (!redirectUri) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Could not determine the request origin.",
    });
  }

  try {
    const googleResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!googleResponse.ok) {
      const failure = (await googleResponse.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      // Log Google's reason (it is diagnostic, not secret) but return a
      // flat 400 — an auth code is single-use and short-lived, so there is
      // nothing a caller can usefully retry.
      console.error(
        "Google token exchange rejected:",
        failure.error ?? googleResponse.status,
        failure.error_description ?? "",
      );
      return res.status(400).json({
        error: "exchange_failed",
        error_description: "Google rejected the authorization code.",
      });
    }

    const tokens = (await googleResponse.json()) as GoogleTokenResponse;
    if (!tokens.access_token || typeof tokens.expires_in !== "number") {
      throw new Error("Token response missing access_token/expires_in");
    }

    // Google only issues a refresh token on the first consent for a given
    // client+user (unless prompt=consent forces a new one). Absent is
    // therefore normal on re-authorization, not an error: the existing
    // cookie, if any, stays valid.
    if (tokens.refresh_token) {
      setRefreshCookie(req, res, tokens.refresh_token);
    }

    return res.status(200).json({
      access_token: tokens.access_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
      email: readEmailFromIdToken(tokens.id_token),
    });
  } catch (error) {
    console.error(
      "Auth exchange error:",
      error instanceof Error ? error.message : String(error),
    );
    return res.status(500).json({
      error: "server_error",
      error_description: "Failed to exchange authorization code.",
    });
  }
};
