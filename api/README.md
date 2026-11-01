# Phase 15b Backend: Google OAuth Integration

This directory contains Vercel Serverless Functions for the trackz sync backend, specifically the Google OAuth2 integration needed for Phase 15b (Drive sync).

## Structure

```
api/
├── auth/
│   ├── exchange.ts    # POST /api/auth/exchange - Exchange auth code for access token
│   └── refresh.ts     # POST /api/auth/refresh - Refresh expired access token
└── README.md          # This file
```

## Setup

### 1. Create Google Cloud Project & OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable "Google Drive API"
4. Go to "Credentials" → Create OAuth 2.0 Web Application
5. Set authorized redirect URIs:
   - Local development: `http://localhost:5173`
   - Production: `https://yourdomain.com`
6. Copy your Client ID and Client Secret

### 2. Configure Environment Variables

**For local development (.env.local):**

```bash
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:5173
CORS_ORIGIN=http://localhost:5173
```

**For production (Vercel Dashboard):**

1. Go to your Vercel project settings
2. Environment Variables
3. Add the same variables for your production domain
4. Set them for "Production" environment

### 3. Verify File Structure

```bash
# These files should exist:
ls api/auth/exchange.ts
ls api/auth/refresh.ts

# This template should exist:
cat .env.example
```

## API Endpoints

### POST /api/auth/exchange

Exchanges a Google authorization code for an access token.

**Request:**
```json
{
  "code": "4/0AX4XfWh..."
}
```

**Response (200 OK):**
```json
{
  "access_token": "ya29.a0AfH6SMB...",
  "expires_in": 3599,
  "token_type": "Bearer",
  "refresh_token": "1//0gw..."  // Only if first-time auth
}
```

**Error Response (400/401/500):**
```json
{
  "error": "invalid_request",
  "error_description": "Missing or invalid authorization code"
}
```

### POST /api/auth/refresh

Refreshes an expired access token using the refresh token.

**Request:**
```json
{
  "refresh_token": "1//0gw..."
}
```

**Response (200 OK):**
```json
{
  "access_token": "ya29.a0AfH6SMC...",
  "expires_in": 3599,
  "token_type": "Bearer"
}
```

**Error Response (401):**
```json
{
  "error": "invalid_grant",
  "error_description": "Refresh token expired or invalid. Please sign in again."
}
```

## How It Works

### OAuth2 Authorization Code Flow

1. **Frontend (sync/auth.ts)**
   - User clicks "Sign in with Google"
   - Google Identity Services shows authorization dialog
   - User approves → GIS calls callback with `code`

2. **Frontend → Backend Exchange**
   - Frontend POSTs auth `code` to `/api/auth/exchange`
   - Backend exchanges code + client_secret (kept secret!) for access token

3. **Token Refresh (Automatic)**
   - sync/auth.ts schedules refresh 30s before token expiry
   - On expiry, frontend POSTs refresh_token to `/api/auth/refresh`
   - Backend exchanges refresh_token for new access_token
   - Cycle repeats

### Security Design

- ✅ Client secret **never** exposed to frontend
- ✅ Authorization code is short-lived (1 use only)
- ✅ Access tokens are short-lived (~1 hour)
- ✅ Refresh tokens are long-lived (~6 months)
- ✅ CORS headers restrict which origins can call the endpoints
- ⚠️ Refresh tokens currently returned in JSON (should use httpOnly cookies in production)

## Local Development

### Running Locally with Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Run locally (from repo root)
cd /path/to/trackz
vercel dev

# This starts:
# - Frontend: http://localhost:3000 (or next available port)
# - API functions: http://localhost:3000/api/*
# - Database: not needed for sync (uses Google Drive)
```

### Testing with cURL

```bash
# 1. First get an auth code (manual - use Google's OAuth flow)
# 2. Exchange for access token
curl -X POST http://localhost:3000/api/auth/exchange \
  -H "Content-Type: application/json" \
  -d '{"code": "4/0AX4XfWh..."}'

# Expected response:
# {"access_token": "ya29.a0...", "expires_in": 3599, ...}

# 3. Refresh token
curl -X POST http://localhost:3000/api/auth/exchange \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "1//0gw..."}'
```

## Deployment to Vercel

```bash
# 1. Push to GitHub (Vercel watches this)
git add api/
git commit -m "feat: Add backend OAuth endpoints"
git push origin main

# 2. Vercel automatically deploys
# 3. Set environment variables in Vercel Dashboard
# 4. Test: curl https://yourdomain.com/api/auth/exchange
```

## Troubleshooting

### "GOOGLE_CLIENT_ID not configured"
- Check `.env.local` exists in repo root
- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- Restart dev server: `vercel dev`

### "Authorization failed: invalid_code"
- Auth code has expired (only valid for ~10 minutes)
- Get a fresh code by signing in again
- Make sure `GOOGLE_REDIRECT_URI` matches your app's URL

### "Refresh token expired"
- Refresh token lasts ~6 months
- User hasn't opened the app in >6 months
- User revoked permissions in Google account settings
- Solution: User must sign in again

### CORS errors in browser
- Check `CORS_ORIGIN` environment variable
- Must match the origin where frontend is running
- Local dev: `http://localhost:5173`
- Production: `https://yourdomain.com`

## Production Checklist

- [ ] Create Google Cloud project (see step 1 above)
- [ ] Create OAuth 2.0 credentials
- [ ] Add production domain as authorized redirect URI
- [ ] Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel
- [ ] Set `CORS_ORIGIN` to production domain
- [ ] Set `GOOGLE_REDIRECT_URI` to production domain
- [ ] Test auth flow end-to-end
- [ ] Monitor error logs in Vercel dashboard
- [ ] (Optional) Implement refresh token storage via httpOnly cookies

## Next Steps

After setting up the backend:

1. **Test locally** with `vercel dev`
2. **Deploy** to Vercel (auto-deploys on git push)
3. **Update frontend config** with production credentials
4. **Real device testing** across two devices

See Phase 15 docs for the full sync architecture.
