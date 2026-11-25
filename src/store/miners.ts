import { create } from "zustand";
import { persist, createJSONStorage, StateStorage } from "zustand/middleware";
import type { Miner, MinerConfig } from "@/lib/types";
import { fetchMinerStats, saveMinerPassword, scanLAN, setMinerPaused, setMinerPowerTarget, STORED_PASSWORD } from "@/lib/minerApi";

const STORAGE_KEY = "blisspoint.state.v2";

const customStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/state");
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object" && Object.keys(data).length > 0) {
          return JSON.stringify(data);
        }
      }
    } catch (e) {
      console.error("Failed to load state from /api/state, falling back to localStorage", e);
    }
    return localStorage.getItem(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    localStorage.setItem(name, value);
    try {
      await fetch("/api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: value,
      });
    } catch (e) {
      console.error("Failed to persist state to /api/state", e);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    localStorage.removeItem(name);
    try {
      await fetch("/api/state", { method: "DELETE" });
    } catch (e) {
      console.error("Failed to delete state from /api/state", e);
    }
  },
};

const seed = (): Miner[] => [];

interface State {
  miners: Miner[];
  selectedId: string | null;
  theme: "light" | "dark";
  scanning: boolean;
  /** true when at least one miner responded with real data on last poll */
  liveMode: boolean;
  /** miner awaiting an API password — for control (pause/resume), reading the
   *  power target, or committing a new power target. `paused` only applies to
   *  control prompts. */
  pwPrompt: { minerId: string; reason: "control" | "read" | "power"; paused?: boolean } | null;
  /** miners whose password prompt the user dismissed this session — don't nag */
  pwDismissed: Record<string, boolean>;
  /** optimistic pause/resume per miner for instant button feedback */
  intents: Record<string, { paused: boolean; until: number }>;

  select: (id: string) => void;
  setTheme: (t: "light" | "dark") => void;
  toggleTheme: () => void;
  setPower: (id: string, watts: number) => void;
  commitPowerTarget: (id: string) => Promise<void>;
  updateConfig: (id: string, patch: Partial<MinerConfig>) => void;
  updateIp: (id: string, ip: string) => void;
  togglePause: (id: string) => Promise<void>;
  submitMinerPassword: (pw: string) => Promise<void>;
  dismissPwPrompt: () => void;
  removeMiner: (id: string) => void;
  scan: () => Promise<void>;
  /** Add a miner by IP, or scan an arbitrary CIDR, from manual input.
   *  Returns a short status code for the UI. */
  addManual: (input: string) => Promise<"added" | "scanned" | "notfound" | "invalid" | "failed" | "exists">;
  /** Poll live data from the real miner API via the local proxy */
  pollLive: () => Promise<void>;
  /** Smooth animation tick (1 s) — lerps toward current target/live values */
  _tick: () => void;
}


