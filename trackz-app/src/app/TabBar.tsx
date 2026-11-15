import type { ComponentChildren } from "preact";
import { Handshake, House, List, Plus, Settings } from "@/components/icons";

export type TabName = "home" | "activity" | "accounts" | "settings";

interface TabBarProps {
  active: TabName;
  onNavigate: (tab: TabName) => void;
  onFabPress: () => void;
}

interface TabDef {
  name: TabName;
  label: string;
  icon: ComponentChildren;
}

const TABS: TabDef[] = [
  { name: "home", label: "Home", icon: <House size="1em" /> },
  { name: "activity", label: "Activity", icon: <List size="1em" /> },
  { name: "accounts", label: "Debts", icon: <Handshake size="1em" /> },
  { name: "settings", label: "Settings", icon: <Settings size="1em" /> },
];

/**
 * 4 tabs + the Add button, per the locked navigation decision
 * (docs/renovation_version_1.txt). Add is NOT one of the 4 tabs — it
 * always opens the entry screen and never becomes "active" — so it sits
 * outside the tab capsule, as its own circle on the right
 * (docs/mockups/tab-bar.html, option A).
 */
export function TabBar({ active, onNavigate, onFabPress }: TabBarProps) {
  return (
    <nav class="tab-bar" aria-label="Primary">
      <div class="tab-bar__capsule">
        {TABS.map((tab) => (
          <TabButton key={tab.name} tab={tab} active={active === tab.name} onNavigate={onNavigate} />
        ))}
      </div>
      <button type="button" class="tab-bar__fab" onClick={onFabPress} aria-label="Add transaction">
        <Plus size="1em" />
      </button>
    </nav>
  );
}

function TabButton({
  tab,
  active,
  onNavigate,
}: {
  tab: TabDef;
  active: boolean;
  onNavigate: (tab: TabName) => void;
}) {
  return (
    <button
      type="button"
      class={`tab-bar__tab ${active ? "tab-bar__tab--active" : ""}`}
      onClick={() => onNavigate(tab.name)}
      aria-current={active ? "page" : undefined}
      // Icon-only: the label is the accessible name, not visible text.
      aria-label={tab.label}
    >
      <span class="tab-bar__icon">{tab.icon}</span>
    </button>
  );
}
