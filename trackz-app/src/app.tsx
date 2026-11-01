import { useEffect, useState } from "preact/hooks";
import { TabBar, type TabName } from "@/app/TabBar";
import { HomeScreen } from "@/features/home/HomeScreen";
import { ActivityScreen } from "@/features/activity/ActivityScreen";
import { AccountsScreen } from "@/features/accounts/AccountsScreen";
import { SettingsScreen } from "@/features/settings/SettingsScreen";
import { EntrySheet, savedToastMessage } from "@/features/entry/EntrySheet";
import { Toast, type ToastState } from "@/components/Toast";
import { useTransactions } from "@/storage/useTransactions";
import { deleteTransaction } from "@/storage/repository";
import type { Transaction } from "@/domain/transaction";
import { emptyFilter, type ActivityFilter } from "@/features/activity/filter";
import { applyServiceWorkerUpdate, registerServiceWorker } from "@/pwa/registerServiceWorker";
import { SyncStatusIndicator } from "@/app/SyncStatusIndicator";
import { initializeSync } from "@/sync/coordinator";
import "@/app/TabBar.css";
import "@/app/SyncStatusIndicator.css";
import "@/components/Card.css";
import "@/components/Toast.css";

/**
 * App shell: 4-tab navigation + center FAB. Home (Phase 10), Activity
 * (Phase 11), Accounts (Phase 12), and Settings' account-type section
 * (the post-Phase-12 SCLB fix's follow-up) are real screens. The FAB
 * opens the quick-entry sheet (Phase 8).
 */
export function App() {
  const [activeTab, setActiveTab] = useState<TabName>("home");
  const [entryOpen, setEntryOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const transactions = useTransactions();

  // Lifted here (rather than owned by ActivityScreen) so a Home insight
  // card can deep-link into a pre-filtered Activity view (closes the gap
  // left open in Phase 10's write-up: "every insight card taps through to
  // a filtered Activity view" was written before Activity existed).
  // `activityFilterNonce` is bumped only on an explicit deep-link and
  // passed to ActivityScreen as `key` — remounting resets the screen's
  // scroll position and internal state cleanly, and plain tab-switching
  // (which doesn't touch the nonce) leaves the screen's own state alone.
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>(emptyFilter());
  const [activityFilterNonce, setActivityFilterNonce] = useState(0);

  function navigateToActivity(filter: ActivityFilter) {
    setActivityFilter(filter);
    setActivityFilterNonce((n) => n + 1);
    setActiveTab("activity");
  }

  function handleSaved(tx: Transaction) {
    setToast({
      id: Date.now(),
      message: savedToastMessage(tx),
      actionLabel: "Undo",
      onAction: () => deleteTransaction(tx.id),
    });
  }

  // Phase 16: a new service-worker version sitting in "waiting" means a
  // newer build has been deployed since this tab loaded. Reusing the same
  // Toast primitive every other save/delete/account-type action uses
  // (see components/Toast.tsx) rather than inventing a banner/modal — the
  // only difference is durationMs: Infinity, since "reload when you're
  // ready" has none of the urgency of a 5s undo window.
  useEffect(() => {
    registerServiceWorker(() => {
      setToast({
        id: Date.now(),
        message: "A new version of trackz is available.",
        actionLabel: "Reload",
        onAction: applyServiceWorkerUpdate,
        durationMs: Infinity,
      });
    });
  }, []);

  // Phase 15b: Initialize sync coordinator on mount
  useEffect(() => {
    initializeSync();
  }, []);

  return (
    <div class="app-shell">
      <div class="app-header">
        <h1 class="app-title">trackz</h1>
        <SyncStatusIndicator />
      </div>
      {activeTab === "home" && <HomeScreen onDrillDown={navigateToActivity} />}
      {activeTab === "activity" && (
        <ActivityScreen key={activityFilterNonce} initialFilter={activityFilter} onToast={setToast} />
      )}
      {activeTab === "accounts" && <AccountsScreen onDrillDown={navigateToActivity} />}
      {activeTab === "settings" && <SettingsScreen onToast={setToast} />}
      <TabBar active={activeTab} onNavigate={setActiveTab} onFabPress={() => setEntryOpen(true)} />
      <EntrySheet
        open={entryOpen}
        transactions={transactions}
        onClose={() => setEntryOpen(false)}
        onSaved={handleSaved}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
