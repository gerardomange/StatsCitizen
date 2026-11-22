use regex::Regex;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

pub const DEFAULT_PORT: u16 = 50051;
pub const ENV_NAME: &str = "GRPC_CLIENT_SERVER_ENABLED";

static LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*([A-Za-z0-9_.\-]+)\s*=?\s*(.*?)\s*$").unwrap());

pub fn read_cfg(path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(text) = fs::read_to_string(path) else {
        return map;
    };
    for line in text.lines() {
        let s = line.trim();
        if s.is_empty()
            || s.starts_with("--")
            || s.starts_with(';')
            || s.starts_with('#')
            || s.starts_with("//")
        {
            continue;
        }
        if let Some(cap) = LINE_RE.captures(s) {
            map.insert(cap[1].to_lowercase(), cap[2].trim().to_string());
        }
    }
    map
}

pub fn read_port(path: &Path) -> u16 {
    let cfg = read_cfg(path);
    if let Some(port_str) = cfg.get("grpc.client.server.port") {
        if let Ok(p) = port_str.parse::<u16>() {
            if p > 0 {
                return p;
            }
        }
    }
    if let Some(addr) = cfg.get("grpc.client.server.address") {
        if let Some((_, pstr)) = addr.rsplit_once(':') {
            if let Ok(p) = pstr.parse::<u16>() {
                if p > 0 {
                    return p;
                }
            }
        }
    }
    DEFAULT_PORT
}

pub fn actions_enabled(path: &Path) -> bool {
    read_cfg(path)
        .get("server.game.telemetry.trigger.actions.enabled")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn wanted_keys(uses_port_cvar: bool, enable_actions: bool) -> BTreeMap<&'static str, String> {
    let mut wanted = BTreeMap::new();
    wanted.insert("grpc.client.server.enabled", "1".to_string());
    if uses_port_cvar {
        wanted.insert("grpc.client.server.port", DEFAULT_PORT.to_string());
        wanted.insert("server.game.telemetry.enabled", "1".to_string());
        if enable_actions {
            wanted.insert("server.game.telemetry.trigger.actions.enabled", "1".to_string());
        }
    } else {
        wanted.insert(
            "grpc.client.server.address",
            format!("127.0.0.1:{}", DEFAULT_PORT),
        );
    }
    wanted
}

pub fn missing_keys(path: &Path, uses_port_cvar: bool) -> Vec<String> {
    let cur = read_cfg(path);
    let wanted = wanted_keys(uses_port_cvar, false);
    let mut missing = Vec::new();
    for (k, v) in wanted {
        if k == "grpc.client.server.port" || k == "grpc.client.server.address" {
            if !cur.contains_key(k) {
                missing.push(k.to_string());
            }
        } else if cur.get(k).map(|s| s.as_str()) != Some(v.as_str()) {
            missing.push(k.to_string());
        }
    }
    missing
}

pub fn patch_cfg_text(original: &str, changes: &BTreeMap<&str, String>) -> String {
    let mut lines: Vec<String> = original.lines().map(|l| l.to_string()).collect();
    let mut done = std::collections::HashSet::new();

    for line in &mut lines {
        let s = line.trim();
        if s.is_empty()
            || s.starts_with("--")
            || s.starts_with(';')
            || s.starts_with('#')
            || s.starts_with("//")
        {
            continue;
        }
        if let Some(cap) = LINE_RE.captures(s) {
            let key = cap[1].to_lowercase();
            if let Some((&wanted_k, wanted_v)) = changes.iter().find(|(&k, _)| k == key) {
                *line = format!("{} = {}", wanted_k, wanted_v);
                done.insert(wanted_k);
            }
        }
    }

    let extra: Vec<String> = changes
        .iter()
        .filter(|(&k, _)| !done.contains(k))
        .map(|(&k, v)| format!("{} = {}", k, v))
        .collect();

    if !extra.is_empty() {
        if let Some(last) = lines.last() {
            if !last.trim().is_empty() {
                lines.push(String::new());
            }
        }
        lines.push("; --- StatsCitizen: Local Game Telemetry (gRPC) ---".to_string());
        lines.extend(extra);
    }

    let mut out = lines.join("\r\n");
    out.push_str("\r\n");
    out
}

