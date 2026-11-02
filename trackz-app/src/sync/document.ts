import type { Transaction } from "@/domain/transaction";
import type { AccountTypeMap } from "@/storage/accountTypes";

/**
 * Synced payload shape — the document stored on Google Drive.
 *
 * sync/drive.ts uploads this and reads it back; this type declares what
 * persists, so sync/merge.ts can merge it with local state.
 *
 * Constraints:
 * - All transactions included, live + tombstones: merge.ts needs to see
 *   every record (live or deleted) to detect conflicts.
 * - revision: incremented on every successful upload. Useful for
 *   debugging and audit, but NOT the concurrency mechanism — Drive's own
 *   server-side `version` counter is (see coordinator.ts's performSync).
 *   A revision carried inside the document can only be read by first
 *   downloading the document, which is too late to protect the write.
 * - device: which device last uploaded, for debugging and for
 *   distinguishing multiple offline clients in conflict scenarios (not
 *   needed by last-writer-wins, but useful for audit).
 */
export interface SyncDocument {
  revision: number; // 0, 1, 2, ... incremented on each upload
  device: string; // e.g. "user-device-abc123-iphone"
  transactions: Transaction[]; // all records, live + tombstones
  /**
   * Account cash/investment classifications, with per-account timestamps.
   *
   * OPTIONAL on purpose: documents written before this field existed have
   * to keep parsing, and absent must mean "this writer had nothing to say
   * about account types" — not "this writer says there are none". Treating
   * absent as an empty map that then merged would let an older device wipe
   * a newer device's classifications.
   *
   * Syncing this is not cosmetic. Without it, two devices holding
   * byte-identical transactions display different "Liquid" headline
   * figures, because the classification decides what counts as spendable
   * cash (see storage/accountTypes.ts).
   */
  accountTypes?: AccountTypeMap;
}

/**
 * Convert local storage into a SyncDocument ready to upload to Drive.
 * Called just before an upload so sync/merge.ts has what to upload.
 */
export function localToSync(
  transactions: Transaction[],
  revision: number,
  deviceId: string,
  accountTypes?: AccountTypeMap,
): SyncDocument {
  return {
    revision,
    device: deviceId,
    transactions: [...transactions], // shallow copy so caller can't mutate
    // Omit the key entirely when there is nothing to say, rather than
    // writing an empty object — see the field's comment for why absent and
    // empty must stay distinguishable.
    ...(accountTypes && Object.keys(accountTypes).length > 0 ? { accountTypes } : {}),
  };
}

/**
 * Extract the transaction list from a SyncDocument fetched from Drive.
 * Sync/merge.ts uses this to compare against local state.
 */
export function getTransactionsFromSync(doc: SyncDocument): Transaction[] {
  return doc.transactions;
}

/**
 * Compare two SyncDocuments by revision to determine which is newer.
 * Returns:
 *   - negative: left is older
 *   - 0: same revision (tie, will use updatedAt field for merge resolution)
 *   - positive: left is newer
 */
export function compareRevisions(left: SyncDocument, right: SyncDocument): number {
  return left.revision - right.revision;
}
