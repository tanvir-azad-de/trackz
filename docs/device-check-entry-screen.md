# Device check: entry screen (no layout shift)

Installed PWA on the iPhone, after this change is deployed. Playwright
can't reproduce iOS keyboard or panning behaviour, so these stay open
until checked here.

1. [ ] FAB opens the full-screen Add screen. Typing 1 2 4 0 shows 12,40 €. Rapid
   double taps on adjacent keys do not zoom the page.
2. [ ] Tapping Category, Merchant, Account, Type and Date swaps the keypad
   for that list in the same space. Nothing above it moves.
3. [ ] Tapping Note raises the keyboard straight away (one tap). The page
   does not scroll or shift, and the input stays at the top.
4. [ ] Done (and the keyboard's own Done/return) saves the note and closes
   the keyboard. Afterwards there is no black band and no offset.
5. [ ] Merchant → + New raises the keyboard straight away. Cancel keeps the
   previous merchant.
6. [ ] Account → + New: the Cash / Credit card / Investment chips can be
   tapped without the keyboard closing.
7. [ ] Date → Pick a date opens the iOS date picker. Picking a day updates
   the Date tile.
8. [ ] Save, then open Add again: the "Saved" toast sits over the amount,
   not over the C / 0 / delete keys.
9. [ ] Activity → tap a row: the Edit screen shows its amount. C clears it,
   new digits replace it, Save stores the new amount.
10. [ ] Edit → Delete transaction → the confirm appears in the same row,
    and Delete removes the row.
11. [ ] The header clears the notch/Dynamic Island, and the keypad's
    bottom row clears the home indicator.
