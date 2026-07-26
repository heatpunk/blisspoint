/** Round watts to the nearest 50 W — the operator convention for shown targets. */
export function roundTo50(watts: number): number {
  return Math.round(watts / 50) * 50;
}

/**
 * The power target to display for a miner running on a subset of its blisspoints.
 *
 * BraiinsOS keeps ONE whole-machine power limit (`PowerLimit` from tunerstatus)
 * sized for ALL `total` boards. When only `active` boards are populated, the
 * share those boards actually pull is `fullTarget * active / total`, rounded to
 * the nearest 50 W.
 *
 * Worked examples (verified live against the two S19j Pro units):
 *   PowerLimit 1718 W, 2 of 3 boards → 1718 * 2/3 = 1145.3 → 1150 W
 *   PowerLimit 1798 W, 1 of 3 boards → 1798 * 1/3 =  599.3 →  600 W
 *
 * `fullTarget` itself stays the slider's MAX (the scale ceiling); this scaled
 * value is the Target readout / handle position inside that scale.
 */
export function scaledTarget(fullTarget: number, active: number, total: number): number {
  if (!(fullTarget > 0) || !(active > 0) || !(total > 0)) return 0;
  return roundTo50((fullTarget * active) / total);
}
