import { useState } from "preact/hooks";
import { useAuthState } from "@/storage/useAuthState";
import { useSyncStatus } from "@/storage/useSyncStatus";
import { isGoogleScriptReady, isSyncConfigured, signIn, signOut } from "@/sync/auth";
import { syncNow } from "@/sync/coordinator";
import type { ToastState } from "@/components/Toast";
import "./SyncSettings.css";

interface SyncSettingsProps {
  onToast?: (toast: ToastState) => void;
}

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

  const configured = isSyncConfigured();

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
            Connect Google Drive to keep this app in step across your devices. trackz asks only
            for permission to the single file it creates — it cannot see anything else in your
            Drive.
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
