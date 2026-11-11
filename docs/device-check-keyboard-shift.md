# Device check: keyboard shift after Done (2026-11-11)

Status: all checks passed on the iPhone, installed PWA on production (8e18415), 2026-11-11.

Bug: on iPhone, Add sheet -> tap Amount -> keyboard up -> Done. The whole
app stayed shifted up with a black band at the bottom until Home was opened.

Fix: `src/app/keyboardScroll.ts` saves the scroll position when a
keyboard-raising field takes focus and restores it when focus leaves (and
once more on the next visualViewport resize, after iOS finishes animating
the keyboard away). Verified only in desktop Chromium, which has no
on-screen keyboard and never reproduced the shift — the restore was
checked by scrolling manually while focused. Whether iOS honours
`window.scrollTo` for this offset is the open question.

On the installed PWA (production URL), after the deploy:

- [x] Add sheet -> Amount -> Done. No black band; the tab bar sits at the
      bottom edge.
- [x] Same, but tap the backdrop to close the sheet instead of Done.
- [x] Amount -> tap Note (focus moves field to field) -> Done. No band.
- [x] Activity: scroll down the list, tap search, type, Done. The list stays
      where it was (does not jump to the top) and no band.
- [x] Debts -> a Lent out name -> Activity. Clear the search, go to Settings,
      come back: search stays empty. (Also verified in Playwright.)

If the band still appears, note which step and whether switching tabs
clears it — that says whether the offset is scrollY or the visual viewport.
