/**
 * Sync error categorization for better user messages.
 * Helps distinguish between auth issues, network problems, and Drive API errors.
 *
 * Categorises on MESSAGE TEXT, which is fragile by nature: rewording a
 * throw site silently reclassifies its error. It survives here because the
 * throw sites are all in sync/, and the categories drive real behavioural
 * differences (retry vs don't, sign-out vs wait). If this grows further,
 * the errors should carry a type field instead of being re-sniffed.
 */

export type SyncErrorType = "auth" | "network" | "conflict" | "drive" | "unknown";

export interface SyncError {
  type: SyncErrorType;
  message: string;
  recoverable: boolean; // true if user action or retry can fix it
}

/**
 * Categorize an error and provide user-friendly messaging.
 */
export function categorizeSyncError(error: unknown): SyncError {
  const errorStr = error instanceof Error ? error.message : String(error);

  // Auth errors
  if (errorStr.includes("Not signed in") || errorStr.includes("GOOGLE_CLIENT_ID")) {
    return {
      type: "auth",
      message: "Please sign in to Google to enable syncing.",
      recoverable: true,
    };
  }

  // A dead grant: the refresh token was revoked or has expired, so no
  // amount of retrying produces a working token. Checked before the
  // generic "token" rule below so the message can name the one action that
  // actually fixes it. Without this branch, a revoked grant burned five
  // retries and then surfaced as a bare "Sync failed after multiple
  // retries" — true, but it tells the user nothing to do.
  if (
    errorStr.includes("invalid_grant") ||
    errorStr.includes("reconnect Google Drive") ||
    errorStr.includes("could not be renewed")
  ) {
    return {
      type: "auth",
      message: "Google Drive access has expired. Reconnect Drive in Settings to resume syncing.",
      recoverable: true,
    };
  }

  if (errorStr.includes("token") || errorStr.includes("Token refresh")) {
    return {
      type: "auth",
      message: "Authentication failed. Please sign in again.",
      recoverable: true,
    };
  }

  // Conflict errors.
  //
  // Matches on "conflict" only. It used to also match "412" and "ETag",
  // which could never fire: Drive v3 removed Files.etag and files.update
  // accepts no precondition, so no 412 was reachable. Worse, "412" is a
  // bare substring — it would have matched an unrelated status or id
  // containing those digits and mislabelled it a conflict. Conflicts now
  // come from the coordinator's version-convergence check, which says
  // "conflict" in its message.
  if (errorStr.includes("conflict")) {
    return {
      type: "conflict",
      message: "Sync conflict: another device uploaded changes. Review and sync again.",
      recoverable: true,
    };
  }

  // Network errors
  if (
    errorStr.includes("network") ||
    errorStr.includes("Network error") ||
    errorStr.includes("fetch") ||
    errorStr.includes("offline")
  ) {
    return {
      type: "network",
      message: "Network error. Will retry when connection is restored.",
      recoverable: true,
    };
  }

  // Drive API errors
  if (errorStr.includes("Failed to") || errorStr.includes("API") || errorStr.includes("status")) {
    return {
      type: "drive",
      message: "Drive API error. Will retry automatically.",
      recoverable: true,
    };
  }

  return {
    type: "unknown",
    message: "Sync error. Will retry automatically.",
    recoverable: true,
  };
}