pub enum ApplyCfgOutcome {
    Unchanged,
    WrittenDirect,
    WrittenElevated,
}

pub fn apply_cfg(
    path: &Path,
    uses_port_cvar: bool,
    enable_actions: bool,
) -> Result<ApplyCfgOutcome, String> {
    let cur = read_cfg(path);
    let wanted = wanted_keys(uses_port_cvar, enable_actions);
    let mut changes: BTreeMap<&str, String> = BTreeMap::new();
    for (k, v) in wanted {
        if k == "grpc.client.server.port" || k == "grpc.client.server.address" {
            if !cur.contains_key(k) {
                changes.insert(k, v);
            }
        } else if cur.get(k).map(|s| s.as_str()) != Some(v.as_str()) {
            changes.insert(k, v);
        }
    }

    if changes.is_empty() {
        return Ok(ApplyCfgOutcome::Unchanged);
    }

    let old_text = fs::read_to_string(path).unwrap_or_default();
    let new_text = patch_cfg_text(&old_text, &changes);

    // Try direct write first (with backup)
    let bak_path = path.with_extension("cfg.statscitizen.bak");
    if path.exists() && !bak_path.exists() {
        let _ = fs::copy(path, &bak_path);
    }

    match fs::write(path, &new_text) {
        Ok(()) => Ok(ApplyCfgOutcome::WrittenDirect),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            #[cfg(windows)]
            {
                let tmp = std::env::temp_dir().join("statscitizen_user_cfg.tmp");
                fs::write(&tmp, &new_text)
                    .map_err(|err| format!("Failed writing temp config: {err}"))?;
                let target_str = path.to_string_lossy().replace('\'', "''");
                let tmp_str = tmp.to_string_lossy().replace('\'', "''");
                let bak_str = bak_path.to_string_lossy().replace('\'', "''");
                let ps_cmd = format!(
                    "if (Test-Path '{t}') {{ if (-not (Test-Path '{b}')) {{ Copy-Item -LiteralPath '{t}' -Destination '{b}' }} }}; Copy-Item -LiteralPath '{s}' -Destination '{t}' -Force",
                    t = target_str,
                    b = bak_str,
                    s = tmp_str
                );
                let status = std::process::Command::new("powershell")
                    .args([
                        "-NoProfile",
                        "-Command",
                        &format!(
                            "$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',\"{}\"; exit $p.ExitCode",
                            ps_cmd.replace('"', "`\"")
                        ),
                    ])
                    .status()
                    .map_err(|err| format!("Failed to request UAC elevation: {err}"))?;
                let _ = fs::remove_file(&tmp);
                if status.success() {
                    Ok(ApplyCfgOutcome::WrittenElevated)
                } else {
                    Err("Elevation was cancelled or denied while updating user.cfg.".to_string())
                }
            }
            #[cfg(not(windows))]
            {
                Err(format!("Permission denied writing user.cfg: {e}"))
            }
        }
        Err(e) => Err(format!("Failed to write user.cfg: {e}")),
    }
}

pub fn env_enabled() -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        if let Ok(env_key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
            if let Ok(val) = env_key.get_value::<String, _>(ENV_NAME) {
                return val.eq_ignore_ascii_case("true") || val == "1";
            }
        }
        false
    }
    #[cfg(not(windows))]
    {
        std::env::var(ENV_NAME)
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false)
    }
}

pub fn enable_env() -> Result<bool, String> {
    if env_enabled() {
        return Ok(false);
    }
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (env_key, _) = hkcu
            .create_subkey("Environment")
            .map_err(|e| format!("Failed to open HKCU\\Environment: {e}"))?;
        env_key
            .set_value(ENV_NAME, &"true")
            .map_err(|e| format!("Failed to set {}: {e}", ENV_NAME))?;
        // Notify Windows shell that user environment changed
        let _ = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                "[Environment]::SetEnvironmentVariable('GRPC_CLIENT_SERVER_ENABLED','true','User')",
            ])
            .status();
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}
