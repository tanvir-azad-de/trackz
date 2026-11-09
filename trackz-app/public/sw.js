// Hand-rolled service worker — no vite-plugin-pwa / Workbox dependency.
//
// Why hand-rolled: Vite emits content-hashed filenames for every JS/CSS
// chunk (e.g. index-CLVuw3db.js). Content-hashed assets are immutable by
// construction — a byte change always produces a new URL — so cache-first
// runtime caching needs no build-time precache manifest at all. The only
// URL that is NOT content-hashed, and therefore the only one that needs
// explicit precaching, is index.html itself (and "/", which serves it).
// That reduces this to ~2 fetch strategies and no new dependency, which
// matches this codebase's measured-bytes posture (see Sparkline.tsx's
// uPlot writeup) — Workbox would land in this SW file, not the main
// bundle, so it wouldn't move the main-bundle gzipped figure (41.96KB when
// this was written, 51.4KB now — see the renovation doc for the current
// number rather than trusting this comment);
// the argument against it is dependency surface and opacity, not size.
//
// Caching strategy:
//   - Navigations (the HTML shell): network-first, falling back to the
//     cached shell when offline. Network-first (not cache-first) means a
//     normal online load always gets the latest shell — avoids serving a
//     stale app forever if this SW's own update-detection step is ever
//     slow or misses a beat.
//   - Hashed assets under /assets/: cache-first. Safe specifically
//     because the URL changes whenever the content does — a cache-first
//     hit is never stale by definition.
//   - Everything else (icons, manifest, favicon): cache-first with a
//     network fallback, same reasoning as assets but these aren't
//     content-hashed, so a very rare manual edit to one of these files
//     could lag a cache cycle; acceptable for icons/manifest, which the
//     user is not actively looking at for correctness.
//
// This SW is scoped to the STATIC SHELL only — it deliberately caches no
// user data. Drive sync (Phase 15) has since landed, so the older claim
// here that the app makes zero runtime network calls is no longer true.
// It stays safe for two specific reasons, both enforced by the fetch
// handler below and neither accidental:
//   - every /api/* auth call is a POST, and the handler returns early on
//     any non-GET request;
//   - every Drive call goes to googleapis.com, and the handler returns
//     early on any cross-origin request.
// So no sync response can land in the shell cache. If a same-origin GET
// API endpoint is ever added, it needs an explicit bypass here BEFORE it
// ships — cacheFirst would otherwise serve a stale financial payload from
// cache indefinitely.

// __BUILD_ID__ is substituted at build time by the stamp-service-worker
// plugin in vite.config.ts (pure half: src/pwa/stampServiceWorker.ts).
//
// THIS LINE IS THE UPDATE MECHANISM, not a cache-naming detail. A browser
// installs a new service worker only when the BYTES of this file change.
// This was a frozen literal ("trackz-v1") for 19 commits, so every deploy
// served a byte-identical worker, so the browser never installed one, so
// the update Toast below — fully built and correctly wired — had never
// fired in production once. The app still got new code on a fresh load via
// the network-first navigation strategy, which is why nobody noticed; what
// was broken is a session left OPEN across a deploy, running stale JS with
// no prompt. Do not replace this with a hand-bumped version number: that
// is what the old public/js/version.js hook did, and a step a human must
// remember is a step that gets skipped.
//
// It is also why the activate handler's cache cleanup below had never
// deleted anything — it filters on a name that never changed.
//
// The ternary is the unstamped fallback. Both occurrences are substituted
// together (replaceAll), so after stamping this reads
// "DEADBEEF".startsWith("__") ? "dev" : "DEADBEEF" and yields the build id;
// unstamped it yields "dev". Written this way rather than as a bare token
// (CACHE_VERSION = __BUILD_ID__) because a bare unstamped token is a
// ReferenceError that kills the worker at install and takes offline
// support with it.
const BUILD_ID = "__BUILD_ID__".startsWith("__") ? "dev" : "__BUILD_ID__";
const CACHE_VERSION = `trackz-${BUILD_ID}`;
const SHELL_URLS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS)),
  );
  // Don't auto-activate — wait for the client to explicitly accept the
  // update (see src/pwa/registerServiceWorker.ts's SKIP_WAITING message),
  // so a reload is a deliberate user action via the Toast prompt, not a
  // surprise mid-session swap of the running app's code.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_VERSION);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(fallbackUrl);
    if (cached) return cached;
    throw new Error("network-first: offline with no cached fallback");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}
