# Real-device checklist — Phases 6b / 13b (iPhone Safari)

Written: 2026-11-09, against production `d04c4d0` (verified: the deployed
bundle contains Phase 13b's strings, so production is current with HEAD).

**RUN AND CLOSED, 2026-11-09.** Every section below passed on a real iPhone.
Keep the file as the record of what was checked and as the template for the
next pass; the outcomes are written up in `renovation_version_1.txt` under
"REAL-DEVICE PASS FOR PHASES 6b/13b".

The pass found one bug, and it came from outside this checklist: the app
header double-counted `--safe-top`, so content started 118px down for a 59px
inset on every screen. The header is now removed. Two `vh` units were fixed
with it. **Sections 3, 4 and 5 are worth re-running after the next deploy**,
since the layout they exercise has changed underneath them.

This covers the three phases that shipped with **no real-device pass at
all** — Phase 6 part 1/2 (merchant merge) and Phase 13b (categories) — plus
the two items left unchecked in `docs/device-check-phase16.md` section 5.

Run it against the production URL on the **installed PWA**, not Safari-tab
and not localhost. Install behaviour, `--safe-top`, and native gesture
recognizers all differ, and `appDataFolder` is shared with dev (see
AGENTS.md).

Sections 1 and 2 expire: section 1 needs a launch where the running app
predates the deploy, section 2 is the only confirmation the `touch-action`
fix ever worked.

## 1. Does a deploy reach the installed app?

The toast was designed for this and **cannot fire** — see "Known: the update
toast is unreachable" below. So check the thing that actually matters: does
relaunching pick up new code at all?

- [ ] Launch the installed PWA (first launch since the 2026-11-09 deploy).
- [ ] Settings → confirm a **Categories** section exists reading
      "Edit categories (34)". That section is new in Phase 13b, so seeing it
      proves the new bundle is running.
  - [ ] If it reads 36 rather than 34, the ledger on this device predates the
        Dining→Restaurant and Fees→Bank Charges renames. The section existing
        at all is the update check; the count is a data question.
- [ ] Note whether an update toast appeared. **Expected: it does not.** If it
      does, that contradicts the analysis below and is worth reporting.

## 2. Keypad double-tap (the one fix never confirmed)

`touch-action: manipulation` on the universal selector was added in response
to a real bug found on-device, then shipped without re-checking it on-device.

- [ ] FAB → quick-entry keypad. Double-tap rapidly between two adjacent
      digits ("2" then "3") several times. The page must **not** zoom.
- [ ] Pinch-zoom somewhere else (Home). It must still work — `manipulation`
      was chosen over `none` specifically to keep this, so losing it would
      trade one bug for an accessibility regression.

## 3. Categories sheet (Phase 13b, never on a device)

A scrolling 34-row list plus a text input inside a `Sheet`. The Phase 6b
z-index bug came from exactly this shape.

- [ ] Settings → "Edit categories (34)". The sheet opens.
- [ ] Scroll the full list inside the sheet. The list scrolls, the page
      behind it does not (`overscroll-behavior: contain`).
- [ ] Tap a category with several rows. The rename form appears.
- [ ] **Tap the "New name" field and watch the keyboard.** Confirm the input
      and the Rename button are both still visible above it. This is the
      specific risk: the sheet is capped in `vh`, which iOS does not shrink
      for the keyboard, and nothing in the codebase handles keyboard
      avoidance (see "Known" below).
- [ ] Rename it to something harmless and back. After each rename:
  - [ ] An Undo toast appears **and is actually tappable** — tap it, don't
        just look at it. The sheet deliberately stays open, which is the
        condition that made the toast untappable before.
  - [ ] Undo restores the original name and row count.
- [ ] Tap a category marked "· mixed types" (WiFi, or Shopping). Confirm the
      breakdown lists more than one type and the note reads as information,
      not an error.

## 4. Merchant merge sheet (Phase 6b, never on a device)

- [ ] Settings → "Tidy up merchants (N to review)". The sheet opens on a
      suggested group.
- [ ] Merge one, confirm the Undo toast is tappable, undo it.
- [ ] "Merge manually" tab → tap both merchant inputs. Same keyboard check as
      section 3: are the inputs and the Merge button still reachable? This tab
      has **two** inputs plus a canonical-name field, so it is the worst case
      in the app.
- [ ] Confirm the autocomplete dropdown (`list=`) renders usably on iOS — it
      is a `<datalist>`, which iOS styles differently from Chromium.
- [ ] If a group warns about counterparty rows, confirm the warning is legible
      and not clipped.

## 5. Bottom-of-screen layout

`.app-shell` uses `height: 100vh` (not `100dvh`) — see "Known" below. On iOS
`100vh` is the *taller* viewport that ignores the toolbar.

- [ ] Scroll to the very bottom of Activity. Confirm the last row is fully
      readable above the tab bar and is not hidden behind it.
- [ ] Confirm there is no dead empty scroll space past the last row.
- [ ] Repeat on Home and Settings (shorter pages, so a fixed-height shell
      shows up differently).

## 6. Sync still alive

Free to check while here. The OAuth consent screen is **published**, so the
7-day refresh-token trap does not apply — but live verification was 2026-11-02
and nothing has confirmed the session since.

Settings' Sync section is now the **only** place the full status appears: the
header badge that used to show it permanently is gone, and `sync/alerts.ts`
toasts only `error` and `conflict` (the two that need attention; the rest
either resolve themselves or are a valid way to run the app).

- [ ] Settings → Sync → status reads "up to date" (or settles there), not
      "not syncing" and not an error.
- [ ] "Check what's on Drive" → row count matches this device's own count.
- [ ] Make one trivial edit, wait ~10s, confirm the status returns to
      "up to date".

## Known problems this checklist expects to find

Recorded so a tester does not spend time rediscovering them, and so a
"failure" here is not mistaken for a new bug.

### The update toast is unreachable

`registerServiceWorker` shows "A new version of trackz is available." when a
new worker reaches `waiting`. A browser only installs a new worker when
**`sw.js` itself changes bytes**. Verified: `sw.js` has not been touched since
Phase 16 (`fc895b1`), across **17 commits**, and the production copy is
byte-identical to the repo copy (`shasum` matches). So `updatefound` has never
fired on any deploy since Phase 16 and the toast has never been reachable in
production.

The app still updates, by a different route: navigations are network-first, so
a relaunch fetches a fresh `index.html` carrying new content-hashed asset
URLs, which then miss the cache and come from the network. That is why this
has gone unnoticed — and why section 1 checks for the new Settings section
rather than the toast.

What is genuinely broken is the case the toast existed for: a PWA session left
open across a deploy keeps running stale JS with no prompt. The fix is to make
`sw.js` change per build (stamp the build hash into `CACHE_VERSION`), which
also fixes the `activate` handler's cache-cleanup never running.
`docs/device-check-phase16.md` section 6 is superseded by this.

### Two `vh` units survived the Phase 17 pass — both now FIXED

The Phase 17 audit claimed "zero 100vh in any CSS file". That was stale —
true when written, regressed afterwards. Both are now `dvh`:

- `trackz-app/src/app/TabBar.css` — `.app-shell` was `height: 100vh`,
  introduced in `6698efb` (Phase 15b, which landed *after* Phase 16/17
  despite the lower number). Now `min-height: 100dvh`.
- `trackz-app/src/features/settings/CategoriesSheet.css` — the list cap was
  `max-height: 50vh`. Now `50dvh`. **CONFIRMED on a real iPhone by the user
  2026-11-10.** Original note: desktop Chromium has no
  dynamic toolbar, so `vh` and `dvh` resolve identically there — confirmed by
  mutating it back and watching the probe still pass. Only a real device can
  settle this one.

### The app header, removed

Not a known problem when this file was written — it is what the pass found.
`.app-header` consumed `var(--safe-top)` as top padding while every screen's
own container did too, so the inset applied twice: measured at 118.0px of
offset for a 59px inset, against Phase 16's verified +59px. Removed rather
than reconciled, since all four screens already render their own `<h1>`.
See `renovation_version_1.txt` for the full write-up, including why the sync
indicator's `conflict` status had to move to a toast rather than just vanish.
