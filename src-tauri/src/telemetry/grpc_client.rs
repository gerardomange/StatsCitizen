use crate::models::{
    LiveSessionMetrics, LiveTelemetryEvent, LiveTelemetryFrame, TriggerActionResult,
    TriggerableActionInfo,
};
use crate::normalizer::normalize_ship_name;
use crate::telemetry::proto_extractor::{load_descriptor_pool, SERVICE_FULL_NAME};
use chrono::Utc;
use http::uri::PathAndQuery;
use prost::Message;
use prost_reflect::{DynamicMessage, MessageDescriptor, SerializeOptions};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::transport::Endpoint;
use tonic::Status;

#[derive(Clone)]
struct DynamicEncoder;

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(dst)
            .map_err(|e| Status::internal(format!("encode error: {e}")))
    }
}

#[derive(Clone)]
struct DynamicDecoder {
    desc: MessageDescriptor,
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let msg = DynamicMessage::decode(self.desc.clone(), src)
            .map_err(|e| Status::internal(format!("decode error: {e}")))?;
        Ok(Some(msg))
    }
}

#[derive(Clone)]
struct DynamicCodec {
    resp_desc: MessageDescriptor,
}

impl DynamicCodec {
    fn new(resp_desc: MessageDescriptor) -> Self {
        Self { resp_desc }
    }
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder {
            desc: self.resp_desc.clone(),
        }
    }
}

fn dynamic_to_json(msg: &DynamicMessage) -> Value {
    let opts = SerializeOptions::new()
        .use_proto_field_name(true)
        .stringify_64_bit_integers(false);
    let ser = serde_json::value::Serializer;
    msg.serialize_with_options(ser, &opts)
        .unwrap_or(Value::Null)
}

#[derive(Debug, Default, Clone)]
pub struct SharedGrpcState {
    pub connected: bool,
    pub fps: f32,
    pub port: u16,
    pub channel: String,
    pub error: Option<String>,
    pub supports_actions: bool,
}

