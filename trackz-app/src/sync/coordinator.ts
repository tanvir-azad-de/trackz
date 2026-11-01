import type { SyncDocument } from "./document";
import { merge } from "./merge";
import { localToSync } from "./document";
import { getTransactionsIncludingDeleted, replaceAllTransactions, setSyncNotifier } from "@/storage/repository";
import { fetchFromDrive, uploadToDrive } from "./drive";
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

// Current remote state (for conflict detection and ETag)
let currentETag: string | null = null;

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

  syncState.status = getAuthState().isSignedIn ? "pending" : "signed-out";
  notifyListeners();
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
 * Core sync operation: fetch from Drive, merge, upload if changed.
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

    // 1. Fetch from Drive
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

    // 4. Apply merged result locally
    replaceAllTransactions(mergeResult.merged);

    // 5. Upload if needed
    if (mergeResult.shouldUpload) {
      const localRevision = (remoteDoc?.revision ?? -1) + 1;
      const docToUpload: SyncDocument = localToSync(
        mergeResult.merged,
        localRevision,
        deviceId,
      );

      await uploadToDrive(docToUpload, currentETag);
      currentETag = ""; // In a real app, capture the ETag from the response
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
  currentETag = null;

  syncState = {
    status: "signed-out",
    lastSyncTime: null,
    lastError: null,
    hasConflicts: false,
    conflictCount: 0,
  };

  stateListeners.clear();
}
