mod activity_parser;
mod live_watcher;
mod log_indexer;
mod models;
mod normalizer;
mod overlay;
mod sc_detector;
mod telemetry;
mod tools_manager;

use models::{
    BackupResult, CleanShadersResult, EnableTelemetryResult, PathValidation, StarCitizenInstall,
    TelemetrySetupStatus, TelemetrySummary, TriggerActionResult, TriggerableActionInfo,
};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use telemetry::game_cfg::{self, ApplyCfgOutcome};
use telemetry::grpc_client::{self, SharedGrpcState};

struct LiveRuntime {
    stop_flag: Option<Arc<AtomicBool>>,
    active_channel: Option<String>,
    active_exe: Option<PathBuf>,
    active_port: u16,
    needs_restart: bool,
    grpc_state: Arc<Mutex<SharedGrpcState>>,
}

impl Default for LiveRuntime {
    fn default() -> Self {
        Self {
            stop_flag: None,
            active_channel: None,
            active_exe: None,
            active_port: game_cfg::DEFAULT_PORT,
            needs_restart: false,
            grpc_state: Arc::new(Mutex::new(SharedGrpcState::default())),
        }
    }
}

struct AppState {
    live: Mutex<LiveRuntime>,
}

#[tauri::command]
async fn find_sc_path() -> Option<String> {
    tauri::async_runtime::spawn_blocking(sc_detector::find_default_sc_path)
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn discover_sc_installs() -> Vec<StarCitizenInstall> {
    tauri::async_runtime::spawn_blocking(sc_detector::discover_installs)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn validate_sc_path(sc_path: String) -> PathValidation {
    sc_detector::validate_star_citizen_path(Path::new(&sc_path))
}

#[tauri::command]
async fn scan_logs(sc_path: String, app: AppHandle) -> Result<TelemetrySummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        log_indexer::index_all_star_citizen_logs(&sc_path, |progress| {
            let _ = app.emit("log-scan-progress", progress);
        })
    })
    .await
    .map_err(|e| format!("Log scan task failed: {e}"))
}

#[tauri::command]
async fn clean_shader_cache() -> CleanShadersResult {
    tauri::async_runtime::spawn_blocking(tools_manager::clean_shader_cache)
        .await
        .unwrap_or(CleanShadersResult {
            success: false,
            freed_bytes: 0,
            freed_formatted: "0 MB".to_string(),
            cleared_files_count: 0,
            error: Some("Shader cleanup task panicked".to_string()),
        })
}

#[tauri::command]
async fn backup_user_settings(sc_path: String) -> BackupResult {
    tauri::async_runtime::spawn_blocking(move || tools_manager::backup_user_settings(&sc_path))
        .await
        .unwrap_or(BackupResult {
            success: false,
            backup_path: String::new(),
            files_backed_up: vec![],
            error: Some("Backup task panicked".to_string()),
        })
}

#[tauri::command]
async fn get_telemetry_status(state: State<'_, AppState>) -> Result<TelemetrySetupStatus, String> {
    let installs = tauri::async_runtime::spawn_blocking(sc_detector::discover_installs)
        .await
        .map_err(|e| e.to_string())?;
    let live = state.live.lock().unwrap();
    let grpc = live.grpc_state.lock().unwrap().clone();
    let active_channel = live.active_channel.clone().or_else(|| {
        installs
            .iter()
            .find(|i| i.is_running)
            .or_else(|| installs.first())
            .map(|i| i.channel.clone())
    });
    let supports_actions = active_channel
        .as_deref()
        .and_then(|ch| installs.iter().find(|i| i.channel == ch))
        .map(|i| i.supports_actions)
        .unwrap_or(grpc.supports_actions);

    Ok(TelemetrySetupStatus {
        installs,
        active_channel,
        env_enabled: game_cfg::env_enabled(),
        needs_restart: live.needs_restart,
        grpc_connected: grpc.connected,
        grpc_fps: grpc.fps,
        grpc_port: if grpc.port > 0 {
            grpc.port
        } else {
            live.active_port
        },
        grpc_error: grpc.error,
        log_watcher_active: live.stop_flag.is_some(),
        supports_actions,
    })
}

