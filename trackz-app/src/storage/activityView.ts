/**
 * localStorage plumbing for Activity's days-only toggle (2026-11-19).
 * Device-local and NOT synced: it is a view preference, not data. Read on
 * every mount, which is what makes it survive both a tab switch (tabs
 * unmount) and a reload.
 */
const STORAGE_KEY = "trackz.v2.activityDaysOnly";

export function loadDaysOnly(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDaysOnly(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Private mode / blocked storage: the toggle still works for this visit.
  }
}
