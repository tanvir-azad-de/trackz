import type { RememberedEntry } from "@/features/entry/lastUsed";

/**
 * localStorage plumbing for features/entry/lastUsed.ts (the pure half).
 *
 * Device-local and NOT part of Drive sync: this is a UI preference (what
 * to pre-fill), not financial data. That keeps it consistent with
 * "accounts and categories are derived, never persisted": no name lives
 * here that isn't also on a real transaction.
 */
const STORAGE_KEY = "trackz.v2.entryLastUsed";

/** Returns the raw parsed value, unvalidated; draftFromRemembered checks each field. */
export function loadRememberedEntry(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveRememberedEntry(entry: RememberedEntry): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Private mode / quota: losing the pre-fill is harmless, the save itself already happened.
  }
}
