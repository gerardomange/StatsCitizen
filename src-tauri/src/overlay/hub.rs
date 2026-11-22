//! In-memory overlay state shared by every OBS source. Fed by the same frames/events the
//! desktop UI receives, and fanned out to overlay clients over a broadcast channel.

use super::contracts::{Contract, ContractTracker};
use super::store::{self, OverlayFile};
use crate::models::{LiveTelemetryEvent, LiveTelemetryFrame};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, LazyLock, Mutex};
use tokio::sync::broadcast;

const MAX_EVENTS: usize = 30;
const MAX_HISTORY: usize = 1200;
/// Record a balance point at least this often even if it did not change (keeps the sparkline moving).
const HISTORY_IDLE_MS: i64 = 60_000;

pub type Msg = Arc<str>;

struct Inner {
    frame: Option<LiveTelemetryFrame>,
    events: VecDeque<LiveTelemetryEvent>,
    contracts: ContractTracker,
    /// [unix ms, aUEC balance]
    history: Vec<[i64; 2]>,
    /// When the current live session started (unix ms), so a refreshed OBS source keeps its clock.
    session_start: i64,
    demo: bool,
    file: OverlayFile,
}

pub struct Hub {
    inner: Mutex<Inner>,
    tx: broadcast::Sender<Msg>,
}

