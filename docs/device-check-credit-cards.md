# Device check: credit cards + CSV account types (2026-11-11)

Needs the production URL after the next deploy. Not yet done.

1. Device A: Settings → Data → Import `trackz-backup-2026-11-11.clean.csv`
   (export a backup first). Preview shows Liquid; it must equal Home's
   Liquid after Replace.
2. Home: ADVZ in the strip carries a "Credit card" badge; Liquid excludes it.
3. Accounts: no Total card; sections Cash, Investments (SCLB), Credit cards (ADVZ).
4. Settings has no Accounts row.
5. Device B (synced): after a sync, the same Liquid figure and sections.
   Until B runs the new build, its old code drops credit_card entries, so
   ADVZ would show as cash there — check B only after it reloads the update.
6. Add transaction → Account → + New…: the "Account type" dropdown appears,
   opens the iOS picker, and the keyboard does not hide it. Cancel the row
   afterwards (Undo) — the type entry stays in the map, harmless.
7. Import the OLD 11-11 file (no cell): preview refuses it with
   "No accountTypes config cell".
