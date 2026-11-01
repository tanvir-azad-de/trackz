import { describe, it, expect } from "vitest";
import type { Transaction } from "@/domain/transaction";
import type { SyncDocument } from "@/sync/document";
import { merge, hasDataLoss } from "@/sync/merge";

/**
 * Phase 15a: tests sync/merge.ts's last-writer-wins merge logic.
 * This is the core conflict resolution for two-device sync: when a
 * transaction id exists in both local and Drive with different updatedAt
 * timestamps, the newer one wins. Tombstones (deletedAt !== null) merge
 * just like live records — a deletion can propagate or be undone.
 */

function tx(
  id: string,
  updatedAt: string,
  deletedAt: string | null = null,
  merchant = "Test Merchant",
): Transaction {
  return {
    id,
    date: "2026-01-01",
    account: "Checking",
    destinationAccount: "",
    cashflow: "out",
    category: "Groceries",
    categoryType: "expense",
    merchant,
    amountCents: 1000,
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt,
    deletedAt,
  };
}

function syncDoc(
  transactions: Transaction[],
  revision: number = 1,
  device: string = "remote-device",
): SyncDocument {
  return { revision, device, transactions };
}

describe("merge — last-writer-wins", () => {
  it("returns empty merged list when both local and remote are empty", () => {
    const result = merge([], syncDoc([]));
    expect(result.merged).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.shouldUpload).toBe(false);
  });

  it("includes all remote transactions when local is empty", () => {
    const remote = [tx("id-1", "2026-01-02T00:00:00Z"), tx("id-2", "2026-01-03T00:00:00Z")];
    const result = merge([], syncDoc(remote));
    expect(result.merged).toEqual(remote);
    expect(result.conflicts).toEqual([]);
    expect(result.shouldUpload).toBe(false);
  });

  it("includes all local transactions when remote is empty", () => {
    const local = [tx("id-1", "2026-01-02T00:00:00Z"), tx("id-2", "2026-01-03T00:00:00Z")];
    const result = merge(local, syncDoc([]));
    expect(result.merged).toEqual(local);
    expect(result.conflicts).toEqual([]);
    expect(result.shouldUpload).toBe(true);
  });

  it("prefers remote when remote's updatedAt is newer", () => {
    const local = [tx("id-1", "2026-01-02T00:00:00Z", null, "Local Merchant")];
    const remote = [tx("id-1", "2026-01-03T00:00:00Z", null, "Remote Merchant")];
    const result = merge(local, syncDoc(remote));

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]).toEqual(remote[0]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual({
      id: "id-1",
      local: local[0],
      remote: remote[0],
      winner: "remote",
    });
    expect(result.shouldUpload).toBe(false);
  });

  it("prefers local when local's updatedAt is newer", () => {
    const local = [tx("id-1", "2026-01-03T00:00:00Z", null, "Local Merchant")];
    const remote = [tx("id-1", "2026-01-02T00:00:00Z", null, "Remote Merchant")];
    const result = merge(local, syncDoc(remote));

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]).toEqual(local[0]);
    expect(result.conflicts).toEqual([]); // Local is newer, not a conflict
    expect(result.shouldUpload).toBe(true);
  });

  it("prefers local as tie-breaker when updatedAt is identical", () => {
    const time = "2026-01-02T00:00:00Z";
    const local = [tx("id-1", time, null, "Local Merchant")];
    const remote = [tx("id-1", time, null, "Remote Merchant")];
    const result = merge(local, syncDoc(remote));

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]).toEqual(local[0]);
    expect(result.conflicts).toEqual([]); // Same time, local wins but no conflict
    expect(result.shouldUpload).toBe(false);
  });

  it("merges tombstones (deletedAt) using the same LWW logic", () => {
    const local = [tx("id-1", "2026-01-03T00:00:00Z", "2026-01-03T00:00:00Z")]; // Deleted locally
    const remote = [tx("id-1", "2026-01-02T00:00:00Z", null)]; // Still live on remote
    const result = merge(local, syncDoc(remote));

    // Local's deletion is newer, so keep the tombstone
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.deletedAt).toBe("2026-01-03T00:00:00Z");
    expect(result.shouldUpload).toBe(true);
  });

  it("undoes a deletion if remote's version (undeletion) is newer", () => {
    const local = [tx("id-1", "2026-01-02T00:00:00Z", "2026-01-02T00:00:00Z")]; // Deleted
    const remote = [tx("id-1", "2026-01-03T00:00:00Z", null)]; // Undeleted on remote
    const result = merge(local, syncDoc(remote));

    // Remote's undeletion is newer
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.deletedAt).toBe(null);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.winner).toBe("remote");
  });

  it("marks a conflict when both local and remote changed (different updatedAt)", () => {
    const local = [tx("id-1", "2026-01-02T10:00:00Z")];
    const remote = [tx("id-1", "2026-01-02T11:00:00Z")];
    const result = merge(local, syncDoc(remote));

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      id: "id-1",
      winner: "remote",
    });
  });

  it("handles mixed local-only, remote-only, and conflicted transactions", () => {
    const local = [
      tx("local-only", "2026-01-02T00:00:00Z"), // Only in local
      tx("conflict-1", "2026-01-02T00:00:00Z"), // Both have it, local older
      tx("conflict-2", "2026-01-03T00:00:00Z"), // Both have it, local newer
    ];
    const remote = [
      tx("remote-only", "2026-01-02T00:00:00Z"), // Only in remote
      tx("conflict-1", "2026-01-03T00:00:00Z"), // Both have it, remote newer
      tx("conflict-2", "2026-01-02T00:00:00Z"), // Both have it, local newer
    ];
    const result = merge(local, syncDoc(remote));

    // Should have 4 transactions: local-only, remote-only, and both conflicts
    expect(result.merged).toHaveLength(4);
    expect(result.merged.map((t) => t.id)).toContain("local-only");
    expect(result.merged.map((t) => t.id)).toContain("remote-only");
    expect(result.merged.map((t) => t.id)).toContain("conflict-1");
    expect(result.merged.map((t) => t.id)).toContain("conflict-2");

    // conflict-1 should use remote's version (newer)
    const conflict1Result = result.merged.find((t) => t.id === "conflict-1");
    expect(conflict1Result?.updatedAt).toBe("2026-01-03T00:00:00Z");

    // conflict-2 should use local's version (newer)
    const conflict2Result = result.merged.find((t) => t.id === "conflict-2");
    expect(conflict2Result?.updatedAt).toBe("2026-01-03T00:00:00Z");

    // Should report exactly 1 conflict (conflict-1 has different timestamps)
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.id).toBe("conflict-1");

    // shouldUpload is true because local-only and conflict-2 (local is newer)
    expect(result.shouldUpload).toBe(true);
  });

  it("sets shouldUpload=true when local has transactions not in remote", () => {
    const local = [tx("local-new", "2026-01-02T00:00:00Z")];
    const result = merge(local, syncDoc([]));
    expect(result.shouldUpload).toBe(true);
  });

  it("sets shouldUpload=true when local's updatedAt is newer than remote's", () => {
    const local = [tx("id-1", "2026-01-03T00:00:00Z")];
    const remote = [tx("id-1", "2026-01-02T00:00:00Z")];
    const result = merge(local, syncDoc(remote));
    expect(result.shouldUpload).toBe(true);
  });

  it("sets shouldUpload=false when remote is newer and has all local ids", () => {
    const local = [tx("id-1", "2026-01-02T00:00:00Z")];
    const remote = [tx("id-1", "2026-01-03T00:00:00Z")];
    const result = merge(local, syncDoc(remote));
    expect(result.shouldUpload).toBe(false);
  });
});

