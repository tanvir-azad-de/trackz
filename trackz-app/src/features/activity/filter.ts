import type { CategoryType, Transaction } from "@/domain/transaction";
import type { ISODate } from "@/domain/dates";
import {
  getLastNMonthsRange,
  getLocalToday,
  getThisMonthRange,
  getYearToDateRange,
} from "@/domain/dates";

/**
 * Pure filtering for the Activity screen (Phase 11). No DOM, no
 * localStorage — same posture as insights/engine.ts, for the same reason
 * (testable against the real CSV, no half-initialized-global class of
 * bug from the old dashboard.js).
 *
 * `from`/`to` are deliberately independent optional bounds rather than a
 * single DateRange (@/domain/dates) — DateRange requires both ends, but
 * "everything after 1 Sept" with no upper bound is a normal filter state
 * here, so this allows either end (or both) to be "".
 */
export interface ActivityFilter {
  query: string;
  accounts: string[];
  categories: string[];
  categoryTypes: CategoryType[];
  from: string; // ISODate, "" = unbounded
  to: string; // ISODate, "" = unbounded
}

export function emptyFilter(): ActivityFilter {
  return { query: "", accounts: [], categories: [], categoryTypes: [], from: "", to: "" };
}

/** Number of distinct filter facets in use — drives the filter button's badge. Search is not counted (it has its own visible input). */
export function activeFacetCount(filter: ActivityFilter): number {
  let count = 0;
  if (filter.accounts.length > 0) count++;
  if (filter.categories.length > 0) count++;
  if (filter.categoryTypes.length > 0) count++;
  if (filter.from !== "" || filter.to !== "") count++;
  return count;
}

export function isFilterActive(filter: ActivityFilter): boolean {
  return filter.query !== "" || activeFacetCount(filter) > 0;
}

/**
 * Case- and diacritic-insensitive normalization for search matching. The
 * real merchant data is a graveyard of raw bank strings and mixed-case
 * merchant names (see docs/renovation_version_1.txt: "Niemerszein" /
 * "NIEMERSZEIN & CO.KG" etc) — NFD decomposition + combining-mark removal
 * means "Édeka" and "edeka" (hypothetically) match the same query.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** `normalizedQuery` must already be passed through normalizeForSearch(). */
export function matchesQuery(tx: Transaction, normalizedQuery: string): boolean {
  if (normalizedQuery === "") return true;
  const haystacks = [tx.merchant, tx.category, tx.notes, tx.account, tx.destinationAccount];
  return haystacks.some((field) => field !== "" && normalizeForSearch(field).includes(normalizedQuery));
}

function matchesFacets(tx: Transaction, filter: ActivityFilter): boolean {
  if (filter.accounts.length > 0) {
    if (!filter.accounts.includes(tx.account) && !filter.accounts.includes(tx.destinationAccount)) return false;
  }
  if (filter.categories.length > 0 && !filter.categories.includes(tx.category)) return false;
  if (filter.categoryTypes.length > 0 && !filter.categoryTypes.includes(tx.categoryType)) return false;
  if (filter.from !== "" && tx.date < filter.from) return false;
  if (filter.to !== "" && tx.date > filter.to) return false;
  return true;
}

/** All facets AND together; search is ANDed with the facet result. Sorted date desc, then createdAt desc (most recently entered first within a day). */
export function filterTransactions(transactions: Transaction[], filter: ActivityFilter): Transaction[] {
  const normalizedQuery = normalizeForSearch(filter.query);
  return transactions
    .filter((tx) => matchesFacets(tx, filter) && matchesQuery(tx, normalizedQuery))
    .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
}

/**
 * The date presets offered by FilterSheet. "all-time" is the absence of
 * both bounds rather than a computed range, which is why it needs naming:
 * it is a real, selectable state and must light up like the others.
 */
export type PresetKey = "this-month" | "last-3-months" | "this-year" | "all-time";

/** The from/to a preset sets. `null` bounds mean "unbounded" (all-time). */
export function presetRange(
  preset: PresetKey,
  today: ISODate = getLocalToday(),
): { from: string; to: string } {
  switch (preset) {
    case "this-month": {
      const r = getThisMonthRange(today);
      return { from: r.from, to: r.to };
    }
    case "last-3-months": {
      const r = getLastNMonthsRange(3, today);
      return { from: r.from, to: r.to };
    }
    case "this-year": {
      const r = getYearToDateRange(today);
      return { from: r.from, to: r.to };
    }
    case "all-time":
      return { from: "", to: "" };
  }
}

/**
 * Which preset, if any, the filter's current date bounds correspond to.
 *
 * Exists because FilterSheet's preset buttons had NO active state at all —
 * they set a range and then looked identical to the unselected ones, so
 * the sheet could not answer "which range am I looking at?". The chips
 * beside them have had `--active` styling since Phase 11; only the
 * presets were missed.
 *
 * Derived by comparison rather than stored as a selected-preset field.
 * Storing it would create two sources of truth that drift the moment the
 * user edits a date input by hand: the field would still claim
 * "This month" while the dates say otherwise. Comparing means hand-editing
 * a date correctly clears the highlight, and typing a range that happens
 * to equal a preset correctly lights it up.
 *
 * Returns null when the bounds match no preset (a custom range, or only
 * one end set).
 */
export function matchingPreset(
  filter: Pick<ActivityFilter, "from" | "to">,
  today: ISODate = getLocalToday(),
): PresetKey | null {
  // ORDER BREAKS ONE REAL TIE, and only one. Throughout January,
  // this-month and this-year are the SAME range (both 1 Jan -> today), so
  // no amount of comparing can distinguish them; this-month wins by being
  // listed first, as the narrower claim. In January, tapping "This year"
  // therefore highlights "This month". Cosmetic, inherent to deriving the
  // state rather than storing it, and pinned by a test.
  //
  // all-time's position is NOT load-bearing, which was confirmed by
  // mutation rather than assumed: no other preset can produce empty
  // bounds, so it cannot be shadowed wherever it sits. Listed first only
  // because "no bounds" is the simplest case to read.
  const presets: PresetKey[] = ["all-time", "this-month", "last-3-months", "this-year"];
  for (const preset of presets) {
    const range = presetRange(preset, today);
    if (range.from === filter.from && range.to === filter.to) return preset;
  }
  return null;
}
