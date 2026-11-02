import { useState } from "preact/hooks";
import { useAuthState } from "@/storage/useAuthState";
import { useSyncStatus } from "@/storage/useSyncStatus";
import { isGoogleScriptReady, isSyncConfigured, signIn, signOut } from "@/sync/auth";
import { overwriteRemoteWithLocal, syncNow } from "@/sync/coordinator";
import { fetchFromDrive, readRemoteMetadata } from "@/sync/drive";
import type { ToastState } from "@/components/Toast";
import "./SyncSettings.css";

interface SyncSettingsProps {
  onToast?: (toast: ToastState) => void;
}

/**
 * What the "check Drive" readout currently knows. A discriminated union so
 * "not asked yet" and "asked, and there is nothing there" cannot be
 * conflated — they mean very different things to a user wondering whether
 * their data is backed up.
 */
type RemoteState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "loaded"; rows: number; modifiedTime: string }
  | { kind: "error"; message: string };

/**
 * Phase 15b: the Google Drive connection control.
 *
 * This component is what makes the rest of sync/ reachable at all: before
 * it existed, auth.ts's signIn() had no caller anywhere in the app, so
 * getAuthState().isSignedIn was permanently false and performSync() bailed
 * on every attempt. Drive sync was shipped but unreachable.
 *
 * Deliberately placed in Settings rather than prompted at startup. Sync is
 * optional — the app is fully usable with localStorage alone — and an
 * unsolicited Google consent popup on first launch is both hostile and, on
 * iOS Safari, likely to be swallowed by the popup blocker since it
 * wouldn't stem from a user gesture.
 */
