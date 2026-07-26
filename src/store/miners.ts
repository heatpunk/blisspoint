import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Miner, MinerConfig } from "@/lib/types";
import { fetchMinerStats, scanLAN, setMinerPaused, setMinerPowerTarget } from "@/lib/minerApi";

const STORAGE_KEY = "blisspoint.state.v2";

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
  /** Poll live data from the real miner API via the local proxy */
  pollLive: () => Promise<void>;
  /** Smooth animation tick (1 s) — lerps toward current target/live values */
  _tick: () => void;
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
        const res = await setMinerPowerTarget(m.ip, m.config.powerTarget, m.config.apiPassword);
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
        const res = await setMinerPaused(m.ip, desiredPaused, m.config.apiPassword);
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
        // Store the password and clear any prior dismissal for this miner.
        set((s) => {
          const dismissed = { ...s.pwDismissed };
          delete dismissed[minerId];
          return {
            pwPrompt: null,
            pwDismissed: dismissed,
            miners: s.miners.map((x) =>
              x.id === minerId ? { ...x, config: { ...x.config, apiPassword: pw } } : x
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
          const res = await setMinerPaused(m.ip, !!paused, pw);
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
            const snap = await fetchMinerStats(m.ip, m.config.apiPassword);
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
        const { miners } = get();
        const existingIp = miners[0]?.ip ?? "192.168.1.1";
        const subnet = existingIp.split(".").slice(0, 3).join(".");

        const discovered = await scanLAN(subnet);

        set((s) => {
          const existingIps = new Set(s.miners.map((m) => m.ip));
          const newMiners: Miner[] = discovered
            .filter((d) => !existingIps.has(d.ip))
            .map((d, i) => ({
              id: `disc-${Date.now()}-${i}`,
              ip: d.ip,
              model: d.model,
              status: "mining" as const,
              config: {
                name: d.ip,
                powerMin: 0,
                powerMax: 0,
                powerTarget: 0,
              },
              live: {
                th: d.live.th,
                watts: d.live.watts ?? 0,
                chipTemp: d.live.chipTemp ?? 0,
                fanSpeed: d.live.fanSpeed ?? 0,
              },
            }));
          return { scanning: false, miners: [...s.miners, ...newMiners] };
        });
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

