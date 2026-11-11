import type { ActivityFilter } from "@/features/activity/filter";
import { emptyFilter } from "@/features/activity/filter";
import type { BalanceSheetRow } from "@/insights/engine";

/**
 * Where a tap on a Home balance row lands in Activity.
 *
 * Account rows (cash, investment, credit card) filter to that account —
 * the same filter an Accounts-screen card applies. Lent out and Borrowed
 * are NOT accounts: their label is a display name, so filtering
 * `accounts: ["Lent out"]` would match nothing. They filter to their
 * category type instead, i.e. every lending (or borrowing) row with
 * every person — the Accounts screen's per-person cards add the name.
 */
export function balanceRowFilter(row: BalanceSheetRow): ActivityFilter {
  switch (row.kind) {
    case "lent_out":
      return { ...emptyFilter(), categoryTypes: ["receivable"] };
    case "borrowed":
      return { ...emptyFilter(), categoryTypes: ["payable"] };
    default:
      return { ...emptyFilter(), accounts: [row.label] };
  }
}
