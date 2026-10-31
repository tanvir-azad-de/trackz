import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Sheet } from "@/components/Sheet";
import { CATEGORY_TYPES, categoryTypeLabel } from "@/domain/transaction";
import type { Account, Category } from "@/domain/transaction";
import { getLastNMonthsRange, getLocalToday, getThisMonthRange, getYearToDateRange } from "@/domain/dates";
import { activeFacetCount, emptyFilter, type ActivityFilter } from "@/features/activity/filter";

interface FilterSheetProps {
  open: boolean;
  filter: ActivityFilter;
  accounts: readonly Account[];
  categories: readonly Category[];
  onApply: (next: ActivityFilter) => void;
  onClose: () => void;
}

type PresetKey = "this-month" | "last-3-months" | "this-year" | "all-time";

/**
 * Facet picker for the Activity screen (Phase 11). Reuses Sheet rather
 * than hand-rolling a second backdrop/scroll-lock/escape implementation —
 * Sheet was deliberately kept generic in Phase 8 for exactly this reuse.
 *
 * Edits a local draft (`local`) independently of the committed `filter`
 * prop, so closing via the backdrop/Escape without tapping Apply discards
 * in-progress changes instead of silently half-applying them.
 */
export function FilterSheet({ open, filter, accounts, categories, onApply, onClose }: FilterSheetProps) {
  const [local, setLocal] = useState<ActivityFilter>(filter);

  // Re-sync the draft to the committed filter every time the sheet opens,
  // so reopening it shows the filters currently in effect, not whatever
  // was left over (possibly discarded) from the previous time it was open.
  useEffect(() => {
    if (open) setLocal(filter);
  }, [open, filter]);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function applyPreset(preset: PresetKey) {
    const today = getLocalToday();
    const range =
      preset === "this-month"
        ? getThisMonthRange(today)
        : preset === "last-3-months"
          ? getLastNMonthsRange(3, today)
          : preset === "this-year"
            ? getYearToDateRange(today)
            : null;
    setLocal((f) => ({ ...f, from: range?.from ?? "", to: range?.to ?? "" }));
  }

  function handleApply() {
    onApply(local);
    onClose();
  }

  function handleReset() {
    const reset = { ...emptyFilter(), query: local.query };
    setLocal(reset);
  }

  const facetCount = activeFacetCount(local);

  return (
    <Sheet open={open} onClose={onClose} title="Filter">
      <div class="filter-sheet">
        <FilterSection title="Date">
          <div class="filter-sheet__presets">
            <PresetButton label="This month" onClick={() => applyPreset("this-month")} />
            <PresetButton label="Last 3 months" onClick={() => applyPreset("last-3-months")} />
            <PresetButton label="This year" onClick={() => applyPreset("this-year")} />
            <PresetButton label="All time" onClick={() => applyPreset("all-time")} />
          </div>
          <div class="filter-sheet__date-range">
            <label class="filter-sheet__date-field">
              <span>From</span>
              <input
                type="date"
                class="filter-sheet__date-input"
                value={local.from}
                onInput={(e) => setLocal((f) => ({ ...f, from: e.currentTarget.value }))}
              />
            </label>
            <label class="filter-sheet__date-field">
              <span>To</span>
              <input
                type="date"
                class="filter-sheet__date-input"
                value={local.to}
                onInput={(e) => setLocal((f) => ({ ...f, to: e.currentTarget.value }))}
              />
            </label>
          </div>
        </FilterSection>

        <FilterSection title="Type">
          <div class="filter-sheet__chips">
            {CATEGORY_TYPES.map((t) => (
              <ChipToggle
                key={t}
                label={categoryTypeLabel(t)}
                active={local.categoryTypes.includes(t)}
                onClick={() => setLocal((f) => ({ ...f, categoryTypes: toggle(f.categoryTypes, t) }))}
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Account">
          <div class="filter-sheet__chips">
            {accounts.map((a) => (
              <ChipToggle
                key={a.name}
                label={a.name}
                active={local.accounts.includes(a.name)}
                onClick={() => setLocal((f) => ({ ...f, accounts: toggle(f.accounts, a.name) }))}
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Category">
          <div class="filter-sheet__chips filter-sheet__chips--scroll">
            {categories.map((c) => (
              <ChipToggle
                key={c.name}
                label={c.name}
                active={local.categories.includes(c.name)}
                onClick={() => setLocal((f) => ({ ...f, categories: toggle(f.categories, c.name) }))}
              />
            ))}
          </div>
        </FilterSection>

        <div class="filter-sheet__actions">
          <button type="button" class="filter-sheet__reset" onClick={handleReset} disabled={facetCount === 0}>
            Reset
          </button>
          <button type="button" class="filter-sheet__apply" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function FilterSection({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="filter-sheet__section">
      <h3 class="filter-sheet__section-title">{title}</h3>
      {children}
    </div>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" class="filter-sheet__preset" onClick={onClick}>
      {label}
    </button>
  );
}

function ChipToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class={`filter-sheet__chip ${active ? "filter-sheet__chip--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
