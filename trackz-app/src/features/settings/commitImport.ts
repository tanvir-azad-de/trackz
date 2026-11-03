import { replaceAllTransactions } from "@/storage/repository";
import { getAuthState } from "@/sync/auth";
import { overwriteRemoteWithLocal } from "@/sync/coordinator";
import type { Transaction } from "@/domain/transaction";

/**
 * Committing a CSV import, including its consequences for Drive.
 *
 * WHY THIS IS NOT JUST replaceAllTransactions(). The import UI promises
 * "This will permanently replace your current N transactions" and labels
 * its button "Replace anyway". With Drive connected, a plain
 * replaceAllTransactions() made that promise false:
 *
 *   1. The write notified the sync coordinator, arming the 5s debounce.
 *   2. The debounce ran performSync, which merges — and sync/merge.ts is a
 *      UNION BY ID (see its step 2: every local id and every remote id
 *      survives).
 *   3. So every row that was on Drive but absent from the imported file
 *      came straight back, about five seconds after the import.
 *
 * Importing a 1,000-row file over 1,456 synced rows therefore ended up
 * back at 1,456. Verified as a real failure before this module existed
 * (see the regression tests in sync/__tests__/coordinator-sync.test.ts).
 *
 * The blast radius was limited to files with DIFFERENT content, because
 * CSV import derives ids from row content (domain/id.ts's
 * contentDerivedTransactionId): re-importing the same file, or an export
 * of this app's own V3 format, produces ids that already match and so
 * converges correctly. A smaller or edited file is the broken case. That
 * makes this a broken PROMISE rather than data corruption — which is why
 * the fix is about honesty, not recovery.
 *
 * WHY OVERWRITE RATHER THAN RECONCILE. The alternative was to express the
 * dropped rows as tombstones so they propagate through the normal
 * last-writer-wins path. Rejected: it does not actually close the hole. A
 * device importing into an EMPTY store cannot tombstone rows it has never
 * seen, so sync would still restore them, and overwriteRemoteWithLocal()
 * would still be needed for that case. Two mechanisms where one suffices,
 * on the one code path whose failure mode is losing real financial data.
 *
 * Union-by-id is deliberately left intact everywhere else: it is what
 * makes connecting a NEW device safe (an empty store can only ever pull
 * data down, never delete Drive's copy). This module is the explicit
 * exception, invoked only behind the import confirm.
 */

export type CommitImportResult =
  /** Signed out — local only, by design. Nothing to tell Drive. */
  | { kind: "local-only" }
  /** Local written and Drive overwritten to match. */
  | { kind: "synced" }
  /**
   * Local written, but Drive still holds the OLD data and no retry is
   * scheduled (the local write was silent, so nothing armed a debounce).
   *
   * This state must be surfaced, not swallowed. Left unreported it is
   * latent: the next ordinary edit arms a debounce, that sync merges
   * against a Drive copy still holding the dropped rows, and the union
   * brings them back — the very bug this module exists to fix, delayed by
   * however long until the user's next edit. The caller names the fix
   * ("Replace Drive copy with this device" in Sync settings).
   */
  | { kind: "local-but-drive-failed"; message: string };

/**
 * Replace all local transactions with an imported set, then make Drive
 * match.
 *
 * ORDER IS LOAD-BEARING: the local write must land first, because
 * overwriteRemoteWithLocal() reads the repository itself
 * (getTransactionsIncludingDeleted) rather than taking an argument.
 * Uploading before the write would push the pre-import data.
 *
 * The local write is `silent` as defence in depth, not as the fix. Mutation
 * testing showed the bug does NOT return when `silent` is removed: the
 * overwrite below cancels any pending debounce as its first synchronous act
 * (see coordinator.ts), so it wins regardless. `silent` is kept because it
 * is the honest description of this write — a sync-originated replace is not
 * a local edit — and because it keeps the fix independent of that
 * cancellation remaining first in overwriteRemoteWithLocal's body. The
 * overwrite call is the load-bearing line; two tests fail without it.
 */
export async function commitImport(transactions: Transaction[]): Promise<CommitImportResult> {
  replaceAllTransactions(transactions, { silent: true });

  if (!getAuthState().isSignedIn) {
    return { kind: "local-only" };
  }

  try {
    await overwriteRemoteWithLocal();
    return { kind: "synced" };
  } catch (error) {
    return {
      kind: "local-but-drive-failed",
      message: error instanceof Error ? error.message : "Could not update Google Drive.",
    };
  }
}
