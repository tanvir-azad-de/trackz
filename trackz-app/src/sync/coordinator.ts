import type { SyncDocument } from "./document";
import type { Transaction } from "@/domain/transaction";
import { merge } from "./merge";
import { localToSync } from "./document";
import { getTransactionsIncludingDeleted, replaceAllTransactions, setSyncNotifier } from "@/storage/repository";
import {
  getAccountTypeEntries,
  mergeAccountTypes,
  type AccountTypeMap,
} from "@/storage/accountTypes";
import { deleteRemoteSyncFile, fetchFromDrive, readVersion, uploadToDrive } from "./drive";
import { getAuthState, subscribeToAuth } from "./auth";
import { categorizeSyncError } from "./errors";

/**
 * Phase 15b: Sync coordinator.
 *
 * Orchestrates:
 * - Debouncing uploads (~5s after last local change)
 * - Fetching from Drive before each merge
 * - Merging local + remote using Phase 15a's last-writer-wins
 * - Uploading merged result back to Drive
 * - Retrying with exponential backoff on network errors
 * - Reporting sync status to UI
 *
 * Sync flow for each upload cycle:
 * 1. Wait for debounce timer (5s after last local change detected)
 * 2. Fetch current state from Drive
 * 3. Merge local + remote using last-writer-wins
 * 4. If anything changed, upload to Drive
 * 5. Report status (synced/pending/offline/conflict) to UI
 * 6. Retry on failure with exponential backoff (1s → 2s → 4s → 8s, max 5 retries)
 */

/**
 * Sync status, as shown to the user.
 *
 * "signed-out" is deliberately distinct from "conflict": an earlier pass
 * reported missing auth AS a conflict, which told the user their devices
 * disagreed when in fact they had simply never connected Drive. The whole
 * point of this status set (per the Phase 15 spec's "honest status UI") is
 * that each value implies a different user action — connect an account,
 * resolve a clash, or wait for the network — so they cannot be conflated.
 */
export type SyncStatus =
  | "synced"
  | "pending"
  | "offline"
  | "conflict"
  | "signed-out"
  | "error";

export interface SyncState {
  status: SyncStatus;
  lastSyncTime: number | null; // timestamp of last successful sync
  lastError: string | null; // error message if status === "error"
  hasConflicts: boolean; // true if any transactions had different updatedAt
  conflictCount: number; // how many conflicts were resolved
}

let syncState: SyncState = {
  // Starts "signed-out", not "synced". Nothing has been synced at startup,
  // and the overwhelmingly common case on a fresh install is no Drive
  // account at all; claiming "Synced" would be the single most misleading
  // thing this indicator could say. initializeSync() corrects it once the
  // real auth state is known.
  status: "signed-out",
  lastSyncTime: null,
  lastError: null,
  hasConflicts: false,
  conflictCount: 0,
};

let stateListeners = new Set<(state: SyncState) => void>();

// Debounce timer for uploads
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY_MS = 5000;

// Retry state for failed syncs
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * How many times a single sync will re-merge because another device wrote
 * mid-flight. Low on purpose: three losses in a row means the other device
 * is writing continuously, and the right answer then is to report a
 * conflict and let the next debounce try, not to keep spinning on Drive.
 */
const MAX_CONVERGENCE_ROUNDS = 3;

