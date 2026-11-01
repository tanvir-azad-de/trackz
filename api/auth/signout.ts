/**
 * Phase 15b Backend: sign-out endpoint.
 *
 * POST /api/auth/signout
 *
 * Clears the httpOnly refresh cookie. This endpoint has to exist: because
 * the cookie is httpOnly by design, frontend JavaScript cannot delete it.
 * Without this, "sign out" would only drop the in-memory access token while
 * the browser quietly kept a months-long Drive credential that the next
 * page load would silently reuse.
 *
 * Request body: none
 * Request header: X-Requested-With: XmlHttpRequest (CSRF, required)
 *
 * Response: 204 No Content, including when no cookie was present —
 * "you are signed out" is the desired end state either way.
 *
 * Note this does not revoke the grant at Google, only forgets it on this
 * device. Full revocation is google.accounts.oauth2.revoke() on the client
 * (or myaccount.google.com/permissions) and is a deliberately separate,
 * louder action than signing out one browser.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearRefreshCookie, rejectUnlessSameOriginPost } from "../../lib/apiAuth";

export default async (req: VercelRequest, res: VercelResponse) => {
  if (rejectUnlessSameOriginPost(req, res)) return;

  clearRefreshCookie(req, res);
  return res.status(204).end();
};
