import { useEffect, useState } from "react";
import { useMiners } from "@/store/miners";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  minerId: string;
}

export function SettingsDialog({ open, onOpenChange, minerId }: Props) {
  const miner = useMiners((s) => s.miners.find((m) => m.id === minerId));
  const updateConfig = useMiners((s) => s.updateConfig);
  const updateIp = useMiners((s) => s.updateIp);
  const removeMiner = useMiners((s) => s.removeMiner);
  const theme = useMiners((s) => s.theme);
  const toggleTheme = useMiners((s) => s.toggleTheme);

  const [name, setName] = useState("");
  const [ip, setIp] = useState("");

  useEffect(() => {
    if (!miner) return;
    setName(miner.config.name);
    setIp(miner.ip);
  }, [miner?.id, open]);

  if (!miner) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="tracking-display text-xs font-medium">
            Settings
          </DialogTitle>
          <DialogDescription className="text-xs">
            {miner.model}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Name */}
          <div className="space-y-2">
            <Label className="text-[10px] tracking-display text-muted-foreground">
              Device name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => updateConfig(miner.id, { name })}
              className="font-readout"
            />
          </div>

          {/* IP address */}
          <div className="space-y-2">
            <Label className="text-[10px] tracking-display text-muted-foreground">
              IP address
            </Label>
            <Input
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              onBlur={() => {
                if (ip.trim()) updateIp(miner.id, ip.trim());
              }}
              className="font-readout"
              placeholder="192.168.x.x"
            />
          </div>

          <Separator />

          {/* Power range */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] tracking-display text-muted-foreground">
                Power range
              </Label>
              <span className="font-readout text-xs text-muted-foreground">
                {miner.config.powerMin}–{miner.config.powerMax} W
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/70 leading-snug">
              {miner.boards
                ? `${miner.boards.active} / ${miner.boards.total} blisspoints active — Max = machine target ÷ ${miner.boards.total} × ${miner.boards.active}, to the nearest 50 W. Never higher.`
                : "Scaled to the active blisspoints"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Min</Label>
                <Input
                  type="number"
                  value={miner.config.powerMin}
                  readOnly
                  title="Scaled to active blisspoints — not editable here"
                  className="font-readout opacity-60 cursor-not-allowed"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Max (active)</Label>
                <Input
                  type="number"
                  value={miner.config.powerMax}
                  readOnly
                  title="The machine target scaled to the active boards — never higher"
                  className="font-readout opacity-60 cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Theme */}
          <div className="flex items-center justify-between">
            <Label className="text-[10px] tracking-display text-muted-foreground">
              Pearl mode
            </Label>
            <Switch
              checked={theme === "light"}
              onCheckedChange={() => toggleTheme()}
            />
          </div>

          <Separator />

          {/* Remove miner */}
          <Button
            variant="destructive"
            size="sm"
            className="w-full text-xs"
            onClick={() => {
              removeMiner(miner.id);
              onOpenChange(false);
            }}
          >
            Remove this miner
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