function toMiner(d: { ip: string; model?: string; live: { th: number; watts?: number; chipTemp?: number; fanSpeed?: number } }): Miner {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `disc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ip: d.ip,
    model: d.model ?? "Unknown",
    status: "mining" as const,
    config: { name: d.ip, powerMin: 0, powerMax: 0, powerTarget: 0 },
    live: {
      th: d.live.th,
      watts: d.live.watts ?? 0,
      chipTemp: d.live.chipTemp ?? 0,
      fanSpeed: d.live.fanSpeed ?? 0,
    },
  };
}

export const useMiners = create<State>()(
  persist(
    (set, get) => ({
      miners: seed(),
      selectedId: null,
      theme: "dark",
      scanning: false,
      liveMode: false,
      pwPrompt: null,
      pwDismissed: {},
      intents: {},

      select: (id) => set({ selectedId: id }),
      setTheme: (t) => set({ theme: t }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),

      setPower: (id, watts) =>
        set((s) => ({
          miners: s.miners.map((m) =>
            m.id === id
              ? {
                  ...m,
                  config: {
                    ...m.config,
                    powerTarget: Math.round(
                      Math.min(m.config.powerMax, Math.max(m.config.powerMin, watts))
                    ),
                  },
                }
              : m
          ),
        })),

      commitPowerTarget: async (id) => {
        const m = get().miners.find((x) => x.id === id);
        if (!m || m.config.powerTarget <= 0) return;
        const res = await setMinerPowerTarget(m.ip, m.config.powerTarget);
        if (res.needPassword) {
          set({ pwPrompt: { minerId: id, reason: "power" } });
        }
      },

      updateConfig: (id, patch) =>
        set((s) => ({
          miners: s.miners.map((m) => {
            if (m.id !== id) return m;
            const config = { ...m.config, ...patch };
            config.powerTarget = Math.min(
              config.powerMax,
              Math.max(config.powerMin, config.powerTarget)
            );
            return { ...m, config };
          }),
        })),

      updateIp: (id, ip) =>
        set((s) => ({
          miners: s.miners.map((m) => (m.id === id ? { ...m, ip } : m)),
        })),

      togglePause: async (id) => {
        const { miners, intents } = get();
        const m = miners.find((x) => x.id === id);
        if (!m) return;
        const currentlyPaused = intents[id]?.paused ?? m.status === "paused";
        const desiredPaused = !currentlyPaused;
        // optimistic: flip the icon instantly, hold ~20s until polls confirm
        set((s) => ({
          intents: { ...s.intents, [id]: { paused: desiredPaused, until: Date.now() + 20000 } },
          miners: s.miners.map((x) =>
            x.id === id ? { ...x, status: desiredPaused ? "paused" : "mining" } : x
          ),
        }));
        const res = await setMinerPaused(m.ip, desiredPaused);
        if (res.needPassword) {
          set((s) => { const i = { ...s.intents }; delete i[id]; return { intents: i, pwPrompt: { minerId: id, reason: "control", paused: desiredPaused } }; });
        } else if (!res.ok) {
          set((s) => { const i = { ...s.intents }; delete i[id]; return { intents: i }; });
        }
      },

      submitMinerPassword: async (pw) => {
        const prompt = get().pwPrompt;
        if (!prompt) return;
        const { minerId, reason, paused } = prompt;
        const { miners } = get();
        const target = miners.find((x) => x.id === minerId);
        if (!target) return;
        // The server stores the credential encrypted; the browser keeps only the
        // placeholder, and every control call is finished server-side.
        const stored = await saveMinerPassword(target.ip, pw);
        const kept = stored ? STORED_PASSWORD : pw;
        // Store the password and clear any prior dismissal for this miner.
        set((s) => {
          const dismissed = { ...s.pwDismissed };
          delete dismissed[minerId];
          return {
            pwPrompt: null,
            pwDismissed: dismissed,
            miners: s.miners.map((x) =>
              x.id === minerId ? { ...x, config: { ...x.config, apiPassword: kept } } : x
            ),
          };
        });

        // "read": password only needed to read the power target — refresh now.
        if (reason === "read") {
          await get().pollLive();
          return;
        }

        // "power": password needed to commit power target — retry now.
        if (reason === "power") {
          await get().commitPowerTarget(minerId);
          return;
        }

        // "control": also apply the intended pause/resume.
        set((s) => ({
          intents: { ...s.intents, [minerId]: { paused: !!paused, until: Date.now() + 20000 } },
          miners: s.miners.map((x) =>
            x.id === minerId ? { ...x, status: paused ? "paused" : "mining" } : x
          ),
        }));
        const m = get().miners.find((x) => x.id === minerId);
        if (m) {
          const res = await setMinerPaused(m.ip, !!paused);
          if (res.ok) {
            set((s) => ({
              miners: s.miners.map((x) =>
                x.id === minerId ? { ...x, status: paused ? "paused" : "mining" } : x
              ),
            }));
          } else if (res.needPassword) {
            set({ pwPrompt: { minerId, reason: "control", paused } });
          }
        }
      },

      dismissPwPrompt: () =>
        set((s) =>
          s.pwPrompt
            ? { pwPrompt: null, pwDismissed: { ...s.pwDismissed, [s.pwPrompt.minerId]: true } }
            : { pwPrompt: null }
        ),

      removeMiner: (id) =>
        set((s) => {
          const miners = s.miners.filter((m) => m.id !== id);
          const selectedId =
            s.selectedId === id ? (miners[0]?.id ?? null) : s.selectedId;
          return { miners, selectedId };
        }),

      pollLive: async () => {
        const { miners } = get();
        const fetched = await Promise.all(
          miners.map(async (m) => {
            const snap = await fetchMinerStats(m.ip);
            return { id: m.id, snap };
          })
        );

        const anyLive = fetched.some((f) => f.snap != null);

        set((s) => ({
          liveMode: anyLive,
          miners: s.miners.map((m) => {
            const entry = fetched.find((f) => f.id === m.id);
            const snap = entry?.snap;
            // No response this poll → mark offline, keep last known values.
            if (!snap) return { ...m, online: false };
            const live = snap.live;
            // Only trust board counts while actively hashing. During cool-down
            // after a power-target change, asic-rs may report misleading board
            // counts (e.g. all boards "active" via last-resort fallback), which
            // would temporarily corrupt the scaled Range and Target readouts.
            const boards = (snap.live.th > 0.5 ? snap.boards : null) ?? m.boards;
            // Capture the whole-machine power ceiling ONCE at first connection
            // and freeze it — subsequent polls must not overwrite it.
            const captured = m.config.powerMax > 0;
            const effMax = captured ? m.config.powerMax : (snap.machineFull ?? 0);
            const configPatch = {
              ...(!captured && snap.machineFull != null && snap.machineFull > 0
                ? { powerMax: snap.machineFull, powerTarget: snap.machineFull }
                : {}),
              ...(effMax > 0
                ? {
                    powerMin:
                      snap.powerMin != null && snap.powerMin > 0
                        ? snap.powerMin
                        : Math.round(effMax / 3),
                  }
                : {}),
            };
            return {
              ...m,
              online: true,
              status: snap.paused ? ("paused" as const) : ("mining" as const),
              boards,
              config: { ...m.config, ...configPatch },
              live: {
                th: live.th,
                watts: live.watts ?? m.live.watts,
                chipTemp: live.chipTemp ?? m.live.chipTemp,
                fanSpeed: live.fanSpeed ?? m.live.fanSpeed,
              },
            };
          }),
        }));

        // Reads use the open CGMiner API now — no password prompt for viewing.
        // (The control flow still raises its own prompt for pause/resume.)

        const now = Date.now();
        set((s) => {
          let changed = false;
          const intents = { ...s.intents };
          for (const mm of s.miners) {
            const it = intents[mm.id];
            if (it && (now > it.until || (mm.status === "paused") === it.paused)) {
              delete intents[mm.id];
              changed = true;
            }
          }
          return changed ? { intents } : {};
        });
      },

      scan: async () => {
        set({ scanning: true });
        // The container cannot see the host's interfaces, so interface
        // auto-detection is useless on StartOS. Scan the two ranges home
        // users actually have (192.168.0-7.x and 10.0.0-7.x, i.e. /21 each);
        // anything else is one manual CIDR entry away. Saved miners outside
        // those ranges get their own /24; docker ranges (172.16-31.x) are
        // never scanned.
        const subnetsToScan = new Set<string>(["192.168.0.0/21", "10.0.0.0/21"]);
        const isDockerRange = (cidr: string) => {
          const m = cidr.match(/^(\d+)\.(\d+)\./);
          return !!m && +m[1] === 172 && +m[2] >= 16 && +m[2] <= 31;
        };

        for (const m of get().miners) {
          const first = m.ip.split(".");
          if (first.length === 4) {
            const a = +first[0], b = +first[1];
            const covered =
              (a === 192 && b === 168 && +first[2] <= 7) ||
              (a === 10 && b === 0 && +first[2] <= 7);
            if (!covered && !isDockerRange(m.ip)) subnetsToScan.add(first.slice(0, 3).join("."));
          }
        }

        try {
          const res = await fetch("/api/subnet");
          if (res.ok) {
            const data = await res.json();
            const candidates: string[] = [];
            if (Array.isArray(data.subnets)) candidates.push(...data.subnets);
            else if (typeof data.subnet === "string") candidates.push(data.subnet);
            for (const c of candidates) {
              if (typeof c === "string" && !isDockerRange(c)) {
                subnetsToScan.add(c.includes("/") ? c : c.split(".").slice(0, 3).join("."));
              }
            }
          }
        } catch (e) {
          console.error(e);
        }

        const subnetList = Array.from(subnetsToScan);
        const scanResults = await Promise.allSettled(subnetList.map((subnet) => scanLAN(subnet)));
        const allDiscovered = scanResults.flatMap((r, i) => {
          if (r.status === "rejected") {
            console.error(`scan of ${subnetList[i]} failed`, r.reason);
            return [];
          }
          return r.value;
        });

        const map = new Map<string, { ip: string; model?: string; live: { th: number; watts?: number; chipTemp?: number; fanSpeed?: number } }>();
        for (const item of allDiscovered) {
          if (item && item.ip) {
            map.set(item.ip, item);
          }
        }
        const discovered = Array.from(map.values());

        set((s) => {
          const existingIps = new Set(s.miners.map((m) => m.ip));
          const newMiners: Miner[] = discovered
            .filter((d) => !existingIps.has(d.ip))
            .map((d) => toMiner(d));
          return { scanning: false, miners: [...s.miners, ...newMiners] };
        });
      },

      addManual: async (input) => {
        const v = input.trim();
        const cidr = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
        const ipRe = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const validOctets = (m: RegExpMatchArray) => [1, 2, 3, 4].every((i) => +m[i] <= 255);

        const isPrivateV4 = (a: number, b: number) =>
          a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
        const mCidr = v.match(cidr);
        if (mCidr && validOctets(mCidr)) {
          const prefix = +mCidr[5];
          const [a, b] = [+mCidr[1], +mCidr[2]];
          // Cap manual scans at /21 (2048 hosts, same as the built-in scan) and
          // require private ranges — a dropdown must never be a scan amplifier.
          if (prefix < 21 || prefix > 32 || !isPrivateV4(a, b)) {
            return "invalid";
          }
          set({ scanning: true });
          try {
            const discovered = await scanLAN(v);
            set((s) => {
              const existing = new Set(s.miners.map((m) => m.ip));
              const fresh = discovered.filter((d) => d.ip && !existing.has(d.ip)).map((d) => toMiner(d));
              return { scanning: false, miners: [...s.miners, ...fresh] };
            });
            return "scanned";
          } catch {
            set({ scanning: false });
            return "failed";
          }
        }

        const mIp = v.match(ipRe);
        if (mIp && validOctets(mIp)) {
          if (get().miners.some((m) => m.ip === v)) return "exists";
          const snap = await fetchMinerStats(v);
          if (!snap) return "notfound";
          set((s) => {
            const miner = toMiner({ ip: v, live: snap.live });
            return {
              miners: [...s.miners, miner],
              selectedId: s.selectedId ?? miner.id,
            };
          });
          return "added";
        }

        return "invalid";
      },

      _tick: () => {
        // In live mode the real values come from pollLive — don't simulate.
        // In non-live mode, only animate paused miners (lerp toward 0);
        // mining miners keep their last known real values unchanged.
        if (get().liveMode) return;
        set((s) => ({
          miners: s.miners.map((m) => {
            if (m.status !== "mining") {
              return {
                ...m,
                live: {
                  ...m.live,
                  th: lerp(m.live.th, 0, 0.2),
                  watts: lerp(m.live.watts, 0, 0.25),
                  chipTemp: lerp(m.live.chipTemp, 28, 0.04),
                  fanSpeed: lerp(m.live.fanSpeed, 0, 0.15),
                },
              };
            }
            return m;
          }),
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => customStorage),
      // v0→v1: power values and live readings now come from the miner on each poll.
      // v1→v2: powerMin/powerMax/powerTarget now store whole-machine watts (not
      //   scaled per active boards); reset to 0 so the ceiling is re-captured
      //   on next poll with the new semantics.
      migrate: (persisted) => {
        const s = persisted as { miners?: Miner[]; selectedId?: string | null; theme?: "light" | "dark" };
        return {
          selectedId: s.selectedId ?? null,
          theme: s.theme ?? "dark",
          miners: (s.miners ?? []).map((m) => ({
            ...m,
            config: {
              name: m.config?.name ?? m.ip ?? "",
              powerMin: 0,
              powerMax: 0,
              powerTarget: 0,
              apiPassword: m.config?.apiPassword,
            },
            live: { th: 0, watts: 0, chipTemp: 0, fanSpeed: 0 },
          })),
        };
      },
      partialize: (s) => ({
        miners: s.miners,
        selectedId: s.selectedId,
        theme: s.theme,
      }),
    }
  )
);

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

