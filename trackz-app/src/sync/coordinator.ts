import type { SyncDocument } from "./document";
import { merge } from "./merge";
import { localToSync } from "./document";
import { getTransactionsIncludingDeleted, replaceAllTransactions, setSyncNotifier } from "@/storage/repository";
import { fetchFromDrive, uploadToDrive } from "./drive";
import { getAuthState } from "./auth";

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

export type SyncStatus = "synced" | "pending" | "offline" | "conflict" | "error";

export interface SyncState {
  status: SyncStatus;
  lastSyncTime: number | null; // timestamp of last successful sync
  lastError: string | null; // error message if status === "error"
  hasConflicts: boolean; // true if any transactions had different updatedAt
  conflictCount: number; // how many conflicts were resolved
}

let syncState: SyncState = {
  status: "synced",
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
let deviceId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Current remote state (for conflict detection and ETag)
let currentETag: string | null = null;

/**
 * Initialize the sync coordinator. Call once during app startup.
 */
export function initializeSync(): void {
  // Register with repository so every local write triggers sync debounce
  setSyncNotifier(markLocalChanged);
  // TODO: In Phase 15b+, optionally restore previous session's device ID from localStorage
  // to keep the same device identity across page reloads
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
    syncState.status = "conflict"; // Using "conflict" as the status when auth is needed
    syncState.lastError = "Not signed in to Google Drive";
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Sync error:", errorMessage);

    // Categorize error
    if (errorMessage.includes("conflict") || errorMessage.includes("412")) {
      syncState.status = "conflict";
      syncState.lastError = "Sync conflict detected. Another device has newer changes.";
      retryCount = 0; // Don't retry conflicts, let user resolve
    } else if (errorMessage.includes("network")) {
      syncState.status = "offline";
    } else {
      syncState.status = "error";
      syncState.lastError = errorMessage;
    }

    notifyListeners();

    // Schedule retry for transient errors
    if (syncState.status !== "conflict") {
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

  debounceTimer = null;
  retryTimer = null;
  retryCount = 0;
  currentETag = null;

  syncState = {
    status: "synced",
    lastSyncTime: null,
    lastError: null,
    hasConflicts: false,
    conflictCount: 0,
  };

  stateListeners.clear();
}