pub static HUB: LazyLock<Hub> = LazyLock::new(|| {
    let (tx, _) = broadcast::channel(256);
    Hub {
        inner: Mutex::new(Inner {
            frame: None,
            events: VecDeque::new(),
            contracts: ContractTracker::default(),
            history: Vec::new(),
            session_start: now_ms(),
            demo: false,
            file: store::load(),
        }),
        tx,
    }
});

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl Hub {
    pub fn subscribe(&self) -> broadcast::Receiver<Msg> {
        self.tx.subscribe()
    }

    fn send(&self, v: Value) {
        if self.tx.receiver_count() > 0 {
            let _ = self.tx.send(Arc::from(v.to_string()));
        }
    }

    pub fn on_frame(&self, frame: &LiveTelemetryFrame) {
        let mut point = None;
        {
            let mut inner = self.inner.lock().unwrap();
            inner.frame = Some(frame.clone());
            let bal = frame
                .actor
                .as_ref()
                .and_then(|a| a.pointer("/state/uec_balance"))
                .and_then(|v| v.as_f64())
                .map(|b| b as i64);
            if let Some(bal) = bal.filter(|b| *b > 0) {
                let now = now_ms();
                let due = match inner.history.last() {
                    Some([t, b]) => *b != bal || now - *t >= HISTORY_IDLE_MS,
                    None => true,
                };
                if due {
                    if inner.history.len() >= MAX_HISTORY {
                        // Halve the resolution of the oldest half instead of dropping the start of the session.
                        let half = inner.history.len() / 2;
                        let mut kept: Vec<[i64; 2]> =
                            inner.history[..half].iter().step_by(2).copied().collect();
                        kept.extend_from_slice(&inner.history[half..]);
                        inner.history = kept;
                    }
                    inner.history.push([now, bal]);
                    point = Some([now, bal]);
                }
            }
        }
        if self.tx.receiver_count() > 0 {
            self.send(json!({ "t": "frame", "frame": frame }));
            if let Some(p) = point {
                self.send(json!({ "t": "history", "point": p }));
            }
        }
    }

    pub fn on_event(&self, ev: &LiveTelemetryEvent) {
        let contracts = {
            let mut inner = self.inner.lock().unwrap();
            if ev.id.is_some() && inner.events.iter().any(|e| e.id == ev.id) {
                return;
            }
            inner.events.push_front(ev.clone());
            inner.events.truncate(MAX_EVENTS);
            inner.contracts.on_event(ev).then(|| (inner.contracts.list(), inner.contracts.completed_total()))
        };
        self.send(json!({ "t": "event", "event": ev }));
        if let Some((c, done)) = contracts {
            self.send(json!({ "t": "contracts", "contracts": c, "completed": done }));
        }
    }

    /// New live session (watcher restarted / channel switched).
    pub fn reset_session(&self) {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.frame = None;
            inner.events.clear();
            inner.contracts.clear();
            inner.history.clear();
            inner.session_start = now_ms();
        }
        self.send(json!({ "t": "reset", "sessionStart": now_ms() }));
    }

    /// Rebuild contract state from events already in the current Game.log (app restarted mid-session).
    pub fn seed_contracts(&self, events: &[LiveTelemetryEvent]) {
        let list = {
            let mut inner = self.inner.lock().unwrap();
            for ev in events {
                inner.contracts.on_event(ev);
            }
            (inner.contracts.list(), inner.contracts.completed_total())
        };
        self.send(json!({ "t": "contracts", "contracts": list.0, "completed": list.1 }));
    }

    pub fn snapshot(&self, layout_id: Option<&str>) -> Value {
        let inner = self.inner.lock().unwrap();
        let layout = layout_id.and_then(|id| {
            inner
                .file
                .layouts
                .iter()
                .find(|l| store::layout_id(l) == Some(id))
                .cloned()
        });
        json!({
            "t": "hello",
            "frame": inner.frame,
            "events": inner.events,
            "contracts": inner.contracts.list(),
            "contractsCompleted": inner.contracts.completed_total(),
            "history": inner.history,
            "sessionStart": inner.session_start,
            "demo": inner.demo,
            "layout": layout,
            "serverTime": now_ms(),
        })
    }

    /// Compact state for chat bots / Streamer.bot (`GET /api/state.json`).
    pub fn bot_state(&self) -> Value {
        let inner = self.inner.lock().unwrap();
        let m = inner.frame.as_ref().map(|f| &f.session_metrics);
        let contracts = inner.contracts.list();
        let active: Vec<&Contract> = contracts.iter().filter(|c| c.status == "active").collect();
        json!({
            "connected": inner.frame.as_ref().map(|f| f.connected).unwrap_or(false),
            "uecDelta": m.map(|m| m.uec_delta).unwrap_or(0),
            "deaths": m.map(|m| m.deaths).unwrap_or(0),
            "downed": m.map(|m| m.downed_count).unwrap_or(0),
            "maxSpeed": m.map(|m| m.max_speed).unwrap_or(0.0),
            "ship": m.and_then(|m| m.active_ship_name.clone()),
            "activeContracts": active.iter().map(|c| json!({ "name": c.name, "acceptedAt": c.accepted_at })).collect::<Vec<_>>(),
            "completedContracts": inner.contracts.completed_total(),
        })
    }

    // ---- demo / tests ----

    pub fn set_demo(&self, on: bool) {
        self.inner.lock().unwrap().demo = on;
        self.send(json!({ "t": "demo", "on": on }));
    }

    pub fn test_moment(&self, kind: &str) {
        self.send(json!({ "t": "test", "kind": kind }));
    }

    // ---- persisted settings / layouts ----

    pub fn file(&self) -> OverlayFile {
        self.inner.lock().unwrap().file.clone()
    }

    pub fn update_file<F: FnOnce(&mut OverlayFile)>(&self, f: F) -> Result<OverlayFile, String> {
        let mut inner = self.inner.lock().unwrap();
        let mut next = inner.file.clone();
        f(&mut next);
        store::save(&next)?;
        inner.file = next.clone();
        Ok(next)
    }

    pub fn save_layout(&self, layout: Value) -> Result<(), String> {
        let id = store::layout_id(&layout).ok_or("Layout has no id")?.to_string();
        self.update_file(|file| {
            if let Some(slot) = file.layouts.iter_mut().find(|l| store::layout_id(l) == Some(id.as_str())) {
                *slot = layout.clone();
            } else {
                file.layouts.push(layout.clone());
            }
        })?;
        self.send(json!({ "t": "layout", "layout": layout }));
        Ok(())
    }

    pub fn delete_layout(&self, id: &str) -> Result<(), String> {
        self.update_file(|file| file.layouts.retain(|l| store::layout_id(l) != Some(id)))?;
        self.send(json!({ "t": "layoutDeleted", "id": id }));
        Ok(())
    }
}
