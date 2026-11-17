import type { Transaction } from "@/domain/transaction";
import { historyEventFrom, parseHistory, pushHistory, type HistoryEvent, type HistoryKind } from "@/features/settings/history";

/**
 * localStorage plumbing for features/settings/history.ts. Device-local
 * and not synced (user request: "persisted locally on the user's device").
 */
const STORAGE_KEY = "trackz.v2.history";

export function loadHistory(): HistoryEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return parseHistory(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

export function recordHistory(kind: HistoryKind, tx: Transaction): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pushHistory(loadHistory(), historyEventFrom(kind, tx, new Date().toISOString()))));
  } catch {
    // Private mode / quota: losing a history line is harmless, the save itself already happened.
  }
}
