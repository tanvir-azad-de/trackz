import { describe, expect, it } from "vitest";
import { savedToast } from "@/features/entry/savedToast";
import type { Transaction } from "@/domain/transaction";

const tx: Transaction = {
  id: "txn_abc123",
  date: "2026-10-17",
  account: "ADVZ",
  destinationAccount: "",
  cashflow: "out",
  category: "Groceries",
  categoryType: "expense",
  merchant: "Edeka",
  amountCents: 1240,
  notes: "",
  createdAt: "2026-10-17T08:00:00.000Z",
  updatedAt: "2026-10-17T08:00:00.000Z",
  deletedAt: null,
};

describe("savedToast", () => {
  it("confirms the save for exactly 1s with no Undo action", () => {
    const toast = savedToast(tx, 42);
    expect(toast).toEqual({
      id: 42,
      message: `Saved ${"12,40 €"} · Groceries`,
      durationMs: 1000,
    });
    // Toast renders the button only when both are set; pin both absent.
    expect(toast.actionLabel).toBeUndefined();
    expect(toast.onAction).toBeUndefined();
  });
});
