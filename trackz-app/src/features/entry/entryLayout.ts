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
  // Lent out / I owe carry no category (domain usesCategory); Direction takes its slot.
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
      return "Merchant";
    case "direction":
      return "Direction";
    case "notes":
      return "Note";
  }
}

/** The two Direction choices, worded per type; "out" first, matching the draft default. */
export function directionLabel(categoryType: CategoryType, direction: "out" | "in"): string {
  if (categoryType === "receivable") return direction === "out" ? "Lending out" : "Getting repaid";
  return direction === "out" ? "Borrowing" : "Repaying";
}
