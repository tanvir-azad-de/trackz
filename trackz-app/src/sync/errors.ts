/**
 * Phase 15b: Sync error categorization for better user messages.
 * Helps distinguish between auth issues, network problems, and Drive API errors.
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

  if (errorStr.includes("token") || errorStr.includes("Token refresh")) {
    return {
      type: "auth",
      message: "Authentication failed. Please sign in again.",
      recoverable: true,
    };
  }

  // Conflict errors (412 Precondition Failed)
  if (errorStr.includes("conflict") || errorStr.includes("412") || errorStr.includes("ETag")) {
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
