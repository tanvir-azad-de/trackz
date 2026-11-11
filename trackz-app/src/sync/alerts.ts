import type { SyncStatus } from "@/sync/coordinator";

/**
 * Which sync statuses deserve to interrupt the user, and what to call them.
 *
 * Pure so the decision is testable without a DOM — app.tsx keeps only the
 * setToast plumbing, matching the split used by exportImport.ts /
 * merchantMerge.ts / nameRename.ts against their screens.
 *
 * WHY THIS EXISTS AT ALL. Until the app header was removed (it
 * double-counted --safe-top on every screen, pushing content 118px down
 * for a 59px inset), a badge up there showed every status permanently, and
 * only "error" was toasted. Dropping the badge made "conflict" invisible:
 * unlike the transient states it schedules NO retry — coordinator.ts sets
 * retryCount = 0 and returns — so nothing would ever have mentioned it
 * again, and the user's changes would sit un-synced with the app claiming
 * nothing was wrong. That silence is the bug this guards against.
 *
 * The states left silent are left silent deliberately:
 *   - "pending" and "offline" resolve themselves (scheduleRetry), and a
 *     toast for a state that clears on its own is noise.
 *   - "signed-out" is a valid way to run the app, not a fault — the whole
 *     app works on localStorage alone.
 *   - "synced" is the happy path.
 * All six remain visible in Settings' Sync section, which is now the only
 * full readout.
 */
export interface SyncAlert {
  /** Prefix for the toast message, e.g. "Sync conflict". */
  label: string;
}

export function describeSyncAlert(status: SyncStatus, lastError: string | null): SyncAlert | null {
  // An alert with no message would render as a bare "Sync error:" with
  // nothing after the colon, so the message is part of the condition
  // rather than defaulted to a vague placeholder.
  if (lastError === null || lastError === "") return null;

  switch (status) {
    case "error":
      return { label: "Sync error" };
    case "conflict":
      return { label: "Sync conflict" };
    default:
      return null;
  }
}
