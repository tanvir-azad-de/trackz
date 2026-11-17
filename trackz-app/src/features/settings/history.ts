import { categoryOrTypeLabel, type Transaction } from "@/domain/transaction";
import { isValidISODate } from "@/domain/dates";
import type { Cents } from "@/domain/money";
import { emptyFilter, type ActivityFilter } from "@/features/activity/filter";

/**
 * Pure half of Settings -> History (user request 2026-11-17): the last 10
 * Add / Edit saves on THIS device. storage/history.ts is the localStorage
 * half; it is device-local and never synced, like entryMemory.
 *
 * Each event is a SNAPSHOT of the row as saved, not a pointer to it: a
 * history entry reads "what I saved then", and a later edit or delete must
 * not rewrite an earlier line.
 */
export type HistoryKind = "added" | "updated";

export interface HistoryEvent {
  kind: HistoryKind;
  /** ISO timestamp of the save. */
  at: string;
  id: string;
  date: string; // ISODate of the transaction
  title: string;
  merchant: string;
  category: string;
  amountCents: Cents;
}

export const HISTORY_LIMIT = 10;

export function historyEventFrom(kind: HistoryKind, tx: Transaction, at: string): HistoryEvent {
  return {
    kind,
    at,
    id: tx.id,
    date: tx.date,
    title: tx.merchant || categoryOrTypeLabel(tx),
    merchant: tx.merchant,
    category: tx.category,
    amountCents: tx.amountCents,
  };
}

/** Newest first, capped. Repeat edits of one row are separate events, not merged. */
export function pushHistory(list: readonly HistoryEvent[], event: HistoryEvent): HistoryEvent[] {
  return [event, ...list].slice(0, HISTORY_LIMIT);
}

/** Whatever localStorage held, reduced to well-formed events. Bad entries are dropped, not the whole list. */
export function parseHistory(raw: unknown): HistoryEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isHistoryEvent).slice(0, HISTORY_LIMIT);
}

function isHistoryEvent(value: unknown): value is HistoryEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    (e.kind === "added" || e.kind === "updated") &&
    typeof e.at === "string" &&
    typeof e.id === "string" &&
    typeof e.date === "string" &&
    isValidISODate(e.date) &&
    typeof e.title === "string" &&
    typeof e.merchant === "string" &&
    typeof e.category === "string" &&
    Number.isInteger(e.amountCents)
  );
}

/**
 * Where a tap lands (user decision 2026-11-17): that day, plus the name as
 * search text. Merchant is search, not a facet, because ActivityFilter has
 * none (the same choice Settings -> Merchants makes). A row with no
 * merchant falls back to its category facet; a transfer has neither and
 * lands on the whole day.
 */
export function historyFilter(event: HistoryEvent): ActivityFilter {
  const base = { ...emptyFilter(), from: event.date, to: event.date };
  if (event.merchant) return { ...base, query: event.merchant };
  if (event.category) return { ...base, categories: [event.category] };
  return base;
}
