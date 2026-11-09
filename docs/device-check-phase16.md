# Phase 16/17 real-device checklist (iPhone Safari)

Written: 2026-11-01. Everything below is what Playwright/Chromium cannot
verify — see docs/renovation_version_1.txt's Phase 16 write-up for what
WAS verified in-session and how.

Run this after deploying the Phase 16/17 commit to production (Vercel),
not against localhost — Safari's install/PWA behavior and storage
eviction policy are tied to the real origin.

## 1. Install

- [x] Open the production URL in Safari (not Chrome iOS — it's just a
      skin over WebKit, but Safari is the one real "Add to Home Screen"
      path this app targets).
- [x] Share sheet → "Add to Home Screen". Confirm:
  - [x] The app icon shown in the Add-to-Home-Screen preview is the
        purple bolt (`apple-touch-icon-180.png`), not a blank/generic icon.
  - [x] The suggested name is "trackz" (from `apple-mobile-web-app-title`).
- [x] Launch from the Home Screen icon. Confirm:
  - [x] No Safari URL bar / tab chrome — runs standalone.
  - [x] Splash screen (if shown) is dark (`#0a0b0f`), not a white flash.

## 2. Safe area / status bar (the bug installing creates)

- [x] On a notched/Dynamic-Island device, confirm the Home screen's
      "Home" title is NOT overlapped by the status bar / Dynamic Island.
      (This is the `--safe-top` fix — `apple-mobile-web-app-status-bar-style:
      black-translucent` extends content under the status bar, which is
      why this specific check exists: it did NOT need checking before
      the app was installable.)
- [x] Repeat on the Activity screen — confirm the sticky search/filter
      header does not slide under the status bar when scrolling (the
      two-sticky-element case: `.activity-screen__sticky-header` AND
      `.activity-list__month` both needed a `--safe-top` offset,
      independently, since sticky positioning is viewport-relative not
      parent-padding-relative).
- [x] Repeat on Accounts and Settings tabs (same fix, simpler layout).

## 3. Export (the thing flagged unverified since Phase 13a)

This is the actual reason this phase exists — the export path makes
your data recoverable if storage is ever evicted, and it was flagged
unverified on real iOS in `SettingsScreen.tsx`'s `handleExport` docstring.

- [x] Settings → Export. Note which code path actually fires:
  - [x] iOS share sheet opens (`navigator.canShare({files})` path), OR
  - [x] A file silently downloads via the `<a download>` fallback — if
        so, check where iOS Safari puts it (Files app → Downloads,
        typically) and confirm it's actually the CSV, not a blank/HTML
        file (Safari's anchor-download path has historically been
        unreliable in some iOS versions/contexts — this is the specific
        failure mode being checked for).
