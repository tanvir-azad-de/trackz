import { useState } from "preact/hooks";
import { TabBar, type TabName } from "@/app/TabBar";
import { HomeScreen } from "@/features/home/HomeScreen";
import { ActivityScreen } from "@/features/activity/ActivityScreen";
import { AccountsScreen } from "@/features/accounts/AccountsScreen";
import { EntrySheet, savedToastMessage } from "@/features/entry/EntrySheet";
import { Toast, type ToastState } from "@/components/Toast";
import { useTransactions } from "@/storage/useTransactions";
import { deleteTransaction } from "@/storage/repository";
import type { Transaction } from "@/domain/transaction";
import { emptyFilter, type ActivityFilter } from "@/features/activity/filter";
import "@/app/TabBar.css";
import "@/components/Card.css";
import "@/components/Toast.css";

/**
 * App shell: 4-tab navigation + center FAB. Home (Phase 10), Activity
 * (Phase 11), and Accounts (Phase 12) are real screens; Settings is still
 * a Phase 13 placeholder. The FAB opens the quick-entry sheet (Phase 8).
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

  return (
    <div class="app-shell">
      {activeTab === "home" && <HomeScreen onDrillDown={navigateToActivity} />}
      {activeTab === "activity" && (
        <ActivityScreen key={activityFilterNonce} initialFilter={activityFilter} onToast={setToast} />
      )}
      {activeTab === "accounts" && <AccountsScreen onDrillDown={navigateToActivity} />}
      {activeTab === "settings" && <PlaceholderScreen title="Settings" />}
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

function PlaceholderScreen({ title }: { title: string }) {
  return (
    <main style={{ padding: "24px 20px", maxWidth: 480, margin: "0 auto" }}>
      <h1 style={{ fontSize: 15, color: "var(--text-secondary)" }}>{title}</h1>
      <p style={{ color: "var(--text-tertiary)", fontSize: 14 }}>Coming in a later phase.</p>
    </main>
  );
}
