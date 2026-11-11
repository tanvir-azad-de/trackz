import { isAccountType, type AccountType } from "@/domain/transaction";

/**
 * Persisted account-type classification (cash / investment / credit
 * card) — see the AccountType comment in domain/transaction.ts for why
 * this is the one piece of account metadata that IS stored, unlike
 * everything else (balances/names), which Phase 0 locked as pure
 * transaction derivations.
 *
 * Its source of truth is the CSV (user decision 2026-11-11): an import
 * replaces the whole map from the file's `accountTypes` config cell
 * (replaceAccountTypes), and the entry form sets one entry when it
 * creates a new account. There is no Settings control any more.
 *
 * New, namespaced key — same posture as storage/repository.ts.
 *
 * WHY EVERY ENTRY CARRIES A TIMESTAMP. This map syncs across devices, and
 * a bare `Record<string, AccountType>` cannot be merged: with no per-entry
 * timestamp, two devices that each classified a different account would
 * have to resolve by whole-map last-writer-wins, silently discarding the
 * other device's classification. Timestamping each entry lets the same
 * last-writer-wins rule merge.ts uses for transactions apply per account,
 * so independent edits on two devices both survive.
 *
 * Without syncing this map at all, two devices holding byte-identical
 * transactions would show different "Liquid" headline figures — the same
 * class of silent mismatch as the Phase 13a preview-vs-Home bug.
 */
const STORAGE_KEY = "trackz.v2.accountTypes";

/** A classification plus when it was last set, for cross-device merging. */
export interface AccountTypeEntry {
  type: AccountType;
  updatedAt: string; // ISO timestamp
}

export type AccountTypeMap = Record<string, AccountTypeEntry>;

const listeners = new Set<() => void>();

export function subscribeAccountTypes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Read the stored map, migrating the pre-sync flat shape on the way.
 *
 * The migration is read-time and non-destructive: existing
 * `trackz.v2.accountTypes` data is `{"SCLB":"investment"}`, and a user who
 * already classified accounts must not lose that to a format change.
 * Migrated entries are backdated to the epoch so that ANY later explicit
 * edit, on this device or another, wins the merge — a timestamp of "now"
 * would make every old entry look freshly authoritative and beat genuine
 * recent edits from another device.
 */
function readRaw(): AccountTypeMap {
  let stored: AccountTypeMap = {};

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        for (const [account, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (isAccountType(value)) {
            // Old flat shape.
            stored[account] = { type: value, updatedAt: new Date(0).toISOString() };
          } else if (
            typeof value === "object" &&
            value !== null &&
            "type" in value &&
            isAccountType((value as AccountTypeEntry).type)
          ) {
            const entry = value as AccountTypeEntry;
            stored[account] = {
              type: entry.type,
              updatedAt: entry.updatedAt ?? new Date(0).toISOString(),
            };
          }
          // Anything else is corrupt and skipped: a bad entry should cost
          // one account's classification, not the whole map.
        }
      }
    }
  } catch {
    stored = {};
  }

  return stored;
}

function writeRaw(types: AccountTypeMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
}

/** The full map WITH timestamps — what sync needs. UI should use getAccountTypes(). */
export function getAccountTypeEntries(): AccountTypeMap {
  return readRaw();
}

/** Returns the flat classification map the UI renders from. Unlisted accounts are "cash" by convention — see getAccountType. */
export function getAccountTypes(): Record<string, AccountType> {
  const flat: Record<string, AccountType> = {};
  for (const [account, entry] of Object.entries(readRaw())) {
    flat[account] = entry.type;
  }
  return flat;
}

/** "cash" for any account with no explicit entry (including one that doesn't exist yet, e.g. mid-quick-entry). */
export function getAccountType(accountName: string): AccountType {
  return readRaw()[accountName]?.type ?? "cash";
}

export function setAccountType(accountName: string, type: AccountType): void {
  const all = readRaw();
  all[accountName] = { type, updatedAt: new Date().toISOString() };
  writeRaw(all);
  notify();
}

/**
 * Merge a remote account-type map into the local one, per account, by
 * last-writer-wins — the same rule sync/merge.ts applies to transactions,
 * including its tie-break: equal timestamps keep the LOCAL value.
 *
 * Per-account rather than whole-map, so classifying account A on this
 * device and account B on another leaves both classified.
 *
 * @returns true if anything changed locally (so the caller can decide
 *          whether a notify and an upload are warranted)
 */
export function mergeAccountTypes(remote: AccountTypeMap | undefined): boolean {
  if (!remote) return false;

  const local = readRaw();
  let changed = false;

  for (const [account, remoteEntry] of Object.entries(remote)) {
    if (!isAccountType(remoteEntry?.type)) continue;

    const localEntry = local[account];
    if (!localEntry) {
      local[account] = remoteEntry;
      changed = true;
      continue;
    }

    const localTime = new Date(localEntry.updatedAt).getTime();
    const remoteTime = new Date(remoteEntry.updatedAt).getTime();
    if (remoteTime > localTime) {
      local[account] = remoteEntry;
      changed = true;
    }
  }

  if (changed) {
    writeRaw(local);
    notify();
  }

  return changed;
}

/**
 * Replace the whole map with an import's classification (the CSV is the
 * source of truth). Every entry is stamped now, so the next sync's
 * per-account last-writer-wins carries the import to other devices.
 *
 * Accounts absent from `types` are NOT kept: a stale local entry for an
 * account the file no longer has would otherwise linger. (Sync's merge is
 * a union, so another device can still send it back; it is harmless,
 * since an account with no rows is never shown.)
 */
export function replaceAccountTypes(types: Record<string, AccountType>, now: string = new Date().toISOString()): void {
  const next: AccountTypeMap = {};
  for (const [account, type] of Object.entries(types)) next[account] = { type, updatedAt: now };
  writeRaw(next);
  notify();
}
