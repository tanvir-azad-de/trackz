import type { AccountType } from "@/domain/transaction";

/**
 * Persisted account-type classification (cash vs investment) — see the
 * AccountType comment in domain/transaction.ts for why this is the one
 * piece of account metadata that IS stored, unlike everything else
 * (balances/names), which Phase 0 locked as pure transaction derivations.
 *
 * Caught live during Phase 12 QA: SCLB (Scalable Capital, a real
 * brokerage account in the user's data) was being summed into Home's
 * "Liquid" hero and the Accounts screen's "Liquid" total alongside true
 * cash accounts, overstating spendable cash by its full 2.300,00 €
 * balance (3.147,07 € shown vs 847,07 € true liquid cash). This map is
 * the fix: SCLB is seeded as "investment" below; everything else
 * defaults to "cash" so no other account's behavior changes.
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

/**
 * Marks that the seed has been applied, so it is applied exactly once per
 * device rather than on every read.
 *
 * This flag is the fix for a phantom third writer. readRaw() used to merge
 * `{...SEED_DEFAULTS, ...parsed}` on EVERY read, which hardcoded
 * SCLB: "investment" into the result forever. Once this map syncs, that
 * becomes destructive: a device with cleared storage re-seeds "investment"
 * and can overwrite a deliberate "cash" that the user set on another
 * device. A seed is a first-run convenience, not a standing opinion.
 */
const SEED_APPLIED_KEY = "trackz.v2.accountTypes.seeded";

/** Known non-cash accounts, seeded once rather than requiring the user to manually reclassify SCLB after every Phase 0-style fresh import. */
const SEED_DEFAULTS: Record<string, AccountType> = {
  SCLB: "investment",
};

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
          if (value === "cash" || value === "investment") {
            // Old flat shape.
            stored[account] = { type: value, updatedAt: new Date(0).toISOString() };
          } else if (
            typeof value === "object" &&
            value !== null &&
            "type" in value &&
            ((value as AccountTypeEntry).type === "cash" ||
              (value as AccountTypeEntry).type === "investment")
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

  return applySeedOnce(stored);
}

/**
 * Apply SEED_DEFAULTS only on a genuinely first run, and record that it
 * happened. "First run" means the seed flag is absent AND the account has
 * no stored classification — so a user who explicitly set SCLB to "cash"
 * before this flag existed does not get it silently flipped back.
 */
function applySeedOnce(stored: AccountTypeMap): AccountTypeMap {
  let alreadySeeded = true;
  try {
    alreadySeeded = localStorage.getItem(SEED_APPLIED_KEY) !== null;
  } catch {
    // No localStorage (private browsing, or Node): treat the seed as done
    // rather than re-seeding on every read, which is the bug being fixed.
    return stored;
  }

  if (alreadySeeded) return stored;

  const seeded: AccountTypeMap = { ...stored };
  const now = new Date(0).toISOString();
  for (const [account, type] of Object.entries(SEED_DEFAULTS)) {
    // Epoch-dated for the same reason as the migration: a seed is the
    // weakest possible claim and must lose to any real user edit.
    if (!seeded[account]) seeded[account] = { type, updatedAt: now };
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    localStorage.setItem(SEED_APPLIED_KEY, new Date().toISOString());
  } catch {
    // Unwritable storage: returning the seeded view is still correct for
    // this session.
  }

  return seeded;
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
    if (remoteEntry?.type !== "cash" && remoteEntry?.type !== "investment") continue;

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

/** Test-only: forget that the seed ran, so first-run behaviour can be exercised. */
export function resetSeedForTesting(): void {
  try {
    localStorage.removeItem(SEED_APPLIED_KEY);
  } catch {
    // Nothing to reset without storage.
  }
}
