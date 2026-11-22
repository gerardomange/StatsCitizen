use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShipUsage {
    pub name: String,
    pub normalized_name: String,
    pub manufacturer: String,
    pub total_flight_time_ms: u64,
    pub total_flight_hours: f64,
    pub sorties_count: u32,
    pub last_flown: Option<String>,
    pub ship_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseRecord {
    pub id: String,
    pub timestamp: String,
    pub shop_name: String,
    pub item_name: String,
    pub clean_item_name: String,
    pub category: String,
    pub price: f64,
    pub quantity: u32,
    pub total_cost: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactVelocity {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub magnitude: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FatalCollisionRecord {
    pub timestamp: String,
    pub vehicle_name: String,
    pub normalized_vehicle_name: String,
    pub zone: String,
    pub part: String,
    pub was_pilot: bool,
    pub impact_velocity: Option<ImpactVelocity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuantumRouteRecord {
    pub timestamp: String,
    pub ship_name: String,
    pub destination: String,
    pub clean_destination: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MedicalRecord {
    pub timestamp: String,
    #[serde(rename = "type")]
    pub record_type: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub session_id: String,
    pub file_path: String,
    pub start_time: String,
    pub end_time: String,
    pub duration_ms: u64,
    pub duration_hours: f64,
    pub version_label: String,
    pub build_number: String,
    pub channel: String,
    pub shard_id: Option<String>,
    pub clean_quit: bool,
    pub crashed: bool,
    pub ships_flown: Vec<String>,
    pub total_spent: f64,
    pub purchases_count: usize,
    pub collisions_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSpecs {
    pub cpu: Option<String>,
    pub gpu: Option<String>,
    pub ram_installed: Option<String>,
    pub displays: Option<String>,
    pub gpu_driver: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadoutWearTime {
    pub port: String,
    pub port_label: String,
    pub item: String,
    pub clean_item: String,
    pub duration_ms: u64,
    pub duration_hours: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityCoverage {
    pub contracts: usize,
    pub objectives: usize,
    pub zones: usize,
    pub inventory: usize,
    pub shards: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTelemetryEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub title: String,
    pub details: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount_auec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<String>,
    /// Player-facing objective text from the HUD notification ("Go to Glaciem Ring").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySummary {
    pub pilot_callsign: String,
    pub sc_install_path: String,
    pub total_playtime_ms: u64,
    pub total_playtime_hours: f64,
    pub total_sessions: usize,
    pub longest_session_hours: f64,
    pub average_session_hours: f64,
    pub first_session_date: Option<String>,
    pub last_session_date: Option<String>,
    pub current_patch: String,
    pub total_auec_spent: f64,
    pub total_purchases_count: usize,
    pub ships: Vec<ShipUsage>,
    pub purchases: Vec<PurchaseRecord>,
    pub collisions: Vec<FatalCollisionRecord>,
    pub quantum_routes: Vec<QuantumRouteRecord>,
    pub medical_treatments: Vec<MedicalRecord>,
    pub loadouts: Vec<LoadoutWearTime>,
    pub sessions: Vec<SessionData>,
    pub system_specs: SystemSpecs,
    pub shards_count: usize,
    pub scanned_files_count: usize,
    pub scan_warnings: Vec<String>,
    pub flight_control_lines: usize,
    pub activity_events: Vec<LiveTelemetryEvent>,
    pub activity_coverage: ActivityCoverage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathValidation {
    pub is_valid: bool,
    pub has_game_log: bool,
    pub has_log_backups: bool,
    pub backups_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub current: usize,
    pub total: usize,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanShadersResult {
    pub success: bool,
    pub freed_bytes: u64,
    pub freed_formatted: String,
    pub cleared_files_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub success: bool,
    pub backup_path: String,
    pub files_backed_up: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarCitizenInstall {
    pub channel: String,
    pub path: String,
    pub exe_path: String,
    pub user_cfg_path: String,
    pub has_game_log: bool,
    pub backups_count: usize,
    pub is_running: bool,
    pub has_telemetry_proto: bool,
    pub supports_actions: bool,
    pub uses_port_cvar: bool,
    pub cfg_ready: bool,
    pub cfg_missing: Vec<String>,
    pub actions_cfg_enabled: bool,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySetupStatus {
    pub installs: Vec<StarCitizenInstall>,
    pub active_channel: Option<String>,
    pub env_enabled: bool,
    pub needs_restart: bool,
    pub grpc_connected: bool,
    pub grpc_fps: f32,
    pub grpc_port: u16,
    pub grpc_error: Option<String>,
    pub log_watcher_active: bool,
    pub supports_actions: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableTelemetryResult {
    pub changed_channels: Vec<String>,
    pub elevated_channels: Vec<String>,
    pub env_updated: bool,
    pub needs_restart: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionMetrics {
    pub uec_start: Option<i64>,
    pub uec_current: Option<i64>,
    pub uec_delta: i64,
    pub max_speed: f32,
    pub max_g: f32,
    pub deaths: u32,
    pub downed_count: u32,
    pub active_ship_name: Option<String>,
    pub active_ship_since: Option<String>,
    pub total_frames: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTelemetryFrame {
    pub connected: bool,
    pub fps: f32,
    pub channel: String,
    pub port: u16,
    pub timestamp: String,
    pub error: Option<String>,
    pub supports_actions: bool,
    pub actor: Option<Value>,
    pub vehicle: Option<Value>,
    pub weapons: Option<Value>,
    pub turret: Option<Value>,
    pub force_feedback: Option<Value>,
    pub session_metrics: LiveSessionMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerableActionInfo {
    pub action_name: String,
    pub category: String,
    pub holdable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerActionResult {
    pub status: String,
    pub message: String,
}
