# Device check — entry form rework (2026-11-10)

**RUN 2026-11-10 on a real iPhone against production (7fe522c): all 8
checked items passed.** "Remembered date across days" was confirmed by the
user on a later day, 2026-11-10. All 9 passed.

Things Playwright on desktop Chromium cannot settle. Run on a real iPhone
against the production URL after deploying. See docs/renovation_version_1.txt
section 5, "ENTRY FORM REWORK".

- [x] **Native picker with a long list.** Open Add transaction, enter an
      amount, tap Next, then tap Merchant. iOS opens its wheel picker. Is
      finding a name comfortable with the full real merchant list? Is the
      most-used name at the top?
- [x] **"+ New…" on iOS.** Choose "+ New…" in Category. Does the text field
      take focus and raise the keyboard? (`autoFocus` after a select change
      may not raise the keyboard on iOS.) Does "List" restore the previous
      value?
- [x] **Keypad-screen date picker.** Tap the date under the keypad. The
      native date wheel opens, the chosen date shows on the form step, and
      the sheet layout doesn't jump.
- [x] **Next reachable.** With the sheet open, Next sits above the home
      indicator and is fully tappable, not clipped or under the tab bar.
- [x] **Memory survives an app restart.** Save one transaction, close the
      installed PWA fully, reopen, and press +. The date and every field except
      the amount are pre-filled.
- [x] **Remembered date across days.** CONFIRMED by the user 2026-11-10. On a later day, the date picker still
      shows the last-used date, as the user decided. Confirm that is still
      what you want once it's in daily use.
- [x] **Filter sheet buttons pinned.** Activity → filter button. Reset/Apply
      are visible at the sheet bottom on open, and stay pinned with no
      jitter while momentum-scrolling the facets underneath.
- [x] **Activity month pills.** Swipe the pill row sideways: it scrolls
      without moving the list. Tap an old month: the list glides there and
      that pill lights up. Fling-scroll the list: the lit pill follows and
      the row re-centres it without jitter.
- [x] **Select chevron is tappable (icon migration).** In the entry form, tap
      exactly on the ▾ chevron of Type / Category / Merchant / Account. The iOS
      picker opens each time; the arrow never swallows the tap.
