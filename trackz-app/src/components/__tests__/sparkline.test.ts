import { describe, expect, it } from "vitest";
import { cssVarName } from "@/components/Sparkline";

describe("cssVarName", () => {
  it("extracts the token from var(--token) and leaves real colors alone", () => {
    expect(cssVarName("var(--negative)")).toBe("--negative");
    expect(cssVarName(" var( --text-tertiary ) ")).toBe("--text-tertiary");
    expect(cssVarName("#ff6b6b")).toBeNull();
    expect(cssVarName("rgb(1, 2, 3)")).toBeNull();
  });
});