describe("hasDataLoss", () => {
  it("returns false when local and remote are identical", () => {
    const local = [tx("id-1", "2026-01-02T00:00:00Z")];
    const remote = syncDoc([tx("id-1", "2026-01-02T00:00:00Z")]);
    expect(hasDataLoss(local, remote)).toBe(false);
  });

  it("returns false when remote is newer", () => {
    const local = [tx("id-1", "2026-01-02T00:00:00Z")];
    const remote = syncDoc([tx("id-1", "2026-01-03T00:00:00Z")]);
    expect(hasDataLoss(local, remote)).toBe(false);
  });

  it("returns true when local is newer (potential data loss if remote is accepted)", () => {
    const local = [tx("id-1", "2026-01-03T00:00:00Z")];
    const remote = syncDoc([tx("id-1", "2026-01-02T00:00:00Z")]);
    expect(hasDataLoss(local, remote)).toBe(true);
  });

  it("returns false when local only (no conflict)", () => {
    const local = [tx("id-1", "2026-01-02T00:00:00Z")];
    const remote = syncDoc([]);
    expect(hasDataLoss(local, remote)).toBe(false);
  });

  it("returns false when remote only (no local data to lose)", () => {
    const local: Transaction[] = [];
    const remote = syncDoc([tx("id-1", "2026-01-02T00:00:00Z")]);
    expect(hasDataLoss(local, remote)).toBe(false);
  });

  it("detects data loss in one of multiple transactions", () => {
    const local = [
      tx("id-1", "2026-01-02T00:00:00Z"), // OK
      tx("id-2", "2026-01-03T00:00:00Z"), // NEWER — would be lost
    ];
    const remote = syncDoc([
      tx("id-1", "2026-01-03T00:00:00Z"),
      tx("id-2", "2026-01-02T00:00:00Z"),
    ]);
    expect(hasDataLoss(local, remote)).toBe(true);
  });
});
