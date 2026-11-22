use crate::models::{PathValidation, StarCitizenInstall};
use crate::telemetry::game_cfg;
use crate::telemetry::proto_extractor;
use regex::Regex;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use sysinfo::{ProcessesToUpdate, System};

static LAUNCHER_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)([A-Za-z]:\\[^,\r\n'\x22]+\\StarCitizen)").unwrap());

pub fn validate_star_citizen_path(candidate: &Path) -> PathValidation {
    if !candidate.is_dir() {
        return PathValidation {
            is_valid: false,
            has_game_log: false,
            has_log_backups: false,
            backups_count: 0,
        };
    }

    let has_game_log = candidate.join("Game.log").is_file();
    let backups_dir = candidate.join("logbackups");
    let mut backups_count = 0usize;
    if backups_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&backups_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("log"))
                        .unwrap_or(false)
                {
                    backups_count += 1;
                }
            }
        }
    }
    let has_exe = candidate.join("Bin64").join("StarCitizen.exe").is_file();

    PathValidation {
        is_valid: has_game_log || backups_count > 0 || has_exe,
        has_game_log,
        has_log_backups: backups_count > 0,
        backups_count,
    }
}

pub fn running_sc_channel_dir() -> Option<PathBuf> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    for process in sys.processes().values() {
        let name = process.name().to_string_lossy();
        if name.eq_ignore_ascii_case("StarCitizen.exe") {
            if let Some(exe) = process.exe() {
                // <channel>\Bin64\StarCitizen.exe -> <channel>
                if let Some(bin64) = exe.parent() {
                    if let Some(channel_dir) = bin64.parent() {
                        return Some(channel_dir.to_path_buf());
                    }
                }
            }
        }
    }
    None
}

pub fn discover_installs() -> Vec<StarCitizenInstall> {
    let running_dir = running_sc_channel_dir();
    let mut base_dirs: Vec<PathBuf> = Vec::new();

    for drive in ["C", "D", "E", "F", "G"] {
        for sub in [
            r"Program Files (x86)\StarCitizen",
            r"Program Files\Roberts Space Industries\StarCitizen",
            r"Roberts Space Industries\StarCitizen",
            r"StarCitizen",
            r"Games\StarCitizen",
        ] {
            let p = PathBuf::from(format!(r"{}:\{}", drive, sub));
            if p.is_dir() {
                base_dirs.push(p);
            }
        }
    }

    // Check RSI Launcher log for custom install bases
    if let Some(config_dir) = dirs::config_dir() {
        let launcher_log = config_dir.join("rsilauncher").join("logs").join("log.log");
        if let Ok(content) = fs::read_to_string(&launcher_log) {
            for cap in LAUNCHER_PATH_RE.captures_iter(&content) {
                let raw = cap[1].replace("\\\\", "\\");
                let p = PathBuf::from(raw.trim());
                if p.is_dir() {
                    base_dirs.push(p);
                }
            }
        }
    }

    let mut channels: BTreeMap<String, PathBuf> = BTreeMap::new();
    if let Some(ref rd) = running_dir {
        if let Some(ch) = rd.file_name().and_then(|s| s.to_str()) {
            channels.insert(ch.to_uppercase(), rd.clone());
        }
    }

    for base in base_dirs {
        if let Ok(entries) = fs::read_dir(&base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let exe = path.join("Bin64").join("StarCitizen.exe");
                if !exe.is_file() {
                    continue;
                }
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    let key = name.to_uppercase();
                    channels.entry(key).or_insert(path);
                }
            }
        }
    }

    let mut installs = Vec::new();
    for (channel, dir) in channels {
        let exe_path = dir.join("Bin64").join("StarCitizen.exe");
        let user_cfg_path = dir.join("user.cfg");
        let validation = validate_star_citizen_path(&dir);
        let is_running = running_dir
            .as_ref()
            .map(|r| r.to_string_lossy().eq_ignore_ascii_case(&dir.to_string_lossy()))
            .unwrap_or(false);

        let probe = proto_extractor::probe_exe_capabilities(&exe_path);
        let cfg_missing = game_cfg::missing_keys(&user_cfg_path, probe.uses_port_cvar);
        let port = game_cfg::read_port(&user_cfg_path);
        let actions_cfg_enabled = game_cfg::actions_enabled(&user_cfg_path);

        installs.push(StarCitizenInstall {
            channel,
            path: dir.to_string_lossy().to_string(),
            exe_path: exe_path.to_string_lossy().to_string(),
            user_cfg_path: user_cfg_path.to_string_lossy().to_string(),
            has_game_log: validation.has_game_log,
            backups_count: validation.backups_count,
            is_running,
            has_telemetry_proto: probe.has_telemetry_proto,
            supports_actions: probe.supports_actions,
            uses_port_cvar: probe.uses_port_cvar,
            cfg_ready: cfg_missing.is_empty(),
            cfg_missing,
            actions_cfg_enabled,
            port,
        });
    }

    // Prefer running channel first, then PTU, LIVE, others
    installs.sort_by(|a, b| {
        b.is_running.cmp(&a.is_running).then_with(|| {
            let rank = |ch: &str| match ch {
                "PTU" => 0,
                "LIVE" => 1,
                "EPTU" => 2,
                "HOTFIX" => 3,
                "TECH-PREVIEW" => 4,
                _ => 5,
            };
            rank(&a.channel).cmp(&rank(&b.channel))
        })
    });

    installs
}

pub fn find_default_sc_path() -> Option<String> {
    let installs = discover_installs();
    if let Some(running) = installs.iter().find(|i| i.is_running) {
        return Some(running.path.clone());
    }
    if let Some(first) = installs.first() {
        return Some(first.path.clone());
    }
    None
}
