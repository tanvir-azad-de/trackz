/**
 * Service worker registration + update handling (Phase 16).
 *
 * Guarded on import.meta.env.PROD for the same reason src/dev/seed.ts
 * guards on DEV: `npm run dev` already gives live-reloading code via
 * Vite's own HMR, so a service worker in dev would only add a second,
 * competing cache layer that could serve stale code during development.
 *
 * Update flow: the browser installs a new worker into the "waiting"
 * state automatically but does NOT activate it while the old worker
 * still controls open tabs (this is standard SW behavior, not something
 * this code opts into) — sw.js additionally skips auto-activation on its
 * own install event, so activation only happens after this module posts
 * SKIP_WAITING, which only happens after the user taps "Reload" on the
 * toast. That is the deliberate choice here: a background tab swapping
 * its running JS out from under a mid-edit quick-entry form would be a
 * worse experience than a slightly stale app for a few extra minutes.
 */
export function registerServiceWorker(onUpdateAvailable: () => void): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("/sw.js").then((registration) => {
    // A worker may already be sitting in "waiting" if this tab was open
    // across a deploy (the registration fired, install completed, but
    // this code hadn't run yet to notice) — check immediately, not only
    // on the next updatefound event.
    if (registration.waiting) {
      onUpdateAvailable();
    }

    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        // "installed" fires for the very first SW install too, when
        // there is no existing controller — only treat it as an update
        // (not a first-run no-op) when a controller already exists.
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          onUpdateAvailable();
        }
      });
    });
  });

  // Reload automatically once the NEW worker actually takes control —
  // triggered by applyServiceWorkerUpdate() below posting SKIP_WAITING,
  // not by this registration step itself.
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

/** Tell the waiting worker to activate now — call from the update toast's action. */
export function applyServiceWorkerUpdate(): void {
  navigator.serviceWorker.getRegistration().then((registration) => {
    registration?.waiting?.postMessage("SKIP_WAITING");
  });
}
