use crate::activity_parser::{parse_activity_line, LineJoiner};
use crate::models::LiveTelemetryEvent;
use crate::normalizer::{normalize_destination, normalize_ship_name};
use chrono::Utc;
use regex::Regex;
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tauri::AppHandle;

static TS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>").unwrap());
static LIVE_BUY_REQUEST_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)SendShopBuyRequest.*shopId\[(\d+)\].*shopName\[(.*?)\].*kioskId\[(\d+)\].*client_price\[(\d+(?:\.\d+)?)\].*itemName\[(.*?)\].*quantity\[(\d+)\]").unwrap()
});
static LIVE_BUY_RESPONSE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)RmShopFlowResponse.*shopId\[(\d+)\].*kioskId\[(\d+)\].*result\[([^\]]+)\]")
        .unwrap()
});
static MISSION_REWARD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)Awarded\s+([\d,]+)\s+aUEC").unwrap());
static GRANT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)granted control token for '([^']+)'").unwrap());
static RELEASE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)releasing control token for '([^']+)'").unwrap());
static QUANTUM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)Player has requested fuel calculation to destination\s+([^\s]+)").unwrap()
});
static COLLISION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)Fatal Collision occured for vehicle\s+([^\s\[]+).*Zone:\s*([^,]+)").unwrap()
});

struct PendingLivePurchase {
    shop_name: String,
    item_name: String,
    unit_price: f64,
    quantity: u32,
}

fn emit_event(app: &AppHandle, event: LiveTelemetryEvent) {
    crate::overlay::publish_event(app, event);
}

