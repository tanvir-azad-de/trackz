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

## 6. Update flow (do this on a LATER deploy, not this one)

- [ ] After a future deploy, re-open the installed app with existing
      data present. Confirm:
  - [ ] A toast reading "A new version of trackz is available." with a
        "Reload" action appears (not instantly — may take a background
        fetch cycle; reloading the app once manually first is fine to
        prompt the check).
  - [ ] Tapping "Reload" actually picks up the new code (check something
        simple that changed in that deploy, or check the build's
        asset-hash filename in a remote inspector if available).
  - [ ] The toast does NOT auto-dismiss after 5 seconds like the normal
        save/delete toasts do (this is the `durationMs: Infinity` case —
        confirm it actually behaves differently, not just that the code
        says so).

## What this checklist does NOT cover

- Google Drive sync — out of scope for THIS checklist. (It no longer
  "doesn't exist": Phase 15b has since wired up sign-in and token
  persistence. But it has never been run against live Google, and
  verifying it needs its own two-device pass — see api/README.md's "Not
  yet verified" section, which is the checklist for that.) Nothing here
  exercises cross-device behavior.
- The 7-day Safari storage-eviction window itself — this would require
  leaving the NON-installed browser-tab version untouched for 7+ real
  days to actually observe eviction, which is out of scope for a
  single-session check. Installing to the Home Screen is the mitigation;
  this checklist verifies the install path works, not that eviction no
  longer happens to the old browser-tab data path (it still does — that
  data path hasn't changed).
