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
// bundle, so it wouldn't move the 41.96KB gzipped main-bundle figure;
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
// This app currently makes ZERO runtime network calls (src/sync/ is an
// empty placeholder — see docs/renovation_version_1.txt Phase 15, not yet
// built), so "cache the shell and it works offline" is true for the whole
// app today. That stops being automatically true the moment Drive sync
// lands; this SW is scoped to the static shell only, deliberately not
// anticipating a sync strategy that doesn't exist yet.

const CACHE_VERSION = "trackz-v1";
const SHELL_URLS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS)),
  );
  // Don't auto-activate — wait for the client to explicitly accept the
  // update (see src/sw-register.ts's SKIP_WAITING message), so a reload
  // is a deliberate user action via the Toast prompt, not a surprise
  // mid-session swap of the running app's code.
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