#[tauri::command]
async fn enable_game_telemetry(
    channel: Option<String>,
    enable_actions: Option<bool>,
    state: State<'_, AppState>,
) -> Result<EnableTelemetryResult, String> {
    let res = tauri::async_runtime::spawn_blocking(move || {
        let installs = sc_detector::discover_installs();
        let targets: Vec<StarCitizenInstall> = match channel {
            Some(ref ch) => installs
                .into_iter()
                .filter(|i| i.channel.eq_ignore_ascii_case(ch))
                .collect(),
            None => installs,
        };

        let want_actions = enable_actions.unwrap_or(false);
        let mut changed_channels = Vec::new();
        let mut elevated_channels = Vec::new();
        let mut errors = Vec::new();

        for inst in targets {
            let cfg_path = Path::new(&inst.user_cfg_path);
            match game_cfg::apply_cfg(
                cfg_path,
                inst.uses_port_cvar,
                want_actions && inst.supports_actions,
            ) {
                Ok(ApplyCfgOutcome::Unchanged) => {}
                Ok(ApplyCfgOutcome::WrittenDirect) => changed_channels.push(inst.channel),
                Ok(ApplyCfgOutcome::WrittenElevated) => elevated_channels.push(inst.channel),
                Err(err) => errors.push(format!("{}: {}", inst.channel, err)),
            }
        }

        let env_updated = match game_cfg::enable_env() {
            Ok(changed) => changed,
            Err(err) => {
                errors.push(format!("Environment: {}", err));
                false
            }
        };

        let needs_restart =
            !changed_channels.is_empty() || !elevated_channels.is_empty() || env_updated;

        EnableTelemetryResult {
            changed_channels,
            elevated_channels,
            env_updated,
            needs_restart,
            errors,
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    if res.needs_restart {
        if let Ok(mut live) = state.live.lock() {
            live.needs_restart = true;
        }
    }

    Ok(res)
}

#[tauri::command]
async fn start_live_watch(
    sc_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<bool, String> {
    let dir = PathBuf::from(&sc_path);
    if !dir.is_dir() {
        return Err("Selected Star Citizen folder does not exist.".to_string());
    }

    let mut live = state.live.lock().unwrap();
    if let Some(prev_stop) = live.stop_flag.take() {
        prev_stop.store(true, Ordering::Relaxed);
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let channel_name = dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("LIVE")
        .to_uppercase();
    let exe_path = dir.join("Bin64").join("StarCitizen.exe");
    let user_cfg_path = dir.join("user.cfg");
    let port = game_cfg::read_port(&user_cfg_path);

    // Reset gRPC shared state for this session
    if let Ok(mut g) = live.grpc_state.lock() {
        g.connected = false;
        g.fps = 0.0;
        g.port = port;
        g.channel = channel_name.clone();
        g.error = None;
    }

    // Fresh overlay session (restores contracts already in the current Game.log)
    overlay::begin_session(&dir);

    // 1. Start Game.log hybrid watcher (if Game.log exists or will appear)
    live_watcher::spawn_log_watcher(dir.clone(), stop_flag.clone(), app.clone());

    // 2. Start live gRPC telemetry stream if StarCitizen.exe exists
    if exe_path.is_file() {
        grpc_client::spawn_grpc_stream(
            exe_path.clone(),
            channel_name.clone(),
            port,
            stop_flag.clone(),
            live.grpc_state.clone(),
            app,
        );
        live.active_exe = Some(exe_path);
    } else {
        live.active_exe = None;
    }

    live.stop_flag = Some(stop_flag);
    live.active_channel = Some(channel_name);
    live.active_port = port;
    Ok(true)
}

#[tauri::command]
fn stop_live_watch(state: State<'_, AppState>) -> bool {
    let mut live = state.live.lock().unwrap();
    if let Some(stop) = live.stop_flag.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if let Ok(mut g) = live.grpc_state.lock() {
        g.connected = false;
        g.fps = 0.0;
    }
    true
}

#[tauri::command]
async fn list_game_actions(sc_path: String) -> Result<Vec<TriggerableActionInfo>, String> {
    let dir = PathBuf::from(&sc_path);
    let exe_path = dir.join("Bin64").join("StarCitizen.exe");
    let port = game_cfg::read_port(&dir.join("user.cfg"));
    grpc_client::list_triggerable_actions(exe_path, port).await
}

#[tauri::command]
async fn trigger_game_action(
    sc_path: String,
    action_name: String,
    hold_ms: Option<u32>,
) -> Result<TriggerActionResult, String> {
    let dir = PathBuf::from(&sc_path);
    let exe_path = dir.join("Bin64").join("StarCitizen.exe");
    let port = game_cfg::read_port(&dir.join("user.cfg"));
    grpc_client::trigger_game_action(exe_path, port, action_name, hold_ms.unwrap_or(0)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            live: Mutex::new(LiveRuntime::default()),
        })
        .invoke_handler(tauri::generate_handler![
            find_sc_path,
            discover_sc_installs,
            validate_sc_path,
            scan_logs,
            clean_shader_cache,
            backup_user_settings,
            get_telemetry_status,
            enable_game_telemetry,
            start_live_watch,
            stop_live_watch,
            list_game_actions,
            trigger_game_action,
            overlay::overlay_get_config,
            overlay::overlay_set_settings,
            overlay::overlay_regenerate_token,
            overlay::overlay_save_layout,
            overlay::overlay_delete_layout,
            overlay::overlay_set_demo,
            overlay::overlay_test_moment,
        ])
        .setup(|app| {
            overlay::autostart(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running StatsCitizen");
}
