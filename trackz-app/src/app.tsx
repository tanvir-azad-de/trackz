import { useState } from "preact/hooks";
import { TabBar, type TabName } from "@/app/TabBar";
import { HomeScreen } from "@/features/home/HomeScreen";
import "@/app/TabBar.css";
import "@/components/Card.css";

/**
 * App shell: 4-tab navigation + center FAB. Only Home (Phase 10) is a
 * real screen so far — Activity/Accounts/Settings are Phase 11-13.
 * Quick-entry (the FAB target) is Phase 8.
 */
export function App() {
  const [activeTab, setActiveTab] = useState<TabName>("home");

  return (
    <div class="app-shell">
      {activeTab === "home" && <HomeScreen />}
      {activeTab === "activity" && <PlaceholderScreen title="Activity" />}
      {activeTab === "accounts" && <PlaceholderScreen title="Accounts" />}
      {activeTab === "settings" && <PlaceholderScreen title="Settings" />}
      <TabBar
        active={activeTab}
        onNavigate={setActiveTab}
        onFabPress={() => {
          // Phase 8: quick-entry sheet. Placeholder for now.
          window.alert("Quick entry coming in Phase 8");
        }}
      />
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
