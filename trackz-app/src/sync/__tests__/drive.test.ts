import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clearCacheForTesting,
  deleteRemoteSyncFile,
  fetchFromDrive,
  readRemoteMetadata,
  readVersion,
  uploadToDrive,
} from "@/sync/drive";
import { resetAuthForTesting, setAccessToken } from "@/sync/auth";
import type { SyncDocument } from "@/sync/document";

/**
 * Tests for drive.ts, the Google Drive transport.
 *
 * WHAT THESE TESTS CAN AND CANNOT PROVE. `fetch` is mocked, so a mock
 * encodes our READING of the Drive v3 docs. A passing test here proves
 * this module is self-consistent with that reading — NOT that Google
 * agrees. Live verification against a real account is the actual gate, and
 * it should be expected to surface something these tests miss.
 *
 * What they do protect, and why it is worth having: the previous version of
 * this module had no coverage at all (the test file asserted
 * `expect(true).toBe(true)`), and shipped three bugs that are visible
 * purely in the shape of the requests — content PATCHed to the metadata
 * endpoint, a file created with no content, and an unencoded search query.
 * Every assertion below about URLs and bodies is aimed at that class of
 * bug, which is exactly the class a type checker cannot see.
 */

const METADATA_HOST = "https://www.googleapis.com/drive/v3";
const UPLOAD_HOST = "https://www.googleapis.com/upload/drive/v3";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetAuthForTesting();
  clearCacheForTesting();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken("test-token", 3600, "person@example.com");
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAuthForTesting();
  clearCacheForTesting();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as Response;
}

/** The file-search response Drive returns when our file already exists. */
function searchHit(id = "file-123"): Response {
  return jsonResponse({ files: [{ id, name: "trackz-data-v2.json" }] });
}

/** The file-search response Drive returns when it does not. */
function searchMiss(): Response {
  return jsonResponse({ files: [] });
}

const doc: SyncDocument = {
  revision: 4,
  device: "device-a",
  transactions: [],
};

/** All URLs passed to fetch, in call order. */
function calledUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function callTo(fragment: string): [string, RequestInit] | undefined {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes(fragment));
  return call as [string, RequestInit] | undefined;
}

describe("file lookup", () => {
  it("searches the hidden appDataFolder, not the user's visible Drive", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(textResponse("{}"));

    await fetchFromDrive("device-a");

    // `spaces=drive` (the default) would never find a file that lives in
    // the app folder, so every session would create a fresh duplicate.
    expect(calledUrls()[0]).toContain("spaces=appDataFolder");
  });

  it("percent-encodes the search query", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(textResponse("{}"));

    await fetchFromDrive("device-a");

    // The query is `name='trackz-data-v2.json' and trashed=false`: spaces
    // and quotes must be encoded or Drive rejects the request outright.
    const searchUrl = calledUrls()[0] ?? "";
    expect(searchUrl).toContain("q=name%3D%27trackz-data-v2.json%27+and+trashed%3Dfalse");
    expect(searchUrl).not.toContain("name='trackz-data-v2.json' and");
  });

  it("throws rather than reporting 'no file' when the search itself fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));

    // Returning null on a failed search would read as "nothing uploaded
    // yet" and send the caller off to CREATE a second file, forking the
    // user's data in two on a transient 500.
    await expect(fetchFromDrive("device-a")).rejects.toThrow(/Failed to search Drive: 500/);
  });

  it("reuses the file id across calls instead of re-searching", async () => {
    fetchMock
      .mockResolvedValueOnce(searchHit())
      .mockResolvedValueOnce(textResponse(JSON.stringify(doc)))
      .mockResolvedValueOnce(textResponse(JSON.stringify(doc)));

    await fetchFromDrive("device-a");
    await fetchFromDrive("device-a");

    const searches = calledUrls().filter((url) => url.includes("spaces=appDataFolder"));
    expect(searches).toHaveLength(1);
  });
});

