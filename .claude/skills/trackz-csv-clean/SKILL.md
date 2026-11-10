---
name: trackz-csv-clean
description: Clean a hand-edited trackz transactions CSV so the app accepts it on import and it matches the conventions already in the data. Use when the user has edited a trackz export (or written rows) in a spreadsheet/text editor and wants it fixed, normalized, or prepared for Settings → Import.
---

# Cleaning a hand-edited trackz CSV

The user edits trackz data as plain CSV. Hand edits drift in two ways: from
what `parseTransactionsCsv` accepts (hard failures), and from the
conventions the existing rows follow (soft drift that fragments merchants
and categories). This skill fixes both without moving a cent that the user
didn't approve.

**Public repo rule.** This file is committed and the repo is public. Never
write real data into it, or into anything else outside `dummyData/`:
no names, amounts, or merchant aliases. Every per-dataset artifact lives in
gitignored `dummyData/`.

## Inputs and outputs

- Input: `dummyData/<name>.csv`. **Never modify it.** It is the rollback.
- Output: `dummyData/<name>.clean.csv` and `dummyData/<name>.changes.md`
  (every changed cell: line, id, field, old → new, reason).
- Memory: `dummyData/cleaning/merchant-aliases.csv`
  (`variant,canonical,decided_on`). Read it first, append approved
  decisions at the end, and never re-ask a decision already in it.
  `dummyData/cleaning/category-rules.csv`
  (`match,value,new_category,extra,decided_on`) holds approved
  merchant → category rules, category folds, and structural rules (e.g.
  "notes → merchant"). Re-apply these without asking, and still log
  every cell they change.
- One run, one log. When a later pass adds rules, re-run everything from
  the original input and overwrite the derived outputs, so a single
  `updatedAt` stamp and a single complete log cover the result.

Read the input with a real CSV parser (Python `csv`, run with `python3 -I`),
never with `split(",")`. Merchants and notes contain commas.

## Ground truth in the code

Check these before trusting this document. If the code has changed, the code wins, and this file gets updated in the same change.

- `trackz-app/src/storage/csv.ts`: accepted headers (V1 10 columns, V2
  `+id,createdAt`, V3 `+updatedAt,deletedAt`), every validation rule, and
  `quoteCsvField` (the quoting rules).
- `trackz-app/src/domain/transaction.ts`: `CATEGORY_TYPES`, the meaning of
  `non_expense`/`non_income`, and why a category can carry several types.
- `trackz-app/src/domain/merchant.ts`: `normalizeMerchant` (the merge key).
- `trackz-app/src/sync/merge.ts`: last-writer-wins on `updatedAt`, and a tie
  goes to local.
- `trackz-app/src/features/settings/commitImport.ts`: import is a full
  replace that also overwrites Drive.

## Phase A: Profile (measure before changing anything)

Report these as a short list:

1. Header version, row count, and how many rows have an `id`. Rows without an
   id are the hand-added ones, and most problems live there.
2. Date formats found (anything other than `YYYY-MM-DD` is a hard failure).
3. `cashflow × category_type` pairs. The expected pairs are `out/expense`,
   `out/non_expense`, `in/income`, `in/non_income`, `none/transfer`, and
   `in|out/receivable`, `in|out/payable`. Report anything else.
4. Currency values (must all be `EUR`) and amount format (positive, dot
   decimal, ≤2 dp).
5. Transfer integrity: `cashflow=none` ⇔ `destinationAccount` set, and no
   self-transfers.
6. Leading/trailing/double whitespace in any field.
7. Merchant groups: same `normalizeMerchant` key, plus near-misses that key
   misses (shared prefix, a legal suffix like GmbH/KG/Fil./branch number/
   city, case-only differences, likely typos).
8. Truncated merchants (`...`, `…`).
9. Merchant → category conflicts: a merchant whose row category differs
   from what that merchant almost always has in history.
10. Category ↔ type oddities, e.g. category `Transfer` on a non-transfer
    row. **Do not "fix" a category for carrying several types.** That is
    legitimate (see transaction.ts).
11. New accounts not seen in history (often a typo of an existing one).
12. **Names stored in notes**: rows with an empty or placeholder merchant
    (`Other`, a category name) whose notes hold the real shop or person.
    This was the biggest single source of empty merchants.
13. **Notes that echo the merchant**: equal to it ignoring case, or
    bank-statement text for the same brand (`EDEKA MARKT <OWNER>` on
    `Edeka`). Notes with real detail are not echoes: contract numbers,
    mandate refs, date ranges, FX rates.
14. **Categories with ≤2 rows**: candidates to fold into a neighbour.
15. **Category vs what the shop is**: tobacco shops, places to eat, or
    drugstores filed under a generic category such as Groceries.
16. **ALL-CAPS or unreadable merchants**: bank strings that were never
    tidied.
17. After any merchant move, **re-run the grouping in item 7** on the result.
    Moving names out of notes creates new spelling variants.

