//! Mapping from asic-rs `MinerData` to Blisspoint's HTTP JSON contract.
//!
//! This module is a pure function — no network, no async — so it is easy
//! to unit-test with constructed `MinerData` values.

use asic_rs_core::data::{
    hashrate::HashRateUnit,
    miner::{MinerData, TuningTarget},
};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Output types (exact JSON shapes the React UI expects)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LiveStats {
    /// Current hashrate in TH/s (0.0 when paused).
    pub th: f64,
    /// Wall-power watts (null when unavailable).
    pub watts: Option<f64>,
    /// Hottest chip temperature °C, 1 decimal (null when unavailable).
    #[serde(rename = "chipTemp")]
    pub chip_temp: Option<f64>,
    /// Max fan speed 0–100 % (null when unavailable).
    #[serde(rename = "fanSpeed")]
    pub fan_speed: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BoardsInfo {
    pub active: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConfigInfo {
    /// Configured power target / limit in watts (the UI slider ceiling).
    /// Null when asic-rs does not expose it.
    #[serde(rename = "fullTarget")]
    pub full_target: Option<f64>,
    /// Always null — Braiins power floor is not on the open API.
    #[serde(rename = "powerMin")]
    pub power_min: Option<f64>,
    /// Active vs total hashboards; null when active == 0.
    pub boards: Option<BoardsInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StatsResponse {
    pub ok: bool,
    pub live: LiveStats,
    pub config: ConfigInfo,
    pub model: String,
    /// Explicit paused state from asic-rs `is_mining` (reliable as of 0.7.2) —
    /// lets the UI drop the "hashrate ≈ 0 ⇒ paused" heuristic.
    pub paused: bool,
    #[serde(rename = "needPassword")]
    pub need_password: bool,
}

// ---------------------------------------------------------------------------
// Board-count helpers (replicate proxy.cjs `modelBoardCount` / `activeBoardCount`)
// ---------------------------------------------------------------------------

/// Physical hashboard count from model name.
/// Antminer S/T 9/17/19/21 → 3; default 3.
/// (Virtually all Antminer S/T-series models have 3 boards, so the default is also 3.)
fn model_board_count_from_name(_model: &str) -> u32 {
    3
}

/// Number of hashboards that are actively hashing.
///
/// Uses `BoardData.active` (Some(true)) to mirror the old proxy's
/// `devs.filter(d => d.Enabled === 'Y' && d.Status === 'Alive').length`.
/// Falls back to the count of boards that have any hashrate or working chips.
fn active_board_count(data: &MinerData) -> u32 {
    // If any board has an explicit `active` field set, use that count.
    let has_explicit_active_field = data.hashboards.iter().any(|b| b.active.is_some());
    if has_explicit_active_field {
        return data
            .hashboards
            .iter()
            .filter(|b| b.active == Some(true))
            .count() as u32;
    }

    // Fall back: boards with any hashrate or working chips
    let fallback = data
        .hashboards
        .iter()
        .filter(|b| {
            b.hashrate.as_ref().map(|hr| hr.value > 0.0).unwrap_or(false)
                || b.working_chips.map(|c| c > 0).unwrap_or(false)
        })
        .count();
    if fallback > 0 {
        return fallback as u32;
    }
    // Last resort: total number of boards reported
    data.hashboards.len() as u32
}

/// Whole-machine configured power target in watts.
///
/// Prefers `tuning_target` (the user-set value), then `scaled_tuning_target`,
/// then the `maximum` of `tuning_capabilities.power` (factory ceiling).
/// Returns None when none of these are populated.
fn full_power_target(data: &MinerData) -> Option<f64> {
    // 1. Current tuning target if it's a power target
    if let Some(TuningTarget::Power(p)) = &data.tuning_target {
        let w = p.as_watts();
        if w > 0.0 {
            return Some(w);
        }
    }
    // 2. Scaled tuning target
    if let Some(TuningTarget::Power(p)) = &data.scaled_tuning_target {
        let w = p.as_watts();
        if w > 0.0 {
            return Some(w);
        }
    }
    // 3. Tuning capabilities maximum
    if let Some(caps) = &data.tuning_capabilities
        && let Some(power_caps) = &caps.power
        && let Some(TuningTarget::Power(p)) = &power_caps.maximum
    {
        let w = p.as_watts();
        if w > 0.0 {
            return Some(w);
        }
    }
    None
}

/// Whole-machine minimum allowed power target in watts, from
/// `tuning_capabilities.power.minimum` (the firmware-reported floor).
/// Returns None when the firmware backend does not expose it.
fn min_power_target(data: &MinerData) -> Option<f64> {
    if let Some(caps) = &data.tuning_capabilities
        && let Some(power_caps) = &caps.power
        && let Some(TuningTarget::Power(p)) = &power_caps.minimum
    {
        let w = p.as_watts();
        if w > 0.0 {
            return Some(w);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Main mapping function
// ---------------------------------------------------------------------------

/// Map asic-rs `MinerData` to Blisspoint's `/api/miners/{ip}/stats` response.
pub fn map_miner_data(data: &MinerData) -> StatsResponse {
    // --- live.th ---
    // Current hashrate in TH/s; 0.0 when paused.
    let th = data
        .hashrate
        .as_ref()
        .map(|hr| {
            let th = hr.clone().as_unit(HashRateUnit::TeraHash).value;
            // Round to 2 decimal places
            (th * 100.0).round() / 100.0
        })
        .unwrap_or(0.0);

    // --- live.watts ---
    let watts = data.wattage.as_ref().map(|p| p.as_watts());

    // --- live.chipTemp ---
    // Hottest chip temperature across all boards, 1 decimal place.
    // Uses outlet_chip_temperature (hottest chip per board) first, then board_temperature.
    let chip_temp: Option<f64> = {
        let mut temps: Vec<f64> = Vec::new();

        for board in &data.hashboards {
            // outlet_chip_temperature = hottest chip on this board
            if let Some(t) = board.outlet_chip_temperature {
                let c = t.as_celsius();
                if c > 0.0 {
                    temps.push(c);
                }
            } else if let Some(t) = board.board_temperature {
                let c = t.as_celsius();
                if c > 0.0 {
                    temps.push(c);
                }
            }
        }

        // Also check chip-level temperatures
        for board in &data.hashboards {
            for chip in &board.chips {
                if let Some(t) = chip.temperature {
                    let c = t.as_celsius();
                    if c > 0.0 {
                        temps.push(c);
                    }
                }
            }
        }

        if temps.is_empty() {
            None
        } else {
            let max = temps.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            Some((max * 10.0).round() / 10.0)
        }
    };

    // --- live.fanSpeed ---
    // Max fan speed as percentage 0–100. asic-rs FanData has rpm (AngularVelocity).
    // We cap at 6000 RPM as equivalent to 100% (matching old proxy heuristic).
    let fan_speed: Option<i64> = {
        let rpms: Vec<f64> = data
            .fans
            .iter()
            .filter_map(|f| f.rpm.map(|r| r.as_rpm()))
            .filter(|&r| r >= 0.0)
            .collect();

        if rpms.is_empty() {
            None
        } else {
            let max_rpm = rpms.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            // Convert RPM to percentage: cap at 6000 RPM = 100%
            let pct = (max_rpm / 6000.0 * 100.0).round().min(100.0) as i64;
            Some(pct.max(0))
        }
    };

    // --- model ---
    let model = {
        let make = data.device_info.make.trim();
        let model_name = data.device_info.model.trim();
        if make.is_empty() && model_name.is_empty() {
            "Antminer".to_string()
        } else if make.is_empty() {
            model_name.to_string()
        } else if model_name.is_empty() {
            make.to_string()
        } else {
            format!("{} {}", make, model_name)
        }
    };

    // --- config.boards ---
    let active = active_board_count(data);
    // Expected hashboards from device_info; fall back to model name heuristic.
    let total_from_model = data
        .expected_hashboards
        .map(|n| n as u32)
        .unwrap_or_else(|| model_board_count_from_name(&model));
    let total = total_from_model.max(active);

    let boards = if active == 0 {
        None
    } else {
        Some(BoardsInfo { active, total })
    };

    // --- config.fullTarget / powerMin ---
    let full_target = full_power_target(data);
    let power_min = min_power_target(data);

    StatsResponse {
        ok: true,
        live: LiveStats {
            th,
            watts,
            chip_temp,
            fan_speed,
        },
        config: ConfigInfo {
            full_target,
            power_min,
            boards,
        },
        model,
        paused: !data.is_mining,
        need_password: false,
    }
}

/// Minimal scan entry returned by `/api/scan`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanEntry {
    pub ip: String,
    pub model: String,
    pub live: LiveStats,
}

/// Build a scan entry from MinerData (subset of StatsResponse).
pub fn map_scan_entry(data: &MinerData) -> ScanEntry {
    let r = map_miner_data(data);
    ScanEntry {
        ip: data.ip.to_string(),
        model: r.model,
        live: r.live,
    }
}

// ---------------------------------------------------------------------------
// Unit tests (Issue #29 acceptance criteria)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use asic_rs_core::data::{
        board::BoardData,
        capabilities::{PowerTuningCapabilities, TuningCapabilities},
        device::{DeviceInfo, HashAlgorithm, MinerHardware},
        fan::FanData,
        hashrate::{HashRate, HashRateUnit},
        miner::{MinerData, TuningTarget},
    };
    use measurements::{AngularVelocity, Power, Temperature};
    use std::{net::IpAddr, time::Duration};

    fn make_device_info(make: &str, model: &str) -> DeviceInfo {
        DeviceInfo {
            make: make.to_string(),
            model: model.to_string(),
            hardware: MinerHardware {
                fans: Some(4),
                boards: Some(vec![Some(76), Some(76), Some(76)]),
            },
            firmware: "BraiinsOS+".to_string(),
            algo: HashAlgorithm::SHA256,
        }
    }

    fn make_board(active: Option<bool>, hashrate_th: Option<f64>, chip_temp_c: Option<f64>) -> BoardData {
        BoardData {
            position: 0,
            hashrate: hashrate_th.map(|v| HashRate {
                value: v,
                unit: HashRateUnit::TeraHash,
                algo: "SHA256".to_string(),
            }),
            expected_hashrate: None,
            board_temperature: None,
            inlet_chip_temperature: None,
            outlet_chip_temperature: chip_temp_c.map(Temperature::from_celsius),
            expected_chips: Some(76),
            working_chips: if active == Some(true) { Some(76) } else { Some(0) },
            serial_number: None,
            chips: vec![],
            voltage: None,
            frequency: None,
            tuned: Some(true),
            active,
        }
    }

    fn base_data(
        hashrate_th: Option<f64>,
        watts: Option<f64>,
        hashboards: Vec<BoardData>,
        fans_rpm: Vec<f64>,
        tuning_target: Option<TuningTarget>,
    ) -> MinerData {
        MinerData {
            schema_version: "0.7.1".to_string(),
            timestamp: 0,
            ip: "192.168.1.1".parse::<IpAddr>().unwrap(),
            mac: None,
            device_info: make_device_info("Antminer", "S19j Pro"),
            serial_number: None,
            hostname: None,
            api_version: None,
            firmware_version: None,
            control_board_version: None,
            expected_hashboards: Some(3),
            hashboards,
            hashrate: hashrate_th.map(|v| HashRate {
                value: v,
                unit: HashRateUnit::TeraHash,
                algo: "SHA256".to_string(),
            }),
            expected_hashrate: None,
            expected_chips: Some(228),
            total_chips: Some(228),
            expected_fans: Some(4),
            fans: fans_rpm
                .into_iter()
                .enumerate()
                .map(|(i, rpm)| FanData {
                    position: i as i16,
                    rpm: Some(AngularVelocity::from_rpm(rpm)),
                })
                .collect(),
            psu_fans: vec![],
            average_temperature: None,
            fluid_temperature: None,
            outlet_fluid_temperature: None,
            wattage: watts.map(Power::from_watts),
            tuning_target,
            scaled_tuning_target: None,
            tuning_percent: None,
            tuning_capabilities: None,
            efficiency: None,
            light_flashing: None,
            messages: vec![],
            uptime: Some(Duration::from_secs(3600)),
            is_mining: true,
            pools: vec![],
        }
    }

    // (a) Active miner with normal values
    #[test]
    fn test_active_miner() {
        let boards = vec![
            make_board(Some(true), Some(33.0), Some(64.0)),
            make_board(Some(true), Some(31.5), Some(62.0)),
            make_board(Some(true), Some(30.6), Some(63.5)),
        ];
        let data = base_data(
            Some(95.12),
            Some(3250.0),
            boards,
            vec![4800.0, 5100.0, 4700.0, 5000.0],
            Some(TuningTarget::from_watts(3400.0)),
        );

        let r = map_miner_data(&data);
        assert!(r.ok);
        assert_eq!(r.live.th, 95.12);
        assert_eq!(r.live.watts, Some(3250.0));
        // Hottest board chip temp = 64.0
        assert_eq!(r.live.chip_temp, Some(64.0));
        // Max rpm = 5100, pct = round(5100/6000*100) = 85
        assert_eq!(r.live.fan_speed, Some(85));
        assert_eq!(r.model, "Antminer S19j Pro");
        assert_eq!(r.config.full_target, Some(3400.0));
        assert_eq!(r.config.power_min, None);
        let boards_info = r.config.boards.unwrap();
        assert_eq!(boards_info.active, 3);
        assert_eq!(boards_info.total, 3);
        assert!(!r.need_password);
    }

    // (b) Paused miner: th=0, watts=0, fanSpeed=0
    #[test]
    fn test_paused_miner() {
        let boards = vec![
            make_board(Some(false), Some(0.0), None),
            make_board(Some(false), Some(0.0), None),
            make_board(Some(false), Some(0.0), None),
        ];
        let mut data = base_data(Some(0.0), Some(0.0), boards, vec![0.0, 0.0, 0.0, 0.0], None);
        data.is_mining = false;

        let r = map_miner_data(&data);
        assert_eq!(r.live.th, 0.0);
        assert_eq!(r.live.watts, Some(0.0));
        // fan_speed: max rpm = 0 → 0%
        assert_eq!(r.live.fan_speed, Some(0));
        // No active boards (all active=false) → boards=None
        assert!(r.config.boards.is_none());
    }

    // (c) One board removed: active=2, total=3
    #[test]
    fn test_one_board_missing() {
        let boards = vec![
            make_board(Some(true), Some(50.0), Some(62.0)),
            make_board(Some(true), Some(48.0), Some(61.0)),
            // third board absent
        ];
        let data = base_data(
            Some(98.0),
            Some(3300.0),
            boards,
            vec![4500.0, 4600.0],
            Some(TuningTarget::from_watts(3400.0)),
        );

        let r = map_miner_data(&data);
        let b = r.config.boards.unwrap();
        assert_eq!(b.active, 2);
        // total = max(2, expected_hashboards=3) = 3
        assert_eq!(b.total, 3);
    }

    // (d) Missing fullTarget → fullTarget: null
    #[test]
    fn test_missing_full_target() {
        let boards = vec![make_board(Some(true), Some(95.0), Some(63.0))];
        let data = base_data(Some(95.0), Some(3200.0), boards, vec![4800.0], None);

        let r = map_miner_data(&data);
        assert_eq!(r.config.full_target, None);
    }

    // fullTarget from tuning_capabilities.power.maximum
    #[test]
    fn test_full_target_from_capabilities() {
        let boards = vec![make_board(Some(true), Some(95.0), Some(63.0))];
        let mut data = base_data(Some(95.0), Some(3200.0), boards, vec![4800.0], None);
        data.tuning_capabilities = Some(TuningCapabilities {
            power: Some(PowerTuningCapabilities {
                default: None,
                minimum: None,
                maximum: Some(TuningTarget::from_watts(3500.0)),
            }),
            hashrate: None,
            presets: None,
        });

        let r = map_miner_data(&data);
        assert_eq!(r.config.full_target, Some(3500.0));
    }

    // model fallback when device_info fields are empty
    #[test]
    fn test_model_fallback() {
        let mut data = base_data(None, None, vec![], vec![], None);
        data.device_info.make = "".to_string();
        data.device_info.model = "".to_string();

        let r = map_miner_data(&data);
        assert_eq!(r.model, "Antminer");
    }

    // th rounded to 2 decimals
    #[test]
    fn test_th_rounding() {
        let data = base_data(Some(95.123456), None, vec![], vec![], None);
        let r = map_miner_data(&data);
        assert_eq!(r.live.th, 95.12);
    }

    // hashrate in GH/s gets converted to TH/s
    #[test]
    fn test_hashrate_unit_conversion() {
        let mut data = base_data(None, None, vec![], vec![], None);
        data.hashrate = Some(HashRate {
            value: 95000.0,
            unit: HashRateUnit::GigaHash,
            algo: "SHA256".to_string(),
        });

        let r = map_miner_data(&data);
        assert_eq!(r.live.th, 95.0);
    }

    // error response helper
    #[test]
    fn test_error_response_json() {
        let body = serde_json::json!({ "ok": false, "error": "timeout" });
        assert_eq!(body["ok"], false);
        assert_eq!(body["error"], "timeout");
    }
}
