use crate::activity_parser::{parse_activity_line, LineJoiner};
use crate::models::{
    ActivityCoverage, FatalCollisionRecord, ImpactVelocity, LiveTelemetryEvent, MedicalRecord,
    PurchaseRecord, QuantumRouteRecord, ScanProgress, SessionData, ShipUsage, SystemSpecs,
    TelemetrySummary,
};
use crate::normalizer::{
    normalize_destination, normalize_item_name, normalize_ship_name, normalize_shop_name,
};
use chrono::{DateTime, Utc};
use regex::Regex;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use std::sync::{mpsc, LazyLock};
use std::time::UNIX_EPOCH;

/// Bump whenever `parse_single_log_file` output changes so stale cache entries are re-parsed.
const LOG_CACHE_VERSION: u32 = 2;

static TS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>").unwrap());
static ENV_SESSION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"@env_session:\s*'([^']+)'").unwrap());
static SHIP_GRANT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*granted control token for '([^']+)'\s*\[(\d+)\]").unwrap()
});
static SHIP_RELEASE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*releasing control token for '([^']+)'\s*\[(\d+)\]").unwrap()
});
static QUANTUM_DEST_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*Player has requested fuel calculation to destination\s+([^\s]+)").unwrap()
});
static SHOP_BUY_REQ_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*SendShopBuyRequest.*shopId\[(\d+)\].*shopName\[(.*?)\].*kioskId\[(\d+)\].*client_price\[(\d+(?:\.\d+)?)\].*itemName\[(.*?)\].*quantity\[(\d+)\]").unwrap()
});
static SHOP_FLOW_RESP_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*RmShopFlowResponse.*shopId\[(\d+)\].*kioskId\[(\d+)\].*result\[([^\]]+)\]").unwrap()
});
static FATAL_COLLISION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*<FatalCollision>\s+Fatal Collision occured for vehicle\s+([^\s\[]+)\s+\[Part:\s*([^,]+).*Zone:\s*([^,]+).*PlayerPilot:\s*(\d+)\]").unwrap()
});
static COLLISION_VEL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)Relative Vel:\s*x:\s*([-\d.]+),\s*y:\s*([-\d.]+),\s*z:\s*([-\d.]+)").unwrap()
});
static MEDICAL_BED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>.*Medical Bed:\s*([^."]+)"#)
        .unwrap()
});
static SHARD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<Update Shard Id>\s+New Shard Id:\s+([^\s>.]+)").unwrap());
static CPU_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)Host CPU:\s*([^\n\r]+)").unwrap());
static GPU_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Suitable rendering device:\s*([^\n\r]+)").unwrap());
static RAM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)memory installed:\s*([^\n\r]+)").unwrap());
static DISPLAYS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Displays connected:\s*(\d+)").unwrap());
static TRAILING_NUM_SUFFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"_\d+$").unwrap());

#[derive(Clone, Serialize, Deserialize)]
struct ShipInterval {
    ship: String,
    duration_ms: u64,
    last_flown: String,
    sortie_completed: bool,
}

struct PendingPurchase {
    id: String,
    ts: String,
    shop_name: String,
    price: f64,
    item_name: String,
    quantity: u32,
}

#[derive(Clone, Serialize, Deserialize)]
struct SingleLogResult {
    session: Option<SessionData>,
    ship_intervals: Vec<ShipInterval>,
    purchases: Vec<PurchaseRecord>,
    collisions: Vec<FatalCollisionRecord>,
    quantum_routes: Vec<QuantumRouteRecord>,
    medical_treatments: Vec<MedicalRecord>,
    shard_id: Option<String>,
    specs: SystemSpecs,
    flight_control_lines: usize,
    activity_events: Vec<LiveTelemetryEvent>,
}

