import { describe, expect, it } from "vitest";
import { keyboardInsetPx } from "@/components/keyboardInset";

describe("keyboardInsetPx", () => {
  it("is the height the keyboard takes from the bottom", () => {
    expect(keyboardInsetPx(844, 508, 0)).toBe(336);
  });

  it("subtracts the visual viewport's scroll offset, so a page iOS scrolled up isn't lifted twice", () => {
    expect(keyboardInsetPx(844, 508, 336)).toBe(0);
    expect(keyboardInsetPx(844, 508, 100)).toBe(236);
  });

  it("is 0 with no keyboard, and never negative", () => {
    expect(keyboardInsetPx(844, 844, 0)).toBe(0);
    expect(keyboardInsetPx(844, 900, 0)).toBe(0);
  });

  it("rounds subpixel heights", () => {
    expect(keyboardInsetPx(844, 507.6, 0)).toBe(336);
  });
});
