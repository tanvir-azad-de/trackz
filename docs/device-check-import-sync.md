# Device check: CSV import reaches the iPhone

Fix for "imported on the Mac, not on the iPhone". Unit-tested only; Drive
is never connected from `npm run dev`, so this needs production + iPhone.

Do these in order. Adoption only works for a device that has synced once
on the new build before the import.

1. Deploy. On the iPhone (installed PWA): open it, accept the Reload
   toast if shown, wait until Settings shows **Synced**.
2. On the Mac (production URL): reload, wait for **Synced**.
3. Mac: Settings > Data > Import from CSV, the cleaned file, Replace.
4. iPhone, WITHOUT killing the app first (this exercises the stale-file-id
   fix): bring it to the front, Settings > Sync now.
   - [ ] Status reaches **Synced**, not an error.
   - [ ] Transaction count matches the Mac.
   - [ ] An edited row from the file (e.g. a merged category) shows the
         new value.
5. Mac: reload, Sync now.
   - [ ] Count still matches (the iPhone did not re-upload its old copy).
6. iPhone: add a test transaction, wait ~10s. Mac: Sync now.
   - [ ] It appears on the Mac (ordinary sync still works after adopting).
   Delete it afterwards.
