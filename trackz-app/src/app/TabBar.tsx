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
 * 4 tabs + center FAB, per the locked navigation decision
 * (docs/renovation_version_1.txt). The FAB sits physically between
 * Activity and Debts in the DOM/visual order but is NOT one of the 4
 * tabs — it always opens the quick-entry sheet (Phase 8), it never
 * becomes "active".
 */
export function TabBar({ active, onNavigate, onFabPress }: TabBarProps) {
  const [left, right] = [TABS.slice(0, 2), TABS.slice(2)];
  return (
    <nav class="tab-bar" aria-label="Primary">
      {left.map((tab) => (
        <TabButton key={tab.name} tab={tab} active={active === tab.name} onNavigate={onNavigate} />
      ))}
      <button type="button" class="tab-bar__fab" onClick={onFabPress} aria-label="Add transaction">
        <Plus size="1em" />
      </button>
      {right.map((tab) => (
        <TabButton key={tab.name} tab={tab} active={active === tab.name} onNavigate={onNavigate} />
      ))}
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
    >
      <span class="tab-bar__icon">{tab.icon}</span>
      <span class="tab-bar__label">{tab.label}</span>
    </button>
  );
}
