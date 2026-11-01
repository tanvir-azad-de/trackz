import type { Transaction } from "@/domain/transaction";

/**
 * Synced payload shape — the immutable document stored on Google Drive.
 *
 * Phase 15b (not yet built) will POST/PUT this to Drive and GET it back,
 * along with an ETag for conflict detection. This type declares what
 * persists so sync/merge.ts can merge it with the local state.
 *
 * Constraints:
 * - All transactions included, live + tombstones: merge.ts needs to see
 *   every record (live or deleted) to detect conflicts.
 * - revision: incremented on every successful upload, so each device
 *   can know if its local state is newer or older than Drive.
 * - device-id: which device last uploaded this revision, for debugging
 *   and distinguishing multiple offline clients in conflict scenarios
 *   (Phase 15b: not needed for last-writer-wins, but useful for audit).
 */
export interface SyncDocument {
  revision: number; // 0, 1, 2, ... incremented on each upload
  device: string; // e.g. "user-device-abc123-iphone"
  transactions: Transaction[]; // all records, live + tombstones
}

/**
 * Convert local storage into a SyncDocument ready to upload to Drive.
 * Called just before a PUT/POST so sync/merge.ts has what to upload.
 */
export function localToSync(
  transactions: Transaction[],
  revision: number,
  deviceId: string,
): SyncDocument {
  return {
    revision,
    device: deviceId,
    transactions: [...transactions], // shallow copy so caller can't mutate
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
