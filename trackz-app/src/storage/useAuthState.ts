import { useEffect, useState } from "preact/hooks";
import { getAuthState, subscribeToAuth, type AuthState } from "@/sync/auth";

/**
 * Phase 15b: Hook to subscribe to Google auth state changes.
 *
 * Same shape as useSyncStatus (storage/useSyncStatus.ts) — read the
 * current value, then re-render on every change. Settings uses this to
 * show whether Drive is connected and which account.
 */
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>(getAuthState);

  useEffect(() => {
    const unsubscribe = subscribeToAuth(setState);
    // Auth can change between the initial render and this effect running
    // (restoreSession resolves independently of the component lifecycle),
    // so re-read rather than trusting the useState initializer.
    setState(getAuthState());
    return unsubscribe;
  }, []);

  return state;
}
