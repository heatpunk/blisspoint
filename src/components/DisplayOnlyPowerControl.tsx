import { useState } from "react";
import { PowerSlider } from "@/components/PowerSlider";
import { axisLabels } from "@/lib/axis";
import { displayStep } from "@/lib/power";

/**
 * Shown for miners whose firmware exposes no power control (S9/BraiinsOS,
 * Bitaxe). The slider is fully draggable but purely visual: onCommit is a
 * no-op and nothing is ever sent to the miner. Scale runs 0..~1.1x the last
 * measured wattage, snapped to the machine's display step (50 W on big
 * ASICs, exact watts under 500 W). Until the user drags, the handle tracks
 * live watts. Greys out while paused, like the real slider.
 */
export function DisplayOnlyPowerControl({ watts, paused = false }: { watts: number | null; paused?: boolean }) {
  const [dragged, setDragged] = useState<number | null>(null);
  const measured = Math.max(0, watts ?? 0);
  const raw = Math.max(measured * 1.1, 50);
  const step = displayStep(raw);
  const max = Math.ceil(raw / step) * step;
  const value = dragged ?? Math.min(Math.round(measured), max);
  const axis = axisLabels(0, max);
  return (
    <>
      <div className="flex flex-col justify-between py-1 font-readout text-[10px] text-muted-foreground tabular-nums" style={{ width: 78 }}>
        <span>{axis.top}</span>
        <span>{axis.mid}</span>
        <span>{axis.bottom}</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <div className="w-32 sm:w-40 h-full max-h-none">
          <PowerSlider min={0} max={max} value={value} onChange={setDragged} onCommit={() => {}} disabled={paused} />
        </div>
        <span className="text-[9px] tracking-display uppercase text-muted-foreground/60">
          display only — firmware can't be tuned
        </span>
      </div>
      <div className="flex flex-col items-end justify-center" style={{ width: 78 }}>
        <span className="text-[9px] tracking-display text-muted-foreground/70">Target</span>
        <span className="font-readout text-xl sm:text-2xl font-light leading-none mt-1.5 tabular-nums">
          {Math.round(value)}
        </span>
        <span className="text-[9px] tracking-display text-muted-foreground/60 mt-1">watt</span>
      </div>
    </>
  );
}
