import { useEffect, useState } from "preact/hooks";
import type { Transaction } from "@/domain/transaction";
import { getTransactions, subscribe } from "@/storage/repository";

/**
 * Live-reads the transaction list and re-renders whenever it changes
 * (add/update/delete/replace — see storage/repository.ts's subscribe()).
 *
 * Added for Phase 8: before this, HomeScreen read the repository once
 * inside useMemo(..., []) and never again, so saving a quick-entry
 * transaction changed localStorage but not a single pixel on screen.
 * Every screen that reads transactions should use this hook instead of
 * calling getTransactions() directly, so Phase 11-13 get this for free.
 *
 * Preact 11's hooks package has no useSyncExternalStore, so this is a
 * plain subscribe-in-effect hook instead.
 */
export function useTransactions(): Transaction[] {
  const [transactions, setTransactions] = useState<Transaction[]>(() => getTransactions());

  useEffect(() => {
    const unsubscribe = subscribe(() => setTransactions(getTransactions()));
    return unsubscribe;
  }, []);

  return transactions;
}
