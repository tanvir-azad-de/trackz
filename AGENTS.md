# trackz

Personal finance PWA. EUR-only, dark-only, offline-first, Google Drive sync.
Live app is `trackz-app/` (Vite + Preact + TS). `public/` is the dead legacy
app, kept only as the Phase 18 rollback target.

## Replying to the user

Keep replies short. A call to action, an acknowledgement, or something
genuinely important — nothing else.

- Lead with the answer or the next action. No preamble, no recap of what was
  just asked.
- Report findings as a short list of claims. Explain the reasoning behind one
  only when asked, or when acting on it without the reasoning would be wrong.
- Use the `question` tool for decisions that are actually the user's to make.
  Two options with one line each beats a paragraph weighing them.
- Say what you verified and what you assumed. A one-line caveat is fine; a
  section defending it is not.

## Measure before you trust a document

Every phase of this rebuild found the plan doc wrong about something, and
measuring the real data first is what caught it each time — the merchant
"7 groups / 150 rows" figure, the category-type "bug" that was correct data,
the drill-down that was worse than described. `docs/renovation_version_1.txt`
is the project's history and single source of truth for decisions, and parts
of it are stale or superseded. Check a claim against the code or the CSV
before building on it, then correct the doc in the same change.

Read that doc before planning work. Section 5, "WHERE THIS STANDS", is at
the top and is the maintained one — current baseline, what is done, what is
left, and the known bugs. The rest is chronological history where later
entries supersede earlier ones. Update section 5 in the same change as any
work.

## Verification earns the claim

Three disciplines this codebase holds to. Each exists because skipping it
shipped a real bug here.

- **Mutation-test every new test.** Reintroduce the bug it covers, confirm the
  test fails, revert. A test that passes either way documents nothing — this
  has caught vacuous tests three times, including one whose code comment
  claimed the wrong line was load-bearing.
- **Drive the real UI for UI work.** Playwright against a live `npm run dev`,
  390x844 at `deviceScaleFactor: 2`, real clicks. Static DOM dumps and unit
  tests both missed an Undo toast that was visible but untappable, and a
  canvas rendering at double its CSS size on retina only.
- **Check arithmetic, not change.** Assert the exact expected cent value.
  "The number moved" passes while the number is wrong.

Some things only a real iPhone can settle: native gesture recognizers, iOS
Safari's download path, install behaviour, keyboard avoidance. When work ends
with one of those open, write it into a device-check doc rather than claiming
it works.

## Domain rules the code depends on

- **Money is integer cents** (`domain/money.ts`), formatted only at the edge.
- **`getSignedAmountCents(tx, perspective)` is the only sign convention.** The
  legacy app had four divergent copies. Do not add a fifth.
- **Dates are UTC-anchored `YYYY-MM-DD` strings.** `domain/dates.ts` only;
  tests run under both `Asia/Dhaka` and `America/Los_Angeles`.
- **Accounts and categories are derived from transactions**, never separately
  persisted. The one exception is account type (cash/investment), which has no
  transaction-derivable signal.
- **A category is its name alone.** `categoryType` is a property of each
  transaction — one category legitimately carries several types.
- **`non_expense` / `non_income`** mean money moved but the amount is not
  wholly mine (a loan out, a shared bill, a refund). These are not spending.
  On these rows and on `receivable`/`payable`, `merchant` names a *person*,
  and feeds the Lent out / I owe screens.

## Traps

- **Two npm roots.** `trackz-app/` holds the app and its tests; the repo root
  holds `api/` and its typecheck. Both must pass.
- **Never connect Drive from `npm run dev`.** `appDataFolder` is scoped per
  (app, Google account), not per origin, so dev shares the real sync file with
  production while having separate localStorage. This produced a 4368-row
  triplication incident. Device B is the production URL.
- **`dummyData/` is real financial data and gitignored** in a public repo. Nine
  test files read it and skip gracefully without it. There is no CI, so a
  fixture-less run is green while silently skipping those assertions — and
  `storage/csv.test.ts:97` guards with a bare `return` rather than
  `describe.skipIf`, so it reports as a pass and is invisible even in the
  skip tally.
- **Hand-edited CSVs go through `.claude/skills/trackz-csv-clean/SKILL.md`**
  before import. The user edits data in plain CSV; hand-added rows drift
  (e.g. `DD.MM.YYYY` dates the parser rejects, bank-statement merchant
  spellings). Its per-dataset alias memory lives in gitignored `dummyData/`.
- **`VITE_GOOGLE_CLIENT_ID` is inlined at build time.** Setting it after a
  deploy does nothing until the next build. This failure mode has recurred
  twice.
- **The pre-commit hook reads `public/js/version.js`** and exits 1 without it,
  blocking every commit. Deleting `public/` means updating
  `.githooks/pre-commit` in the same change. (`scripts/setup-git-hooks.sh`
  only sets `core.hooksPath` and needs no change — the doc claimed otherwise
  until it was checked.)

## Conventions

- **Pure logic splits from plumbing.** The pure half is tested and holds no DOM
  or repository access (`exportImport.ts`, `merchantMerge.ts`,
  `categoryRename.ts`); the thin half wires it up and is untested
  (`SettingsScreen.tsx`). Keep orchestration that touches both the repository
  and the sync coordinator in its own module.
- **No gradients.** Flat dark cards, 1px `--border-subtle` edge, color reserved
  for meaning rather than decoration. `--gradient-accent` is a dead token.
- **Reuse the primitives**: `Sheet`, `Toast`, `TypeBreakdown`, `Sparkline`.
  Toast's z-index must out-rank Sheet's so an Undo stays tappable over an open
  sheet.
- **Measure bytes before adding a dependency.** uPlot cost a measured 22.3KB
  gzipped for a 6-point sparkline because it does not tree-shake. That cost is
  already paid and shipped — it is an argument against the NEXT dependency, not
  against using uPlot further. The production bundle is the number to watch
  (`gzip -c dist/assets/*.js | wc -c`); report it after each change.
- **Comment the load-bearing line**, including why a plausible alternative is
  wrong. A rule that never fires implies a decision the code does not make —
  delete it and pin the real behaviour with a test instead.