## Phase B: Mechanical fixes (apply, but log every one)

These have exactly one correct answer:

- **Dates** `DD.MM.YYYY` / `D.M.YYYY` → `YYYY-MM-DD`, then check that the result is a
  real calendar date (same rule as `isValidISODate`). A slash format
  (`03/10/2026`) is ambiguous between DMY and MDY, so move it to Phase C.
- **Whitespace**: trim every field and collapse internal runs of spaces.
- **Amounts**: `12,50` → `12.50`, strip `€` and thousands separators. The result
  must be > 0 with ≤ 2 decimals. Drop the minus sign from a negative amount
  only after Phase C confirms which cashflow it means; never flip a
  sign silently.
- **Header**: write the V3 header exactly.

## Phase C: Proposed changes (nothing is applied without approval)

Build one change table and show it to the user, grouped so it can be
approved group by group. Each line includes the evidence: how many history
rows support the proposal.

- **Merchant canonical = short brand.** Use the spelling the history uses
  most (`Edeka`, `Rewe`, `Lidl`), not bank-statement text
  (`EDEKA Markt <owner>`, `REWE <branch> GmbH`). Drop legal forms,
  branch numbers, and city suffixes. This applies to the **whole file**,
  old rows included.
- **Truncated merchants**: propose a completion only when history gives a
  single obvious candidate. Otherwise ask.
- **Category from merchant history**: propose this only when history is
  near-unanimous for that merchant. Show the count.
- **Category/type mismatches** found in Phase A.
- **Counterparty rows are separate.** On `non_expense`, `non_income`,
  `receivable`, and `payable` rows, `merchant` is a **person**, and it feeds
  the Lent out / I owe screens. Never fold a person into a shop alias. List
  any counterparty change in its own group, because merging two
  spellings moves money between people in a view the user relies on.
- **Structural fixes from items 12–16**: move a name from notes into
  merchant (then clear the note, unless it carries extra detail), fold tiny
  categories, recategorize by what the shop is, apply Title Case, or use
  `Unknown`. Follow the target category's own convention. Example: if a
  category's merchant is the product and the shop goes in notes, keep
  that. Folding or recategorizing must keep `category_type`, so no money
  moves between types.
- **Not reported**: exact content duplicates. The user decided these are
  genuine (repeated refunds, repeated transfers). Do not flag or remove them.

After approval, append every merchant decision to
`dummyData/cleaning/merchant-aliases.csv`.

## Phase D: Apply and write

- **Rows with an id** keep `id` and `createdAt`. **If any field changed, set
  `updatedAt` to the cleaning run's timestamp** (one ISO value for the
  whole run). This is load-bearing. `sync/merge.ts` breaks `updatedAt`
  ties in favour of local, so a second device still holding the old row
  with the old `updatedAt` would push the old content back. Unchanged
  rows keep their `updatedAt` byte-for-byte.
- **Rows without an id** keep `id`, `createdAt`, and `updatedAt` blank. The
  importer mints a content-derived id (`domain/id.ts`) and midnight
  timestamps. Don't hand-mint ids: a hand-minted id would not match what
  another import of the same content produces.
- `deletedAt`: preserve it as-is.
- Quote fields with `quoteCsvField`'s rule: wrap in `"` when the field
  contains `,` `"` CR or LF, and double any inner `"`. Use CRLF line endings
  with a trailing CRLF, matching `serializeTransactionsCsv`.
- Keep the input's row order.

## Phase E: Verify (assert exact values, not "it changed")

All five checks must hold before reporting done. Report the actual numbers.

1. **The app's own parser accepts it.** Write a throwaway test at
   `trackz-app/src/__clean_verify__.test.ts` that reads the output path from
   an env var, calls `parseTransactionsCsv`, and asserts `errors` is `[]`
   and `transactions.length` equals the input row count. Run it with
   `CLEAN_CSV=<abs path> npx vitest run src/__clean_verify__.test.ts` from
   `trackz-app/`, then **delete the file**. It must never be committed.
2. **Row count is preserved** (input = output).
3. **The id set is preserved**: identical set of non-empty ids.
4. **Money hasn't moved**: the sum of amount in integer cents per
   `(account, cashflow)` and per `category_type` is identical before and
   after. If an approved change does move money (e.g. a category_type fix),
   state the exact cent delta per bucket and confirm it equals the approved
   change.
5. **The log is complete**: a cell-by-cell diff of input vs output matches
   `changes.md` exactly, with no unlogged change and no logged change missing.

## Hand-off to the user (say this every time)

- Import goes through Settings → Import on the **production URL**. Never
  connect Drive from `npm run dev`: dev shares the real Drive file.
- Import **replaces everything and overwrites Drive**. If any rows were
  entered in the app after this CSV was exported, they will be lost.
  Re-export first, and re-run this skill on the fresh export.
- After import, spot-check the totals on Home against the Phase E sums.
  This is the user's step; don't claim it is done.
