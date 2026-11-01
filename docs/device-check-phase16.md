# Phase 16/17 real-device checklist (iPhone Safari)

Written: 2026-11-01. Everything below is what Playwright/Chromium cannot
verify — see docs/renovation_version_1.txt's Phase 16 write-up for what
WAS verified in-session and how.

Run this after deploying the Phase 16/17 commit to production (Vercel),
not against localhost — Safari's install/PWA behavior and storage
eviction policy are tied to the real origin.

## 1. Install

- [ ] Open the production URL in Safari (not Chrome iOS — it's just a
      skin over WebKit, but Safari is the one real "Add to Home Screen"
      path this app targets).
- [ ] Share sheet → "Add to Home Screen". Confirm:
  - [ ] The app icon shown in the Add-to-Home-Screen preview is the
        purple bolt (`apple-touch-icon-180.png`), not a blank/generic icon.
  - [ ] The suggested name is "trackz" (from `apple-mobile-web-app-title`).
- [ ] Launch from the Home Screen icon. Confirm:
  - [ ] No Safari URL bar / tab chrome — runs standalone.
  - [ ] Splash screen (if shown) is dark (`#0a0b0f`), not a white flash.

## 2. Safe area / status bar (the bug installing creates)

- [ ] On a notched/Dynamic-Island device, confirm the Home screen's
      "Home" title is NOT overlapped by the status bar / Dynamic Island.
      (This is the `--safe-top` fix — `apple-mobile-web-app-status-bar-style:
      black-translucent` extends content under the status bar, which is
      why this specific check exists: it did NOT need checking before
      the app was installable.)
- [ ] Repeat on the Activity screen — confirm the sticky search/filter
      header does not slide under the status bar when scrolling (the
      two-sticky-element case: `.activity-screen__sticky-header` AND
      `.activity-list__month` both needed a `--safe-top` offset,
      independently, since sticky positioning is viewport-relative not
      parent-padding-relative).
- [ ] Repeat on Accounts and Settings tabs (same fix, simpler layout).

## 3. Export (the thing flagged unverified since Phase 13a)

This is the actual reason this phase exists — the export path makes
your data recoverable if storage is ever evicted, and it was flagged
unverified on real iOS in `SettingsScreen.tsx`'s `handleExport` docstring.

- [ ] Settings → Export. Note which code path actually fires:
  - [ ] iOS share sheet opens (`navigator.canShare({files})` path), OR
  - [ ] A file silently downloads via the `<a download>` fallback — if
        so, check where iOS Safari puts it (Files app → Downloads,
        typically) and confirm it's actually the CSV, not a blank/HTML
        file (Safari's anchor-download path has historically been
        unreliable in some iOS versions/contexts — this is the specific
        failure mode being checked for).
- [ ] Re-import that exact exported file (Settings → Import from CSV).
      Confirm the preview reads:
  - [ ] Liquid 847,07 € (adjust to your real current figure if the data
        has changed since this doc was written)
  - [ ] Total assets matches Accounts screen's total exactly
  - [ ] transaction/account/category/merchant counts look sane (compare
        to Settings' own transaction count before export)
- [ ] Confirm NOT committing the re-import still leaves existing data
      untouched (tap Cancel on the preview sheet, check nothing changed).

## 4. Offline

- [ ] Enable Airplane Mode.
- [ ] Force-quit the installed app (swipe up, swipe away).
- [ ] Re-launch from the Home Screen icon. Confirm:
  - [ ] App loads (shell renders from the service worker cache — the
        in-session Playwright check simulated this via routed network
        failures rather than `setOffline()`, which is a CDP quirk that
        pre-empts navigation before the SW gets a chance; the real
        device test is the first time this is checked against an
        actual disconnected radio).
  - [ ] Existing transaction data still shows (this is a localStorage
        read, unrelated to the service worker, but confirm it together
        since "the app works offline" is the actual claim being tested).
- [ ] Disable Airplane Mode, confirm the app continues working normally
      (no stuck "offline" state, no console-visible-only error — there's
      no remote-devtools step for this, just "does it look normal").

## 5. Input zoom / keyboard

- [ ] Tap the Activity search field — confirm Safari does NOT zoom the
      page in on focus (the 16px floor in `globals.css`).
- [ ] Open quick-entry, tap "More options" → tap the amount field and
      the Type dropdown — same check.
- [ ] Open Activity's filter sheet, tap a date field — same check.
- [ ] Tap the Type dropdown specifically — confirm it shows the app's
      own dark-styled option list with the new chevron, not iOS's
      native light picker wheel (the `-webkit-appearance: none` fix;
      the chevron rendering itself was confirmed in Chromium, but iOS's
      native select-replacement behavior can differ from desktop
      Chromium's and is worth eyeballing once for real).

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

- Google Drive sync — doesn't exist yet (Phase 15, not started). Nothing
  here exercises cross-device behavior.
- The 7-day Safari storage-eviction window itself — this would require
  leaving the NON-installed browser-tab version untouched for 7+ real
  days to actually observe eviction, which is out of scope for a
  single-session check. Installing to the Home Screen is the mitigation;
  this checklist verifies the install path works, not that eviction no
  longer happens to the old browser-tab data path (it still does — that
  data path hasn't changed).
