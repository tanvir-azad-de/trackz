import { useSyncStatus } from "@/storage/useSyncStatus";
import { syncNow } from "@/sync/coordinator";
import type { SyncStatus } from "@/sync/coordinator";
import "./SyncStatusIndicator.css";

/**
 * Phase 15b: Displays sync status in the app header.
 *
 * Shows:
 * - "Synced" (green) when local and Drive are in sync
 * - "Syncing…" (yellow) while an upload is pending or in flight
 * - "Offline" (gray) when no network connection
 * - "Conflict" (red) when two devices made conflicting changes
 * - "Not syncing" (gray) when no Google account is connected
 * - "Error" (red) when sync failed after retries
 *
 * The retry button appears only for states a retry could actually fix.
 * "Not syncing" is not one of them — the fix there is to connect an
 * account in Settings, so offering a retry button would just produce a
 * second failure. That's also why it carries no error tooltip: having no
 * account connected is a valid way to run the app, not a fault.
 */
export function SyncStatusIndicator() {
  const syncState = useSyncStatus();
  const canManualSync =
    syncState.status === "offline" ||
    syncState.status === "conflict" ||
    syncState.status === "error";

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
    case "signed-out":
      return "Not syncing";
    case "error":
      return "Error";
  }
}
