import { describe, expect, it } from "vitest";
import { balanceRowFilter } from "@/features/home/balanceRowFilter";
import { emptyFilter } from "@/features/activity/filter";

describe("balanceRowFilter", () => {
  it("filters an account row of every type to that account", () => {
    for (const kind of ["cash", "investment", "credit_card"] as const) {
      expect(balanceRowFilter({ label: "ACC1", kind, amountCents: 100 })).toEqual({ ...emptyFilter(), accounts: ["ACC1"] });
    }
  });

  it("filters Lent out and Borrowed by category type, never as an account name", () => {
    expect(balanceRowFilter({ label: "Lent out", kind: "lent_out", amountCents: 100 })).toEqual({
      ...emptyFilter(),
      categoryTypes: ["receivable"],
    });
    expect(balanceRowFilter({ label: "Borrowed", kind: "borrowed", amountCents: 100 })).toEqual({
      ...emptyFilter(),
      categoryTypes: ["payable"],
    });
  });
});