export function SyncSettings({ onToast }: SyncSettingsProps) {
  const auth = useAuthState();
  const syncState = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<RemoteState>({ kind: "idle" });

  const configured = isSyncConfigured();

  /**
   * Ask Drive what it is actually holding.
   *
   * This exists because the data lives in Drive's hidden appDataFolder, so
   * the user cannot open Drive and look. Without a readout, "is my data
   * really up there?" would be unanswerable by any means available to
   * them — and the status indicator is no substitute: it reports what this
   * device last ATTEMPTED, which is exactly the thing in doubt.
   *
   * On demand rather than on render: it costs two Drive round trips, and
   * firing those every time Settings is opened would spend the user's
   * quota to answer a question they usually aren't asking.
   */
  async function handleCheckRemote() {
    setRemote({ kind: "loading" });
    try {
      const metadata = await readRemoteMetadata();
      if (!metadata) {
        setRemote({ kind: "empty" });
        return;
      }
      // Row count has to come from the content; file metadata cannot know it.
      const doc = await fetchFromDrive("settings-readout");
      setRemote({
        kind: "loaded",
        rows: doc?.transactions.length ?? 0,
        modifiedTime: metadata.modifiedTime,
      });
    } catch (error) {
      setRemote({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not reach Google Drive.",
      });
    }
  }

  async function handleSignIn() {
    setBusy(true);
    try {
      await signIn();
      onToast?.({ id: Date.now(), message: "Google Drive connected. Syncing…" });
    } catch (error) {
      // Cancelling the Google popup lands here too. It isn't a failure, so
      // report it in the same neutral register as any other outcome rather
      // than as an error the user needs to act on.
      onToast?.({
        id: Date.now(),
        message: error instanceof Error ? error.message : "Could not connect Google Drive.",
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Replace the Drive copy with this device's data.
   *
   * The recovery path for a remote file that has gone wrong — notably one
   * holding duplicates that cannot be reconciled, because nothing links
   * their ids to anything local. Normal sync cannot fix that: it is a
   * union by id, so the remote document only ever grows, and merely
   * reconnecting pulls the junk straight back in.
   *
   * Delegates to overwriteRemoteWithLocal() rather than deleting and
   * calling syncNow(), because that sequence was a race: the debounced
   * merge could re-upload the union before the clean upload landed, so
   * whether it worked depended on how fast the user clicked.
   *
   * Irreversible — appDataFolder files cannot be trashed, so there is
   * nothing to undo from.
   */
  async function handleResetRemote() {
    const confirmed = window.confirm(
      "Replace the copy of your data on Google Drive with this device's data?\n\n" +
        "This cannot be undone. Other devices will be overwritten the next time they sync, " +
        "so make sure THIS device holds the data you want to keep.\n\n" +
        "Export a CSV backup first if you have not already.",
    );
    if (!confirmed) return;

    setBusy(true);
    setRemote({ kind: "idle" });
    try {
      await overwriteRemoteWithLocal();
      onToast?.({
        id: Date.now(),
        message: "Drive now holds this device's data. Check what's on Drive to confirm.",
      });
    } catch (error) {
      onToast?.({
        id: Date.now(),
        message: error instanceof Error ? error.message : "Could not replace the Drive copy.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      onToast?.({
        id: Date.now(),
        message: "Google Drive disconnected. Your data stays on this device.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncNow() {
    setBusy(true);
    try {
      await syncNow();
    } catch {
      // syncNow records its own failure in sync state, which this component
      // already renders — a toast would say the same thing twice.
    } finally {
      setBusy(false);
    }
  }

  // No client ID in this build: say so plainly instead of rendering a
  // button that could only ever throw. This is the B7 lesson — a missing
  // GOOGLE_CLIENT_ID used to fail silently and leave a blank screen.
  if (!configured) {
    return (
      <section class="sync-settings">
        <h2 class="settings-screen__section-title">Sync</h2>
        <p class="settings-screen__hint">
          Google Drive sync isn't available in this build, because it was compiled without a
          Google client ID. Your data is saved on this device only — use Export below to keep a
          backup.
        </p>
      </section>
    );
  }

  const scriptReady = isGoogleScriptReady();

  return (
    <section class="sync-settings">
      <h2 class="settings-screen__section-title">Sync</h2>

      {auth.isSignedIn ? (
        <>
          <p class="settings-screen__hint">
            Connected{auth.userEmail ? ` as ${auth.userEmail}` : ""}. Changes upload to your
            Google Drive a few seconds after you make them, and this device picks up changes made
            on your others.
          </p>
          <p class="sync-settings__status">
            Status: <strong>{describeStatus(syncState.status)}</strong>
            {syncState.lastSyncTime !== null && (
              <span class="sync-settings__last">
                {" "}
                · last synced {formatRelativeTime(syncState.lastSyncTime)}
              </span>
            )}
          </p>
          {syncState.lastError && <p class="sync-settings__error">{syncState.lastError}</p>}
          {remote.kind !== "idle" && (
            <p class="sync-settings__remote">{describeRemote(remote)}</p>
          )}
          <div class="sync-settings__actions">
            <button
              type="button"
              class="settings-data-button"
              onClick={handleSyncNow}
              disabled={busy}
            >
              Sync now
            </button>
            <button
              type="button"
              class="settings-data-button"
              onClick={handleCheckRemote}
              disabled={busy || remote.kind === "loading"}
            >
              Check what's on Drive
            </button>
            <button
              type="button"
              class="settings-data-button settings-data-button--danger"
              onClick={handleResetRemote}
              disabled={busy}
            >
              Replace Drive copy with this device
            </button>
            <button
              type="button"
              class="settings-data-button"
              onClick={handleSignOut}
              disabled={busy}
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="settings-screen__hint">
            Connect Google Drive to keep this app in step across your devices. trackz stores its
            data in a private app folder that only trackz can reach — it cannot see your own
            files in Drive, and the folder won't show up there either.
          </p>
          <div class="sync-settings__actions">
            <button
              type="button"
              class="settings-data-button"
              onClick={handleSignIn}
              /* The GIS script is `async defer`, so on a cold load it may
                 not be parsed yet. Disabling beats letting the tap throw
                 "Google Identity Services not loaded" at the user. */
              disabled={busy || !scriptReady}
            >
              {busy ? "Connecting…" : "Connect Google Drive"}
            </button>
          </div>
          {!scriptReady && (
            <p class="settings-screen__hint">
              Still loading Google sign-in. If this doesn't clear, check your connection.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Phrase the status for a settings page, where there is room for a full
 * sentence — unlike SyncStatusIndicator's one-or-two-word header badge.
 */
function describeStatus(status: ReturnType<typeof useSyncStatus>["status"]): string {
  switch (status) {
    case "synced":
      return "up to date";
    case "pending":
      return "syncing…";
    case "offline":
      return "offline — will retry";
    case "conflict":
      return "conflict — sync again to resolve";
    case "signed-out":
      return "not syncing";
    case "error":
      return "error";
  }
}

/** Coarse relative time; "last synced 3 minutes ago" needs no precision. */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Describe what Drive is holding. Says "no data yet" rather than anything
 * reassuring when the file is missing: with no visible file to check, a
 * vague message here would leave the user believing they have a backup
 * they do not have.
 */
function describeRemote(remote: RemoteState): string {
  switch (remote.kind) {
    case "idle":
      return "";
    case "loading":
      return "Checking Drive…";
    case "empty":
      return "Nothing on Drive yet — no data has been uploaded from any device.";
    case "loaded": {
      const rows = `${remote.rows} ${remote.rows === 1 ? "transaction" : "transactions"}`;
      const when = remote.modifiedTime
        ? formatRelativeTime(new Date(remote.modifiedTime).getTime())
        : "an unknown time ago";
      return `Drive holds ${rows}, last changed ${when}.`;
    }
    case "error":
      return remote.message;
  }
}
