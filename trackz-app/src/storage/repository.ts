import type { Transaction } from "@/domain/transaction";

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

export function getTransactions(): Transaction[] {
  return readRaw();
}

export function isEmpty(): boolean {
  return localStorage.getItem(STORAGE_KEY) === null;
}

/** Replace the entire transaction list — used by CSV import (Phase 13) and the one-time dev seed. */
export function replaceAllTransactions(transactions: Transaction[]): void {
  writeRaw(transactions);
}

export function addTransaction(tx: Transaction): void {
  const all = readRaw();
  all.push(tx);
  writeRaw(all);
}

export function updateTransaction(tx: Transaction): void {
  const all = readRaw();
  const index = all.findIndex((t) => t.id === tx.id);
  if (index === -1) throw new Error(`updateTransaction: no transaction with id ${tx.id}`);
  all[index] = tx;
  writeRaw(all);
}

export function deleteTransaction(id: string): void {
  const all = readRaw();
  writeRaw(all.filter((t) => t.id !== id));
}