// Device ID for this client (used in sync metadata)
// Persisted in localStorage so the same device keeps the same ID across sessions
function getDeviceId(): string {
  const DEVICE_ID_KEY = "trackz.sync.device-id";
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `device-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      try {
        localStorage.setItem(DEVICE_ID_KEY, id);
      } catch (error) {
        // localStorage might be full or unavailable in private browsing
        console.warn("Could not persist device ID:", error);
      }
    }
    return id;
  } catch (error) {
    // localStorage not available (Node.js tests)
    return `device-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

let deviceId = getDeviceId();

// No cached remote version is kept between syncs, deliberately. The
// version only means anything relative to the content fetched alongside
// it, so performSync reads it fresh each round; a value held from a
// previous sync would be a stale comparison basis, which is the failure
// mode the old `currentETag = ""` line had.

// Teardown for initializeSync's auth subscription, so repeat calls (and
// tests) don't accumulate listeners.
let unsubscribeFromAuth: (() => void) | null = null;

/**
 * Initialize the sync coordinator. Call once during app startup, after
 * restoreSession() has settled so the initial status reflects real auth.
 *
 * Subscribes to auth so that signing in or out immediately moves the
 * status indicator, rather than leaving it stale until the next write.
 * Signing in also kicks off a sync right away: a device that has been
 * offline for a week has changes waiting, and making the user tap a
 * button to discover that would defeat the point of syncing.
 */
export function initializeSync(): void {
  // Register with repository so every local write triggers sync debounce
  setSyncNotifier(markLocalChanged);

  // Idempotent: a second call must not stack a second auth subscription,
  // or one sign-in would kick off two concurrent performSync() runs racing
  // to upload the same revision.
  if (unsubscribeFromAuth) unsubscribeFromAuth();
  unsubscribeFromAuth = subscribeToAuth((auth) => {
    if (auth.isSignedIn) {
      if (syncState.status === "signed-out") {
        syncState.status = "pending";
        syncState.lastError = null;
        notifyListeners();
        performSync().catch((error) => {
          console.error("Sync after sign-in failed:", error);
        });
      }
      return;
    }

    // Signed out: cancel pending work so a queued upload can't fire with a
    // dead token and surface as a spurious error.
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryCount = 0;
    syncState.status = "signed-out";
    syncState.lastError = null;
    notifyListeners();
  });

  const signedIn = getAuthState().isSignedIn;
  syncState.status = signedIn ? "pending" : "signed-out";
  notifyListeners();

  // Already signed in at startup — a restored session. Sync NOW rather than
  // waiting for the auth subscription above, which fires only on a CHANGE:
  // restoreSession() has already resolved by this point, so no change is
  // coming and the status would sit on "pending" ("syncing…") forever.
  //
  // Found during Phase 15c live verification, on the first reload of a
  // signed-in session. It was unreachable until then — sign-in had never
  // worked end to end, so no session had ever survived a reload to expose
  // it.
  if (signedIn) {
    performSync().catch((error) => {
      console.error("Sync on startup failed:", error);
    });
  }
}

/**
 * Get the current sync state.
 */
export function getSyncState(): SyncState {
  return { ...syncState };
}

/**
 * Mark that a local change occurred (add/update/delete). Triggers a debounced
 * sync attempt. Called by repository after every write.
 */
export function markLocalChanged(): void {
  // No account connected: this write is local-only and that's a legitimate
  // way to use the app. Stay "signed-out" rather than showing "Syncing…"
  // for a sync that cannot happen, and don't arm a timer that would only
  // wake up to fail.
  if (!getAuthState().isSignedIn) {
    return;
  }

  // Clear any pending retry timer (will reset with new debounce)
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryCount = 0;

  // Set status to pending
  syncState.status = "pending";
  notifyListeners();

  // Reset debounce timer
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    performSync().catch((error) => {
      console.error("Sync failed:", error);
    });
  }, DEBOUNCE_DELAY_MS);
}

/**
 * Manually trigger a sync (e.g., user taps a "sync now" button).
 * Bypasses debounce.
 */
export async function syncNow(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryCount = 0;

  await performSync();
}

/**
 * Overwrite the Drive copy with this device's data, skipping the merge
 * entirely.
 *
 * THE ONLY OPERATION IN THIS MODULE THAT CAN MAKE DRIVE SMALLER. Normal
 * sync is a union by id: merge.ts keeps every id present on either side,
 * so a remote document holding junk can never shrink, and reconnecting
 * re-merges it into whatever the device has just rebuilt. That is correct
 * for ordinary syncing — it is what stops one device's stale view from
 * deleting another's work — and useless as a recovery path.
 *
 * The incident that forced this: a V1 CSV import minted random ids, so
 * importing one 1456-row backup three times produced 4368 unrelated
 * transactions on Drive. Rebuilding the ledger locally could not fix it,
 * because connecting Drive merged the 4368 straight back in. Deleting the
 * remote file and then calling syncNow() was not enough either: the
 * debounced merge could win the race and re-upload the union before the
 * fresh upload landed.
 *
 * So this does not delete-then-sync, and it does not consult the remote
 * document at all. It cancels pending work, then uploads local state as
 * revision 0 — the only sequence whose outcome does not depend on timing.
 *
 * Destructive by design: other devices are overwritten on their next sync.
 * Callers must confirm with the user, and CSV export is the only undo.
 */