pub fn spawn_grpc_stream(
    exe_path: PathBuf,
    channel_name: String,
    port: u16,
    stop_flag: Arc<AtomicBool>,
    shared_state: Arc<Mutex<SharedGrpcState>>,
    app: AppHandle,
) {
    tauri::async_runtime::spawn(async move {
        let (pool, supports_actions) = match load_descriptor_pool(&exe_path) {
            Ok(res) => res,
            Err(err) => {
                if let Ok(mut st) = shared_state.lock() {
                    st.connected = false;
                    st.error = Some(err.clone());
                    st.supports_actions = false;
                }
                crate::overlay::publish_frame(&app, LiveTelemetryFrame {
                        connected: false,
                        fps: 0.0,
                        channel: channel_name,
                        port,
                        timestamp: Utc::now().to_rfc3339(),
                        error: Some(err),
                        supports_actions: false,
                        actor: None,
                        vehicle: None,
                        weapons: None,
                        turret: None,
                        force_feedback: None,
                        session_metrics: LiveSessionMetrics::default(),
                    },
                );
                return;
            }
        };

        let Some(req_desc) = pool.get_message_by_name("sc.game.telemetry.v1.TelemetryStreamRequest")
        else {
            return;
        };
        let Some(resp_desc) =
            pool.get_message_by_name("sc.game.telemetry.v1.TelemetryStreamResponse")
        else {
            return;
        };

        if let Ok(mut st) = shared_state.lock() {
            st.port = port;
            st.channel = channel_name.clone();
            st.supports_actions = supports_actions;
        }

        let mut metrics = LiveSessionMetrics::default();
        let mut prev_annunciators: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let method_path =
            PathAndQuery::from_static("/sc.game.telemetry.v1.GameTelemetryService/TelemetryStream");

        while !stop_flag.load(Ordering::Relaxed) {
            let endpoint_str = format!("http://127.0.0.1:{}", port);
            let channel_res = Endpoint::from_shared(endpoint_str)
                .map(|ep| {
                    ep.connect_timeout(Duration::from_secs(2))
                        .tcp_nodelay(true)
                });

            let connect_res = match channel_res {
                Ok(ep) => ep.connect().await,
                Err(e) => {
                    update_disconnected(&shared_state, &app, &channel_name, port, supports_actions, &metrics, format!("Invalid endpoint: {e}"));
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }
            };

            let grpc_channel = match connect_res {
                Ok(ch) => ch,
                Err(_) => {
                    update_disconnected(
                        &shared_state,
                        &app,
                        &channel_name,
                        port,
                        supports_actions,
                        &metrics,
                        format!(
                            "Waiting for Star Citizen telemetry server on 127.0.0.1:{} (load into the 'verse to start stream)",
                            port
                        ),
                    );
                    tokio::time::sleep(Duration::from_millis(2500)).await;
                    continue;
                }
            };

            let mut grpc = tonic::client::Grpc::new(grpc_channel);
            if let Err(e) = grpc.ready().await {
                update_disconnected(
                    &shared_state,
                    &app,
                    &channel_name,
                    port,
                    supports_actions,
                    &metrics,
                    format!("gRPC channel not ready: {e}"),
                );
                tokio::time::sleep(Duration::from_millis(2500)).await;
                continue;
            }

            let codec = DynamicCodec::new(resp_desc.clone());
            let req = tonic::Request::new(DynamicMessage::new(req_desc.clone()));
            let stream_res = grpc.server_streaming(req, method_path.clone(), codec).await;

            let mut stream = match stream_res {
                Ok(resp) => resp.into_inner(),
                Err(status) => {
                    update_disconnected(
                        &shared_state,
                        &app,
                        &channel_name,
                        port,
                        supports_actions,
                        &metrics,
                        format!("Telemetry stream unavailable ({})", status.code()),
                    );
                    tokio::time::sleep(Duration::from_millis(2500)).await;
                    continue;
                }
            };

            let mut fps_window_start = Instant::now();
            let mut fps_window_count = 0u32;
            let mut current_fps = 0.0f32;
            let mut last_emit = Instant::now() - Duration::from_secs(1);

            loop {
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }

                let next_msg = tokio::select! {
                    msg = stream.message() => msg,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {
                        if stop_flag.load(Ordering::Relaxed) {
                            break;
                        }
                        continue;
                    }
                };

                match next_msg {
                    Ok(Some(msg)) => {
                        metrics.total_frames += 1;
                        fps_window_count += 1;
                        let elapsed = fps_window_start.elapsed().as_secs_f32();
                        if elapsed >= 1.5 {
                            current_fps = (fps_window_count as f32 / elapsed * 10.0).round() / 10.0;
                            fps_window_start = Instant::now();
                            fps_window_count = 0;
                        }

                        if let Ok(mut st) = shared_state.lock() {
                            st.connected = true;
                            st.fps = current_fps;
                            st.error = None;
                        }

                        let val = dynamic_to_json(&msg);
                        let now_iso = Utc::now().to_rfc3339();

                        // 1. Track aUEC balance deltas in real time
                        if let Some(bal) = val
                            .pointer("/actor/state/uec_balance")
                            .and_then(|v| v.as_i64())
                        {
                            if bal > 0 || metrics.uec_start.is_some() {
                                if metrics.uec_start.is_none() {
                                    metrics.uec_start = Some(bal);
                                }
                                if let Some(prev) = metrics.uec_current {
                                    let diff = bal - prev;
                                    if diff != 0 {
                                        let is_gain = diff > 0;
                                        crate::overlay::publish_event(&app, LiveTelemetryEvent {
                                                id: Some(format!("grpc|uec|{}|{}", now_iso, bal)),
                                                timestamp: now_iso.clone(),
                                                event_type: if is_gain { "reward" } else { "purchase" }
                                                    .to_string(),
                                                title: if is_gain {
                                                    "aUEC Balance Increased (Live)"
                                                } else {
                                                    "aUEC Spent (Live)"
                                                }
                                                .to_string(),
                                                details: format!(
                                                    "{}{} aUEC · New balance: {} aUEC",
                                                    if is_gain { "+" } else { "" },
                                                    diff,
                                                    bal
                                                ),
                                                objective_id: None,
                                                objective_state: None,
                                                zone: None,
                                                mission_id: None,
                                                mission_name: None,
                                                amount_auec: Some(diff.abs() as f64),
                                                item_name: None,
                                                operation: Some("grpc_balance_delta".to_string()),
                                                objective_text: None,
                                                confirmed: Some(true),
                                                category: Some("finance".to_string()),
                                                severity: Some(
                                                    if is_gain { "success" } else { "info" }
                                                        .to_string(),
                                                ),
                                            },
                                        );
                                    }
                                }
                                metrics.uec_current = Some(bal);
                                if let Some(start) = metrics.uec_start {
                                    metrics.uec_delta = bal - start;
                                }
                            }
                        }

                        // 2. Track active ship & peak instruments
                        if let Some(vstate) = val.pointer("/vehicle/state") {
                            if let Some(class_name) =
                                vstate.get("class_name").and_then(|v| v.as_str())
                            {
                                if !class_name.is_empty() {
                                    let norm = normalize_ship_name(class_name);
                                    if metrics.active_ship_name.as_deref() != Some(&norm.name) {
                                        metrics.active_ship_name = Some(norm.name);
                                        metrics.active_ship_since = Some(now_iso.clone());
                                    }
                                }
                            }
                            if let Some(spd) = vstate
                                .pointer("/flight/instruments/speed")
                                .and_then(|v| v.as_f64())
                            {
                                let spd = spd as f32;
                                if spd.is_finite() && spd > metrics.max_speed && spd < 100_000.0 {
                                    metrics.max_speed = spd;
                                }
                            }
                            if let Some(g) = vstate
                                .pointer("/flight/instruments/g_meter/current")
                                .and_then(|v| v.as_f64())
                            {
                                let g_abs = (g as f32).abs();
                                if g_abs.is_finite() && g_abs > metrics.max_g && g_abs < 100.0 {
                                    metrics.max_g = g_abs;
                                }
                            }

                            // 3. Emit combat warnings on major annunciator transitions
                            if let Some(ann) =
                                vstate.get("annunciators").and_then(|v| v.as_object())
                            {
                                for (key, state_val) in ann {
                                    let st_str = state_val.as_str().unwrap_or("");
                                    let prev = prev_annunciators
                                        .get(key)
                                        .map(|s| s.as_str())
                                        .unwrap_or("");
                                    let is_major = st_str.contains("MAJOR");
                                    let was_major = prev.contains("MAJOR");
                                    if is_major && !was_major && matches!(key.as_str(), "misl" | "hit" | "shld" | "pwr") {
                                        let label = match key.as_str() {
                                            "misl" => "MISSILE LOCK / INCOMING",
                                            "hit" => "HULL / SHIELD HIT DETECTED",
                                            "shld" => "SHIELDS CRITICAL",
                                            "pwr" => "POWER SYSTEM CRITICAL",
                                            _ => "COCKPIT ALERT",
                                        };
                                        crate::overlay::publish_event(&app, LiveTelemetryEvent {
                                                id: Some(format!("grpc|ann|{}|{}", now_iso, key)),
                                                timestamp: now_iso.clone(),
                                                event_type: "notice".to_string(),
                                                title: label.to_string(),
                                                details: format!("Cockpit annunciator {} -> {}", key.to_uppercase(), st_str),
                                                objective_id: None,
                                                objective_state: None,
                                                zone: None,
                                                mission_id: None,
                                                mission_name: None,
                                                amount_auec: None,
                                                item_name: None,
                                                operation: None,
                                                objective_text: None,
                                                confirmed: Some(true),
                                                category: Some("combat".to_string()),
                                                severity: Some("alert".to_string()),
                                            },
                                        );
                                    }
                                    prev_annunciators.insert(key.clone(), st_str.to_string());
                                }
                            }
                        } else {
                            metrics.active_ship_name = None;
                            metrics.active_ship_since = None;
                            prev_annunciators.clear();
                        }

                        // 4. Discrete game events from gRPC
                        if let Some(events_arr) =
                            val.pointer("/events/events").and_then(|v| v.as_array())
                        {
                            for ev in events_arr {
                                let Some(ev_type) = ev.get("type").and_then(|v| v.as_str()) else {
                                    continue;
                                };
                                let (mapped_type, title, category, severity) = match ev_type {
                                    "GAME_EVENT_TYPE_ACTOR_ENTER_SEAT" => {
                                        ("flight_start", "Entered Vehicle Seat", "flight", "info")
                                    }
                                    "GAME_EVENT_TYPE_ACTOR_LEAVE_SEAT" => {
                                        ("flight_end", "Exited Vehicle Seat", "flight", "info")
                                    }
                                    "GAME_EVENT_TYPE_ACTOR_DEAD" => {
                                        metrics.deaths += 1;
                                        ("medical", "Pilot Incapacitated / Dead", "combat", "alert")
                                    }
                                    "GAME_EVENT_TYPE_ACTOR_DOWNED" => {
                                        metrics.downed_count += 1;
                                        ("medical", "Pilot Downed", "combat", "warning")
                                    }
                                    "GAME_EVENT_TYPE_ACTOR_RESPAWN" => {
                                        ("medical", "Pilot Respawned", "medical", "success")
                                    }
                                    "GAME_EVENT_TYPE_ACTOR_SPAWN" => {
                                        ("notice", "Entered Verse", "system", "info")
                                    }
                                    _ => continue,
                                };
                                crate::overlay::publish_event(&app, LiveTelemetryEvent {
                                        id: Some(format!("grpc|ev|{}|{}", now_iso, ev_type)),
                                        timestamp: now_iso.clone(),
                                        event_type: mapped_type.to_string(),
                                        title: title.to_string(),
                                        details: format!("Live gRPC event: {}", ev_type),
                                        objective_id: None,
                                        objective_state: None,
                                        zone: None,
                                        mission_id: None,
                                        mission_name: None,
                                        amount_auec: None,
                                        item_name: None,
                                        operation: None,
                                        objective_text: None,
                                        confirmed: Some(true),
                                        category: Some(category.to_string()),
                                        severity: Some(severity.to_string()),
                                    },
                                );
                            }
                        }

                        // 5. Throttle UI frame emission (~8 Hz = 125ms)
                        if last_emit.elapsed() >= Duration::from_millis(125) {
                            last_emit = Instant::now();
                            let frame = LiveTelemetryFrame {
                                connected: true,
                                fps: current_fps,
                                channel: channel_name.clone(),
                                port,
                                timestamp: now_iso,
                                error: None,
                                supports_actions,
                                actor: val.get("actor").cloned(),
                                vehicle: val.get("vehicle").cloned(),
                                weapons: val.get("weapons").cloned(),
                                turret: val.get("turret").cloned(),
                                force_feedback: val.get("force_feedback").cloned(),
                                session_metrics: metrics.clone(),
                            };
                            crate::overlay::publish_frame(&app, frame);
                        }
                    }
                    Ok(None) => {
                        update_disconnected(
                            &shared_state,
                            &app,
                            &channel_name,
                            port,
                            supports_actions,
                            &metrics,
                            "Telemetry stream ended; waiting for reconnection...".to_string(),
                        );
                        break;
                    }
                    Err(status) => {
                        update_disconnected(
                            &shared_state,
                            &app,
                            &channel_name,
                            port,
                            supports_actions,
                            &metrics,
                            format!("Stream interrupted ({})", status.code()),
                        );
                        break;
                    }
                }
            }

            if !stop_flag.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(2500)).await;
            }
        }

        if let Ok(mut st) = shared_state.lock() {
            st.connected = false;
            st.fps = 0.0;
        }
    });
}

