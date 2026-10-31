/**
 * Single place that mints transaction ids. Previously `storage/csv.ts` had
 * its own private module-local counter (reset on every page load) and
 * quick-entry (Phase 8) needed the same thing — rather than duplicate that
 * logic a second time, both call through here.
 *
 * Prefers crypto.randomUUID() (available in all target browsers/Node 19+).
 * Falls back to a counter+random string only if it's somehow missing, so
 * this never throws in an older WebView.
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
