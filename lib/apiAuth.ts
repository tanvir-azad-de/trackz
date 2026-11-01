/**
 * Shared helpers for the /api/auth/* endpoints.
 *
 * Lives in lib/ rather than under api/ because Vercel creates one function
 * per source file in api/, and its Node.js runtime docs say to "keep shared
 * utilities and route modules outside api/ and import them from your
 * function entry point". A module placed in api/ would be deployed as a
 * third, pointless endpoint.
 *
 * Why cookies rather than returning the refresh token as JSON: the refresh
 * token is a ~6-month credential for the user's Drive. Handing it to
 * JavaScript means any XSS (or a malicious dependency) exfiltrates
 * long-lived Drive access. As an httpOnly cookie it is never readable by
 * script, and it persists across reloads for free, which is what makes
 * "stay signed in" possible at all.
 *
 * Why there are no CORS headers: the browser always talks to this API
 * same-origin. In production the static app and these functions share a
 * Vercel domain; in local dev Vite proxies /api to `vercel dev` (see
 * trackz-app/vite.config.ts), so the browser still sees one origin. That
 * matters for two reasons:
 *   1. A SameSite=Lax cookie is NOT sent on cross-site requests, so a
 *      genuinely cross-origin setup would break the refresh flow anyway.
 *   2. Omitting Access-Control-Allow-Origin is the CSRF defense. These are
 *      cookie-authenticated POSTs, so another site could cause the browser
 *      to issue one — but with no CORS grant it can never read the
 *      response, so it cannot steal the access token.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Name of the refresh-token cookie. Scoped to /api/auth so it is not
 * attached to ordinary app or asset requests — only the endpoints that
 * actually need it.
 */
export const REFRESH_COOKIE = "trackz_rt";
const COOKIE_PATH = "/api/auth";

/** Google refresh tokens last ~6 months; expire ours slightly sooner. */
const COOKIE_MAX_AGE_SECONDS = 150 * 24 * 60 * 60;

/**
 * True when the request is served over plain HTTP on localhost, where a
 * `Secure` cookie would be dropped by the browser. Everywhere else
 * (including Vercel preview URLs) must be Secure.
 */
function isInsecureLocalhost(req: VercelRequest): boolean {
  const host = req.headers.host ?? "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

/**
 * Read the refresh token from the request cookies. Uses Vercel's
 * `request.cookies` helper rather than parsing the Cookie header by hand.
 */
export function readRefreshCookie(req: VercelRequest): string | null {
  const value = req.cookies?.[REFRESH_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Store the refresh token as an httpOnly cookie. Never echoed back in a body. */
export function setRefreshCookie(
  req: VercelRequest,
  res: VercelResponse,
  token: string,
): void {
  const attrs = [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!isInsecureLocalhost(req)) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

/**
 * Expire the refresh cookie. The attributes other than Max-Age must match
 * setRefreshCookie's, or the browser treats it as a different cookie and
 * leaves the original in place.
 */
export function clearRefreshCookie(req: VercelRequest, res: VercelResponse): void {
  const attrs = [
    `${REFRESH_COOKIE}=`,
    `Path=${COOKIE_PATH}`,
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!isInsecureLocalhost(req)) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

/**
 * Reject anything that isn't a same-origin POST carrying the popup-mode
 * CSRF header. Returns true if the handler should stop (a response has
 * already been sent).
 *
 * Google's "Use Code Model" guide specifies the popup-mode CSRF defense as:
 * confirm the `X-Requested-With: XmlHttpRequest` header is present. A
 * cross-site form POST cannot set a custom header, and a cross-site fetch
 * that tries triggers a CORS preflight we never grant, so requiring it
 * blocks forged requests. This is layered with SameSite=Lax and the Origin
 * check below.
 *
 * The Origin check: browsers send Origin on cross-site POSTs, so a mismatch
 * is a request no first-party flow would ever make. Requests with no Origin
 * at all (cURL, server-to-server) are allowed through so the endpoints stay
 * testable.
 */
export function rejectUnlessSameOriginPost(
  req: VercelRequest,
  res: VercelResponse,
): boolean {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({
      error: "method_not_allowed",
      error_description: "This endpoint accepts POST only.",
    });
    return true;
  }

  if (req.headers["x-requested-with"] !== "XmlHttpRequest") {
    res.status(403).json({
      error: "forbidden",
      error_description: "Missing required X-Requested-With header.",
    });
    return true;
  }

  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const host = req.headers.host;
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      res.status(403).json({
        error: "forbidden",
        error_description: "Malformed Origin header.",
      });
      return true;
    }
    if (!host || originHost !== host) {
      res.status(403).json({
        error: "forbidden",
        error_description: "Cross-origin requests are not permitted.",
      });
      return true;
    }
  }

  return false;
}

/**
 * The `redirect_uri` to present when exchanging an auth code.
 *
 * For GIS popup mode this is NOT a configurable endpoint path: Google's
 * guide states that `redirect_uri` "defaults to the origin of the page that
 * calls initCodeClient", and the same value must be replayed at exchange
 * time. So it has to be the app's own origin, derived per-request, and a
 * hardcoded GOOGLE_REDIRECT_URI env var would simply not match in any
 * deployment whose origin differs from it (every preview URL, for one).
 *
 * Prefers the Origin header; falls back to reconstructing from Host.
 */
export function callerOrigin(req: VercelRequest): string | null {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }

  const host = req.headers.host;
  if (!host) return null;
  const scheme = isInsecureLocalhost(req) ? "http" : "https";
  return `${scheme}://${host}`;
}

/** The OAuth client credentials, or null if the deployment is misconfigured. */
export function readGoogleCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
