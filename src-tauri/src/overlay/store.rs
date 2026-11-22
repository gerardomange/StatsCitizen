//! Overlay settings + layouts, persisted in `%LOCALAPPDATA%\StatsCitizen\overlays\overlay.json`.
//! Layouts are opaque JSON owned by the frontend; the backend only needs their `id`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

pub const DEFAULT_PORT: u16 = 47800;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OverlaySettings {
    /// Start the local overlay server with the app.
    pub enabled: bool,
    pub port: u16,
    /// Listen on all interfaces (2-PC streaming setups). Requires `token` from non-loopback peers.
    pub allow_lan: bool,
    pub token: String,
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
            allow_lan: false,
            token: new_token(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OverlayFile {
    pub settings: OverlaySettings,
    pub layouts: Vec<Value>,
}

pub fn new_token() -> String {
    // Not cryptographic-grade, but unguessable enough for a LAN gate and dependency-free.
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for _ in 0..2 {
        let mut h = RandomState::new().build_hasher();
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn file_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("StatsCitizen").join("overlays").join("overlay.json"))
}

pub fn load() -> OverlayFile {
    let Some(path) = file_path() else { return OverlayFile::default() };
    let mut file: OverlayFile = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if file.settings.token.len() < 16 {
        file.settings.token = new_token();
    }
    if file.settings.port == 0 {
        file.settings.port = DEFAULT_PORT;
    }
    file
}

pub fn save(file: &OverlayFile) -> Result<(), String> {
    let path = file_path().ok_or("No local data directory")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    // Write-then-rename so a crash never leaves a half-written file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub fn layout_id(layout: &Value) -> Option<&str> {
    layout.get("id").and_then(|v| v.as_str()).filter(|s| !s.is_empty())
}
