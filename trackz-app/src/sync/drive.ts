import type { SyncDocument } from "./document";
import { getAuthState, refreshAccessToken } from "./auth";

/**
 * Google Drive API transport.
 *
 * WHERE THE DATA LIVES: the app's hidden `appDataFolder`, not the user's
 * visible Drive. See `driveScope` in app/config.ts for why, and for the
 * consequences (no trash, no sharing, nothing visible by eye).
 *
 * THE METADATA/CONTENT SPLIT is the thing to understand here, because
 * getting it wrong fails silently rather than loudly. Drive v3 serves a
 * file's METADATA and its CONTENT from two different hosts:
 *
 *   www.googleapis.com/drive/v3/files/{id}         -> File resource (metadata)
 *   www.googleapis.com/upload/drive/v3/files/{id}  -> bytes (content)
 *
 * A PATCH to the metadata URI treats its body as a File RESOURCE, and
 * silently ignores any field that isn't one. An earlier version of this
 * module PATCHed the metadata URI with the SyncDocument as the body:
 * `revision`, `device` and `transactions` are not File fields, so every
 * upload returned 200 while storing nothing. Likewise `content` is not a
 * File field, so creating a file with `{name, mimeType, content}` produced
 * an EMPTY file — and the next read then died parsing a zero-byte body, so
 * a first-ever sync could never succeed. Hence: content always goes
 * through an `/upload/` URI with an explicit `uploadType`.
 *
 * NO ETAGS. Drive v3 removed `Files.etag` (it is listed as `n/a` in
 * Google's own v2-to-v3 reference) and `files.update` documents no
 * If-Match or precondition parameter, so optimistic concurrency via ETag
 * is not merely unimplemented here, it is unavailable. Conflict handling
 * instead uses the File resource's `version` counter — see `readVersion`.
 */

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  /* No webViewLink: appDataFolder files cannot be shared or opened in the
     Drive UI, so Drive does not return a usable one. */
}

export interface DriveError extends Error {
  status?: number;
  code?: string;
}

const SYNC_FILENAME = "trackz-data-v2.json";
const MIME_TYPE = "application/json";

/**
 * The app's private, user-invisible Drive folder. Both uses are required
 * and they are not interchangeable:
 * - `parents: [APP_DATA_FOLDER]` on create puts the file in there.
 * - `spaces=appDataFolder` on search tells Drive to look in there; the
 *   default `drive` space would never find it, and we would create a fresh
 *   duplicate file on every session.
 */
const APP_DATA_FOLDER = "appDataFolder";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

/** The File resource fields we actually read. Requesting only these keeps
 *  the response small and makes it obvious what this module depends on. */
const METADATA_FIELDS = "id,name,mimeType,modifiedTime,version,size";

// Cache file ID to avoid repeated searching
let cachedFileId: string | null = null;

function driveError(message: string, status?: number, code?: string): DriveError {
  const error = new Error(message) as DriveError;
  if (status !== undefined) error.status = status;
  if (code !== undefined) error.code = code;
  return error;
}

function requireAccessToken(): string {
  const auth = getAuthState();
  if (!auth.isSignedIn || !auth.accessToken) {
    throw new Error("Not signed in to Google");
  }
  return auth.accessToken;
}

/**
 * Call Drive with the current access token, and on a 401 mint a new token
 * and retry ONCE.
 *
 * This reactive refresh is not redundant with auth.ts's proactive refresh
 * timer. That timer is a `setTimeout`, and iOS freezes timers in a
 * backgrounded PWA — which is this app's primary target. Reopening the app
 * after a few hours therefore resumes with a token that expired while the
 * timer was suspended, and without this branch every sync would burn its
 * five retries against a dead token and land on a generic "error".
 *
 * Exactly one retry: if a token minted seconds ago is also rejected, the
 * grant itself is gone, and retrying harder cannot bring it back.
 */
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    });

  let response: Response;
  try {
    response = await send(requireAccessToken());
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Network error calling Drive: ${error.message}`);
    }
    throw error;
  }

  if (response.status !== 401) return response;

  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    throw driveError(
      "Drive rejected the access token and it could not be renewed — please reconnect Google Drive.",
      401,
      "AUTH_EXPIRED",
    );
  }

  try {
    return await send(requireAccessToken());
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Network error calling Drive: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch the current synced document from Google Drive.
 *
 * @returns SyncDocument from Drive, or null if there is nothing usable yet
 * @throws DriveError if auth fails or the request fails
 */
export async function fetchFromDrive(_deviceId: string): Promise<SyncDocument | null> {
  requireAccessToken();

  const fileId = await findSyncFile();
  if (!fileId) {
    // Nothing has ever been uploaded from any device.
    return null;
  }

  const response = await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`);

  if (!response.ok) {
    throw driveError(`Failed to fetch from Drive: ${response.status}`, response.status);
  }

  // Read as text, not response.json(). An empty or truncated body has to be
  // "there is no remote document" rather than a thrown SyntaxError: a parse
  // error would be categorised as unknown, retried five times, and finally
  // reported as a permanent failure. Returning null instead lets the next
  // upload simply overwrite the unusable file, which is also the recovery
  // path for any file left empty by the metadata/content bug described at
  // the top of this module.
  const body = await response.text();
  if (!body.trim()) return null;

  try {
    return JSON.parse(body) as SyncDocument;
  } catch {
    console.warn("Drive sync file is not valid JSON; treating it as empty.");
    return null;
  }
}

/**
 * Read the server-side `version` of the sync file: a monotonically
 * increasing counter Drive bumps on every change to the file, metadata or
 * content. This is the only concurrency signal v3 offers us.
 *
 * Kept as a STRING and only ever compared for equality. Drive serialises
 * int64 fields as strings, and "has someone else written since I read?" is
 * an equality question — parsing to a Number would add a precision hazard
 * to buy an ordering we never use.
 *
 * @returns the version, or null if the file does not exist yet
 */
