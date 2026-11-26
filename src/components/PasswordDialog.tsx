import { useState } from "react";
import { useMiners } from "@/store/miners";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function PasswordDialog() {
  const pwPrompt = useMiners((s) => s.pwPrompt);
  const pwError = useMiners((s) => s.pwError);
  const target = useMiners((s) =>
    pwPrompt ? s.miners.find((m) => m.id === pwPrompt.minerId) : undefined
  );
  const submit = useMiners((s) => s.submitMinerPassword);
  const dismiss = useMiners((s) => s.dismissPwPrompt);
  const [pw, setPw] = useState("");
  const [prevPrompt, setPrevPrompt] = useState(pwPrompt);

  // Reset the field when a new prompt opens (render-phase state adjustment,
  // the React-recommended alternative to setState-in-effect).
  if (pwPrompt !== prevPrompt) {
    setPrevPrompt(pwPrompt);
    if (pwPrompt) setPw("");
  }

  return (
    <Dialog open={!!pwPrompt} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-xs" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="tracking-display text-xs font-medium">
            Miner password
          </DialogTitle>
          <DialogDescription className="text-xs">
            {target && (
              <span className="mb-1 block font-medium text-foreground">
                {target.config.name} — {target.ip}
              </span>
            )}
            {pwPrompt?.reason === "read"
              ? "This miner needs its password to read its data. Enter its BraiinsOS+ password (username: root). Password is stored encrypted on this server."
              : pwPrompt?.reason === "power"
              ? "This miner requires a password to set the power target. Enter its BraiinsOS+ password (username: root). Password is stored encrypted on this server."
              : "This miner requires a password for control. Enter its BraiinsOS+ password (username: root). Password is stored encrypted on this server."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); submit(pw); }}
          className="space-y-3 pt-1"
        >
          <Input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="font-readout"
          />
          {pwError && (
            <p className="text-xs text-destructive">{pwError}</p>
          )}
          <Button type="submit" size="sm" className="w-full text-xs">
            Connect
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
