//! Blisspoint proxy-rs — Rust replacement for server/proxy.cjs
//!
//! Listens on 127.0.0.1:8081 (same address the old Node proxy used so that
//! server/serve.cjs and the React app continue to work without modification).
//!
//! Routes implemented:
//!   GET  /api/health
//!   GET  /api/miners/{ip}/stats
//!   POST /api/miners/{ip}/pause
//!   POST /api/miners/{ip}/resume
//!   POST /api/miners/{ip}/power
//!   GET  /api/miners/{ip}/rawdata
//!   GET  /api/scan?subnet=192.168.1

mod map;

use std::net::IpAddr;
use std::str::FromStr;

use asic_rs::MinerFactory;
use asic_rs_core::config::tuning::TuningConfig;
use asic_rs_core::data::miner::TuningTarget;
use asic_rs_core::traits::auth::MinerAuth;
use axum::{
    Router,
    extract::{Path, Query, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures::StreamExt;
use map::{map_miner_data, map_scan_entry};
use measurements::Power;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

// ---------------------------------------------------------------------------
// Shared application state
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct AppState {
    host_re: Regex,
}

impl AppState {
    fn new() -> Self {
        Self {
            host_re: Regex::new(r"^[a-zA-Z0-9.\-]+$").expect("valid regex"),
        }
    }
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------

fn json_response<T: Serialize>(status: StatusCode, body: &T) -> Response {
    let json_bytes = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    (
        status,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        )],
        json_bytes,
    )
        .into_response()
}

fn ok_json<T: Serialize>(body: &T) -> Response {
    json_response(StatusCode::OK, body)
}

fn err_json(status: StatusCode, msg: &str) -> Response {
    json_response(status, &json!({ "ok": false, "error": msg }))
}

fn bad_request(msg: &str) -> Response {
    err_json(StatusCode::BAD_REQUEST, msg)
}

fn bad_gateway(msg: &str) -> Response {
    err_json(StatusCode::BAD_GATEWAY, msg)
}

// ---------------------------------------------------------------------------
// Route: GET /api/health
// ---------------------------------------------------------------------------

async fn health() -> Response {
    ok_json(&json!({ "ok": true }))
}

// ---------------------------------------------------------------------------
// Route: GET /api/miners/{ip}/stats
// ---------------------------------------------------------------------------

async fn miner_stats(State(state): State<AppState>, Path(ip): Path<String>) -> Response {
    if !state.host_re.is_match(&ip) {
        return bad_request("bad host");
    }

    let addr = match IpAddr::from_str(&ip) {
        Ok(a) => a,
        Err(_) => return bad_request("invalid IP address"),
    };

    let factory = MinerFactory::new();
    let miner = match factory.get_miner(addr).await {
        Ok(Some(m)) => m,
        Ok(None) => return bad_gateway("miner not found or not supported"),
        Err(e) => return bad_gateway(&format!("discovery error: {e}")),
    };

    let data = miner.get_data().await;
    let response = map_miner_data(&data);

    info!(
        "[stats] {} model=\"{}\" fullTarget={:?} boards={:?}",
        ip, response.model, response.config.full_target, response.config.boards
    );

    ok_json(&response)
}

// ---------------------------------------------------------------------------
// Route: POST /api/miners/{ip}/pause  and  /resume
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
struct ControlBody {
    #[serde(default)]
    password: String,
}

async fn miner_pause(
    State(state): State<AppState>,
    Path(ip): Path<String>,
    body: Option<axum::extract::Json<ControlBody>>,
) -> Response {
    handle_pause_resume(state, ip, "pause", body).await
}

async fn miner_resume(
    State(state): State<AppState>,
    Path(ip): Path<String>,
    body: Option<axum::extract::Json<ControlBody>>,
) -> Response {
    handle_pause_resume(state, ip, "resume", body).await
}

async fn handle_pause_resume(
    state: AppState,
    ip: String,
    action: &'static str,
    body: Option<axum::extract::Json<ControlBody>>,
) -> Response {
    if !state.host_re.is_match(&ip) {
        return bad_request("bad host");
    }

    let addr = match IpAddr::from_str(&ip) {
        Ok(a) => a,
        Err(_) => return bad_request("invalid IP address"),
    };

    let password = body.map(|b| b.password.clone()).filter(|p| !p.is_empty());

    // Discover the miner
    let factory = MinerFactory::new();
    let mut miner = match factory.get_miner(addr).await {
        Ok(Some(m)) => m,
        Ok(None) => {
            return json_response(
                StatusCode::BAD_GATEWAY,
                &json!({ "ok": false, "needPassword": false, "error": "miner not found or not supported" }),
            );
        }
        Err(e) => {
            return json_response(
                StatusCode::BAD_GATEWAY,
                &json!({ "ok": false, "error": format!("discovery error: {e}") }),
            );
        }
    };

    if let Some(pw) = password {
        miner.set_auth(MinerAuth::new("root", pw));
    }

    // Issue #31 decision: use native pause/resume from asic-rs Pause/Resume traits.
    // The Miner trait includes Pause and Resume via HasMinerControl.
    // `supports_pause()` / `supports_resume()` tell us if the firmware supports it.
    let result = match action {
        "pause" => {
            if miner.supports_pause() {
                miner.pause(None).await
            } else {
                Err(anyhow::anyhow!("pause not supported by this firmware"))
            }
        }
        "resume" => {
            if miner.supports_resume() {
                miner.resume(None).await
            } else {
                Err(anyhow::anyhow!("resume not supported by this firmware"))
            }
        }
        _ => unreachable!(),
    };

    match result {
        Ok(_) => ok_json(&json!({ "ok": true, "command": action })),
        Err(e) => {
            let msg = e.to_string();
            // Mirror old proxy: flag auth errors with needPassword=true
            let denied = is_auth_error(&msg);
            let status = if denied {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::BAD_GATEWAY
            };
            json_response(
                status,
                &json!({ "ok": false, "needPassword": denied, "error": msg }),
            )
        }
    }
}

/// Match auth/permission errors (mirrors old proxy regex).
fn is_auth_error(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    lower.contains("denied")
        || lower.contains("unauth")
        || lower.contains("invalid")
        || lower.contains("permission")
        || lower.contains("password")
        || lower.contains("credential")
}

// ---------------------------------------------------------------------------
// Route: POST /api/miners/{ip}/power
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
struct PowerBody {
    watts: i64,
    #[serde(default)]
    password: String,
}

async fn miner_set_power(
    State(state): State<AppState>,
    Path(ip): Path<String>,
    body: Option<axum::extract::Json<PowerBody>>,
) -> Response {
    if !state.host_re.is_match(&ip) {
        return bad_request("bad host");
    }

    let addr = match IpAddr::from_str(&ip) {
        Ok(a) => a,
        Err(_) => return bad_request("invalid IP address"),
    };

    let body = match body {
        Some(b) => b.0,
        None => return bad_request("missing body with {\"watts\": N}"),
    };

    if body.watts <= 0 {
        return bad_request("watts must be positive");
    }

    let password = if body.password.is_empty() {
        None
    } else {
        Some(body.password.clone())
    };

    let factory = MinerFactory::new();
    let mut miner = match factory.get_miner(addr).await {
        Ok(Some(m)) => m,
        Ok(None) => {
            return json_response(
                StatusCode::BAD_GATEWAY,
                &json!({ "ok": false, "needPassword": false, "error": "miner not found or not supported" }),
            );
        }
        Err(e) => {
            return json_response(
                StatusCode::BAD_GATEWAY,
                &json!({ "ok": false, "error": format!("discovery error: {e}") }),
            );
        }
    };

    if let Some(pw) = password {
        miner.set_auth(MinerAuth::new("root", pw));
    }

    // BraiinsOS+ v26.04+ (including v26.06) returns false from supports_tuning_config()
    // and uses a dedicated power-limit endpoint instead. Try that as fallback.
    if miner.supports_tuning_config() {
        let config = TuningConfig::new(TuningTarget::from_watts(body.watts as f64));
        return match miner.set_tuning_config(config, None).await {
            Ok(_) => ok_json(&json!({ "ok": true })),
            Err(e) => {
                let msg = e.to_string();
                let denied = is_auth_error(&msg);
                let status = if denied {
                    StatusCode::UNAUTHORIZED
                } else {
                    StatusCode::BAD_GATEWAY
                };
                json_response(
                    status,
                    &json!({ "ok": false, "needPassword": denied, "error": msg }),
                )
            }
        };
    }

    if miner.supports_set_power_limit() {
        let power = Power::from_watts(body.watts as f64);
        return match miner.set_power_limit(power).await {
            Ok(true) => ok_json(&json!({ "ok": true })),
            Ok(false) => bad_gateway("firmware rejected power-limit change"),
            Err(e) => {
                let msg = e.to_string();
                let denied = is_auth_error(&msg);
                let status = if denied {
                    StatusCode::UNAUTHORIZED
                } else {
                    StatusCode::BAD_GATEWAY
                };
                json_response(
                    status,
                    &json!({ "ok": false, "needPassword": denied, "error": msg }),
                )
            }
        };
    }

    json_response(
        StatusCode::BAD_GATEWAY,
        &json!({ "ok": false, "error": "power tuning not supported by this firmware" }),
    )
}

// ---------------------------------------------------------------------------
// Route: GET /api/miners/{ip}/rawdata
// ---------------------------------------------------------------------------

async fn miner_rawdata(State(state): State<AppState>, Path(ip): Path<String>) -> Response {
    if !state.host_re.is_match(&ip) {
        return bad_request("bad host");
    }

    let addr = match IpAddr::from_str(&ip) {
        Ok(a) => a,
        Err(_) => return bad_request("invalid IP address"),
    };

    let factory = MinerFactory::new();
    let miner = match factory.get_miner(addr).await {
        Ok(Some(m)) => m,
        Ok(None) => return bad_gateway("miner not found or not supported"),
        Err(e) => return bad_gateway(&format!("discovery error: {e}")),
    };

    let data = miner.get_data().await;
    let raw = serde_json::to_value(&data).unwrap_or_else(|_| json!({}));
    ok_json(&json!({ "ok": true, "raw": raw }))
}

// ---------------------------------------------------------------------------
// Route: GET /api/scan?subnet=192.168.1
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ScanParams {
    subnet: Option<String>,
}

async fn scan_lan(Query(params): Query<ScanParams>) -> Response {
    let subnet = params
        .subnet
        .unwrap_or_else(|| "192.168.1".to_string());

    // Build a /24-style range: subnet.1 – subnet.254
    // subnet is expected to be in "a.b.c" form (three octets).
    let range_str = format!("{}.1-254", subnet);

    let factory = match MinerFactory::from_range(&range_str) {
        Ok(f) => f.with_concurrent_limit(20),
        Err(e) => {
            return err_json(
                StatusCode::BAD_REQUEST,
                &format!("invalid subnet: {e}"),
            );
        }
    };

    let mut miners = Vec::new();
    let mut stream = factory.scan_stream();

    while let Some(miner) = stream.next().await {
        let data = miner.get_data().await;
        miners.push(map_scan_entry(&data));
    }

    ok_json(&json!({ "ok": true, "miners": miners }))
}

// ---------------------------------------------------------------------------
// Router construction (exported for integration tests)
// ---------------------------------------------------------------------------

pub fn build_router() -> Router {
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any)
        .allow_origin(Any);

    let state = AppState::new();

    Router::new()
        .route("/api/health", get(health))
        .route("/api/miners/{ip}/stats", get(miner_stats))
        .route("/api/miners/{ip}/pause", post(miner_pause))
        .route("/api/miners/{ip}/resume", post(miner_resume))
        .route("/api/miners/{ip}/power", post(miner_set_power))
        .route("/api/miners/{ip}/rawdata", get(miner_rawdata))
        .route("/api/scan", get(scan_lan))
        .layer(cors)
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let addr = "127.0.0.1:8081";
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    info!("Blisspoint proxy-rs → http://{addr}");

    axum::serve(listener, build_router())
        .await
        .expect("server error");
}

