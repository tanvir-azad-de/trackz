# Device check — form + settings rework (2026-11-10)

**RUN 2026-11-10 on a real iPhone against production (c03ca41): all items
passed.** (A keyboard item was dropped by user decision 2026-11-10: it is
fixed only if it is seen again.)

Desktop Playwright can't settle these. Run them on a real
iPhone against the production URL after deploying. See
docs/renovation_version_1.txt section 5, "FORM + SETTINGS REWORK".

- [x] **Decimal keyboard.** Open Add transaction and tap Amount. Check that
      iOS raises the decimal pad, not the full keyboard. Type `12,40` with the
      pad's own separator, which is a comma on a German locale. Save it, and
      check that Activity shows 12,40 €, not 1.240,00 € and not 12,00 €.
- [x] **No scroll.** For an Expense, check that the whole form and Save fit
      without scrolling the sheet. Lent out / I owe adds a Direction row and
      should still fit.
- [x] **Half-width native pickers.** Check that the Type, Account, Category
      and Merchant selects open the iOS wheel. Check that the date field opens
      the date wheel and shows the full date inside its half-width box.
- [x] **"+ New…" at half width.** Choose "+ New…" in Category. Check that the
      narrow text field plus "List" is usable and takes focus.
- [x] **Edit sheet.** Open a row in Activity. Check that the amount is
      editable, that Delete → Delete removes the row, and that Undo restores it.
- [x] **Settings → Data → Import.** Check that the file picker opens from
      inside the Data sheet. Pick a CSV, then check that the Import preview
      opens and the Data sheet is gone.
- [x] **Top spacing without titles.** With the screen titles gone, check that
      Home, Activity, Accounts and Settings start clear of the status bar in
      the installed PWA.

## Round 2 (issues 6–8)

- [x] **Import the cleaned CSV**, after deploying: Settings → Data → Import
      `trackz-backup-2026-11-10.clean.csv` on the production URL. Check that
      the preview shows 1542 transactions, and that Lent out shows 6 rows
      whose notes say "Kaution".
- [x] **What changed this month** on real data: does each card now match
      your sense of the month? Electricity should not appear unless the bill
      changed.
- [x] **Version row** shows the deployed commit, the same hash as on
      Vercel's deployment.
