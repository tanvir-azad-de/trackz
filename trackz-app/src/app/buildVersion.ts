/**
 * The label on Settings' version row, e.g. "2ccafb3 · 10 Nov 2026".
 *
 * A commit hash plus build date (user decision 2026-11-10), not a semver:
 * trackz-app/package.json says 0.0.0, and the pre-commit hook's counter
 * bumps the DEAD legacy app's public/js/version.js, which goes away with
 * public/ in Phase 18. The hash is exactly what was deployed and never
 * needs bumping.
 *
 * vite.config.ts calls this at BUILD time and inlines the result as
 * __APP_VERSION__, so like VITE_GOOGLE_CLIENT_ID it only changes on the
 * next build. Pure, so the config stays the thin half.
 */
export function buildVersionLabel(commitSha: string | undefined, buildDateIso: string): string {
  const [year, month, day] = buildDateIso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const date = `${day} ${MONTHS[month - 1]} ${year}`;
  const sha = commitSha?.trim().slice(0, 7);
  return sha ? `${sha} · ${date}` : `dev · ${date}`;
}

// Hard-coded, not toLocaleDateString: the build machine's locale (Vercel's
// is en-US) would otherwise decide the label's language.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
