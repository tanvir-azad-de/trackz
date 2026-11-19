import type { ActivityFilter } from "@/features/activity/filter";
import { emptyFilter } from "@/features/activity/filter";
import { getMonthEndDate, getMonthStartDate } from "@/domain/dates";

/**
 * Where a tap on a category lands in Activity: from the category sheet
 * or from This month so far. Both show net spending (engine.ts
 * spendingCents: expense minus non_income), so the filter takes exactly
 * those two types. With expense alone (the filter before 2026-11-19), a
 * category whose refund shares its name showed its gross figure in
 * Activity and its net figure on Home. With no type facet, its
 * non_expense rows would be counted too, and Home never counts those.
 */
export function categoryDrillFilter(category: string, monthKey: string): ActivityFilter {
  return {
    ...emptyFilter(),
    categories: [category],
    categoryTypes: ["expense", "non_income"],
    from: getMonthStartDate(monthKey),
    to: getMonthEndDate(monthKey),
  };
}
