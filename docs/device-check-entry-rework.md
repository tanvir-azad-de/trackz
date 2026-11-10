# Device check — entry form rework (2026-11-10)

Things Playwright on desktop Chromium cannot settle. Run on a real iPhone
against the production URL after deploying. See docs/renovation_version_1.txt
section 5, "ENTRY FORM REWORK".

- [ ] **Native picker with a long list.** Open Add transaction, enter an
      amount, tap Next, then tap Merchant. iOS opens its wheel picker. Is
      finding a name comfortable with the full real merchant list? Is the
      most-used name at the top?
- [ ] **"+ New…" on iOS.** Choose "+ New…" in Category. Does the text field
      take focus and raise the keyboard? (`autoFocus` after a select change
      may not raise the keyboard on iOS.) Does "List" restore the previous
      value?
- [ ] **Keypad-screen date picker.** Tap the date under the keypad. The
      native date wheel opens, the chosen date shows on the form step, and
      the sheet layout doesn't jump.
- [ ] **Next reachable.** With the sheet open, Next sits above the home
      indicator and is fully tappable, not clipped or under the tab bar.
- [ ] **Memory survives an app restart.** Save one transaction, close the
      installed PWA fully, reopen, and press +. The date and every field except
      the amount are pre-filled.
- [ ] **Remembered date across days.** On a later day, the date picker still
      shows the last-used date, as the user decided. Confirm that is still
      what you want once it's in daily use.
- [ ] **Filter sheet buttons pinned.** Activity → filter button. Reset/Apply
      are visible at the sheet bottom on open, and stay pinned with no
      jitter while momentum-scrolling the facets underneath.
