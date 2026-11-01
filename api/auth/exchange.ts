/**
 * Phase 15b Backend: Google OAuth2 code exchange endpoint
 *
 * POST /api/auth/exchange
 *
 * Receives an authorization code from Google Identity Services (obtained by the
 * frontend via the OAuth2 authorization flow) and exchanges it for an access token.
 * Returns the access token and expiration time so the frontend can make Drive API calls.
 *
 * Security considerations:
 * - NEVER expose client_secret in frontend code
 * - NEVER log credentials or tokens
 * - Always validate the authorization code
 * - Always verify the origin/referer
 * - Use HTTPS only in production
 * - Token should expire within 1 hour
 *
 * Request body:
 * {
 *   "code": "4/0AX4XfWh..."  // Authorization code from GIS
 * }
 *
 * Response:
 * {
 *   "access_token": "ya29.a0AfH6SMB...",
 *   "expires_in": 3599,
 *   "token_type": "Bearer"
 * }
 *
 * Error responses (4xx/5xx with JSON body):
 * {
 *   "error": "invalid_code",
 *   "error_description": "..."
 * }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

// Type for Google's token response
interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

interface ErrorResponse {
  error: string;
  error_description: string;
}

/**
 * Validate the request has required fields and reasonable values
 */
function validateRequest(body: unknown): { code: string } | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const { code } = body as { code?: unknown };
  if (typeof code !== "string" || code.length < 10 || code.length > 500) {
    return null;
  }

  return { code };
}

/**
 * Exchange authorization code for access token via Google API
 */
async function exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000";

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials not configured");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!response.ok) {
    const errorData = (await response.json()) as ErrorResponse;
    throw new Error(
      `Google OAuth error: ${errorData.error} - ${errorData.error_description || "unknown"}`,
    );
  }

  const data = (await response.json()) as GoogleTokenResponse;
  return data;
}

/**
 * Main handler for the auth exchange endpoint
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
        error_description: "Missing or invalid authorization code",
      });
    }

    // Exchange code for token
    const tokenResponse = await exchangeCodeForToken(validated.code);

    // Return token to client
    // Note: We return access_token, expires_in, and token_type (required)
    // If the backend receives a refresh_token from Google, it should be:
    // - Stored securely on the backend (httpOnly cookie + encrypted DB)
    // - NOT sent to the frontend in production
    // For now, we return it so the frontend can handle token refresh,
    // but this should be secured in production
    const response: Record<string, unknown> = {
      access_token: tokenResponse.access_token,
      expires_in: tokenResponse.expires_in,
      token_type: tokenResponse.token_type,
    };

    // Include refresh_token only if provided by Google
    // In production, handle this securely via httpOnly cookies
    if (tokenResponse.refresh_token) {
      response.refresh_token = tokenResponse.refresh_token;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error(
      "Auth exchange error:",
      error instanceof Error ? error.message : String(error),
    );

    // Don't expose internal error details to client
    return res.status(500).json({
      error: "server_error",
      error_description: "Failed to exchange authorization code",
    });
  }
};