fn parse_ts(ts: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn format_version(env_session: Option<&str>) -> (String, String, String) {
    let Some(env) = env_session else {
        return (
            "Star Citizen Alpha".to_string(),
            "Unknown".to_string(),
            "LIVE".to_string(),
        );
    };
    let parts: Vec<&str> = env.split('-').collect();
    let channel = if parts
        .first()
        .map(|s| s.eq_ignore_ascii_case("pub"))
        .unwrap_or(false)
    {
        "LIVE"
    } else {
        "PTU"
    };
    let version_digits = parts.get(3).copied().unwrap_or("");
    let build = parts.get(4).copied().unwrap_or("").to_string();

    let (major, minor, patch) = if version_digits.len() >= 2 {
        let mut chars = version_digits.chars();
        let maj = chars.next().map(|c| c.to_string()).unwrap_or_else(|| "3".to_string());
        let min = chars.next().map(|c| c.to_string()).unwrap_or_else(|| "0".to_string());
        let rest: String = chars.collect();
        let pat = if rest.is_empty() { "0".to_string() } else { rest };
        (maj, min, pat)
    } else {
        ("3".to_string(), "0".to_string(), "0".to_string())
    };

    (
        format!("Alpha {}.{}.{} {}", major, minor, patch, channel),
        build,
        channel.to_string(),
    )
}

fn parse_single_log_file(file_path: &Path) -> std::io::Result<SingleLogResult> {
    let file = File::open(file_path)?;
    let reader = BufReader::with_capacity(64 * 1024, file);

    let mut first_ts: Option<DateTime<Utc>> = None;
    let mut last_ts: Option<DateTime<Utc>> = None;
    let mut env_session: Option<String> = None;
    let mut shard_id: Option<String> = None;
    let mut clean_quit = false;
    let mut flight_control_lines = 0usize;

    let mut specs = SystemSpecs::default();
    let mut active_ships: HashMap<String, DateTime<Utc>> = HashMap::new();
    let mut ship_intervals: Vec<ShipInterval> = Vec::new();
    let mut pending_purchases: HashMap<String, VecDeque<PendingPurchase>> = HashMap::new();
    let mut purchase_occurrences: HashMap<String, usize> = HashMap::new();
    let mut purchases: Vec<PurchaseRecord> = Vec::new();
    let mut collisions: Vec<FatalCollisionRecord> = Vec::new();
    let mut quantum_routes: Vec<QuantumRouteRecord> = Vec::new();
    let mut medical_treatments: Vec<MedicalRecord> = Vec::new();
    let mut activity_events: Vec<LiveTelemetryEvent> = Vec::new();
    let mut joiner = LineJoiner::default();

    for line_res in reader.split(b'\n') {
        let raw_line = match line_res {
            Ok(b) => b,
            Err(_) => continue,
        };
        let line = String::from_utf8_lossy(&raw_line);
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }

        let mut current_ts: Option<DateTime<Utc>> = None;
        if let Some(cap) = TS_RE.captures(line) {
            if let Some(dt) = parse_ts(&cap[1]) {
                if first_ts.is_none() {
                    first_ts = Some(dt);
                }
                last_ts = Some(dt);
                current_ts = Some(dt);
            }
        }

        if let Some(dt) = current_ts {
            let iso = dt.to_rfc3339();
            if let Some(logical) = joiner.push(line) {
                activity_events.extend(parse_activity_line(&logical, &iso));
            }
        }

        if env_session.is_none() && line.contains("@env_session:") {
            if let Some(cap) = ENV_SESSION_RE.captures(line) {
                env_session = Some(cap[1].to_string());
            }
        }

        if shard_id.is_none() && line.contains("<Update Shard Id>") {
            if let Some(cap) = SHARD_RE.captures(line) {
                shard_id = Some(cap[1].to_string());
            }
        }

        if line.contains("Requesting QuitLobby") || line.contains("Engine exit requested") {
            clean_quit = true;
        }

        if specs.cpu.is_none() && line.contains("Host CPU:") {
            if let Some(cap) = CPU_RE.captures(line) {
                specs.cpu = Some(cap[1].trim().to_string());
            }
        }
        if specs.gpu.is_none() && line.contains("Suitable rendering device:") {
            if let Some(cap) = GPU_RE.captures(line) {
                specs.gpu = Some(cap[1].trim().to_string());
            }
        }
        if specs.ram_installed.is_none() && line.contains("memory installed:") {
            if let Some(cap) = RAM_RE.captures(line) {
                specs.ram_installed = Some(cap[1].trim().to_string());
            }
        }
        if specs.displays.is_none() && line.contains("Displays connected:") {
            if let Some(cap) = DISPLAYS_RE.captures(line) {
                specs.displays = Some(cap[1].trim().to_string());
            }
        }

        let lower_has_token = line.contains("control token") || line.contains("Control Token");
        if lower_has_token {
            flight_control_lines += 1;
        }
        if line.contains("CSCItemNavigation") || lower_has_token {
            if let Some(cap) = SHIP_GRANT_RE.captures(line) {
                if let Some(dt) = parse_ts(&cap[1]) {
                    active_ships.insert(format!("{}_{}", &cap[2], &cap[3]), dt);
                }
            }
            if let Some(cap) = SHIP_RELEASE_RE.captures(line) {
                if let Some(dt) = parse_ts(&cap[1]) {
                    let ship = &cap[2];
                    let key = format!("{}_{}", ship, &cap[3]);
                    let started = active_ships.get(&key).or_else(|| active_ships.get(ship)).copied();
                    if let Some(st) = started {
                        if dt > st {
                            let duration_ms = (dt - st).num_milliseconds().max(0) as u64;
                            ship_intervals.push(ShipInterval {
                                ship: ship.to_string(),
                                duration_ms,
                                last_flown: dt.to_rfc3339(),
                                sortie_completed: true,
                            });
                            active_ships.remove(&key);
                            active_ships.remove(ship);
                        }
                    }
                }
            }
        }

        if line.contains("Player has requested fuel calculation to destination") {
            if let Some(cap) = QUANTUM_DEST_RE.captures(line) {
                let raw_dest = cap[2].to_string();
                quantum_routes.push(QuantumRouteRecord {
                    timestamp: cap[1].to_string(),
                    ship_name: "Active Vessel".to_string(),
                    clean_destination: normalize_destination(&raw_dest),
                    destination: raw_dest,
                });
            }
        }

        if line.contains("SendShopBuyRequest") {
            if let Some(cap) = SHOP_BUY_REQ_RE.captures(line) {
                let ts = cap[1].to_string();
                let shop_id = &cap[2];
                let shop_name = cap[3].to_string();
                let kiosk_id = &cap[4];
                let price = cap[5].parse::<f64>().unwrap_or(0.0);
                let item_name = cap[6].to_string();
                let quantity = cap[7].parse::<u32>().unwrap_or(1);

                let key = format!("{}_{}", shop_id, kiosk_id);
                let occ_key = format!("{}|{}|{}", ts, shop_name, item_name);
                let occ = purchase_occurrences
                    .entry(occ_key)
                    .and_modify(|v| *v += 1)
                    .or_insert(1);
                let id = format!("{}_{}_{}_{}", ts, shop_name, item_name, *occ);

                pending_purchases
                    .entry(key)
                    .or_default()
                    .push_back(PendingPurchase {
                        id,
                        ts,
                        shop_name,
                        price,
                        item_name,
                        quantity,
                    });
            }
        } else if line.contains("RmShopFlowResponse") {
            if let Some(cap) = SHOP_FLOW_RESP_RE.captures(line) {
                let key = format!("{}_{}", &cap[2], &cap[3]);
                let result = cap[4].to_lowercase();
                if let Some(queue) = pending_purchases.get_mut(&key) {
                    if let Some(p) = queue.pop_front() {
                        if result.contains("success") {
                            let (clean_name, category) = normalize_item_name(&p.item_name);
                            purchases.push(PurchaseRecord {
                                id: p.id,
                                timestamp: p.ts,
                                shop_name: normalize_shop_name(&p.shop_name),
                                item_name: p.item_name,
                                clean_item_name: clean_name,
                                category,
                                price: p.price,
                                quantity: p.quantity,
                                total_cost: p.price * (p.quantity as f64),
                            });
                        }
                    }
                    if queue.is_empty() {
                        pending_purchases.remove(&key);
                    }
                }
            }
        }

        if line.contains("<FatalCollision>") {
            if let Some(cap) = FATAL_COLLISION_RE.captures(line) {
                let ts = cap[1].to_string();
                let raw_vehicle = cap[2].to_string();
                let part = cap[3].trim().to_string();
                let zone = normalize_destination(&cap[4]);
                let was_pilot = &cap[5] == "1";

                let impact_velocity = COLLISION_VEL_RE.captures(line).and_then(|v| {
                    let x = v[1].parse::<f64>().ok()?;
                    let y = v[2].parse::<f64>().ok()?;
                    let z = v[3].parse::<f64>().ok()?;
                    Some(ImpactVelocity {
                        x,
                        y,
                        z,
                        magnitude: (x * x + y * y + z * z).sqrt(),
                    })
                });
                let norm = normalize_ship_name(&raw_vehicle);
                collisions.push(FatalCollisionRecord {
                    timestamp: ts,
                    vehicle_name: raw_vehicle,
                    normalized_vehicle_name: norm.name,
                    zone,
                    part,
                    was_pilot,
                    impact_velocity,
                });
            }
        }

        if line.contains("Medical Bed: The bed has restored your health") {
            if let Some(cap) = MEDICAL_BED_RE.captures(line) {
                medical_treatments.push(MedicalRecord {
                    timestamp: cap[1].to_string(),
                    record_type: "Bed Restoration".to_string(),
                    description: cap[2].trim().to_string(),
                });
            }
        }
    }

    if let Some(end_dt) = last_ts {
        for (key, started) in active_ships {
            if end_dt > started {
                let duration_ms = (end_dt - started).num_milliseconds().max(0) as u64;
                let ship = TRAILING_NUM_SUFFIX.replace(&key, "").to_string();
                ship_intervals.push(ShipInterval {
                    ship,
                    duration_ms,
                    last_flown: end_dt.to_rfc3339(),
                    sortie_completed: false,
                });
            }
        }
    }

    let session = match (first_ts, last_ts) {
        (Some(start), Some(end)) if end >= start => {
            let duration_ms = (end - start).num_milliseconds().max(0) as u64;
            let (version_label, build_number, channel) = format_version(env_session.as_deref());
            let total_spent: f64 = purchases.iter().map(|p| p.total_cost).sum();
            let ships_flown: Vec<String> = ship_intervals
                .iter()
                .map(|s| normalize_ship_name(&s.ship).name)
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();

            Some(SessionData {
                session_id: file_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Game.log")
                    .to_string(),
                file_path: file_path.to_string_lossy().to_string(),
                start_time: start.to_rfc3339(),
                end_time: end.to_rfc3339(),
                duration_ms,
                duration_hours: ((duration_ms as f64 / 3_600_000.0) * 100.0).round() / 100.0,
                version_label,
                build_number,
                channel,
                shard_id: shard_id.clone(),
                clean_quit,
                crashed: !collisions.is_empty() || !clean_quit,
                ships_flown,
                total_spent,
                purchases_count: purchases.len(),
                collisions_count: collisions.len(),
            })
        }
        _ => None,
    };

    Ok(SingleLogResult {
        session,
        ship_intervals,
        purchases,
        collisions,
        quantum_routes,
        medical_treatments,
        shard_id,
        specs,
        flight_control_lines,
        activity_events,
    })
}

