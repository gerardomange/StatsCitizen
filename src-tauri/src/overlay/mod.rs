//! Stream overlay for OBS: shared state hub, contract tracker, layout store and local server.

pub mod contracts;
pub mod hub;
pub mod server;
pub mod store;

use crate::models::{LiveTelemetryEvent, LiveTelemetryFrame};
use hub::HUB;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use store::OverlaySettings;
use tauri::{AppHandle, Emitter};

/// Send a frame to the desktop UI and to overlay clients.
pub fn publish_frame(app: &AppHandle, frame: LiveTelemetryFrame) {
    HUB.on_frame(&frame);
    let _ = app.emit("live-telemetry-frame", frame);
}

/// Send an event to the desktop UI and to overlay clients.
pub fn publish_event(app: &AppHandle, event: LiveTelemetryEvent) {
    HUB.on_event(&event);
    let _ = app.emit("live-telemetry-event", event);
}

/// Called when a live session (re)starts: clears session state and restores contracts
/// already present in the current Game.log (e.g. the app was restarted mid-session).
pub fn begin_session(sc_dir: &Path) {
    HUB.reset_session();
    let log = sc_dir.join("Game.log");
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(bytes) = std::fs::read(&log) else { return };
        let text = String::from_utf8_lossy(&bytes);
        let fallback = chrono::Utc::now().to_rfc3339();
        let mut joiner = crate::activity_parser::LineJoiner::default();
        let mut events: Vec<LiveTelemetryEvent> = Vec::new();
        for line in text.lines() {
            let Some(logical) = joiner.push(line) else { continue };
            // Cheap pre-filter before running the regexes on a multi-MB log.
            if !(logical.contains("<EndMission>") || logical.contains("MissionId: [")) {
                continue;
            }
            events.extend(
                crate::activity_parser::parse_activity_line(&logical, &fallback)
                    .into_iter()
                    .filter(|e| matches!(e.category.as_deref(), Some("contract") | Some("objective"))),
            );
        }
        HUB.seed_contracts(&events);
    });
}

/// Start the server at app launch if the user left it enabled.
pub fn autostart(app: AppHandle) {
    let settings = HUB.file().settings;
    if settings.enabled {
        tauri::async_runtime::spawn(async move {
            if let Err(e) = server::start(app, settings).await {
                eprintln!("Overlay server failed to start: {e}");
            }
        });
    }
}

// ---------------------------------------------------------------- commands

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConfig {
    settings: OverlaySettings,
    layouts: Vec<Value>,
    server: server::ServerStatus,
}

#[tauri::command]
pub fn overlay_get_config() -> OverlayConfig {
    let file = HUB.file();
    OverlayConfig { settings: file.settings, layouts: file.layouts, server: server::status() }
}

/// Save settings and (re)start or stop the server to match them.
#[tauri::command]
pub async fn overlay_set_settings(app: AppHandle, settings: OverlaySettings) -> Result<OverlayConfig, String> {
    let file = HUB.update_file(|f| {
        let token = if settings.token.len() >= 16 { settings.token.clone() } else { f.settings.token.clone() };
        f.settings = OverlaySettings { token, ..settings };
    })?;
    if file.settings.enabled {
        server::start(app, file.settings.clone()).await?;
    } else {
        server::stop();
    }
    Ok(overlay_get_config())
}

#[tauri::command]
pub async fn overlay_regenerate_token(app: AppHandle) -> Result<OverlayConfig, String> {
    let file = HUB.update_file(|f| f.settings.token = store::new_token())?;
    if file.settings.enabled {
        server::start(app, file.settings.clone()).await?;
    }
    Ok(overlay_get_config())
}

#[tauri::command]
pub fn overlay_save_layout(layout: Value) -> Result<(), String> {
    HUB.save_layout(layout)
}

#[tauri::command]
pub fn overlay_delete_layout(id: String) -> Result<(), String> {
    HUB.delete_layout(&id)
}

#[tauri::command]
pub fn overlay_set_demo(on: bool) {
    HUB.set_demo(on);
}

#[tauri::command]
pub fn overlay_test_moment(kind: String) {
    HUB.test_moment(&kind);
}
