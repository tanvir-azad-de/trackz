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

/**
 * OAuth scope for Drive sync: the app's own hidden appDataFolder only.
 *
 * NOT drive.file, and definitely not full-drive. drive.appdata grants access
 * to a per-app folder the user never sees in their Drive UI, so the sync file
 * cannot be moved, renamed, or deleted by accident — the three ways a
 * drive.file setup silently loses its own data.
 *
 * The trade-offs, accepted deliberately (see Phase 15c notes):
 * - appDataFolder files cannot be trashed or shared, so there is no trash to
 *   recover a bad write from. CSV export is the only recovery path.
 * - The folder is deleted outright if the user removes the app from Drive.
 * - Nothing is visible by eye in Drive, so "is my data up there?" has to be
 *   answerable in-app (remote row count + modified time in Settings).
 *
 * Changing this scope later would force every existing grant to re-consent.
 * It is free right now only because no grant has ever been issued.
 */
export const driveScope = "https://www.googleapis.com/auth/drive.appdata";