// ---------------------------------------------------------------------------
// Incremental + parallel parsing.
// logbackups/*.log never change once written, so each file's parse result is cached
// on disk keyed by (path, size, mtime). Only new/changed files (usually just Game.log)
// are parsed again, in parallel across CPU cores.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct CacheEntry {
    size: u64,
    mtime_ms: u128,
    result: SingleLogResult,
}

#[derive(Serialize, Deserialize, Default)]
struct LogCache {
    version: u32,
    entries: HashMap<String, CacheEntry>,
}

fn cache_file_for(sc_path: &str) -> Option<PathBuf> {
    let base = dirs::data_local_dir()?;
    let slug: String = sc_path
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
        .collect();
    Some(base.join("StatsCitizen").join("log-cache").join(format!("{slug}.json")))
}

fn load_cache(path: &Path) -> LogCache {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<LogCache>(&bytes).ok())
        .filter(|c| c.version == LOG_CACHE_VERSION)
        .unwrap_or_default()
}

fn file_stamp(path: &Path) -> Option<(u64, u128)> {
    let meta = fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some((meta.len(), mtime))
}

fn parse_files_cached<F>(
    sc_path: &str,
    files: &[PathBuf],
    on_progress: &mut F,
) -> Vec<Result<SingleLogResult, String>>
where
    F: FnMut(ScanProgress),
{
    let total = files.len();
    let cache_path = cache_file_for(sc_path);
    let mut cache = cache_path.as_deref().map(load_cache).unwrap_or_default();

    let mut results: Vec<Option<Result<SingleLogResult, String>>> = (0..total).map(|_| None).collect();
    let mut stamps: Vec<Option<(u64, u128)>> = Vec::with_capacity(total);
    let mut todo: Vec<usize> = Vec::new();

    for (idx, file) in files.iter().enumerate() {
        let stamp = file_stamp(file);
        stamps.push(stamp);
        let key = file.to_string_lossy().to_string();
        match (stamp, cache.entries.get(&key)) {
            (Some((size, mtime)), Some(entry)) if entry.size == size && entry.mtime_ms == mtime => {
                results[idx] = Some(Ok(entry.result.clone()));
            }
            _ => todo.push(idx),
        }
    }

    let mut done = total - todo.len();
    on_progress(ScanProgress {
        current: done,
        total,
        filename: "Loaded from cache".to_string(),
    });

    if !todo.is_empty() {
        let workers = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, 8)
            .min(todo.len());
        let next = std::sync::atomic::AtomicUsize::new(0);
        let (tx, rx) = mpsc::channel::<(usize, Result<SingleLogResult, String>)>();

        std::thread::scope(|scope| {
            for _ in 0..workers {
                let tx = tx.clone();
                let next = &next;
                let todo = &todo;
                scope.spawn(move || loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let Some(&idx) = todo.get(i) else { break };
                    let res = parse_single_log_file(&files[idx]).map_err(|e| e.to_string());
                    if tx.send((idx, res)).is_err() {
                        break;
                    }
                });
            }
            drop(tx);
            // Progress is reported from this thread (on_progress isn't Send).
            for (idx, res) in rx {
                done += 1;
                on_progress(ScanProgress {
                    current: done,
                    total,
                    filename: files[idx]
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown.log")
                        .to_string(),
                });
                results[idx] = Some(res);
            }
        });
    }

    // Rebuild the cache from the files that exist now (drops deleted logs) — only when something changed.
    let cache_dirty = !todo.is_empty() || cache.entries.len() != total;
    if let (Some(cache_path), true) = (cache_path, cache_dirty) {
        let mut fresh = LogCache {
            version: LOG_CACHE_VERSION,
            entries: HashMap::with_capacity(total),
        };
        for (idx, file) in files.iter().enumerate() {
            if let (Some((size, mtime)), Some(Ok(res))) = (stamps[idx], results[idx].as_ref()) {
                fresh.entries.insert(
                    file.to_string_lossy().to_string(),
                    CacheEntry { size, mtime_ms: mtime, result: res.clone() },
                );
            }
        }
        if let Some(dir) = cache_path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(bytes) = serde_json::to_vec(&fresh) {
            let tmp = cache_path.with_extension("json.tmp");
            if fs::write(&tmp, bytes).is_ok() {
                let _ = fs::rename(&tmp, &cache_path);
            }
        }
    }

    results
        .into_iter()
        .map(|r| r.unwrap_or_else(|| Err("not parsed".to_string())))
        .collect()
}

