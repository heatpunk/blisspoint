import { describe, it, expect } from "vitest";
import { roundTo50, scaledTarget, displayStep, roundToStep } from "@/lib/power";

describe("displayStep — 50 W convention on big ASICs, exact watts on small heaters", () => {
  it("sub-500 W machines (Bitaxe class) show exact watts", () => {
    expect(displayStep(120)).toBe(1);
    expect(displayStep(499)).toBe(1);
  });
  it("500 W and up keep the 50 W operator convention", () => {
    expect(displayStep(500)).toBe(50);
    expect(displayStep(1718)).toBe(50);
  });
  it("unknown ceiling (0) falls back to the convention", () => {
    expect(displayStep(0)).toBe(50);
  });
});

describe("roundToStep", () => {
  it("step 1 keeps whole watts", () => {
    expect(roundToStep(120.4, 1)).toBe(120);
    expect(roundToStep(175.6, 1)).toBe(176);
  });
  it("step 50 matches roundTo50", () => {
    expect(roundToStep(1145.33, 50)).toBe(roundTo50(1145.33));
  });
});

describe("roundTo50", () => {
  it("rounds to the nearest 50 W", () => {
    expect(roundTo50(1145.33)).toBe(1150);
    expect(roundTo50(599.33)).toBe(600);
    expect(roundTo50(1718)).toBe(1700);
    expect(roundTo50(1725)).toBe(1750);
    expect(roundTo50(0)).toBe(0);
  });
});

describe("scaledTarget — verified live against the two S19j Pro units", () => {
  it("1718 W over 2 of 3 boards → 1150 W (Cellarheater)", () => {
    expect(scaledTarget(1718, 2, 3)).toBe(1150);
  });
  it("1798 W over 1 of 3 boards → 600 W (Garageheater)", () => {
    expect(scaledTarget(1798, 1, 3)).toBe(600);
  });
  it("full machine (3 of 3) → the limit, rounded to 50", () => {
    expect(scaledTarget(1718, 3, 3)).toBe(1700);
  });
  it("the scaled target never exceeds the full machine target", () => {
    for (const active of [1, 2, 3]) {
      expect(scaledTarget(1718, active, 3)).toBeLessThanOrEqual(roundTo50(1718));
    }
  });
  it("returns 0 for missing/garbage inputs (shows 'connecting', not a wrong number)", () => {
    expect(scaledTarget(0, 2, 3)).toBe(0);
    expect(scaledTarget(1718, 0, 3)).toBe(0);
    expect(scaledTarget(1718, 2, 0)).toBe(0);
  });
});

describe("scaledTarget — low-power machines (issue #84: Bitaxe class)", () => {
  it("a 120 W Bitaxe target shows 120 W, not snapped to 100 W", () => {
    expect(scaledTarget(120, 1, 1)).toBe(120);
  });
  it("a 175 W target shows 175 W, not rounded up to 200 W", () => {
    expect(scaledTarget(175, 1, 1)).toBe(175);
  });
  it("fractional shares round to whole watts, not to 50", () => {
    // 350 W machine limit, 2 of 3 boards → 233.33 → 233 W
    expect(scaledTarget(350, 2, 3)).toBe(233);
  });
  it("the 500 W boundary keeps the 50 W convention", () => {
    expect(scaledTarget(500, 1, 1)).toBe(500);
    expect(scaledTarget(520, 1, 1)).toBe(500);
  });
});
