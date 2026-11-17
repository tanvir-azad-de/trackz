import type { CategoryType } from "@/domain/transaction";

/**
 * Which tiles the entry screen shows for a category type, in grid order
 * (2 columns). Pure, so the per-type layout is pinned by tests rather than
 * by reading JSX conditionals.
 *
 * Always 3 rows: the screen's keypad dock fills whatever height the tiles
 * leave, so a type change that added or removed a ROW would resize the
 * keypad under the user's thumb — the layout shift this screen exists to
 * remove. Transfer has 5 tiles, and its Note spans both columns of row 3
 * (EntryScreen.css) instead of leaving a gap.
 */
export type TileKey = "type" | "date" | "account" | "destination" | "category" | "merchant" | "direction" | "notes";

export function entryTiles(categoryType: CategoryType): TileKey[] {
  if (categoryType === "transfer") return ["type", "date", "account", "destination", "notes"];
  // Lent / Borrowed carry no category (domain usesCategory); Direction takes its slot.
  if (categoryType === "receivable" || categoryType === "payable") {
    return ["type", "date", "account", "direction", "merchant", "notes"];
  }
  return ["type", "date", "account", "category", "merchant", "notes"];
}

export function tileLabel(tile: TileKey, categoryType: CategoryType): string {
  switch (tile) {
    case "type":
      return "Type";
    case "date":
      return "Date";
    case "account":
      return categoryType === "transfer" ? "From" : "Account";
    case "destination":
      return "To";
    case "category":
      return "Category";
    case "merchant":
      // On Lent / Borrowed the merchant field names a person (domain/transaction.ts).
      return categoryType === "receivable" || categoryType === "payable" ? "Person" : "Merchant";
    case "direction":
      return "Direction";
    case "notes":
      return "Note";
  }
}

/**
 * The Direction choices, worded by what happens to MY account (user
 * decision 2026-11-17), the same for Lent and Borrowed: on Lent, Cash out
 * is lending and Cash in is being repaid; on Borrowed, Cash in is
 * borrowing and Cash out is repaying. The cashflow stored is the same
 * word, so the label cannot disagree with the sign.
 */
export const DIRECTIONS = ["in", "out"] as const;

export function directionLabel(direction: "out" | "in"): string {
  return direction === "in" ? "Cash in" : "Cash out";
}