export async function readVersion(): Promise<string | null> {
  const fileId = await findSyncFile();
  if (!fileId) return null;

  const response = await driveFetch(`${DRIVE_API}/files/${fileId}?fields=version`);
  if (!response.ok) {
    throw driveError(`Failed to read Drive file version: ${response.status}`, response.status);
  }

  const metadata = (await response.json()) as { version?: string };
  return metadata.version ?? null;
}

/**
 * Read the sync file's metadata, for the Settings readout that answers "is
 * my data actually up there?". With `drive.appdata` the file is invisible in
 * the Drive UI, so an in-app readout is the only way to check.
 *
 * @returns metadata, or null if nothing has been uploaded yet
 */
export async function readRemoteMetadata(): Promise<
  (DriveFileMetadata & { version: string | null; size: number | null }) | null
> {
  const fileId = await findSyncFile();
  if (!fileId) return null;

  const response = await driveFetch(`${DRIVE_API}/files/${fileId}?fields=${METADATA_FIELDS}`);
  if (!response.ok) {
    throw driveError(`Failed to read Drive metadata: ${response.status}`, response.status);
  }

  const metadata = (await response.json()) as {
    id?: string;
    name?: string;
    mimeType?: string;
    modifiedTime?: string;
    version?: string;
    size?: string;
  };

  return {
    id: metadata.id ?? fileId,
    name: metadata.name ?? SYNC_FILENAME,
    mimeType: metadata.mimeType ?? MIME_TYPE,
    modifiedTime: metadata.modifiedTime ?? "",
    version: metadata.version ?? null,
    size: metadata.size === undefined ? null : Number(metadata.size),
  };
}

/**
 * Upload a synced document to Google Drive, creating the file if this is
 * the first upload from any device.
 *
 * This writes unconditionally. Drive offers no compare-and-swap, so
 * "don't clobber a concurrent write" cannot be enforced here; the
 * coordinator handles it by re-reading `version` immediately before
 * calling this and restarting the merge if it moved.
 *
 * @returns the new server-side version and modified time
 */
export async function uploadToDrive(
  doc: SyncDocument,
): Promise<{ version: string | null; modifiedTime: string }> {
  requireAccessToken();

  const body = JSON.stringify(doc);
  const existingFileId = await findSyncFile();

  const response = existingFileId
    ? await driveFetch(
        // The /upload/ host with uploadType=media: the body IS the file's
        // bytes. A PATCH to the metadata host would be accepted and
        // silently store nothing.
        `${DRIVE_UPLOAD_API}/files/${existingFileId}?uploadType=media&fields=${METADATA_FIELDS}`,
        {
          method: "PATCH",
          headers: { "Content-Type": MIME_TYPE },
          body,
        },
      )
    : await createSyncFile(body);

  if (!response.ok) {
    throw driveError(`Failed to upload to Drive: ${response.status}`, response.status);
  }

  const metadata = (await response.json()) as {
    id?: string;
    version?: string;
    modifiedTime?: string;
  };

  // Creation returns the id we now need for every later call.
  if (!existingFileId && metadata.id) cachedFileId = metadata.id;

  return {
    version: metadata.version ?? null,
    modifiedTime: metadata.modifiedTime ?? new Date().toISOString(),
  };
}

/**
 * Create the sync file WITH its content in one request, via a
 * multipart/related upload.
 *
 * Atomicity is the point, not efficiency. Creating the file first and
 * uploading content second leaves a window in which the file exists and is
 * empty, and a second device syncing inside that window reads an empty
 * document. One request has no such window.
 */
async function createSyncFile(content: string): Promise<Response> {
  const metadata = {
    name: SYNC_FILENAME,
    mimeType: MIME_TYPE,
    parents: [APP_DATA_FOLDER],
  };

  // Hand-rolled rather than FormData: FormData would send
  // multipart/form-data, and Drive's multipart upload protocol specifies
  // multipart/related with the metadata part first.
  const boundary = `trackz-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${MIME_TYPE}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  return driveFetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=${METADATA_FIELDS}`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
}

/**
 * Find the sync file's ID in the app data folder, or null if no device has
 * uploaded one yet.
 *
 * Deliberately does NOT create the file. Creation needs the content to go
 * with it (see createSyncFile), and a find-or-create here would have to
 * invent an empty document — which is exactly the empty-file bug this
 * module used to have.
 */
async function findSyncFile(): Promise<string | null> {
  if (cachedFileId) return cachedFileId;

  // URLSearchParams, not string interpolation: the query contains spaces
  // and single quotes (`name='trackz-data-v2.json' and trashed=false`),
  // which must be percent-encoded or Drive rejects the request.
  const params = new URLSearchParams({
    q: `name='${SYNC_FILENAME}' and trashed=false`,
    spaces: APP_DATA_FOLDER,
    fields: "files(id,name,modifiedTime)",
  });

  const response = await driveFetch(`${DRIVE_API}/files?${params.toString()}`);

  if (!response.ok) {
    // Throw rather than return null. Returning null would read as "no file
    // yet" and send the caller off to CREATE a duplicate, so a transient
    // 500 on the search could fork the user's data into two files.
    throw driveError(`Failed to search Drive: ${response.status}`, response.status);
  }

  const result = (await response.json()) as { files?: Array<{ id?: string }> };
  cachedFileId = result.files?.[0]?.id ?? null;
  return cachedFileId;
}

/**
 * Test-only: clear the cached file ID. Used to ensure tests can simulate
 * file discovery happening at different times.
 */
export function clearCacheForTesting(): void {
  cachedFileId = null;
}