- [x] Re-import that exact exported file (Settings → Import from CSV).
      Confirm the preview reads:
  - [x] Liquid 847,07 € (adjust to your real current figure if the data
        has changed since this doc was written)
  - [x] Total assets matches Accounts screen's total exactly
  - [x] transaction/account/category/merchant counts look sane (compare
        to Settings' own transaction count before export)
- [x] Confirm NOT committing the re-import still leaves existing data
      untouched (tap Cancel on the preview sheet, check nothing changed).

## 4. Offline

- [x] Enable Airplane Mode.
- [x] Force-quit the installed app (swipe up, swipe away).
- [x] Re-launch from the Home Screen icon. Confirm:
  - [x] App loads (shell renders from the service worker cache — the
        in-session Playwright check simulated this via routed network
        failures rather than `setOffline()`, which is a CDP quirk that
        pre-empts navigation before the SW gets a chance; the real
        device test is the first time this is checked against an
        actual disconnected radio).
  - [x] Existing transaction data still shows (this is a localStorage
        read, unrelated to the service worker, but confirm it together
        since "the app works offline" is the actual claim being tested).
- [x] Disable Airplane Mode, confirm the app continues working normally
      (no stuck "offline" state, no console-visible-only error — there's
      no remote-devtools step for this, just "does it look normal").

## 5. Input zoom / keyboard

- [x] Tap the Activity search field — confirm Safari does NOT zoom the
      page in on focus (the 16px floor in `globals.css`).
- [x] Open quick-entry, tap "More options" → tap the amount field and
      the Type dropdown — same check.
- [x] Open Activity's filter sheet, tap a date field — same check.
- [x] Tap the Type dropdown specifically — confirm it shows the app's
      own dark-styled option list with the new chevron, not iOS's
      native light picker wheel (the `-webkit-appearance: none` fix;
      the chevron rendering itself was confirmed in Chromium, but iOS's
      native select-replacement behavior can differ from desktop
      Chromium's and is worth eyeballing once for real).

**BUG FOUND on this pass, fixed same day:** double-tapping two adjacent
keypad digits in quick succession (e.g. "2" then "3") on the quick-entry
keypad triggered iOS Safari's native double-tap-to-zoom gesture, zooming
the whole page. This is a DIFFERENT bug than zoom-on-focus above — that
one fires on text-input focus, this one fires on two quick taps anywhere
on the page regardless of what's under them, and nothing in Phase 16/17's
Playwright verification could have caught it: it's native gesture-
recognizer behavior, not a DOM/CSS state a computed-style assertion
observes. Fixed with `touch-action: manipulation` applied to the
universal `*` selector in `globals.css` (not inherited from `body` alone
— confirmed via `getComputedStyle` that `touch-action` does not inherit
in the normal CSS sense, so it has to be set directly on every element).
`manipulation`, not `none`, was used deliberately: it disables only
double-tap-zoom while still permitting pinch-zoom, so this is not an
accessibility regression for users who rely on zoom.
- [ ] Re-verify on the real device: double-tap rapidly between any two
      adjacent keypad digits several times — page should no longer zoom.
- [ ] Also check pinch-zoom still works somewhere in the app (e.g. the
      Home screen) — confirming the fix didn't overshoot into disabling
      zoom entirely.

## 6. Update flow (REWRITTEN 2026-11-09 — the mechanism was broken)

**Why this section was wrong before.** It read "do this on a LATER
deploy", which was correct advice for a reason nobody had identified: the
toast could never have fired on ANY deploy. `CACHE_VERSION` in
`public/sw.js` was the frozen literal `"trackz-v1"`, and a browser
installs a new service worker only when sw.js's BYTES change. Nineteen
commits shipped a byte-identical worker. The deployed copy was confirmed
byte-identical to the repo's by shasum. Everything downstream was built
and correct — `registerServiceWorker.ts` watches for a waiting worker,
`app.tsx` raises the toast with `durationMs: Infinity` — and none of it
could run. The app still picked up new code on a fresh load via the
worker's network-first navigation strategy, which is why this went
unnoticed for so long; what was broken is a session left OPEN across a
deploy, which keeps running stale JS with no prompt.

Now fixed: a build id hashed from every emitted file's name and content
is stamped into sw.js at build time (`src/pwa/stampServiceWorker.ts`,
wired by the `stamp-service-worker` plugin in `vite.config.ts`). Verified
in-session by building twice unchanged (byte-identical sw.js), then
changing `src/app.tsx` (id moved `4f58ae95` → `0191e07f`), then changing
ONLY `index.html` (id moved `4f58ae95` → `672e9eff` — this last case is
why the id hashes content rather than reading Vite's filename hashes;
index.html is not content-hashed).

**CARRIED CAVEAT, cannot be checked on the first deploy.** The currently
installed worker on any existing device is still `trackz-v1`. The deploy
carrying this fix is the first whose sw.js differs, so that deploy is the
one that gets installed — and from the SECOND deploy onward the toast
becomes observable. Do not read "no toast on the fix deploy" as a
failure; it is expected. The check below needs two deploys.

- [x] **Deploy 1 (the fix).** Open the installed app, then force-quit and
      relaunch once. In a remote inspector, confirm
      `navigator.serviceWorker.controller.scriptURL` resolves and that the
      active worker's `CACHE_VERSION` is no longer `trackz-v1` (check
      Cache Storage: the key should read `trackz-<16 hex chars>`). No
      toast is expected here.
      **CONFIRMED on a real device 2026-11-09**, commit f4c67b8: Cache
      Storage reads `trackz-<16 hex>`. The stamping half of this bug is
      now verified end-to-end on real iOS, not just in a local build. The
      PROMPT half is still unverified and needs Deploy 2 below.
- [ ] **Deploy 2 (any later change).** Leave the installed app OPEN,
      deploy, then return to the still-open session. Confirm:
  - [ ] A toast reading "A new version of trackz is available." with a
        "Reload" action appears (not instantly — may take a background
        fetch cycle; backgrounding and foregrounding the app once is fine
        to prompt the check).
  - [ ] Tapping "Reload" actually picks up the new code (check something
        simple that changed in that deploy, or the build's asset-hash
        filename in a remote inspector).
  - [ ] The toast does NOT auto-dismiss after 5 seconds like the normal
        save/delete toasts do (this is the `durationMs: Infinity` case —
        confirm it behaves differently, not just that the code says so).
  - [ ] Cache Storage now holds exactly ONE `trackz-*` key, not two. This
        is the second half of the same bug: sw.js's activate handler
        deletes caches whose name differs from the current
        `CACHE_VERSION`, so with a frozen name it had never deleted
        anything. This is the first deploy where that cleanup can run, and
        a leftover key means it still is not running.
  - [ ] Confirm the reload did NOT lose unsaved quick-entry state in a
        way that feels abrupt (the deliberate design is that activation
        waits for the user's tap — if the app swaps code without the
        toast, `skipWaiting` is firing on its own and that is a
        regression).

## 7. CSV import with Drive connected (added by the Phase 15c step 7 fix)

New in this pass, because the behaviour it checks did not exist before:
importing a CSV now also **overwrites the Drive copy** when Drive is
connected (`features/settings/commitImport.ts`). Previously the import
committed locally and the debounced union merge quietly restored every
row the imported file had omitted, about five seconds later — so
"Replace anyway" did not replace. Covered by four regression tests, but
the live multi-device half can only be checked on real devices.

Do this with a CSV that is deliberately SMALLER than what is currently
synced (e.g. export, delete a handful of rows in a spreadsheet, re-import),
since an identical re-import converges either way and would pass even if
the fix were absent.

- [ ] Export a backup FIRST. This path deletes and rewrites the Drive
      file, and `appDataFolder` has no trash — the CSV is the only undo.
- [ ] Import the smaller file on device A. Confirm the toast reports the
      imported count and does NOT mention Drive having the old copy.
- [ ] Settings → "Check what's on Drive" → row count matches the
      SMALLER file, not the previous total.
- [ ] Wait at least 10 seconds on device A, then re-check. The count must
      stay at the smaller number (this is the actual bug: the debounce
      fired at 5s and unioned the dropped rows back).
- [ ] Open device B and let it sync. Confirm it converges DOWN to the
      smaller set rather than pushing the old rows back up.
- [ ] Offline variant: enable Airplane Mode, import a file, and confirm
      the toast says Drive still holds the old copy and names
      "Replace Drive copy with this device" — then go online, use that
      button, and confirm Drive catches up. (Nothing retries this
      automatically, by design; the local write is silent so no debounce
      is armed.)

## What this checklist does NOT cover

- Google Drive sync — out of scope for THIS checklist, EXCEPT section 7's
  import interaction above. (It no longer "doesn't exist": Phase 15b wired
  up sign-in and token persistence, and Phase 15c step 7 verified
  two-device convergence, tombstone propagation and account-type
  propagation against live Google — see docs/renovation_version_1.txt's
  step 7 entry. api/README.md's "Not yet verified" list is the checklist
  for the auth half.) Nothing else here exercises cross-device behavior.
- The 7-day Safari storage-eviction window itself — this would require
  leaving the NON-installed browser-tab version untouched for 7+ real
  days to actually observe eviction, which is out of scope for a
  single-session check. Installing to the Home Screen is the mitigation;
  this checklist verifies the install path works, not that eviction no
  longer happens to the old browser-tab data path (it still does — that
  data path hasn't changed).
