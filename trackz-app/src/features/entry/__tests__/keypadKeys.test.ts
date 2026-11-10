import { describe, expect, it } from "vitest";
import { KEYPAD_KEYS } from "@/features/entry/keypadKeys";

describe("KEYPAD_KEYS", () => {
  it("is the phone layout 1-9, then blank / 0 / delete", () => {
    const labels = KEYPAD_KEYS.map((k) => (k.kind === "digit" ? k.digit : k.kind));
    expect(labels).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "blank", "0", "delete"]);
  });

  it("has exactly one delete key and every digit is a single 0-9 character", () => {
    expect(KEYPAD_KEYS.filter((k) => k.kind === "delete")).toHaveLength(1);
    for (const k of KEYPAD_KEYS) {
      if (k.kind === "digit") expect(k.digit).toMatch(/^[0-9]$/);
    }
  });
});
