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
 */
const STORAGE_KEY = "trackz.v2.accountTypes";

/** Known non-cash accounts, seeded once rather than requiring the user to manually reclassify SCLB after every Phase 0-style fresh import. */
const SEED_DEFAULTS: Record<string, AccountType> = {
  SCLB: "investment",
};

const listeners = new Set<() => void>();

export function subscribeAccountTypes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

function readRaw(): Record<string, AccountType> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...SEED_DEFAULTS };
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? { ...SEED_DEFAULTS, ...parsed } : { ...SEED_DEFAULTS };
  } catch {
    return { ...SEED_DEFAULTS };
  }
}

function writeRaw(types: Record<string, AccountType>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
}

/** Returns the full classification map (every explicitly-set account + the seed defaults). Unlisted accounts are "cash" by convention — see getAccountType. */
export function getAccountTypes(): Record<string, AccountType> {
  return readRaw();
}

/** "cash" for any account with no explicit entry (including one that doesn't exist yet, e.g. mid-quick-entry). */
export function getAccountType(accountName: string): AccountType {
  return readRaw()[accountName] ?? "cash";
}

export function setAccountType(accountName: string, type: AccountType): void {
  const all = readRaw();
  all[accountName] = type;
  writeRaw(all);
  notify();
}