describe("fetchFromDrive", () => {
  it("reads file CONTENT via alt=media", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(textResponse(JSON.stringify(doc)));

    const result = await fetchFromDrive("device-a");

    expect(calledUrls()[1]).toBe(`${METADATA_HOST}/files/file-123?alt=media`);
    expect(result).toEqual(doc);
  });

  it("returns null when no device has uploaded a file yet", async () => {
    fetchMock.mockResolvedValueOnce(searchMiss());

    expect(await fetchFromDrive("device-a")).toBe(null);
    // No point fetching content for a file that does not exist.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an EMPTY file as 'no remote document' instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(textResponse(""));

    // This is the recovery path for a file left empty by the old
    // create-without-content bug. Calling response.json() on an empty body
    // throws SyntaxError, which categorises as "unknown", retries five
    // times, and strands the user on a permanent "error" — for a file the
    // very next upload would have fixed.
    expect(await fetchFromDrive("device-a")).toBe(null);
  });

  it("treats a CORRUPT file as 'no remote document' instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(textResponse("{not json"));

    expect(await fetchFromDrive("device-a")).toBe(null);
  });

  it("throws when signed out, without calling Drive", async () => {
    resetAuthForTesting();

    await expect(fetchFromDrive("device-a")).rejects.toThrow(/Not signed in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("uploadToDrive", () => {
  it("sends CONTENT to the upload host, never as file metadata", async () => {
    fetchMock
      .mockResolvedValueOnce(searchHit())
      .mockResolvedValueOnce(jsonResponse({ id: "file-123", version: "9", modifiedTime: "2026-01-01T00:00:00Z" }));

    await uploadToDrive(doc);

    const [url, init] = callTo("uploadType=media") ?? ["", {}];
    expect(url).toBe(`${UPLOAD_HOST}/files/file-123?uploadType=media&fields=id,name,mimeType,modifiedTime,version,size`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify(doc));

    // The bug this exists to prevent: a PATCH to the METADATA host is
    // accepted with a 200 and stores nothing, because revision/device/
    // transactions are not File resource fields.
    const metadataPatch = fetchMock.mock.calls.find(
      (c) => String(c[0]).startsWith(`${METADATA_HOST}/files/`) && (c[1] as RequestInit)?.method === "PATCH",
    );
    expect(metadataPatch).toBeUndefined();
  });

  it("creates the file WITH its content in a single multipart request", async () => {
    fetchMock
      .mockResolvedValueOnce(searchMiss())
      .mockResolvedValueOnce(jsonResponse({ id: "new-file", version: "1", modifiedTime: "2026-01-01T00:00:00Z" }));

    await uploadToDrive(doc);

    const [url, init] = callTo("uploadType=multipart") ?? ["", {}];
    expect(url).toContain(`${UPLOAD_HOST}/files?uploadType=multipart`);
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    // multipart/RELATED, not multipart/form-data: FormData would produce
    // the latter, which is not Drive's upload protocol.
    expect(headers["Content-Type"]).toMatch(/^multipart\/related; boundary=/);

    // Both parts in one request. Creating the file first and uploading
    // content second leaves a window where the file exists and is empty,
    // and a second device syncing inside that window reads nothing.
    const body = String(init.body);
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('"name":"trackz-data-v2.json"');
    expect(body).toContain(JSON.stringify(doc));
  });

  it("caches the new file id after creating, so the next upload updates it", async () => {
    fetchMock
      .mockResolvedValueOnce(searchMiss())
      .mockResolvedValueOnce(jsonResponse({ id: "new-file", version: "1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "new-file", version: "2" }));

    await uploadToDrive(doc);
    await uploadToDrive(doc);

    // Without this, the second upload would search again, find nothing (in
    // a real account it would find the file, but only after a round trip)
    // and risk creating a duplicate.
    expect(callTo("uploadType=media")?.[0]).toContain("/files/new-file");
  });

  it("returns the server-side version so the caller can detect later writes", async () => {
    fetchMock
      .mockResolvedValueOnce(searchHit())
      .mockResolvedValueOnce(jsonResponse({ id: "file-123", version: "42", modifiedTime: "2026-02-02T00:00:00Z" }));

    expect(await uploadToDrive(doc)).toEqual({
      version: "42",
      modifiedTime: "2026-02-02T00:00:00Z",
    });
  });

  it("throws on a failed upload instead of reporting success", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(uploadToDrive(doc)).rejects.toThrow(/Failed to upload to Drive: 500/);
  });
});

describe("readVersion", () => {
  it("asks only for the version field", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(jsonResponse({ version: "7" }));

    expect(await readVersion()).toBe("7");
    expect(calledUrls()[1]).toBe(`${METADATA_HOST}/files/file-123?fields=version`);
  });

  it("returns the version as a STRING, unparsed", async () => {
    // Drive serialises int64 as a string. We only ever compare versions for
    // equality ("did anyone write since I read?"), so parsing to Number
    // would add a precision hazard to buy an ordering nothing uses.
    fetchMock
      .mockResolvedValueOnce(searchHit())
      .mockResolvedValueOnce(jsonResponse({ version: "9007199254740993" }));

    expect(await readVersion()).toBe("9007199254740993");
  });

  it("returns null when no file exists yet", async () => {
    fetchMock.mockResolvedValueOnce(searchMiss());

    expect(await readVersion()).toBe(null);
  });
});

describe("readRemoteMetadata", () => {
  it("reports what is actually on Drive, since the app folder is invisible", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(
      jsonResponse({
        id: "file-123",
        name: "trackz-data-v2.json",
        mimeType: "application/json",
        modifiedTime: "2026-03-03T10:00:00Z",
        version: "12",
        size: "2048",
      }),
    );

    // With drive.appdata the user cannot see the file in Drive, so an
    // in-app readout is the only way to answer "is my data up there?".
    expect(await readRemoteMetadata()).toEqual({
      id: "file-123",
      name: "trackz-data-v2.json",
      mimeType: "application/json",
      modifiedTime: "2026-03-03T10:00:00Z",
      version: "12",
      size: 2048,
    });
  });

  it("returns null when nothing has been uploaded", async () => {
    fetchMock.mockResolvedValueOnce(searchMiss());

    expect(await readRemoteMetadata()).toBe(null);
  });
});

describe("expired access token", () => {
  it("refreshes once on a 401 and retries the request", async () => {
    fetchMock
      // The search is rejected: the token died while the app was backgrounded.
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // auth.ts refreshes via /api/auth/refresh.
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-token", expires_in: 3600 }))
      .mockResolvedValueOnce(searchHit())
      .mockResolvedValueOnce(textResponse(JSON.stringify(doc)));

    // This path is not covered by auth.ts's proactive refresh timer: iOS
    // freezes timers in a backgrounded PWA, so reopening the app hours
    // later resumes with a token that expired unnoticed.
    expect(await fetchFromDrive("device-a")).toEqual(doc);

    expect(calledUrls()).toContain("/api/auth/refresh");
    const retried = fetchMock.mock.calls.find(
      (c, i) => i > 1 && String(c[0]).includes("spaces=appDataFolder"),
    );
    expect((retried?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      Authorization: "Bearer fresh-token",
    });
  });

  it("asks the user to reconnect when the refresh token is also dead", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // 401 from refresh means the grant is revoked or expired.
      .mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 401));

    // Must name the action that fixes it. Retrying cannot mint a token
    // from a grant that no longer exists.
    await expect(fetchFromDrive("device-a")).rejects.toThrow(/reconnect Google Drive/);
  });

  it("does not retry more than once", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-token", expires_in: 3600 }))
      // Still 401 with a token minted seconds ago: the grant itself is gone.
      .mockResolvedValueOnce(jsonResponse({}, 401));

    await expect(fetchFromDrive("device-a")).rejects.toThrow();

    const refreshes = calledUrls().filter((url) => url === "/api/auth/refresh");
    expect(refreshes).toHaveLength(1);
  });
});

