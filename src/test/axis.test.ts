import { describe, it, expect } from "vitest";
import { axisLabels } from "@/lib/axis";

describe("axisLabels", () => {
  // The scale tops out at the active-board target (machine limit / total *
  // active, rounded to 50) — NOT the whole-machine limit. These are the live
  // values: .106 = 1718/3*2 = 1150, .120 = 1798/3*1 = 600.
  it("Cellarheater: scale 0 → 1150 W (active-board max) → ticks 0 / 600 / 1150", () => {
    const { top, mid, bottom } = axisLabels(0, 1150);
    expect(bottom).toBe(0);
    expect(mid).toBe(600);
    expect(top).toBe(1150);
  });

  it("Garageheater: scale 0 → 600 W → ticks 0 / 300 / 600", () => {
    const { top, mid, bottom } = axisLabels(0, 600);
    expect(bottom).toBe(0);
    expect(mid).toBe(300);
    expect(top).toBe(600);
  });

  it("the top tick never exceeds the max — not one watt more", () => {
    // The max is always a multiple of 50 (round-to-50 target), so the top tick
    // equals it exactly and the scale never implies headroom above the target.
    for (const max of [1150, 600, 1700, 50, 850]) {
      expect(axisLabels(0, max).top).toBe(max);
    }
  });

  it("top tick brackets the max; bottom brackets the min", () => {
    const cases: [number, number][] = [
      [0, 1150],
      [0, 600],
      [0, 1700],
      [600, 600], // degenerate min == max
    ];
    for (const [min, max] of cases) {
      const { top, bottom } = axisLabels(min, max);
      expect(top).toBeGreaterThanOrEqual(max);
      expect(bottom).toBeLessThanOrEqual(min);
    }
  });

  it("Bitaxe class (issue #84): sub-500 W scale uses exact-watt ticks", () => {
    // 120 W machine: ticks must not snap to a 50 W grid (0 / 50 / 100 / 150).
    const { top, mid, bottom } = axisLabels(0, 120);
    expect(bottom).toBe(0);
    expect(mid).toBe(60);
    expect(top).toBe(120);
  });

  it("small-machine ticks still bracket the band", () => {
    const { top, bottom } = axisLabels(37, 175);
    expect(top).toBeGreaterThanOrEqual(175);
    expect(bottom).toBeLessThanOrEqual(37);
    expect(top).toBe(175);
    expect(bottom).toBe(37);
  });
});
