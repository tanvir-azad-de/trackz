import type { Transaction } from "@/domain/transaction";
// Phase 15b: notify coordinator when local data changes so it can debounce sync
// (lazy import to avoid circular dependencies if coordinator later imports from repo)
let markLocalChanged: (() => void) | null = null;

export function setSyncNotifier(notifier: () => void): void {
  markLocalChanged = notifier;
}

/**
 * Runtime persistence for transactions. New, namespaced key — NOT the old
 * app's `trackz_transactions`. The old keys are never read or written by
 * this app (see Phase 0: confirmed the CSV backup is the single source of
 * truth going forward, so there is no v1->v2 migration to perform; this
 * key exists purely so a second old install's data can't silently bleed
 * into this one by sharing a key name).
 *
 * Accounts/categories/merchants are NEVER stored here — they are always
 * derived from this transaction list (see storage/derive.ts).
 */
const STORAGE_KEY = "trackz.v2.transactions";

/**
 * Subscribers notified after every write (add/update/delete/replace) so UI
 * can re-read without polling. Hand-rolled instead of a state library —
 * this repository is the only mutable store in the app, and the surface
 * is tiny (get the list, get notified it changed). See
 * storage/useTransactions.ts for the Preact-side consumer.
 */
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notify after a write. UI subscribers always hear about it; the sync
 * coordinator hears about it unless the caller marks the write `silent`
 * (see replaceAllTransactions for why sync needs that).
 */
function notify(options?: { silent?: boolean }): void {
  for (const listener of listeners) listener();
  if (markLocalChanged && !options?.silent) markLocalChanged();
}

/**
 * Reads the FULL stored array, tombstones included. Only sync (which needs
 * to see and transmit deletes) and getTransactionsIncludingDeleted() below
 * should call this — every ordinary screen must go through
 * getTransactions(), which filters tombstones, or a "deleted" row would
 * reappear in totals/lists.
 */
function readRaw(): Transaction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(transactions: Transaction[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

/**
 * Live (non-deleted) transactions — what every screen should read. Tombstones
 * (deletedAt !== null, see Phase 15a) exist in storage so a delete can
 * propagate through sync (storage/__tests__ and sync/merge.ts are the only
 * other code that should ever see one), but must never reappear in a list,
 * total, or export a human looks at.
 */
export function getTransactions(): Transaction[] {
  return readRaw().filter((t) => t.deletedAt === null);
}

/** Includes tombstones. Used by sync (needs to transmit deletes) and CSV export (round-trips tombstones so an export/reimport cycle doesn't resurrect anything a device hasn't synced yet). */
export function getTransactionsIncludingDeleted(): Transaction[] {
  return readRaw();
}

/**
 * True when there is no LIVE transaction data yet — used by the dev
 * seed (dev/seed.ts) to decide whether to load sample data, and
 * previously checked `localStorage.getItem(STORAGE_KEY) === null`
 * exactly. That definition has a trap: after ANY write (including
 * writing an empty array, e.g. importing a CSV with zero rows, or
 * deleting every transaction one at a time), the key exists but is
 * "[]" — so isEmpty() would return false and the dev seed could never
 * re-run to recover sample data. Checking the actual array length
 * closes that gap.
 *
 * Phase 15a: deliberately counts getTransactions() (tombstones filtered),
 * not readRaw(). A ledger that's been fully deleted down to nothing but
 * tombstones should still read as "empty" and offer to reseed/reimport —
 * counting raw length would make a user who deleted everything unable to
 * ever see that path again.
 */
export function isEmpty(): boolean {
  return getTransactions().length === 0;
}

/**
 * Replace the entire transaction list — used by CSV import (Phase 13a,
 * features/settings), the one-time dev seed, and sync.
 *
 * `silent: true` still notifies UI subscribers, but does NOT tell the sync
 * coordinator that anything changed locally. Sync must pass it, because a
 * sync-originated write is not a local change: treating it as one made
 * sync self-perpetuating — performSync wrote the merge result, that write
 * re-armed the 5s debounce, and the debounce ran performSync again, giving
 * a full Drive round trip every five seconds for as long as the app was
 * open, with the status indicator never able to settle on "Synced".
 */
export function replaceAllTransactions(
  transactions: Transaction[],
  options?: { silent?: boolean },
): void {
  writeRaw(transactions);
  notify({ silent: options?.silent });
}

export function addTransaction(tx: Transaction): void {
  const all = readRaw();
  all.push(tx);
  writeRaw(all);
  notify();
}

export function updateTransaction(tx: Transaction): void {
  const all = readRaw();
  const index = all.findIndex((t) => t.id === tx.id);
  if (index === -1) throw new Error(`updateTransaction: no transaction with id ${tx.id}`);
  all[index] = { ...tx, updatedAt: new Date().toISOString() };
  writeRaw(all);
  notify();
}

/**
 * Soft delete (Phase 15a): sets deletedAt + bumps updatedAt instead of
 * removing the row. See the Transaction.deletedAt doc comment for why a
 * hard delete would be invisible to sync. Throws on a missing id —
 * matches updateTransaction's contract, since both mutate an existing row
 * by id.
 */
export function deleteTransaction(id: string): void {
  const all = readRaw();
  const index = all.findIndex((t) => t.id === id);
  if (index === -1) throw new Error(`deleteTransaction: no transaction with id ${id}`);
  const now = new Date().toISOString();
  all[index] = { ...all[index]!, deletedAt: now, updatedAt: now };
  writeRaw(all);
  notify();
}

/**
 * Inverse of deleteTransaction — clears the tombstone. Used by the
 * Activity screen's delete-undo toast (previously re-inserted the whole
 * object via addTransaction(), which is wrong now: the row never left
 * storage, it was just marked deleted, so re-adding it would create a
 * SECOND row with the same id).
 */
export function undeleteTransaction(id: string): void {
  const all = readRaw();
  const index = all.findIndex((t) => t.id === id);
  if (index === -1) throw new Error(`undeleteTransaction: no transaction with id ${id}`);
  all[index] = { ...all[index]!, deletedAt: null, updatedAt: new Date().toISOString() };
  writeRaw(all);
  notify();
}

/**
 * Permanently removes tombstones older than retentionDays (default 90).
 * Safe to run opportunistically (e.g. on app start) because by the time a
 * tombstone is this old, every device that could still need to see the
 * delete has almost certainly already synced past it — see
 * sync/merge.ts's doc comment for the exact hazard this trades off
 * (a device offline longer than retentionDays could resurrect a row it
 * never saw deleted). Returns the number of rows actually purged, mostly
 * so a test can assert something happened.
 */
export function purgeOldTombstones(retentionDays = 90): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const all = readRaw();
  const kept = all.filter((t) => t.deletedAt === null || new Date(t.deletedAt).getTime() > cutoff);
  const purged = all.length - kept.length;
  if (purged > 0) {
    writeRaw(kept);
    notify();
  }
  return purged;
}
