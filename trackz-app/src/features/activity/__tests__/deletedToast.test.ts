import { describe, expect, it, vi } from "vitest";
import { deletedToast } from "@/features/activity/deletedToast";
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

describe("deletedToast", () => {
  it("shows for exactly 1s and keeps an Undo that runs the given undo", () => {
    const undo = vi.fn();
    const toast = deletedToast(tx, 42, undo);
    expect(toast).toMatchObject({ id: 42, message: "Deleted Groceries", actionLabel: "Undo", durationMs: 1000 });
    toast.onAction?.();
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
