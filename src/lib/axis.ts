/**
 * Y-axis tick labels for the power slider.
 *
 * The three labels must always *bracket* the real [min, max] band so the
 * Target readout (which sits at max) never shows above the top tick, and the
 * floor never drops below the bottom tick. So: round the top UP and the bottom
 * DOWN. Rounding them the other way crops the band inward — the bug that made
 * Target read 1145 while the top tick said 1100.
 *
 * Ticks snap to the machine's display step: 50 W on big ASICs, exact watts on
 * sub-500 W machines (Bitaxe class), where a 50 W grid would mislabel the scale.
 */
import { displayStep } from "./power";

export interface AxisLabels {
  top: number;
  mid: number;
  bottom: number;
}

export function axisLabels(min: number, max: number): AxisLabels {
  const step = displayStep(max);
  return {
    top: Math.ceil(max / step) * step, // >= max, so Target always sits inside the scale
    mid: Math.round((max + min) / (2 * step)) * step, // midpoint, snapped to the step
    bottom: Math.floor(min / step) * step, // <= min, so the floor always sits inside the scale
  };
}
