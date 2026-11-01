import { useEffect, useState } from "preact/hooks";
import { getSyncState, subscribeSyncState, type SyncState } from "@/sync/coordinator";

/**
 * Phase 15b: Hook to subscribe to sync state changes.
 *
 * Preact analog of useEffect that subscribes to the coordinator's state
 * stream and re-renders whenever sync status changes. UI components use this
 * to display the current sync state.
 */
export function useSyncStatus(): SyncState {
  const [state, setState] = useState<SyncState>(getSyncState);

  useEffect(() => {
    const unsubscribe = subscribeSyncState(setState);
    return unsubscribe;
  }, []);

  return state;
}
