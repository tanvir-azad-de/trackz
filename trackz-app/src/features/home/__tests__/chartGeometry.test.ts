import { describe, expect, it } from "vitest";
import { chartPoints } from "@/features/home/chartGeometry";

const box = { width: 320, height: 140, padTop: 24, padBottom: 28, padX: 24 };
const baseline = 140 - 28;

describe("chartPoints", () => {
  it("puts the largest month on padTop, zero on the baseline, evenly spaced across padX", () => {
    const pts = chartPoints([0, 500, 1000, 250, 1000, 750], box);
    expect(pts.map((p) => p.x)).toEqual([24, 78.4, 132.8, 187.2, 241.6, 296]);
    expect(pts.map((p) => p.y)).toEqual([baseline, 68, 24, 90, 24, 46]);
  });

  it("draws an all-zero series flat on the baseline instead of dividing by zero", () => {
    expect(chartPoints([0, 0, 0, 0, 0, 0], box).every((p) => p.y === baseline)).toBe(true);
  });

  it("keeps a negative (refund-heavy) month on the baseline, out of the month labels", () => {
    expect(chartPoints([-300, 1000], box)[0]!.y).toBe(baseline);
  });
});
