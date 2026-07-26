export interface MinerStats {
  th: number;
  watts: number | null;
  chipTemp: number | null;
  fanSpeed: number | null;
}

export interface DiscoveredMiner {
  ip: string;
  model: string;
  live: MinerStats;
}

export interface MinerSnapshot {
  live: MinerStats;
  /** whole-machine power limit (watts); divided across the active boards to get
   *  BOTH the scale max and the Target — never shown as-is */
  machineFull: number | null;
  /** whole-machine minimum allowed power target (watts), firmware floor; null when not exposed */
  powerMin: number | null;
  /** active vs total blisspoints — the share is active/total */
  boards: { active: number; total: number } | null;
  /** explicit paused state from the miner (asic-rs is_mining); falls back to
   *  the old hashrate≈0 heuristic against proxies that predate the field */
  paused: boolean;
  /** reserved for control flows; reads no longer require a password */
  needPassword: boolean;
}

export async function fetchMinerStats(ip: string, password?: string): Promise<MinerSnapshot | null> {
  try {
    const res = await fetch(`/api/miners/${encodeURIComponent(ip)}/stats`, {
      // Reads use the open CGMiner API (port 4028) — no password needed. The
      // header is kept only so a future authenticated read could use it.
      headers: password ? { 'x-miner-password': password } : {},
      signal: AbortSignal.timeout(6500),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok) return null;
    return {
      live: data.live as MinerStats,
      machineFull: (data.config?.fullTarget ?? null) as number | null,
      powerMin: (data.config?.powerMin ?? null) as number | null,
      boards: (data.config?.boards ?? null) as { active: number; total: number } | null,
      paused: typeof data.paused === "boolean" ? data.paused : ((data.live as MinerStats)?.th ?? 0) <= 0.5,
      needPassword: !!data.needPassword,
    };
  } catch {
    return null;
  }
}

export interface ControlResult { ok: boolean; needPassword?: boolean }

export async function setMinerPowerTarget(ip: string, watts: number, password?: string): Promise<ControlResult> {
  try {
    const res = await fetch(`/api/miners/${encodeURIComponent(ip)}/power`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watts: Math.round(watts), password: password ?? '' }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: !!data.ok, needPassword: !!data.needPassword };
  } catch {
    return { ok: false };
  }
}

export async function setMinerPaused(ip: string, paused: boolean, password?: string): Promise<ControlResult> {
  try {
    const res = await fetch(`/api/miners/${encodeURIComponent(ip)}/${paused ? 'pause' : 'resume'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password ?? '' }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: !!data.ok, needPassword: !!data.needPassword };
  } catch {
    return { ok: false };
  }
}

export async function proxyHealthy(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function scanLAN(subnet: string): Promise<DiscoveredMiner[]> {
  try {
    const res = await fetch(`/api/scan?subnet=${encodeURIComponent(subnet)}`, {
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.ok ? (data.miners as DiscoveredMiner[]) : [];
  } catch {
    return [];
  }
}
