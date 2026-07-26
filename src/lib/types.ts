export type MinerStatus = "mining" | "paused" | "offline";

export interface MinerConfig {
  /** user-defined display name */
  name: string;
  /** lower bound of allowed power range, watts */
  powerMin: number;
  /** upper bound of allowed power range, watts */
  powerMax: number;
  /** target watts (within [powerMin, powerMax]) */
  powerTarget: number;
  /** BraiinsOS+ control-API password (username root); stored on device */
  apiPassword?: string;
}

export interface MinerLive {
  /** measured terahash/s */
  th: number;
  /** measured wall power, watts */
  watts: number;
  /** chip temperature °C */
  chipTemp: number;
  /** current fan speed percent */
  fanSpeed: number;
}

export interface Miner {
  id: string;
  ip: string;
  model: string;
  status: MinerStatus;
  /** reachable on the most recent poll — drives the live dot/ON state */
  online?: boolean;
  /** active vs total blisspoints, populated from the miner */
  boards?: { active: number; total: number };
  config: MinerConfig;
  live: MinerLive;
}
