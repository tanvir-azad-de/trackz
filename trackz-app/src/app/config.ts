/**
 * Build-time config, read from Vite env vars (import.meta.env.VITE_*).
 * Fixes old bug B7: a missing GOOGLE_CLIENT_ID used to silently skip
 * loadData() and render a blank app with no error. Instead, callers of
 * googleClientId must handle `null` explicitly and show a real message
 * (wired up in Phase 15 — Drive sync rewrite).
 *
 * This module is the ONLY place the client ID enters the app. An earlier
 * Phase 15b attempt also set `window.GOOGLE_CLIENT_ID` from an inline
 * classic <script> in index.html, which silently never worked: Vite only
 * rewrites `import.meta.env` inside module scripts, so that text reached
 * dist/index.html verbatim and `import.meta` in a classic script is a
 * SyntaxError. Keep the ID flowing through here, where Vite substitutes
 * it at build time.
 */

export const googleClientId: string | null = import.meta.env.VITE_GOOGLE_CLIENT_ID || null;

/** OAuth scope for Drive sync: per-file access only, NOT full-drive. */
export const driveScope = "https://www.googleapis.com/auth/drive.file";