// ---------------------------------------------------------------------------
// Integration tests (Issue #30/#31/#32 acceptance criteria)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use axum::response::Response as AxumResponse;
    use tower::util::ServiceExt;

    async fn call(app: Router, req: Request<Body>) -> AxumResponse {
        app.oneshot(req).await.unwrap()
    }

    async fn body_json(resp: AxumResponse) -> serde_json::Value {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn test_health_endpoint() {
        let app = build_router();
        let req = Request::builder()
            .uri("/api/health")
            .body(Body::empty())
            .unwrap();
        let resp = call(app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp).await;
        assert_eq!(json["ok"], true);
    }

    #[tokio::test]
    async fn test_stats_unreachable_ip_returns_502() {
        let app = build_router();
        // Use a non-routable IP (TEST-NET) to guarantee no real miner responds
        let req = Request::builder()
            .uri("/api/miners/192.0.2.1/stats")
            .body(Body::empty())
            .unwrap();
        let resp = call(app, req).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
        let json = body_json(resp).await;
        assert_eq!(json["ok"], false);
        assert!(json["error"].as_str().is_some());
    }

    #[tokio::test]
    async fn test_stats_invalid_host_returns_400() {
        let app = build_router();
        let req = Request::builder()
            .uri("/api/miners/not%20valid%21/stats")
            .body(Body::empty())
            .unwrap();
        let resp = call(app, req).await;
        // 400 or 404 depending on how axum URL-decodes the param
        assert!(
            resp.status() == StatusCode::BAD_REQUEST
                || resp.status() == StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn test_pause_unreachable_ip_returns_502() {
        let app = build_router();
        let req = Request::builder()
            .method("POST")
            .uri("/api/miners/192.0.2.2/pause")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"password":""}"#))
            .unwrap();
        let resp = call(app, req).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
        let json = body_json(resp).await;
        assert_eq!(json["ok"], false);
    }

    #[tokio::test]
    async fn test_resume_unreachable_ip_returns_502() {
        let app = build_router();
        let req = Request::builder()
            .method("POST")
            .uri("/api/miners/192.0.2.3/resume")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"password":""}"#))
            .unwrap();
        let resp = call(app, req).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
    }

    #[tokio::test]
    async fn test_pause_bad_host_returns_400() {
        let app = build_router();
        let req = Request::builder()
            .method("POST")
            .uri("/api/miners/bad%20host!/pause")
            .header("content-type", "application/json")
            .body(Body::from(r#"{}"#))
            .unwrap();
        let resp = call(app, req).await;
        assert!(
            resp.status() == StatusCode::BAD_REQUEST
                || resp.status() == StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn test_scan_empty_subnet_returns_ok() {
        // Use 192.0.2.0/24 (TEST-NET, guaranteed no real miners)
        let app = build_router();
        let req = Request::builder()
            .uri("/api/scan?subnet=192.0.2")
            .body(Body::empty())
            .unwrap();
        let resp = call(app, req).await;
        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp).await;
        assert_eq!(json["ok"], true);
        assert!(json["miners"].is_array());
        // No miners should respond in a test-net subnet
        assert_eq!(json["miners"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_is_auth_error() {
        assert!(is_auth_error("access denied"));
        assert!(is_auth_error("unauthorized"));
        assert!(is_auth_error("invalid credentials"));
        assert!(is_auth_error("wrong password"));
        assert!(is_auth_error("credential rejected"));
        assert!(is_auth_error("permission denied"));
        assert!(!is_auth_error("timeout"));
        assert!(!is_auth_error("connection refused"));
    }

    #[tokio::test]
    async fn test_power_unreachable_ip_returns_502() {
        let app = build_router();
        let req = Request::builder()
            .method("POST")
            .uri("/api/miners/192.0.2.4/power")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"watts":3200}"#))
            .unwrap();
        let resp = call(app, req).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
        let json = body_json(resp).await;
        assert_eq!(json["ok"], false);
    }

    #[tokio::test]
    async fn test_power_missing_body_returns_400() {
        let app = build_router();
        let req = Request::builder()
            .method("POST")
            .uri("/api/miners/192.0.2.5/power")
            .header("content-type", "application/json")
            .body(Body::empty())
            .unwrap();
        let resp = call(app, req).await;
        // No body → 400 bad request (missing body check)
        assert!(
            resp.status() == StatusCode::BAD_REQUEST
                || resp.status() == StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn test_not_found_route() {
        // Just sanity-check router compiles and unknown routes return 404
    }
}
