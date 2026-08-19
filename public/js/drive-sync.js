// Google Drive sync — OAuth via Google Identity Services, no backend required.
// Set GOOGLE_CLIENT_ID to your OAuth 2.0 Client ID from Google Cloud Console.
// Authorized JavaScript origins must include this page's origin.

const GOOGLE_CLIENT_ID = window.TRACKZ_CONFIG?.GOOGLE_CLIENT_ID || "";

const DRIVE_FILE_NAME = "trackz-data.json";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GAPI_DISCOVERY = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
const SYNC_INTERVAL_MS = 1_000;

let _accessToken = null;
let _dirty = false;
let _syncTimer = null;
let _cachedFileId = null;

// ── Auth ──────────────────────────────────────────────────────────────────────

function isSignedIn() {
    return Boolean(_accessToken);
}

function setAccessToken(token) {
    _accessToken = token;
    if (token) {
        localStorage.setItem("trackz_token", token);
        localStorage.setItem("trackz_signed_in", "1");
    } else {
        localStorage.removeItem("trackz_token");
        localStorage.removeItem("trackz_signed_in");
    }
}

function getStoredToken() {
    return localStorage.getItem("trackz_token");
}

function signIn() {
    return new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: DRIVE_SCOPE,
            callback: (response) => {
                if (response.error) { reject(new Error(response.error)); return; }
                setAccessToken(response.access_token);
                resolve(response);
            }
        });
        client.requestAccessToken();
    });
}

// Restore token without showing popup — only use stored token
function restoreSession() {
    const token = getStoredToken();
    if (token) {
        _accessToken = token;
        return true;
    }
    return false;
}

function signOut() {
    if (_accessToken) {
        google.accounts.oauth2.revoke(_accessToken);
    }
    setAccessToken(null);
    _cachedFileId = null;
    _dirty = false;
    clearInterval(_syncTimer);
    showLoginScreen();
}

// ── Drive API helpers ─────────────────────────────────────────────────────────

async function driveRequest(method, path, options = {}) {
    const url = `https://www.googleapis.com${path}`;
    const headers = {
        Authorization: `Bearer ${_accessToken}`,
        ...options.headers
    };
    const response = await fetch(url, { method, headers, body: options.body });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Drive API ${method} ${path} → ${response.status}: ${text}`);
    }
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
}

async function findFile() {
    if (_cachedFileId) return _cachedFileId;
    const result = await driveRequest(
        "GET",
        `/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=name='${DRIVE_FILE_NAME}'`
    );
    const file = (result.files || []).find((f) => f.name === DRIVE_FILE_NAME);
    _cachedFileId = file?.id || null;
    return _cachedFileId;
}

async function downloadData() {
    const fileId = await findFile();
    if (!fileId) return null;
    const text = await driveRequest("GET", `/drive/v3/files/${fileId}?alt=media`);
    return typeof text === "string" ? JSON.parse(text) : text;
}

async function uploadData(data) {
    const json = JSON.stringify(data);
    const fileId = await findFile();

    if (fileId) {
        // Update existing file
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${_accessToken}`,
                "Content-Type": "application/json"
            },
            body: json
        });
    } else {
        // Create new file in appDataFolder
        const metadata = { name: DRIVE_FILE_NAME, parents: ["appDataFolder"] };
        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        form.append("file", new Blob([json], { type: "application/json" }));
        const response = await fetch(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
            {
                method: "POST",
                headers: { Authorization: `Bearer ${_accessToken}` },
                body: form
            }
        );
        const result = await response.json();
        _cachedFileId = result.id;
    }
}

// ── Sync logic ────────────────────────────────────────────────────────────────

function markDirty() {
    _dirty = true;
}

async function syncNow() {
    if (!isSignedIn() || !_dirty) return;
    try {
        await uploadData(window.db.exportAll());
        _dirty = false;
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        updateSyncStatus(`Last synced at ${time}`);
    } catch (err) {
        console.error("Drive sync failed:", err);
        updateSyncStatus("Sync failed");
    }
}

function startSyncTimer() {
    clearInterval(_syncTimer);
    _syncTimer = setInterval(syncNow, SYNC_INTERVAL_MS);
}

function updateSyncStatus(message) {
    const el = document.getElementById("sync-status");
    if (el) el.textContent = message;
}

// ── Login screen ──────────────────────────────────────────────────────────────

function showLoginScreen() {
    document.getElementById("login-screen").hidden = false;
    document.getElementById("app-root").hidden = true;
}

function hideLoginScreen() {
    document.getElementById("login-screen").hidden = true;
    document.getElementById("app-root").hidden = false;
}

// ── Initialisation ────────────────────────────────────────────────────────────

async function initDriveSync() {
    // If no client ID is configured, skip auth and run offline
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID_HERE") {
        console.warn("No Google Client ID configured. Running without Drive sync.");
        hideLoginScreen();
        window.db.init();
        return;
    }

    // Try to restore session from stored token — no popup
    if (restoreSession()) {
        try {
            const remote = await downloadData();
            if (remote) window.db.importAll(remote);
            window.db.init();
            hideLoginScreen();
            updateSyncStatus("Drive connected");
            startSyncTimer();
            if (window.loadData) await window.loadData();
            return;
        } catch (err) {
            console.warn("Session restore failed, showing login:", err);
            setAccessToken(null);
        }
    }

    showLoginScreen();
}

async function handleSignIn() {
    const btn = document.getElementById("signin-button");
    btn.disabled = true;
    btn.textContent = "Signing in…";

    try {
        await signIn();
        localStorage.setItem("trackz_signed_in", "1");

        // Try to load data from Drive first
        const remote = await downloadData();
        if (remote) {
            window.db.importAll(remote);
        }
        window.db.init();

        hideLoginScreen();
        updateSyncStatus("Drive connected");
        startSyncTimer();

        // Trigger app load
        if (window.loadData) {
            await window.loadData();
        }
    } catch (err) {
        console.error("Sign-in failed:", err);
        btn.disabled = false;
        btn.textContent = "Sign in with Google";
        const msg = document.getElementById("login-error");
        if (msg) {
            msg.textContent = "Sign-in failed. Please try again.";
            msg.hidden = false;
        }
    }
}

window.driveSync = {
    markDirty,
    syncNow,
    signOut,
    isSignedIn,
    init: initDriveSync,
    handleSignIn
};
