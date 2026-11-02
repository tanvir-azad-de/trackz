import type { Transaction } from "@/domain/transaction";
import type { SyncDocument } from "./document";

/**
 * Merge result from comparing local state with a Drive snapshot.
 *
 * Phase 15a implements last-writer-wins (LWW) merge:
 * - Each transaction carries updatedAt (bumped on every create/edit/delete).
 * - When the same id exists in both local and Drive, the one with the
 *   later updatedAt wins (is kept); the older version is discarded.
 * - Tombstones are treated exactly like live records — they can win or lose
 *   a merge based on updatedAt, so a deletion can propagate or be undone.
 * - If both have the same updatedAt, local wins (device X's changes take
 *   precedence over X itself—better than random tie-breaking or user
 *   interruption when two devices are perfectly synchronized).
 *
 * Hazards (intentional trade-offs documented for Phase 15b+):
 * - Last-writer-wins means edits can be silent (if you and a colleague
 *   both change the merchant at exactly the same time, one silently wins).
 *   UI (Phase 15b) must surface conflicts to users when practical.
 * - Tombstones older than purgeOldTombstones' retention period (90 days)
 *   can resurrect rows if a device was offline longer. Not a Phase 15a issue
 *   (purge only runs locally), but sync coordinators must ensure tombstones
 *   propagate before local purge happens.
 */
export interface MergeResult {
  /**
   * Final merged list of transactions (live + tombstones, ready to write to
   * local storage via repository.replaceAllTransactions). Includes:
   * - All local transactions not touched by Drive (local id not in Drive).
   * - All Drive transactions not touched by local (Drive id not in local).
   * - For ids present in both, the version with later updatedAt (or local
   *   in case of a tie).
   */
  merged: Transaction[];

  /**
   * "conflict" iff local and Drive both have an id but with different
   * updatedAt values. In this case, the merge still proceeds (takes the
   * newer version), but Phase 15b's UI can flag it so a user can review.
   * Empty list if no conflicts occurred.
   *
   * Each conflict records which version won (will always be the newer
   * updatedAt, not random), so a user can understand what changed.
   */
  conflicts: Array<{
    id: string;
    local: Transaction;
    remote: Transaction; // from Drive
    winner: "local" | "remote"; // whichever has the later updatedAt
  }>;

  /**
   * Whether any TRANSACTIONS should be uploaded back to Drive. True if:
   * - Local has any id not in Drive, or
   * - Local's updatedAt for any id is newer than Drive's (rare outside
   *   conflicts, but can happen if merge happened before a local edit
   *   was uploaded).
   *
   * NOT the whole upload decision. coordinator.ts also uploads when only
   * the account-type map differs — a device where the user just
   * reclassified an account has nothing new here, and treating this flag
   * as the final word would strand that classification on one device.
   */
  shouldUpload: boolean;
}

/**
 * Last-writer-wins merge of local state with a remote SyncDocument from Drive.
 *
 * @param local All local transactions (live + tombstones from repository.getTransactionsIncludingDeleted).
 * @param remote SyncDocument from Drive (via document.getTransactionsFromSync).
 * @returns Merge result with merged list, conflicts found, and whether local should be re-uploaded.
 */
export function merge(local: Transaction[], remote: SyncDocument): MergeResult {
  const remoteTransactions = remote.transactions;

  // Build a map for fast lookup
  const localMap = new Map(local.map((t) => [t.id, t]));
  const remoteMap = new Map(remoteTransactions.map((t) => [t.id, t]));

  const merged: Transaction[] = [];
  const conflicts: MergeResult["conflicts"] = [];
  let shouldUpload = false;

  // 1. Start with all remote transactions, applying LWW logic
  for (const remoteTransaction of remoteTransactions) {
    const localTransaction = localMap.get(remoteTransaction.id);

    if (!localTransaction) {
      // This transaction only exists in Drive — add it locally
      merged.push(remoteTransaction);
    } else {
      // Both have this id — compare updatedAt
      const localTime = new Date(localTransaction.updatedAt).getTime();
      const remoteTime = new Date(remoteTransaction.updatedAt).getTime();

      if (localTime > remoteTime) {
        // Local is newer — keep local, will need to upload
        merged.push(localTransaction);
        shouldUpload = true;
      } else if (remoteTime > localTime) {
        // Remote is newer — use remote
        merged.push(remoteTransaction);
        conflicts.push({
          id: remoteTransaction.id,
          local: localTransaction,
          remote: remoteTransaction,
          winner: "remote",
        });
      } else {
        // Same updatedAt — local wins (tie-breaker)
        merged.push(localTransaction);
        // No conflict here because they have the same updatedAt, but we still
        // might record if they differ in other fields (not doing that in Phase 15a,
        // but future phases could). For now, same updatedAt = no record.
      }
    }
  }

  // 2. Add any local transactions not in Drive (will trigger upload)
  for (const localTransaction of local) {
    if (!remoteMap.has(localTransaction.id)) {
      merged.push(localTransaction);
      shouldUpload = true;
    }
  }

  return {
    merged,
    conflicts,
    shouldUpload,
  };
}

/**
 * Detect whether merging would result in data loss (a rare but possible hazard
 * if sync happens at exactly the wrong moment, or if the network drops during
 * an upload). Used by Phase 15b's UI to warn before accepting a merge.
 *
 * Returns true if any local transaction with a newer updatedAt than remote
 * would be overwritten by a stale version from Drive. This should only happen
 * if:
 * 1. Local was edited after sync started downloading Drive's snapshot.
 * 2. The upload of that local edit hasn't finished yet.
 *
 * In a well-coordinated sync (Phase 15b), this should never happen; if it
 * does, it means the app made a sync request before a prior edit finished
 * uploading (a logic error, not a Phase 15a bug).
 */
export function hasDataLoss(local: Transaction[], remote: SyncDocument): boolean {
  const remoteTransactions = remote.transactions;
  const remoteMap = new Map(remoteTransactions.map((t) => [t.id, t]));

  for (const localTransaction of local) {
    const remoteTransaction = remoteMap.get(localTransaction.id);
    if (remoteTransaction) {
      const localTime = new Date(localTransaction.updatedAt).getTime();
      const remoteTime = new Date(remoteTransaction.updatedAt).getTime();
      if (localTime > remoteTime) {
        // Local is newer, but remote is what Drive has. If we blindly accept
        // remote, we'd lose this edit. This is a hazard Phase 15b's UI must guard.
        return true;
      }
    }
  }

  return false;
}
