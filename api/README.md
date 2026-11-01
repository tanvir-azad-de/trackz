# Phase 15b Backend: Google OAuth for Drive sync

Vercel Serverless Functions that hold the Google OAuth client secret, so the
browser never does.

```
api/auth/
├── exchange.ts   # POST — auth code  -> access token + sets refresh cookie
├── refresh.ts    # POST — refresh cookie -> fresh access token
└── signout.ts    # POST — expires the refresh cookie
lib/apiAuth.ts    # shared cookie / CSRF / origin helpers (NOT an endpoint)
```

`lib/` sits outside `api/` deliberately: Vercel creates one function per file
in `api/`, so a helper placed there would deploy as a pointless third
endpoint. Vercel's Node.js runtime docs say to keep shared utilities outside
`api/` and import them from the entry point.

## Token model

| Token | Lifetime | Where it lives | Why |
| --- | --- | --- | --- |
| Authorization code | ~10 min, single use | Never stored | Exchanged immediately |
| Access token | ~1 hour | Frontend memory only | Needed for direct Drive API calls |
| Refresh token | ~6 months | httpOnly cookie, server-set | A long-lived Drive credential must be unreadable by script |

The refresh token is **never** returned in a response body. Anything
JavaScript can read, XSS can steal, and this one would hand an attacker
months of access to the user's Drive. As an httpOnly cookie it is invisible
to script and, as a bonus, survives a page reload — which is what makes
"stay signed in" work without re-prompting on every launch.

Cookie attributes (`lib/apiAuth.ts`): `HttpOnly`, `SameSite=Lax`,
`Path=/api/auth`, `Secure` everywhere except plain-HTTP localhost, where the
browser would otherwise drop it.

## CSRF and CORS

These endpoints are cookie-authenticated, so they need CSRF protection.
Three layers, all required:

1. **No CORS headers at all.** The browser always reaches this API
   same-origin, so no `Access-Control-Allow-Origin` is needed — and
   withholding it means a hostile page can cause a request but can never
   read the response, so it cannot steal the access token.
2. **`X-Requested-With: XmlHttpRequest` required.** This is Google's
   documented CSRF defense for popup-mode code flow. A cross-site HTML form
   cannot set a custom header, and a cross-site `fetch` that tries triggers
   a preflight that is never granted.
3. **`Origin` must match `Host`** when `Origin` is present. Requests with no
   `Origin` (cURL) are allowed so the endpoints stay testable.

## Endpoints

### POST /api/auth/exchange

Headers: `Content-Type: application/json`, `X-Requested-With: XmlHttpRequest`

```json
{ "code": "4/0AX4XfWh..." }
```

**200** — also issues `Set-Cookie: trackz_rt=...`:

```json
{
  "access_token": "ya29.a0AfH6SMB...",
  "expires_in": 3599,
  "token_type": "Bearer",
  "email": "person@example.com"
}
```

`email` is read from the ID token for display only ("Connected as ..."). Its
signature is not verified, because the token came straight from Google's
token endpoint over TLS in response to our own client-secret-authenticated
request — there is no untrusted hop. It is never used for authorization.

Errors: `400 invalid_request` (bad/missing code), `400 exchange_failed`
(Google rejected it — expired, reused, or origin mismatch),
`403 forbidden` (CSRF/origin), `500 server_misconfigured` (no credentials set).

### POST /api/auth/refresh

Headers: `X-Requested-With: XmlHttpRequest`. No body — the refresh token
comes from the cookie.

This endpoint doubles as **session restore**: the frontend calls it on every
page load, and a 200 means "the cookie survived, you are still signed in".

**200** → `{ "access_token", "expires_in", "token_type" }`

- **401 `no_session`** — no cookie. Expected on first visit; the frontend
  treats it as plain "signed out", not an error.
- **401 `invalid_grant`** — cookie present but permanently dead (revoked or
  expired). The cookie is cleared so we stop retrying it.
- **503 `refresh_unavailable`** — transient (Google 5xx, rate limit). The
  cookie is left alone and the client keeps its signed-in state; signing the
  user out over a blip would be a worse lie.

### POST /api/auth/signout

Headers: `X-Requested-With: XmlHttpRequest`. Returns **204**, including when
no cookie was present.

This endpoint has to exist: httpOnly means frontend JavaScript *cannot*
delete the cookie. Without it, "sign out" would drop the in-memory access
token while the browser quietly kept a months-long credential for the next
load to reuse.

It forgets the grant on this device only; it does not revoke it at Google.
Full revocation is `google.accounts.oauth2.revoke()` or
myaccount.google.com/permissions.

## Setup

1. [Google Cloud Console](https://console.cloud.google.com/) → new project
2. Enable the **Google Drive API**
3. Configure the OAuth consent screen. While the app is in "testing" status
   it only works for accounts listed as test users — add yourself.
4. Credentials → OAuth 2.0 Client ID → **Web application**
5. Add **Authorized JavaScript origins** (origins, *not* redirect URIs —
   GIS popup mode uses the calling page's origin, so there is no redirect
   path to register):
   - `http://localhost:5173`
   - `https://your-app.vercel.app`
6. Put the credentials in `.env.local` (server) and
   `trackz-app/.env.local` (client) — see `.env.example`.

There is deliberately no `GOOGLE_REDIRECT_URI` setting: popup-mode exchange
requires `redirect_uri` to equal the calling page's origin, so it is derived
per request (`callerOrigin` in `lib/apiAuth.ts`). A hardcoded value would
break on every origin that differs from it, including all preview URLs.

## Local development

Two processes:

```bash
vercel dev --listen 3000        # /api/auth/*
cd trackz-app && npm run dev    # app on :5173, proxies /api -> :3000
```

Browse to **http://localhost:5173**, never `:3000` directly. Vite's proxy
makes the app and API one origin, as in production; hitting the API's own
port would make them cross-site, and a `SameSite=Lax` cookie is not sent
cross-site, so session restore would silently fail.

## Typechecking

```bash
npm run typecheck:api
```

`tsconfig.api.json` covers `api/` and `lib/`. Worth running: it caught an
unreachable CORS preflight branch in the first version of these endpoints.

## Not yet verified

These endpoints have **not** been exercised against real Google yet — no
unit tests, and no `vercel dev` run. Before trusting this flow, confirm by
hand:

- [ ] Sign in from Settings → Connect Google Drive completes without error
- [ ] `trackz_rt` cookie is present in devtools, flagged HttpOnly
- [ ] Reload the page → still connected, with **no** second consent popup
      (this is the whole point of the cookie; if it fails, check Path and
      SameSite)
- [ ] `trackz-data-v2.json` appears in Drive
- [ ] Disconnect → cookie gone, status reads "Not syncing"
- [ ] Reload after disconnect → still signed out
- [ ] Edit on device A, confirm it lands on device B
- [ ] A 403 from the endpoints means the CSRF header or Origin check is
      failing — check the Vite proxy is not rewriting Host
- [ ] `invalid_grant` on first sign-in usually means the origin registered
      in Google Cloud doesn't match the browser's origin

## Production checklist

- [ ] `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` set in Vercel (Production)
- [ ] `VITE_GOOGLE_CLIENT_ID` set in Vercel (it must be present at *build*
      time — Vite inlines it into the bundle; setting it afterwards has no
      effect until the next deploy)
- [ ] Production origin added to Authorized JavaScript origins
- [ ] OAuth consent screen published, or all intended users added as test users
- [ ] End-to-end auth flow tested on the deployed URL
- [ ] Verified on real iPhone Safari, including the installed PWA
