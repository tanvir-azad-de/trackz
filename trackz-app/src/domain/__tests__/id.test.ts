import { describe, expect, it } from "vitest";
import { newTransactionId } from "@/domain/id";

describe("newTransactionId", () => {
  it("returns a non-empty string prefixed with txn_", () => {
    const id = newTransactionId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("txn_")).toBe(true);
  });

  it("never collides across a large batch", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newTransactionId()));
    expect(ids.size).toBe(2000);
  });
});
