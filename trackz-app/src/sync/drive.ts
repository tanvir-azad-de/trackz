import type { SyncDocument } from "./document";
import { getAuthState } from "./auth";

/**
 * Phase 15b: Google Drive API integration.
 *
 * Handles:
 * - GET: Fetch trackz-data-v2.json from Drive (with ETag for caching)
 * - PUT: Upload new revision to Drive (with If-Match for conflict detection)
 *
 * Drive API basics:
 * - Uses the web (browser) API, not the Node SDK
 * - OAuth2 Bearer token in Authorization header
 * - REST endpoints: files.get, files.update, files.create
 * - ETag for optimistic concurrency control (If-Match)
 * - MIME type application/json for our data files
 *
 * Assumptions:
 * - A file named trackz-data-v2.json exists in Drive (or will be created)
 * - Old sync file trackz-data.json is left untouched (migration path)
 * - Only one instance per account should be syncing (Phase 15b doesn't
 *   implement distributed locks, but If-Match prevents corruption)
 */

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
}

export interface DriveError extends Error {
  status?: number;
  code?: string;
}

const SYNC_FILENAME = "trackz-data-v2.json";
const MIME_TYPE = "application/json";

// Cache file ID to avoid repeated searching
let cachedFileId: string | null = null;

/**
 * Fetch the current synced document from Google Drive.
 *
 * @returns SyncDocument from Drive, or null if file doesn't exist yet
 * @throws DriveError if auth fails or network error (but not 404)
 */
export async function fetchFromDrive(_deviceId: string): Promise<SyncDocument | null> {
  const auth = getAuthState();
  if (!auth.isSignedIn || !auth.accessToken) {
    throw new Error("Not signed in to Google");
  }

  const fileId = await findOrCreateSyncFile();
  if (!fileId) {
    // Brand new account, no file yet
    return null;
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
        },
      },
    );

    if (!response.ok) {
      const error = new Error(`Failed to fetch from Drive: ${response.status}`) as DriveError;
      error.status = response.status;
      throw error;
    }

    const doc = (await response.json()) as SyncDocument;
    return doc;
  } catch (error) {
    if (error instanceof TypeError) {
      // Network error
      throw new Error(`Network error fetching from Drive: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Upload a synced document to Google Drive, using If-Match to ensure
 * we don't overwrite a concurrent write from another device.
 *
 * @param doc SyncDocument to upload
 * @param eTag Current ETag from Drive (for If-Match), or null for first upload
 * @returns Updated metadata (file ID, modified time, ETag)
 * @throws DriveError if conflict (412 Precondition Failed) or auth fails
 */
export async function uploadToDrive(
  doc: SyncDocument,
  eTag: string | null,
): Promise<{ etag: string; modifiedTime: string }> {
  const auth = getAuthState();
  if (!auth.isSignedIn || !auth.accessToken) {
    throw new Error("Not signed in to Google");
  }

  const fileId = await findOrCreateSyncFile();
  if (!fileId) {
    throw new Error("Failed to create sync file on Drive");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    "Content-Type": MIME_TYPE,
  };

  if (eTag) {
    headers["If-Match"] = eTag;
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=json`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(doc),
      },
    );

    if (response.status === 412) {
      // Conflict: another device uploaded while we were offline
      const error = new Error("Sync conflict (ETag mismatch) — another device uploaded") as DriveError;
      error.status = 412;
      error.code = "CONFLICT";
      throw error;
    }

    if (!response.ok) {
      const error = new Error(`Failed to upload to Drive: ${response.status}`) as DriveError;
      error.status = response.status;
      throw error;
    }

    const metadata = (await response.json()) as { etag?: string; modifiedTime?: string };
    return {
      etag: metadata.etag || "",
      modifiedTime: metadata.modifiedTime || new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Network error uploading to Drive: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Find or create the trackz-data-v2.json file in Drive.
 * Returns the file ID, or null if creation failed (should be rare).
 *
 * This is called before every fetch/upload to ensure the file exists.
 * In a real app, you'd cache this more aggressively (but this is simple
 * and Phase 15b prioritizes correctness over performance).
 */
async function findOrCreateSyncFile(): Promise<string | null> {
  // If we've already found the ID this session, return it
  if (cachedFileId) {
    return cachedFileId;
  }

  const auth = getAuthState();
  if (!auth.isSignedIn || !auth.accessToken) {
    throw new Error("Not signed in to Google");
  }

  // Query for existing file
  try {
    const searchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${SYNC_FILENAME}' and trashed=false&spaces=drive&fields=files(id,name,mimeType,modifiedTime,webViewLink)`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
        },
      },
    );

    if (!searchResponse.ok) {
      console.error(`Failed to search Drive: ${searchResponse.status}`);
      return null;
    }

    const searchResult = (await searchResponse.json()) as { files?: Array<{ id: string }> };
    if (searchResult.files && searchResult.files.length > 0) {
      cachedFileId = searchResult.files[0]?.id || null;
      if (cachedFileId) return cachedFileId;
    }
  } catch (error) {
    console.error("Error searching Drive for sync file:", error);
  }

  // File doesn't exist, create it with initial empty document
  try {
    const initialDoc: SyncDocument = {
      revision: 0,
      device: "init",
      transactions: [],
    };

    const createResponse = await fetch("https://www.googleapis.com/drive/v3/files?alt=json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: SYNC_FILENAME,
        mimeType: MIME_TYPE,
        content: initialDoc,
      }),
    });

    if (createResponse.ok) {
    const metadata = (await createResponse.json()) as { id?: string };
    if (metadata?.id) {
      cachedFileId = metadata.id;
      return cachedFileId;
    }
    } else {
      console.error(`Failed to create sync file: ${createResponse.status}`);
    }
  } catch (error) {
    console.error("Error creating sync file on Drive:", error);
  }

  return null;
}

/**
 * Test-only: clear the cached file ID. Used to ensure tests can simulate
 * file discovery happening at different times.
 */
export function clearCacheForTesting(): void {
  cachedFileId = null;
}
