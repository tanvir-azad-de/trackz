import { useSyncStatus } from "@/storage/useSyncStatus";
import { syncNow } from "@/sync/coordinator";
import type { SyncStatus } from "@/sync/coordinator";
import "./SyncStatusIndicator.css";

/**
 * Phase 15b: Displays sync status in the app header.
 *
 * Shows:
 * - "Synced" (green) when local and Drive are in sync
 * - "Pending" (yellow) while upload is in progress (debounce timer running)
 * - "Offline" (gray) when no network connection
 * - "Conflict" (red) when two devices made conflicting changes
 * - "Error" (red) when sync failed after retries
 *
 * Tapping the status indicator shows a tooltip. Tapping "Sync Now" button
 * triggers an immediate sync (bypasses debounce).
 */
export function SyncStatusIndicator() {
  const syncState = useSyncStatus();
  const canManualSync = syncState.status !== "pending" && syncState.status !== "synced";

  const handleSyncNow = async () => {
    try {
      await syncNow();
    } catch (error) {
      console.error("Manual sync failed:", error);
    }
  };

  return (
    <div class="sync-status-indicator" data-status={syncState.status}>
      <div class="sync-status-dot" />
      <span class="sync-status-label">{formatStatus(syncState.status)}</span>
      {syncState.lastError && (
        <div class="sync-status-error-tooltip" title={syncState.lastError}>
          ℹ️
        </div>
      )}
      {canManualSync && (
        <button
          type="button"
          class="sync-status-button"
          onClick={handleSyncNow}
          title="Sync now"
          aria-label="Sync now"
        >
          ↻
        </button>
      )}
    </div>
  );
}

function formatStatus(status: SyncStatus): string {
  switch (status) {
    case "synced":
      return "Synced";
    case "pending":
      return "Syncing…";
    case "offline":
      return "Offline";
    case "conflict":
      return "Conflict";
    case "error":
      return "Error";
  }
}
