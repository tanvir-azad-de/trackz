/**
 * Phase 15b Backend: Google OAuth2 token refresh endpoint
 *
 * POST /api/auth/refresh
 *
 * Refreshes an expiring or expired access token using the refresh token.
 * Called by the frontend (sync/auth.ts) before a token expires or when an old
 * token is rejected by the Drive API with 401 Unauthorized.
 *
 * Request body:
 * {
 *   "refresh_token": "1//0gw..."  // Refresh token from initial exchange
 * }
 *
 * Response:
 * {
 *   "access_token": "ya29.a0AfH6SMC...",
 *   "expires_in": 3599,
 *   "token_type": "Bearer"
 * }
 *
 * Error responses (4xx/5xx with JSON body):
 * {
 *   "error": "invalid_grant",
 *   "error_description": "..."
 * }
 *
 * Note: In this implementation, we assume the frontend stores the refresh token
 * securely (e.g., httpOnly cookie or encrypted localStorage). The frontend is
 * responsible for sending it to this endpoint.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

interface GoogleRefreshResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface ErrorResponse {
  error: string;
  error_description: string;
}

/**
 * Validate the request has required fields
 */
function validateRequest(body: unknown): { refresh_token: string } | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const { refresh_token } = body as { refresh_token?: unknown };
  if (typeof refresh_token !== "string" || refresh_token.length < 10) {
    return null;
  }

  return { refresh_token };
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(refreshToken: string): Promise<GoogleRefreshResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials not configured");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    const errorData = (await response.json()) as ErrorResponse;
    throw new Error(
      `Google OAuth error: ${errorData.error} - ${errorData.error_description || "unknown"}`,
    );
  }

  const data = (await response.json()) as GoogleRefreshResponse;
  return data;
}

/**
 * Main handler for the token refresh endpoint
 */
export default async (req: VercelRequest, res: VercelResponse) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // Validate request
    const validated = validateRequest(req.body);
    if (!validated) {
      return res.status(400).json({
        error: "invalid_request",
        error_description: "Missing or invalid refresh token",
      });
    }

    // Refresh the token
    const tokenResponse = await refreshAccessToken(validated.refresh_token);

    // Return new token to client
    return res.status(200).json({
      access_token: tokenResponse.access_token,
      expires_in: tokenResponse.expires_in,
      token_type: tokenResponse.token_type,
    });
  } catch (error) {
    console.error(
      "Token refresh error:",
      error instanceof Error ? error.message : String(error),
    );

    // Check if this is an invalid_grant error (refresh token expired)
    const errorMsg = error instanceof Error ? error.message : "";
    if (errorMsg.includes("invalid_grant")) {
      return res.status(401).json({
        error: "invalid_grant",
        error_description: "Refresh token expired or invalid. Please sign in again.",
      });
    }

    // Generic server error
    return res.status(500).json({
      error: "server_error",
      error_description: "Failed to refresh access token",
    });
  }
};
