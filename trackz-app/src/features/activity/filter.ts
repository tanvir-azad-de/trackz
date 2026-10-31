import type { CategoryType, Transaction } from "@/domain/transaction";
import type { Cents } from "@/domain/money";
import { addCents } from "@/domain/money";
import { getSignedAmountCents } from "@/domain/transaction";

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

export interface FilteredSummary {
  count: number;
  inCents: Cents;
  outCents: Cents;
  netCents: Cents;
}

/** Totals for the result-summary line above the list. Uses the net-worth perspective so transfers contribute 0, matching every other KPI in the app. */
export function summarizeFiltered(transactions: Transaction[]): FilteredSummary {
  let inCents = 0;
  let outCents = 0;
  for (const tx of transactions) {
    const signed = getSignedAmountCents(tx, { kind: "net-worth" });
    if (signed > 0) inCents = addCents(inCents, signed);
    else if (signed < 0) outCents = addCents(outCents, -signed);
  }
  return { count: transactions.length, inCents, outCents, netCents: inCents - outCents };
}
