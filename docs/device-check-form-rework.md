# Device check — form + settings rework (2026-11-10)

**NOT YET RUN.** Desktop Playwright can't settle these. Run them on a real
iPhone against the production URL after deploying. See
docs/renovation_version_1.txt section 5, "FORM + SETTINGS REWORK".

- [ ] **Decimal keyboard.** Open Add transaction and tap Amount. Check that
      iOS raises the decimal pad, not the full keyboard. Type `12,40` with the
      pad's own separator, which is a comma on a German locale. Save it, and
      check that Activity shows 12,40 €, not 1.240,00 € and not 12,00 €.
- [ ] **Keyboard vs pinned Save.** With the keyboard up on Amount, and again
      on Notes, check that Save stays visible or comes back into view, and
      that the focused field isn't hidden under the keyboard.
- [ ] **No scroll.** For an Expense, check that the whole form and Save fit
      without scrolling the sheet. Lent out / I owe adds a Direction row and
      should still fit.
- [ ] **Half-width native pickers.** Check that the Type, Account, Category
      and Merchant selects open the iOS wheel. Check that the date field opens
      the date wheel and shows the full date inside its half-width box.
- [ ] **"+ New…" at half width.** Choose "+ New…" in Category. Check that the
      narrow text field plus "List" is usable and takes focus.
- [ ] **Edit sheet.** Open a row in Activity. Check that the amount is
      editable, that Delete → Delete removes the row, and that Undo restores it.
- [ ] **Settings → Data → Import.** Check that the file picker opens from
      inside the Data sheet. Pick a CSV, then check that the Import preview
      opens and the Data sheet is gone.
- [ ] **Top spacing without titles.** With the screen titles gone, check that
      Home, Activity, Accounts and Settings start clear of the status bar in
      the installed PWA.
