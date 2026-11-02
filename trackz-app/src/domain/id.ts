/**
 * Single place that mints transaction ids. Previously `storage/csv.ts` had
 * its own private module-local counter (reset on every page load) and
 * quick-entry (Phase 8) needed the same thing — rather than duplicate that
 * logic a second time, both call through here.
 *
 * TWO KINDS OF ID, for two genuinely different situations:
 * - newTransactionId() — random, for a row the user is creating now. There
 *   is nothing to derive from and nothing to reconcile with.
 * - contentDerivedTransactionId() — stable, for a row imported from a CSV
 *   with no id column. Must be reproducible across devices, or sync cannot
 *   tell a re-import from new data. See its comment for the live incident
 *   that forced this.
 *
 * Random ids prefer crypto.randomUUID() (available in all target
 * browsers/Node 19+), falling back to a counter+random string only if it's
 * somehow missing, so this never throws in an older WebView.
 */

let fallbackCounter = 0;

export function newTransactionId(): string {
  const cryptoObj: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return `txn_${cryptoObj.randomUUID()}`;
  }
  fallbackCounter += 1;
  return `txn_${fallbackCounter}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The stable fields of an imported row — everything a human would use to
 * decide "is this the same transaction?". Deliberately excludes createdAt
 * and updatedAt: V1 files have neither, so parseTransactionsCsv synthesises
 * them, and including a synthesised value would defeat the whole point.
 */
export interface TransactionIdentity {
  date: string;
  account: string;
  destinationAccount: string;
  cashflow: string;
  category: string;
  categoryType: string;
  merchant: string;
  amountCents: number;
  notes: string;
}

/**
 * Mint a CONTENT-DERIVED id for a row imported from a CSV that carries no
 * id column (V1/V2 files).
 *
 * WHY THIS EXISTS. Import used to call newTransactionId() for such rows, so
 * the same file imported twice produced two completely different id sets.
 * That is harmless in a single-device app and silently corrupting in a
 * syncing one: sync/merge.ts dedupes by id, so to it the two sets are
 * unrelated transactions that merely look alike. Observed live — importing
 * the same 1456-row backup on the dev origin and the production origin
 * (separate localStorage per origin) put 4368 transactions on Drive, three
 * copies of every row, each internally consistent and impossible for the
 * merge to collapse.
 *
 * With a content-derived id, the same CSV yields the same ids on every
 * device and origin, so a re-import converges instead of accumulating.
 *
 * THE OCCURRENCE INDEX is what keeps this honest. Two genuinely distinct
 * transactions can share every field above — two identical coffees on the
 * same day at the same shop is ordinary, not a data error. A pure content
 * hash would merge them and quietly lose one. So the caller passes how many
 * identical rows it has already seen in THIS file, and the Nth gets its own
 * id. Both rows survive, and a re-import of the same file reproduces the
 * same pairing because the order within a file is fixed.
 *
 * @param identity the row's stable fields
 * @param occurrence 0 for the first row with this identity in the file, 1
 *                   for the second, and so on
 */
export function contentDerivedTransactionId(
  identity: TransactionIdentity,
  occurrence: number,
): string {
  // Unit separator between fields: it cannot occur in CSV data, so no
  // combination of field values can collide by shifting the boundary
  // (e.g. merchant "a|b" vs merchant "a" + category "b").
  const material = [
    identity.date,
    identity.account,
    identity.destinationAccount,
    identity.cashflow,
    identity.category,
    identity.categoryType,
    identity.merchant,
    String(identity.amountCents),
    identity.notes,
    String(occurrence),
  ].join("\u001F");

  return `txn_c${hash64(material)}`;
}

/**
 * 64-bit FNV-1a, as two 32-bit halves in hex.
 *
 * Synchronous on purpose: crypto.subtle.digest is async, and threading a
 * promise through parseTransactionsCsv would make every caller async for a
 * non-cryptographic need. Nothing here is security-sensitive — these ids
 * are never trusted or authenticated, they only have to be stable and
 * well-spread.
 *
 * Two 32-bit halves rather than one: a single 32-bit space collides at
 * roughly 50% odds around 77k rows (birthday bound), which is a plausible
 * ledger size. 64 bits puts that far beyond any realistic use, and a
 * collision would merely merge two unrelated rows rather than corrupt
 * anything.
 */
function hash64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    // Second lane walks the string in reverse with a different prime, so
    // the halves are not simply correlated functions of each other.
    const mirrored = input.charCodeAt(input.length - 1 - i);
    h2 ^= mirrored;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }

  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
