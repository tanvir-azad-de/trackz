import { useEffect, useState } from "preact/hooks";
import type { AccountType } from "@/domain/transaction";
import { getAccountTypes, subscribeAccountTypes } from "@/storage/accountTypes";

/** Live-reads the account-type classification map. Same subscribe-in-effect pattern as useTransactions.ts, for the same reason (Preact 11 has no useSyncExternalStore). */
export function useAccountTypes(): Record<string, AccountType> {
  const [types, setTypes] = useState<Record<string, AccountType>>(() => getAccountTypes());

  useEffect(() => {
    const unsubscribe = subscribeAccountTypes(() => setTypes(getAccountTypes()));
    return unsubscribe;
  }, []);

  return types;
}
