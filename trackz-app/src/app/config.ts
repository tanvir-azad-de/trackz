/**
 * Build-time config, read from Vite env vars (import.meta.env.VITE_*).
 * Fixes old bug B7: a missing GOOGLE_CLIENT_ID used to silently skip
 * loadData() and render a blank app with no error. Instead, callers of
 * googleClientId must handle `null` explicitly and show a real message
 * (wired up in Phase 15 — Drive sync rewrite).
 */

export const googleClientId: string | null = import.meta.env.VITE_GOOGLE_CLIENT_ID || null;
