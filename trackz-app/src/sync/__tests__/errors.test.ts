import { describe, it, expect } from "vitest";
import { categorizeSyncError } from "@/sync/errors";

/**
 * Tests for errors.ts, which decides what the user is told when a sync
 * fails — and, via `type`, whether the coordinator retries at all.
 *
 * Previously untested, which is how two mistakes survived in it: a
 * conflict rule matching the bare substring "412" (so any unrelated
 * message containing those three digits was reported as a conflict) and a
 * rule matching "ETag", which Drive v3 does not even have. Both are
 * invisible to a type checker and to every other test in the suite.
 *
 * These tests pin the CATEGORY, not the exact wording, except where the
 * wording is the whole point (the reconnect instruction).
 */

describe("auth errors", () => {
  it("categorises a signed-out state as auth", () => {
    const result = categorizeSyncError(new Error("Not signed in to Google"));

    expect(result.type).toBe("auth");
  });

  it("tells the user to RECONNECT when the grant is dead", () => {
    const result = categorizeSyncError(
      new Error(
        "Drive rejected the access token and it could not be renewed — please reconnect Google Drive.",
      ),
    );

    // Must not be left to the generic path. A revoked or expired grant
    // used to burn five retries and surface as "Sync failed after multiple
    // retries" — accurate, and useless: it names no action, and the only
    // action that works is reconnecting.
    expect(result.type).toBe("auth");
    expect(result.message).toMatch(/[Rr]econnect/);
  });

  it("recognises Google's invalid_grant by name", () => {
    const result = categorizeSyncError(new Error("refresh failed: invalid_grant"));

    expect(result.type).toBe("auth");
    expect(result.message).toMatch(/[Rr]econnect/);
  });
});

describe("conflict errors", () => {
  it("categorises a stated conflict as a conflict", () => {
    const result = categorizeSyncError(
      new Error("Another device kept changing data while syncing (conflict)"),
    );

    expect(result.type).toBe("conflict");
  });

  it("does NOT call something a conflict just because it contains '412'", () => {
    // The old rule matched the bare substring "412", so this message — a
    // transaction id that happens to contain those digits — was reported
    // to the user as "another device uploaded changes", and the
    // coordinator suppressed the retry that might have fixed it.
    const result = categorizeSyncError(new Error("Failed to upload to Drive: tx-412-abc"));

    expect(result.type).not.toBe("conflict");
  });

  it("does not treat ETag mentions as conflicts", () => {
    // Drive v3 removed Files.etag and accepts no If-Match, so nothing can
    // legitimately report an ETag conflict. Keeping the rule implied a
    // concurrency guarantee the transport does not have.
    const result = categorizeSyncError(new Error("ETag header was ignored"));

    expect(result.type).not.toBe("conflict");
  });
});

describe("network errors", () => {
  it("categorises a network failure as network", () => {
    const result = categorizeSyncError(new Error("Network error calling Drive: failed to fetch"));

    expect(result.type).toBe("network");
    // Must stay recoverable: the coordinator's backoff is the whole
    // response to a flaky connection.
    expect(result.recoverable).toBe(true);
  });
});

describe("unknown errors", () => {
  it("stays recoverable rather than stranding the user", () => {
    const result = categorizeSyncError("something entirely unexpected");

    expect(result.type).toBe("unknown");
    expect(result.recoverable).toBe(true);
  });

  it("handles a non-Error value without throwing", () => {
    expect(() => categorizeSyncError({ weird: true })).not.toThrow();
    expect(() => categorizeSyncError(null)).not.toThrow();
  });
});
