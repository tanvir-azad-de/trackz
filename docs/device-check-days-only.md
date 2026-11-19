# Device check: Activity days-only toggle (2026-11-19)

Run on a real iPhone against production after the next deploy.
Playwright covered layout, arithmetic and tap targets at 390x844 @2x.
These are the parts only a phone can settle.

1. Tap the ListCollapse button right of Filter. It goes accent and the
   list turns into one card of day rows. Tap again: day cards are back.
2. Tap a day's chevron row. Its transactions open under it with no lag.
   Open a second day: both stay open.
3. Tap a transaction inside an open day. The edit sheet opens. Delete
   it, then tap Undo on the toast over the sheet area. The row comes back.
4. Scroll the full list into an older month, then press the button. The
   days-only view shows that month, highlighted, from the top.
5. Tap other month pills, the oldest included. Each swaps the list to
   that month with no flash of the previous one.
6. With days-only on, close the installed PWA fully and relaunch. It
   opens with days-only still on, on the newest month.
7. Type in search with days-only on. The keyboard stays up and open
   days collapse.