export async function overwriteRemoteWithLocal(): Promise<void> {
  // Cancel queued work first. A debounce or retry firing mid-upload would
  // run a normal merge against the file we are replacing, reintroducing
  // exactly what this call exists to remove.
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryCount = 0;

  if (!getAuthState().isSignedIn) {
    throw new Error("Not signed in to Google");
  }

  syncState.status = "pending";
  syncState.lastError = null;
  notifyListeners();

  try {
    const local = getTransactionsIncludingDeleted();

    // Delete first, so the new document cannot inherit anything. Without
    // this, uploading over the existing file would replace its CONTENT but
    // leave any id we failed to account for in place — and more
    // importantly, a fresh file makes "did this work?" answerable by row
    // count alone.
    await deleteRemoteSyncFile();

    // Revision 0: this is a new history, not a continuation of the one
    // being discarded. Claiming a higher revision would imply the old
    // document was an ancestor of this one, which is the opposite of what
    // happened.
    await uploadToDrive(localToSync(local, 0, deviceId, getAccountTypeEntries()));

    syncState.status = "synced";
    syncState.lastSyncTime = Date.now();
    syncState.hasConflicts = false;
    syncState.conflictCount = 0;
    notifyListeners();
  } catch (error) {
    const syncError = categorizeSyncError(error);
    syncState.status = "error";
    syncState.lastError = syncError.message;
    notifyListeners();
    throw error;
  }
}

/**
 * Core sync operation: fetch from Drive, merge, upload if changed.
 *
 * CONVERGENCE, NOT ATOMICITY. Drive v3 gives us no compare-and-swap: it
 * removed `Files.etag` and `files.update` takes no precondition parameter,
 * so "upload only if nobody else has written" is not expressible. What it
 * does give us is `version`, a counter the server bumps on every change.
 * So we re-read `version` immediately before uploading, and if it moved
 * since the content we merged was fetched, we throw that merge away and
 * start over against the newer remote state rather than overwriting it.
 *
 * This narrows the race to the gap between the version check and the
 * upload; it does not close it. Bounded rounds, because two devices
 * writing continuously could otherwise restart each other forever —
 * better to report "conflict" and let the next debounce try again than to
 * spin. merge.ts's last-writer-wins is untouched: it decides WHICH record
 * wins, this decides whether we were merging against current data at all.
 */
async function performSync(): Promise<void> {
  const auth = getAuthState();

  // Check auth state
  if (!auth.isSignedIn) {
    syncState.status = "signed-out";
    syncState.lastError = null;
    notifyListeners();
    return;
  }

  // Check connectivity
  if (!navigator.onLine) {
    syncState.status = "offline";
    notifyListeners();
    scheduleRetry();
    return;
  }

  try {
    syncState.lastError = null;

    let settled = false;

    for (let round = 0; round < MAX_CONVERGENCE_ROUNDS; round++) {
      // 1. Note the remote version BEFORE fetching content, then fetch.
      //    This order is load-bearing. Reading the version afterwards would
      //    be actively unsafe: a write landing between the content fetch and
      //    the version read would leave us holding stale content stamped
      //    with the writer's NEW version, the pre-upload check below would
      //    see no change, and we would overwrite their write. Reading first
      //    can only cause a spurious restart, which is the harmless
      //    direction to be wrong in.
      const versionAtFetch = await readVersion();
      const remoteDoc = await fetchFromDrive(deviceId);

      // 2. Get local state
      const local = getTransactionsIncludingDeleted();

      // 3. Merge
      const mergeResult = remoteDoc
        ? merge(local, remoteDoc)
        : { merged: local, conflicts: [], shouldUpload: true };

      // Track conflicts for UI
      syncState.hasConflicts = mergeResult.conflicts.length > 0;
      syncState.conflictCount = mergeResult.conflicts.length;

      // 4. Apply merged result locally, unless the merge changed nothing.
      //    Skipping a no-op write matters because every write notifies UI
      //    subscribers, and re-rendering every screen on a 5-second timer
      //    that found no news is pure waste. `silent` keeps this write from
      //    looking like a local change and re-arming the debounce.
      if (mergeChangedLocal(local, mergeResult.merged)) {
        replaceAllTransactions(mergeResult.merged, { silent: true });
      }

      // Account types merge per account on their own timestamps, not as
      // part of the transaction merge: they are independent user decisions
      // and a whole-map overwrite would discard the other device's.
      mergeAccountTypes(remoteDoc?.accountTypes);
      const localAccountTypes = getAccountTypeEntries();

      // 5. Upload if local holds anything Drive does not. Checked for
      //    account types as well as transactions: a device where the user
      //    only reclassified an account has nothing new in `transactions`,
      //    and gating the upload on that alone would leave the
      //    classification stranded on one device forever.
      const needsUpload =
        mergeResult.shouldUpload || !sameAccountTypes(localAccountTypes, remoteDoc?.accountTypes);

      if (!needsUpload) {
        settled = true;
        break;
      }

      // Did anyone write while we were merging? If so this merge is stale:
      // uploading it would overwrite whatever they just wrote with a
      // document that never saw it.
      const versionBeforeUpload = await readVersion();
      if (versionBeforeUpload !== versionAtFetch) {
        continue;
      }

      const localRevision = (remoteDoc?.revision ?? -1) + 1;
      const docToUpload: SyncDocument = localToSync(
        mergeResult.merged,
        localRevision,
        deviceId,
        localAccountTypes,
      );

      // The returned version is deliberately discarded. Nothing reads it:
      // each round re-reads the version fresh (see above), and the Settings
      // readout asks Drive directly via readRemoteMetadata. Storing it here
      // would be write-only state that looks like a guarantee.
      await uploadToDrive(docToUpload);
      settled = true;
      break;
    }

    // Rounds exhausted: another device kept writing and our changes are
    // still only local. Saying "Synced" here would be the exact lie the
    // status set exists to prevent, so report the clash instead.
    if (!settled) {
      syncState.status = "conflict";
      syncState.lastError =
        "Another device kept changing data while syncing. Your changes are saved here and will sync shortly.";
      retryCount = 0;
      notifyListeners();
      return;
    }

    // 6. Mark as synced
    syncState.status = "synced";
    syncState.lastSyncTime = Date.now();
    retryCount = 0;
    notifyListeners();
  } catch (error) {
    console.error("Sync error:", error);

    // Use better error categorization
    const syncError = categorizeSyncError(error);
    syncState.lastError = syncError.message;

    // Categorize error for status
    switch (syncError.type) {
      case "conflict":
        syncState.status = "conflict";
        retryCount = 0; // Don't retry conflicts, let user resolve
        break;
      case "network":
        syncState.status = "offline";
        break;
      case "auth":
        syncState.status = "signed-out";
        retryCount = 0; // Retrying can't fix this; the user must sign in.
        break;
      default:
        syncState.status = "error";
    }

    notifyListeners();

    // Schedule retry for transient errors (not auth or conflicts)
    if (syncError.recoverable && syncError.type !== "auth" && syncError.type !== "conflict") {
      scheduleRetry();
    }
  }
}