fn update_disconnected(
    shared_state: &Arc<Mutex<SharedGrpcState>>,
    app: &AppHandle,
    channel_name: &str,
    port: u16,
    supports_actions: bool,
    metrics: &LiveSessionMetrics,
    msg: String,
) {
    if let Ok(mut st) = shared_state.lock() {
        st.connected = false;
        st.fps = 0.0;
        st.error = Some(msg.clone());
    }
    crate::overlay::publish_frame(&app, LiveTelemetryFrame {
            connected: false,
            fps: 0.0,
            channel: channel_name.to_string(),
            port,
            timestamp: Utc::now().to_rfc3339(),
            error: Some(msg),
            supports_actions,
            actor: None,
            vehicle: None,
            weapons: None,
            turret: None,
            force_feedback: None,
            session_metrics: metrics.clone(),
        },
    );
}

pub async fn list_triggerable_actions(
    exe_path: PathBuf,
    port: u16,
) -> Result<Vec<TriggerableActionInfo>, String> {
    let (pool, supports_actions) = load_descriptor_pool(&exe_path)?;
    if !supports_actions {
        return Err("This Star Citizen build does not expose triggerable actions.".to_string());
    }
    let req_desc = pool
        .get_message_by_name("sc.game.telemetry.v1.ListTriggerableActionsRequest")
        .ok_or("Missing ListTriggerableActionsRequest descriptor")?;
    let resp_desc = pool
        .get_message_by_name("sc.game.telemetry.v1.ListTriggerableActionsResponse")
        .ok_or("Missing ListTriggerableActionsResponse descriptor")?;

    let ch = Endpoint::from_shared(format!("http://127.0.0.1:{}", port))
        .map_err(|e| e.to_string())?
        .connect_timeout(Duration::from_secs(2))
        .connect()
        .await
        .map_err(|e| format!("Cannot reach telemetry server on 127.0.0.1:{}: {e}", port))?;

    let mut grpc = tonic::client::Grpc::new(ch);
    grpc.ready().await.map_err(|e| e.to_string())?;
    let path: PathAndQuery = format!("/{}/ListTriggerableActions", SERVICE_FULL_NAME)
        .parse()
        .map_err(|_| "Invalid RPC path")?;
    let resp = grpc
        .unary(
            tonic::Request::new(DynamicMessage::new(req_desc)),
            path,
            DynamicCodec::new(resp_desc),
        )
        .await
        .map_err(|e| format!("gRPC error: {}", e.message()))?;

    let val = dynamic_to_json(resp.get_ref());
    let mut actions = Vec::new();
    if let Some(arr) = val.get("actions").and_then(|v| v.as_array()) {
        for item in arr {
            actions.push(TriggerableActionInfo {
                action_name: item
                    .get("action_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                category: item
                    .get("category")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                holdable: item
                    .get("holdable")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
            });
        }
    }
    Ok(actions)
}

pub async fn trigger_game_action(
    exe_path: PathBuf,
    port: u16,
    action_name: String,
    hold_ms: u32,
) -> Result<TriggerActionResult, String> {
    let (pool, supports_actions) = load_descriptor_pool(&exe_path)?;
    if !supports_actions {
        return Err("This Star Citizen build does not expose triggerable actions.".to_string());
    }
    let req_desc = pool
        .get_message_by_name("sc.game.telemetry.v1.TriggerGameActionRequest")
        .ok_or("Missing TriggerGameActionRequest descriptor")?;
    let resp_desc = pool
        .get_message_by_name("sc.game.telemetry.v1.TriggerGameActionResponse")
        .ok_or("Missing TriggerGameActionResponse descriptor")?;

    let mut req_msg = DynamicMessage::new(req_desc.clone());
    if let Some(field) = req_desc.get_field_by_name("action_name") {
        req_msg.set_field(&field, prost_reflect::Value::String(action_name));
    }
    if hold_ms > 0 {
        if let Some(field) = req_desc.get_field_by_name("hold_ms") {
            req_msg.set_field(&field, prost_reflect::Value::U32(hold_ms));
        }
    }

    let ch = Endpoint::from_shared(format!("http://127.0.0.1:{}", port))
        .map_err(|e| e.to_string())?
        .connect_timeout(Duration::from_secs(2))
        .connect()
        .await
        .map_err(|e| format!("Cannot reach telemetry server on 127.0.0.1:{}: {e}", port))?;

    let mut grpc = tonic::client::Grpc::new(ch);
    grpc.ready().await.map_err(|e| e.to_string())?;
    let path: PathAndQuery = format!("/{}/TriggerGameAction", SERVICE_FULL_NAME)
        .parse()
        .map_err(|_| "Invalid RPC path")?;
    let resp = grpc
        .unary(
            tonic::Request::new(req_msg),
            path,
            DynamicCodec::new(resp_desc),
        )
        .await
        .map_err(|e| format!("gRPC error: {}", e.message()))?;

    let val = dynamic_to_json(resp.get_ref());
    Ok(TriggerActionResult {
        status: val
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("UNKNOWN")
            .replace("TRIGGER_GAME_ACTION_STATUS_", ""),
        message: val
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}
