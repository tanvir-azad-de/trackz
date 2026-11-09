import { describe, expect, it } from "vitest";
import { describeSyncAlert } from "@/sync/alerts";

/**
 * These exist because removing the app header removed the only place
 * "conflict" was ever visible. See alerts.ts's header for why that status
 * is the dangerous one to drop: it schedules no retry, so going silent on
 * it means the user's changes sit un-synced with nothing ever saying so.
 */
describe("describeSyncAlert", () => {
  it("alerts on error", () => {
    expect(describeSyncAlert("error", "Drive returned 500")).toEqual({ label: "Sync error" });
  });

  it("alerts on conflict, which nothing else in the app reports", () => {
    expect(describeSyncAlert("conflict", "Another device kept changing data")).toEqual({
      label: "Sync conflict",
    });
  });

  it("distinguishes the two labels rather than calling a conflict an error", () => {
    const conflict = describeSyncAlert("conflict", "msg");
    const error = describeSyncAlert("error", "msg");
    // Both must be present AND differ. Asserting only that they differ
    // would pass if conflict went null, which is the very regression the
    // test above covers — found by mutation.
    expect(conflict).not.toBeNull();
    expect(error).not.toBeNull();
    expect(conflict?.label).not.toBe(error?.label);
  });

  it("stays silent for the self-resolving and benign states", () => {
    // offline/pending retry on their own; signed-out is a valid way to run
    // the app; synced is the happy path. A toast for any of these is noise.
    expect(describeSyncAlert("offline", "net down")).toBeNull();
    expect(describeSyncAlert("pending", "whatever")).toBeNull();
    expect(describeSyncAlert("signed-out", "not connected")).toBeNull();
    expect(describeSyncAlert("synced", "stale message")).toBeNull();
  });

  it("stays silent when there is no message to show", () => {
    // Otherwise the toast renders "Sync error:" with nothing after it.
    expect(describeSyncAlert("error", null)).toBeNull();
    expect(describeSyncAlert("conflict", null)).toBeNull();
    expect(describeSyncAlert("error", "")).toBeNull();
  });
});