/**
 * Did the merge actually change what we hold locally?
 *
 * Compares by id and updatedAt rather than deep-equality, because those two
 * fields are exactly what merge.ts selects on: it never returns a record
 * that is a field-level blend of two versions, only one side or the other
 * whole. So a matching (id, updatedAt) pair in the same position means the
 * same record survived, and a full deep compare would cost more to reach
 * the same answer.
 *
 * Order matters and is stable: merge.ts emits remote-ordered records first,
 * then local-only ones, so an unchanged merge reproduces the same sequence.
 */
function mergeChangedLocal(before: Transaction[], after: Transaction[]): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (before[i]?.id !== after[i]?.id) return true;
    if (before[i]?.updatedAt !== after[i]?.updatedAt) return true;
  }
  return false;
}

/**
 * Would uploading change the account types Drive holds?
 *
 * Compares on (type, updatedAt) per account, because those are exactly
 * what mergeAccountTypes resolves on. An absent remote map is NOT equal to
 * an empty local one: absent means no device has ever uploaded types, so
 * local types — even none — still need to establish the field.
 */
function sameAccountTypes(local: AccountTypeMap, remote: AccountTypeMap | undefined): boolean {
  if (!remote) return Object.keys(local).length === 0;

  const localKeys = Object.keys(local);
  if (localKeys.length !== Object.keys(remote).length) return false;

  return localKeys.every(
    (key) =>
      local[key]?.type === remote[key]?.type &&
      local[key]?.updatedAt === remote[key]?.updatedAt,
  );
}

/**
 * Schedule a retry attempt with exponential backoff.
 */
function scheduleRetry(): void {
  if (retryCount >= MAX_RETRIES) {
    syncState.status = "error";
    syncState.lastError = "Sync failed after multiple retries";
    notifyListeners();
    return;
  }

  retryCount++;
  const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount - 1);

  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    performSync().catch((error) => {
      console.error("Retry sync failed:", error);
    });
  }, delayMs);
}

/**
 * Subscribe to sync state changes. UI uses this to react to sync updates.
 *
 * @param listener Called whenever sync state changes
 * @returns Unsubscribe function
 */
export function subscribeSyncState(listener: (state: SyncState) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function notifyListeners(): void {
  const state = { ...syncState };
  for (const listener of stateListeners) {
    listener(state);
  }
}

/**
 * Test-only: reset coordinator state. Clears all timers and state.
 */
export function resetCoordinatorForTesting(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  if (unsubscribeFromAuth) {
    unsubscribeFromAuth();
    unsubscribeFromAuth = null;
  }

  debounceTimer = null;
  retryTimer = null;
  retryCount = 0;

  syncState = {
    status: "signed-out",
    lastSyncTime: null,
    lastError: null,
    hasConflicts: false,
    conflictCount: 0,
  };

  stateListeners.clear();
}