pub fn spawn_log_watcher(sc_path: PathBuf, stop_flag: Arc<AtomicBool>, app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let log_path = sc_path.join("Game.log");
        let mut offset: u64 = std::fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0);
        let mut pending_text = String::new();
        let mut pending_purchases: HashMap<String, VecDeque<PendingLivePurchase>> = HashMap::new();
        let mut joiner = LineJoiner::default();

        while !stop_flag.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(800)).await;
            if stop_flag.load(Ordering::Relaxed) {
                break;
            }

            let Ok(meta) = std::fs::metadata(&log_path) else {
                continue;
            };
            let len = meta.len();
            if len < offset {
                offset = 0;
                pending_text.clear();
            }
            if len == offset {
                continue;
            }

            let Ok(mut file) = File::open(&log_path) else {
                continue;
            };
            if file.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let to_read = (len - offset).min(2 * 1024 * 1024) as usize;
            let mut buf = vec![0u8; to_read];
            let Ok(n) = file.read(&mut buf) else {
                continue;
            };
            if n == 0 {
                continue;
            }
            offset += n as u64;
            let chunk = String::from_utf8_lossy(&buf[..n]);
            pending_text.push_str(&chunk);

            let mut lines: Vec<String> = Vec::new();
            while let Some(pos) = pending_text.find('\n') {
                let line = pending_text[..pos].trim_end_matches('\r').to_string();
                pending_text.drain(..=pos);
                if !line.trim().is_empty() {
                    lines.push(line);
                }
            }

            for line in lines {
                let ts = TS_RE
                    .captures(&line)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_else(|| Utc::now().to_rfc3339());

                if let Some(logical) = joiner.push(&line) {
                    for ev in parse_activity_line(&logical, &ts) {
                        emit_event(&app, ev);
                    }
                }

                if let Some(cap) = MISSION_REWARD_RE.captures(&line) {
                    if let Ok(amount) = cap[1].replace(',', "").parse::<f64>() {
                        emit_event(
                            &app,
                            LiveTelemetryEvent {
                                id: Some(format!("{}|reward|{}", ts, amount)),
                                timestamp: ts.clone(),
                                event_type: "reward".to_string(),
                                title: "aUEC Awarded".to_string(),
                                details: format!("{} aUEC (from Game.log)", amount as i64),
                                objective_id: None,
                                objective_state: None,
                                zone: None,
                                mission_id: None,
                                mission_name: None,
                                amount_auec: Some(amount),
                                item_name: None,
                                operation: None,
                                objective_text: None,
                                confirmed: Some(true),
                                category: Some("finance".to_string()),
                                severity: Some("success".to_string()),
                            },
                        );
                    }
                }

                if line.contains("granted control token for") {
                    if let Some(cap) = GRANT_RE.captures(&line) {
                        let ship = normalize_ship_name(&cap[1]);
                        emit_event(
                            &app,
                            LiveTelemetryEvent {
                                id: Some(format!("{}|flight_start|{}", ts, ship.name)),
                                timestamp: ts.clone(),
                                event_type: "flight_start".to_string(),
                                title: "Flight Systems Engaged".to_string(),
                                details: format!("Piloting {} ({})", ship.name, ship.manufacturer),
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
                                category: Some("flight".to_string()),
                                severity: Some("info".to_string()),
                            },
                        );
                    }
                }

                if line.contains("releasing control token for") {
                    if let Some(cap) = RELEASE_RE.captures(&line) {
                        let ship = normalize_ship_name(&cap[1]);
                        emit_event(
                            &app,
                            LiveTelemetryEvent {
                                id: Some(format!("{}|flight_end|{}", ts, ship.name)),
                                timestamp: ts.clone(),
                                event_type: "flight_end".to_string(),
                                title: "Pilot Stand Down".to_string(),
                                details: format!("Released controls of {}", ship.name),
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
                                category: Some("flight".to_string()),
                                severity: Some("info".to_string()),
                            },
                        );
                    }
                }

                if line.contains("Player has requested fuel calculation to destination") {
                    if let Some(cap) = QUANTUM_RE.captures(&line) {
                        let dest = normalize_destination(&cap[1]);
                        emit_event(
                            &app,
                            LiveTelemetryEvent {
                                id: Some(format!("{}|quantum|{}", ts, dest)),
                                timestamp: ts.clone(),
                                event_type: "quantum".to_string(),
                                title: "Quantum Route Computed".to_string(),
                                details: format!("Destination: {}", dest),
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
                                category: Some("navigation".to_string()),
                                severity: Some("info".to_string()),
                            },
                        );
                    }
                }

                if line.contains("<FatalCollision>") {
                    if let Some(cap) = COLLISION_RE.captures(&line) {
                        let ship = normalize_ship_name(&cap[1]);
                        let zone = normalize_destination(&cap[2]);
                        emit_event(
                            &app,
                            LiveTelemetryEvent {
                                id: Some(format!("{}|collision|{}|{}", ts, ship.name, zone)),
                                timestamp: ts.clone(),
                                event_type: "collision".to_string(),
                                title: "CRITICAL IMPACT // HULL LOSS".to_string(),
                                details: format!("{} suffered fatal impact in sector {}", ship.name, zone),
                                objective_id: None,
                                objective_state: None,
                                zone: Some(zone),
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
                }

                if let Some(cap) = LIVE_BUY_REQUEST_RE.captures(&line) {
                    let key = format!("{}_{}", &cap[1], &cap[3]);
                    pending_purchases
                        .entry(key)
                        .or_default()
                        .push_back(PendingLivePurchase {
                            shop_name: cap[2].to_string(),
                            unit_price: cap[4].parse::<f64>().unwrap_or(0.0),
                            item_name: cap[5].to_string(),
                            quantity: cap[6].parse::<u32>().unwrap_or(1),
                        });
                }

                if let Some(cap) = LIVE_BUY_RESPONSE_RE.captures(&line) {
                    let key = format!("{}_{}", &cap[1], &cap[2]);
                    let res = cap[3].to_lowercase();
                    let purchase = pending_purchases
                        .get_mut(&key)
                        .and_then(|q| q.pop_front());
                    if res.contains("success") {
                        let amount_auec = purchase
                            .as_ref()
                            .map(|p| p.unit_price * (p.quantity as f64));
                        let details = match &purchase {
                            Some(p) => format!(
                                "{} ×{} · {} aUEC · {}",
                                p.item_name,
                                p.quantity,
                                amount_auec.unwrap_or(0.0) as i64,
                                p.shop_name
                            ),
                            None => "Successful terminal response; purchase details were not in the log."
                                .to_string(),
                        };
                        emit_event(
                            &app,
                            LiveTelemetryEvent {
                                id: Some(format!("{}|purchase|{}", ts, details)),
                                timestamp: ts.clone(),
                                event_type: "purchase".to_string(),
                                title: "Transaction Confirmed".to_string(),
                                details,
                                objective_id: None,
                                objective_state: None,
                                zone: None,
                                mission_id: None,
                                mission_name: None,
                                amount_auec,
                                item_name: purchase.map(|p| p.item_name),
                                operation: None,
                                objective_text: None,
                                confirmed: Some(true),
                                category: Some("finance".to_string()),
                                severity: Some("success".to_string()),
                            },
                        );
                    }
                }

                if line.contains("Medical Bed: The bed has restored your health") {
                    emit_event(
                        &app,
                        LiveTelemetryEvent {
                            id: Some(format!("{}|medical", ts)),
                            timestamp: ts,
                            event_type: "medical".to_string(),
                            title: "Medical Treatment Applied".to_string(),
                            details: "Health restored and vitals stabilized.".to_string(),
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
                            category: Some("medical".to_string()),
                            severity: Some("success".to_string()),
                        },
                    );
                }
            }
        }
    });
}
