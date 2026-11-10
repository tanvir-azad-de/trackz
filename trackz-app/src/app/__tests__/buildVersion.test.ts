import { describe, expect, it } from "vitest";
import { buildVersionLabel } from "@/app/buildVersion";

describe("buildVersionLabel", () => {
  it("shortens a full commit sha to 7 characters and formats the date", () => {
    expect(buildVersionLabel("2ccafb3e9d1f0a4b5c6d7e8f9a0b1c2d3e4f5a6b", "2026-11-10T20:31:00.000Z")).toBe("2ccafb3 · 10 Nov 2026");
  });

  it("reads the date from the ISO string, not the build machine's clock or timezone", () => {
    expect(buildVersionLabel("abc1234", "2026-01-05T23:59:59.000Z")).toBe("abc1234 · 5 Jan 2026");
    expect(buildVersionLabel("abc1234", "2026-12-31")).toBe("abc1234 · 31 Dec 2026");
  });

  it("says dev when no commit is known", () => {
    expect(buildVersionLabel(undefined, "2026-11-10")).toBe("dev · 10 Nov 2026");
    expect(buildVersionLabel("  ", "2026-11-10")).toBe("dev · 10 Nov 2026");
  });
});
