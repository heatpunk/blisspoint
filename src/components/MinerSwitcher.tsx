import { useMiners } from "@/store/miners";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Radar, Loader2, Check, Plus } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { displayStatus, statusLabel, type DisplayStatus } from "@/lib/status";

// Status colours, used identically for the trigger dot and every list dot so
// two running miners never render differently. Green = mining, grey = paused,
// red = offline.
const DOT_BG: Record<DisplayStatus, string> = {
  mining: "hsl(140 70% 50%)",
  paused: "hsl(var(--muted-foreground))",
  offline: "hsl(var(--destructive))",
};
const LABEL_CLASS: Record<DisplayStatus, string> = {
  mining: "text-[hsl(140_70%_45%)]",
  paused: "text-muted-foreground",
  offline: "text-destructive",
};

function StatusDot({ status }: { status: DisplayStatus }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
      {status === "mining" && (
        <span
          className="absolute inset-0 rounded-full blur-[2px]"
          style={{ background: "hsl(140 80% 55% / 0.7)" }}
        />
      )}
      <span
        className="relative h-2 w-2 rounded-full"
        style={{
          background: DOT_BG[status],
          boxShadow: status === "mining" ? "0 0 6px hsl(140 80% 55% / 0.8)" : "none",
        }}
      />
    </span>
  );
}

/** Slowly rotating sonar sweep (issue #58). Stands in for the name label as
 *  the menu handle while no miners exist — tapping it opens the menu where
 *  Scan LAN lives. */
function SonarSweep() {
  return (
    <span
      aria-hidden="true"
      className="relative block h-11 w-11 rounded-full overflow-hidden"
      style={{
        background:
          "radial-gradient(circle, hsl(140 25% 42% / 0.30) 0%, hsl(140 25% 36% / 0.20) 60%, transparent 73%)",
      }}
    >
      <span
        className="absolute inset-0 rounded-full animate-spin"
        style={{
          animationDuration: "6s",
          background:
            "conic-gradient(from 0deg, transparent 0deg, transparent 290deg, hsl(140 70% 55% / 0.04) 308deg, hsl(140 75% 58% / 0.15) 330deg, hsl(140 80% 62% / 0.5) 347deg, hsl(140 90% 72% / 0.95) 356deg, hsl(140 95% 82%) 360deg)",
        }}
      />
      <span
        className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: "hsl(140 90% 80%)",
          boxShadow: "0 0 4px hsl(140 90% 70%)",
        }}
      />
    </span>
  );
}

export function MinerSwitcher() {
  const miners = useMiners((s) => s.miners);
  const selectedId = useMiners((s) => s.selectedId);
  const select = useMiners((s) => s.select);
  const scan = useMiners((s) => s.scan);
  const scanning = useMiners((s) => s.scanning);
  const addManual = useMiners((s) => s.addManual);
  const [manual, setManual] = useState("");
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const liveMode = useMiners((s) => s.liveMode);

  const current = miners.find((m) => m.id === selectedId) ?? miners[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={current ? undefined : "Open menu to scan LAN"}
        className={
          current
            ? "group flex items-center gap-2 px-3 py-2 rounded-sm hover:bg-secondary/60 transition-colors text-muted-foreground/70"
            : "group flex items-center rounded-full"
        }
      >
        {current ? (
          <>
            <StatusDot status={displayStatus(current, liveMode)} />
            <span className="text-[11px] tracking-display uppercase">
              {current.config.name}
            </span>
          </>
        ) : (
          <SonarSweep />
        )}
      </DropdownMenuTrigger>
      {/* Utan miners finns bara Scan LAN att visa — kompakt meny, centrerad
          under sonaren. Med miners: full bredd för namn/ip/status. */}
      <DropdownMenuContent
        align={miners.length ? "start" : "center"}
        className={miners.length ? "w-64" : "min-w-0"}
      >
        {miners.length > 0 && (
          <DropdownMenuLabel className="text-[10px] tracking-display text-muted-foreground">
            Miners on LAN
          </DropdownMenuLabel>
        )}
        {miners.map((m) => {
          const status = displayStatus(m, liveMode);
          const selected = m.id === selectedId;
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => select(m.id)}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <StatusDot status={status} />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm truncate flex items-center gap-1.5">
                    {m.config.name}
                    {selected && (
                      <Check className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-readout truncate">
                    {m.ip} · {m.model}
                  </span>
                </div>
              </div>
              {/* Live per-miner state — NOT "selected". Every running miner
                  reads ON regardless of which one is in view. */}
              <span
                className={`text-[10px] tracking-display ${LABEL_CLASS[status]}`}
              >
                {statusLabel(status)}
              </span>
            </DropdownMenuItem>
          );
        })}
        {miners.length > 0 && <DropdownMenuSeparator />}
        <form
          className="flex items-center gap-1 px-2 py-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const v = manual.trim();
            if (!v || adding) return;
            setAdding(true);
            setManualMsg(null);
            const result = await addManual(v);
            setAdding(false);
            if (result === "added" || result === "scanned") {
              setManual("");
              setManualMsg(result === "added" ? "Miner added" : "Scan done");
            } else if (result === "notfound") {
              setManualMsg("No miner answered on that IP");
            } else {
              setManualMsg("Enter an IP (192.168.1.50) or CIDR (10.1.0.0/16)");
            }
          }}
        >
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder="Add IP or subnet (10.1.0.0/16)"
            className="h-7 text-xs"
            aria-label="Add miner by IP or scan a subnet"
          />
          <button
            type="submit"
            disabled={adding}
            className="shrink-0 rounded-sm p-1.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
            aria-label="Add miner or scan subnet"
          >
            {adding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </button>
        </form>
        {manualMsg && (
          <div className="px-3 pb-1 text-[10px] text-muted-foreground">{manualMsg}</div>
        )}
        <DropdownMenuItem
          onClick={(e) => {
            e.preventDefault();
            scan();
          }}
          className="gap-2"
        >
          {scanning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Radar className="h-3.5 w-3.5" />
          )}
          <span className="text-sm">
            {scanning ? "Scanning LAN…" : "Scan LAN"}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
