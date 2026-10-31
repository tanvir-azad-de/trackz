import { useState } from "preact/hooks";
import { TabBar, type TabName } from "@/app/TabBar";
import { HomeScreen } from "@/features/home/HomeScreen";
import { EntrySheet, savedToastMessage } from "@/features/entry/EntrySheet";
import { Toast, type ToastState } from "@/components/Toast";
import { useTransactions } from "@/storage/useTransactions";
import { deleteTransaction } from "@/storage/repository";
import type { Transaction } from "@/domain/transaction";
import "@/app/TabBar.css";
import "@/components/Card.css";
import "@/components/Toast.css";

/**
 * App shell: 4-tab navigation + center FAB. Only Home (Phase 10) is a
 * real screen so far — Activity/Accounts/Settings are Phase 11-13.
 * The FAB opens the quick-entry sheet (Phase 8).
 */
export function App() {
  const [activeTab, setActiveTab] = useState<TabName>("home");
  const [entryOpen, setEntryOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const transactions = useTransactions();

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
      {activeTab === "home" && <HomeScreen />}
      {activeTab === "activity" && <PlaceholderScreen title="Activity" />}
      {activeTab === "accounts" && <PlaceholderScreen title="Accounts" />}
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