describe("deleteRemoteSyncFile", () => {
  it("DELETEs the file and forgets its cached id", async () => {
    fetchMock
      .mockResolvedValueOnce(searchHit())
      .mockResolvedValueOnce(jsonResponse({}, 204))
      // After deletion the next call must SEARCH again, not reuse the id.
      .mockResolvedValueOnce(searchMiss());

    expect(await deleteRemoteSyncFile()).toBe(true);

    const [url, init] = callTo("/files/file-123") ?? ["", {}];
    expect(url).toBe(`${METADATA_HOST}/files/file-123`);
    expect(init.method).toBe("DELETE");

    // Keeping the cached id would make the next upload PATCH a file that
    // no longer exists and fail with a confusing 404.
    //
    // Asserted by COUNTING SEARCHES, not by the return value: a stale
    // cached id would send readVersion straight to a metadata fetch, whose
    // response in this mock happens to lack a `version` field, so it would
    // also return null and the test would pass while the bug survived.
    // (It did exactly that until mutation testing exposed it.)
    fetchMock.mockClear();
    await readVersion();

    const searches = calledUrls().filter((url) => url.includes("spaces=appDataFolder"));
    expect(searches).toHaveLength(1);
  });

  it("reports false when there is nothing to delete", async () => {
    fetchMock.mockResolvedValueOnce(searchMiss());

    // Distinguishable from a successful delete, so the UI can say
    // "nothing was on Drive" rather than implying it removed something.
    expect(await deleteRemoteSyncFile()).toBe(false);
  });

  it("treats a 404 as success, since the end state is the same", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(jsonResponse({}, 404));

    // Another device deleted it first. That is the desired outcome, not a
    // failure to report.
    expect(await deleteRemoteSyncFile()).toBe(true);
  });

  it("throws on a real failure instead of claiming the file is gone", async () => {
    fetchMock.mockResolvedValueOnce(searchHit()).mockResolvedValueOnce(jsonResponse({}, 500));

    // Reporting success here would be the worst outcome: the user believes
    // the bad remote data is gone, reconnects, and it merges back in.
    await expect(deleteRemoteSyncFile()).rejects.toThrow(/Failed to delete/);
  });
});
