/**
 * Build-time stamping of a build identity into sw.js (fixes the bug where
 * the service-worker update toast had never once fired in production).
 *
 * WHY THIS EXISTS. A browser installs a new service worker only when the
 * BYTES of sw.js change. sw.js's CACHE_VERSION was a frozen literal
 * ("trackz-v1"), untouched across 19 commits, so every deploy shipped a
 * byte-identical worker and the browser correctly concluded there was
 * nothing to install. Everything downstream of that was already built and
 * correct — registerServiceWorker.ts watches for a waiting worker, app.tsx
 * raises a Toast with durationMs: Infinity — and none of it could ever run.
 * The app still picked up new code via the worker's network-first
 * navigation strategy, which is why this went unnoticed; what was actually
 * broken is a session left OPEN across a deploy, which keeps running stale
 * JS with no prompt. The same frozen string also made sw.js's activate
 * handler filter old caches against a name that never changed, so its
 * cleanup has never deleted anything either. One constant unblocks both.
 *
 * WHY THIS HASHES CONTENT RATHER THAN READING VITE'S FILENAME HASHES.
 * Deriving the id from emitted filenames (index-cAc_IgpD.js) is the
 * obvious shortcut and it is subtly broken: index.html is NOT
 * content-hashed, so it contributes a constant token, so an edit touching
 * only index.html produces an identical build id and no user is ever
 * prompted. That was measured, not theorised — adding a <meta> tag to
 * index.html left the stamped id byte-identical. index.html carries the
 * PWA manifest link, theme-color and viewport meta, all of which are
 * exactly the kind of thing that changes alone. Hashing content covers
 * every emitted file uniformly and has no such blind spot.
 *
 * This module is pure (no fs, no DOM, no Vite types) so it can be unit
 * tested; the plugin in vite.config.ts is the thin half that reads the
 * bundle and rewrites dist/sw.js. Nothing in the app imports this, so it
 * is tree-shaken out of the bundle rather than shipped to the browser.
 */

/** The token in public/sw.js that this module substitutes. */
export const BUILD_ID_PLACEHOLDER = "__BUILD_ID__";

/** One emitted build artifact: its path in dist, and its bytes as text. */
export interface EmittedFile {
  fileName: string;
  content: string;
}

/**
 * 64-bit FNV-1a over the build's contents, as two 32-bit halves in hex.
 *
 * Deliberately a copy of domain/id.ts's private hash64 rather than an
 * import: that function is part of the transaction-id contract, where
 * changing it would orphan every content-derived id already persisted on a
 * user's device. This one has no such obligation — a different value here
 * costs exactly one spurious reload prompt. Coupling them would mean
 * neither could be changed independently.
 *
 * Non-cryptographic is fine: nothing authenticates this string, it only
 * has to be stable for identical input and different for changed input.
 */
function hash64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    const mirrored = input.charCodeAt(input.length - 1 - i);
    h2 ^= mirrored;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }

  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Derive a build id from every emitted file's name and content.
 *
 * Sorted by filename, so the id does not depend on the order Rollup
 * happens to report its bundle in. An unsorted join would make the id
 * unstable across builds of identical code, prompting every user to reload
 * on every deploy — which is how a notification becomes noise.
 *
 * Filenames are included alongside content, not just content, so that
 * renaming or moving a file is itself a change. The unit separator between
 * fields cannot appear in a filename, so no pair of (name, content) values
 * can collide by shifting the boundary between them.
 */
export function deriveBuildId(files: readonly EmittedFile[]): string {
  const material = [...files]
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0))
    .map((file) => `${file.fileName}\u001F${file.content}`)
    .join("\u001E");

  return hash64(material);
}

/**
 * Substitute the build id into sw.js's source.
 *
 * THROWS when the placeholder is absent, rather than returning the source
 * unchanged. A silent no-op here reproduces exactly the bug this module
 * exists to fix — an update mechanism that looks wired up and never fires —
 * except it would now also be invisible in the build log. Failing the
 * build is the only outcome that cannot be ignored.
 */
export function stampServiceWorker(swSource: string, files: readonly EmittedFile[]): string {
  if (!swSource.includes(BUILD_ID_PLACEHOLDER)) {
    throw new Error(
      `stampServiceWorker: ${BUILD_ID_PLACEHOLDER} not found in sw.js. ` +
        "Without it the worker's bytes never change and the update toast can never fire.",
    );
  }
  return swSource.replaceAll(BUILD_ID_PLACEHOLDER, deriveBuildId(files));
}