pub fn index_all_star_citizen_logs<F>(sc_path: &str, mut on_progress: F) -> TelemetrySummary
where
    F: FnMut(ScanProgress),
{
    let root = Path::new(sc_path);
    let mut files_to_scan: Vec<PathBuf> = Vec::new();

    let game_log = root.join("Game.log");
    if game_log.is_file() {
        files_to_scan.push(game_log);
    }

    let backups_dir = root.join("logbackups");
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
                    files_to_scan.push(p);
                }
            }
        }
    }

    let mut sessions: Vec<SessionData> = Vec::new();
    let mut scan_warnings: Vec<String> = Vec::new();
    let mut session_keys: HashSet<String> = HashSet::new();
    let mut event_keys: HashSet<String> = HashSet::new();
    let mut ship_interval_keys: HashSet<String> = HashSet::new();
    let mut all_purchases: Vec<PurchaseRecord> = Vec::new();
    let mut all_collisions: Vec<FatalCollisionRecord> = Vec::new();
    let mut all_quantum_routes: Vec<QuantumRouteRecord> = Vec::new();
    let mut all_medical: Vec<MedicalRecord> = Vec::new();
    let mut activity_map: HashMap<String, LiveTelemetryEvent> = HashMap::new();
    let mut ship_map: HashMap<String, (u64, u32, String, String, String)> = HashMap::new();
    let mut specs = SystemSpecs::default();
    let mut flight_control_lines = 0usize;
    let mut shard_ids: HashSet<String> = HashSet::new();

    let total = files_to_scan.len();
    let parsed = parse_files_cached(sc_path, &files_to_scan, &mut on_progress);

    for (file, outcome) in files_to_scan.iter().zip(parsed) {
        let filename = file
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown.log")
            .to_string();

        match outcome {
            Ok(res) => {
                flight_control_lines += res.flight_control_lines;
                if let Some(sess) = res.session {
                    let key = format!("{}|{}|{}", sess.start_time, sess.end_time, sess.build_number);
                    if session_keys.insert(key) {
                        sessions.push(sess);
                    }
                }
                for item in res.purchases {
                    if event_keys.insert(format!("purchase|{}", item.id)) {
                        all_purchases.push(item);
                    }
                }
                for item in res.collisions {
                    let key = format!(
                        "collision|{}|{}|{}|{}",
                        item.timestamp, item.vehicle_name, item.zone, item.part
                    );
                    if event_keys.insert(key) {
                        all_collisions.push(item);
                    }
                }
                for item in res.quantum_routes {
                    let key = format!("route|{}|{}", item.timestamp, item.destination);
                    if event_keys.insert(key) {
                        all_quantum_routes.push(item);
                    }
                }
                for item in res.medical_treatments {
                    let key = format!("medical|{}|{}", item.timestamp, item.description);
                    if event_keys.insert(key) {
                        all_medical.push(item);
                    }
                }
                for ev in res.activity_events {
                    if let Some(ref id) = ev.id {
                        activity_map.entry(id.clone()).or_insert(ev);
                    }
                }
                if let Some(sid) = res.shard_id {
                    shard_ids.insert(sid);
                }
                if specs.cpu.is_none() {
                    specs.cpu = res.specs.cpu;
                }
                if specs.gpu.is_none() {
                    specs.gpu = res.specs.gpu;
                }
                if specs.ram_installed.is_none() {
                    specs.ram_installed = res.specs.ram_installed;
                }
                if specs.displays.is_none() {
                    specs.displays = res.specs.displays;
                }

                for item in res.ship_intervals {
                    let norm = normalize_ship_name(&item.ship);
                    let ikey = format!("{}|{}|{}", norm.name, item.last_flown, item.duration_ms);
                    if !ship_interval_keys.insert(ikey) {
                        continue;
                    }
                    let entry = ship_map.entry(norm.name.clone()).or_insert_with(|| {
                        (
                            0,
                            0,
                            item.last_flown.clone(),
                            norm.manufacturer.clone(),
                            item.ship.clone(),
                        )
                    });
                    entry.0 += item.duration_ms;
                    if item.sortie_completed {
                        entry.1 += 1;
                    }
                    if item.last_flown > entry.2 {
                        entry.2 = item.last_flown;
                    }
                }
            }
            Err(e) => {
                scan_warnings.push(format!("{}: {}", filename, e));
            }
        }
    }

    sessions.sort_by(|a, b| b.start_time.cmp(&a.start_time));
    all_purchases.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    all_collisions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    all_quantum_routes.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let mut ships: Vec<ShipUsage> = ship_map
        .into_iter()
        .map(|(norm_name, (dur, sorties, last_flown, manufacturer, raw_name))| ShipUsage {
            name: raw_name,
            normalized_name: norm_name,
            manufacturer,
            total_flight_time_ms: dur,
            total_flight_hours: ((dur as f64 / 3_600_000.0) * 100.0).round() / 100.0,
            sorties_count: sorties,
            last_flown: Some(last_flown),
            ship_id: None,
        })
        .collect();
    ships.sort_by(|a, b| b.total_flight_time_ms.cmp(&a.total_flight_time_ms));

    // Union overlapping intervals
    let mut ranges: Vec<(i64, i64)> = sessions
        .iter()
        .filter_map(|s| {
            let st = parse_ts(&s.start_time)?.timestamp_millis();
            let en = parse_ts(&s.end_time)?.timestamp_millis();
            Some((st, en))
        })
        .collect();
    ranges.sort_by_key(|r| r.0);

    let mut total_playtime_ms = 0u64;
    let mut cur_range: Option<(i64, i64)> = None;
    for (start, end) in ranges {
        match cur_range {
            None => cur_range = Some((start, end)),
            Some((rs, re)) if start <= re => cur_range = Some((rs, re.max(end))),
            Some((rs, re)) => {
                total_playtime_ms += (re - rs).max(0) as u64;
                cur_range = Some((start, end));
            }
        }
    }
    if let Some((rs, re)) = cur_range {
        total_playtime_ms += (re - rs).max(0) as u64;
    }

    let total_playtime_hours = ((total_playtime_ms as f64 / 3_600_000.0) * 10.0).round() / 10.0;
    let total_auec_spent: f64 = all_purchases.iter().map(|p| p.total_cost).sum();

    let mut activity_events: Vec<LiveTelemetryEvent> = activity_map.into_values().collect();
    activity_events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let unique_contracts: HashSet<&str> = activity_events
        .iter()
        .filter(|e| e.category.as_deref() == Some("contract"))
        .filter_map(|e| e.mission_id.as_deref())
        .collect();

    let activity_coverage = ActivityCoverage {
        contracts: unique_contracts.len(),
        objectives: activity_events
            .iter()
            .filter(|e| e.category.as_deref() == Some("objective"))
            .count(),
        zones: activity_events
            .iter()
            .filter(|e| e.category.as_deref() == Some("zone"))
            .count(),
        inventory: activity_events
            .iter()
            .filter(|e| e.category.as_deref() == Some("inventory"))
            .count(),
        shards: activity_events
            .iter()
            .filter(|e| e.event_type == "shard")
            .count(),
    };

    let longest_session_hours = sessions
        .iter()
        .map(|s| s.duration_hours)
        .fold(0.0_f64, f64::max);
    let average_session_hours = if sessions.is_empty() {
        0.0
    } else {
        ((total_playtime_ms as f64 / 3_600_000.0 / sessions.len() as f64) * 100.0).round() / 100.0
    };

    let current_patch = sessions
        .first()
        .map(|s| s.version_label.clone())
        .unwrap_or_else(|| "Star Citizen Alpha".to_string());

    TelemetrySummary {
        pilot_callsign: "Citizen".to_string(),
        sc_install_path: sc_path.to_string(),
        total_playtime_ms,
        total_playtime_hours,
        total_sessions: sessions.len(),
        longest_session_hours,
        average_session_hours,
        first_session_date: sessions.last().map(|s| s.start_time.clone()),
        last_session_date: sessions.first().map(|s| s.start_time.clone()),
        current_patch,
        total_auec_spent,
        total_purchases_count: all_purchases.len(),
        ships,
        purchases: all_purchases,
        collisions: all_collisions,
        quantum_routes: all_quantum_routes,
        medical_treatments: all_medical,
        loadouts: vec![],
        sessions,
        system_specs: specs,
        shards_count: shard_ids.len(),
        scanned_files_count: total,
        scan_warnings,
        flight_control_lines,
        activity_events,
        activity_coverage,
    }
}

#[cfg(test)]
mod cache_bench {
    /// Manual timing check: `SC_PATH=... cargo test --release cache_bench -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn cache_bench() {
        let Ok(path) = std::env::var("SC_PATH") else { return };
        for run in 1..=2 {
            let t = std::time::Instant::now();
            let s = super::index_all_star_citizen_logs(&path, |_| {});
            println!("run {run}: {} files, {} sessions in {:?}", s.scanned_files_count, s.total_sessions, t.elapsed());
        }
    }
}
