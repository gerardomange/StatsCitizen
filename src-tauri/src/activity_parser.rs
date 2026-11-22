use crate::models::LiveTelemetryEvent;
use crate::normalizer::normalize_item_name;
use regex::Regex;
use std::sync::LazyLock;

static TIMESTAMP_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>").unwrap());
// `Added notification "Contract Accepted:  Name <EM4>[800 Rep]</EM4>: " [71] to queue. … MissionId: [...], ObjectiveId: [...]`
// The text may contain apostrophes ("People's Alliance") and, before joining, may span two lines.
static NOTIFICATION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)Added notification\s+"(.*?)"\s*\[\d+\]"#).unwrap());
static CONTRACT_NOTICE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(Contract Accepted|Contract Complete|Contract Failed):\s*(.*)$").unwrap());
static OBJECTIVE_NOTICE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(New Objective|Objective Complete|Objective Failed|Objective Withdrawn):\s*(.*)$").unwrap()
});
static EM_TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<EM\d*>.*?</EM\d*>").unwrap());
static ANY_TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"</?[A-Za-z][A-Za-z0-9]*>").unwrap());
static TEMPLATE_VAR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"~\w+\([^)]*\)").unwrap());
static FLAGS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"flags=([A-Za-z|]*)").unwrap());
static FIELD_OBJECTIVE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bObjectiveId:?\s*\[([^\]]*)\]").unwrap());
static LEADING_TS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^<\d{4}-\d{2}-\d{2}T[^>]*>\s?").unwrap());
static OBJECTIVE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)mission_id\s+(.+?)\s+-\s+objective_id\s+(.+?)\s+-\s+state\s+([A-Z0-9_]+)")
        .unwrap()
});
static ARMISTICE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(Entering|Leaving) Armistice Zone\s*-?\s*(.*)$").unwrap());
static JURISDICTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^Entered\s+(.+?)\s+Jurisdiction$").unwrap());
static MONITORED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^Entered Monitored Space$").unwrap());
static SHARD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)New Shard Id:\s*([^\s>.]+)").unwrap());

static FIELD_MISSION_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:MissionId|mission_id):?\s*\[([^\]]*)\]").unwrap());
static FIELD_COMPLETION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bCompletionType:?\s*\[([^\]]*)\]").unwrap());
static FIELD_ITEM_CLASS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:ItemClass|Class):?\s*\[([^\]]*)\]").unwrap());
static FIELD_TYPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bType:?\s*\[([^\]]*)\]").unwrap());
static FIELD_PORT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bPort:?\s*\[([^\]]*)\]").unwrap());

fn extract_bracket_field(re: &Regex, line: &str) -> Option<String> {
    re.captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().trim_start_matches('<').trim_end_matches('>').to_string())
        .filter(|s| !s.is_empty())
}

fn display_item(raw: Option<String>) -> Option<String> {
    let raw = raw?;
    let leaf = raw.rsplit(['/', '\\']).next().unwrap_or(&raw);
    let stem = match leaf.rsplit_once('.') {
        Some((s, _)) if !s.is_empty() => s,
        _ => leaf,
    };
    if stem.chars().all(|c| c.is_ascii_digit()) || stem.len() > 100 {
        return None;
    }
    Some(normalize_item_name(stem).0)
}

/// "Welcome to the System <EM4>[800 Rep] [BP]</EM4>: " → "Welcome to the System".
pub fn clean_notice_text(raw: &str) -> String {
    let s = EM_TAG_RE.replace_all(raw, "");
    let s = ANY_TAG_RE.replace_all(&s, "");
    let s = TEMPLATE_VAR_RE.replace_all(&s, "");
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    s.trim().trim_end_matches(':').trim().to_string()
}

/// The log uses an all-zero GUID for "no mission".
fn is_real_id(id: &str) -> bool {
    id.chars().any(|c| c.is_ascii_alphanumeric() && c != '0')
}

/// Re-joins HUD notifications whose text contains a newline, e.g.
///   `<ts> … Added notification "Objective Complete: Talk To Battaglia In Levski`
///   `<ts> : " [73] to queue. New queue size: 1, MissionId: […], ObjectiveId: […]`
/// Feed it every line in order; it returns the logical line to parse (or None while buffering).
#[derive(Default)]
pub struct LineJoiner {
    pending: Option<String>,
    parts: usize,
}

impl LineJoiner {
    const MAX_PARTS: usize = 4;

    pub fn push<'a>(&mut self, line: &'a str) -> Option<std::borrow::Cow<'a, str>> {
        use std::borrow::Cow;
        if let Some(mut joined) = self.pending.take() {
            joined.push(' ');
            joined.push_str(LEADING_TS_RE.replace(line, "").trim());
            self.parts += 1;
            if line.contains("to queue") || self.parts >= Self::MAX_PARTS {
                self.parts = 0;
                return Some(Cow::Owned(joined));
            }
            self.pending = Some(joined);
            return None;
        }
        if line.contains("Added notification \"") && !line.contains("to queue") {
            self.pending = Some(line.to_string());
            self.parts = 1;
            return None;
        }
        Some(Cow::Borrowed(line))
    }
}

fn make_event(mut event: LiveTelemetryEvent) -> LiveTelemetryEvent {
    // Objective pushes can flip back and forth (shown → hidden → shown): keep every transition.
    if event.operation.as_deref() == Some("upsert") {
        event.id = Some(format!(
            "objective_upsert|{}|{}|{}|{}",
            event.mission_id.as_deref().unwrap_or(""),
            event.objective_id.as_deref().unwrap_or(""),
            event.objective_state.as_deref().unwrap_or(""),
            event.timestamp
        ));
        return event;
    }
    // The HUD notification and <EndMission> both report the same contract outcome: same id → deduped.
    if matches!(
        event.event_type.as_str(),
        "mission_accepted" | "mission_completed" | "mission_failed" | "mission_abandoned"
    ) {
        if let Some(mid) = event.mission_id.as_deref() {
            event.id = Some(format!("contract|{}|{}", event.event_type, mid));
            return event;
        }
    }
    let id = if event.event_type == "objective_update"
        && event.mission_id.is_some()
        && event.objective_id.is_some()
    {
        format!(
            "{}|{}|{}|{}",
            event.event_type,
            event.mission_id.as_deref().unwrap_or(""),
            event.objective_id.as_deref().unwrap_or(""),
            event.objective_state.as_deref().unwrap_or("unknown")
        )
    } else {
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
            event.timestamp,
            event.event_type,
            event.mission_id.as_deref().unwrap_or(""),
            event.objective_id.as_deref().unwrap_or(""),
            event.objective_state.as_deref().unwrap_or(""),
            event.title,
            event.item_name.as_deref().unwrap_or(""),
            event.zone.as_deref().unwrap_or(""),
            event.operation.as_deref().unwrap_or(""),
            event.details
        )
    };
    event.id = Some(id);
    event
}

/// Event skeleton for contract/objective events (keeps the many optional fields in one place).
fn mission_event(
    timestamp: &str,
    event_type: &str,
    title: &str,
    details: String,
    mission_id: &str,
    category: &str,
    severity: &str,
) -> LiveTelemetryEvent {
    LiveTelemetryEvent {
        id: None,
        timestamp: timestamp.to_string(),
        event_type: event_type.to_string(),
        title: title.to_string(),
        details,
        objective_id: None,
        objective_state: None,
        zone: None,
        mission_id: Some(mission_id.to_string()),
        mission_name: None,
        amount_auec: None,
        item_name: None,
        operation: None,
        objective_text: None,
        confirmed: Some(true),
        category: Some(category.to_string()),
        severity: Some(severity.to_string()),
    }
}

pub fn parse_activity_line(line: &str, fallback_ts: &str) -> Vec<LiveTelemetryEvent> {
    let timestamp = TIMESTAMP_RE
        .captures(line)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| fallback_ts.to_string());

    let mut events = Vec::new();
    // Only "Added notification" lines: UpdateNotificationItem repeats the same text 3× (Next/StartFade/Remove).
    let notice = NOTIFICATION_RE
        .captures(line)
        .and_then(|c| c.get(1))
        .map(|m| clean_notice_text(m.as_str()))
        .filter(|s| !s.is_empty());
    let mission_id = extract_bracket_field(&FIELD_MISSION_ID, line).filter(|id| is_real_id(id));

    if let (Some(text), Some(mid)) = (notice.as_deref(), mission_id.as_deref()) {
        if let Some(cap) = CONTRACT_NOTICE_RE.captures(text) {
            let kind = cap[1].to_lowercase();
            let name = cap[2].trim().to_string();
            let (event_type, title, severity) = if kind.ends_with("accepted") {
                ("mission_accepted", "Contract Accepted", "info")
            } else if kind.ends_with("complete") {
                ("mission_completed", "Contract Completed", "success")
            } else {
                ("mission_failed", "Contract Failed", "alert")
            };
            let details = if name.is_empty() { format!("Mission {}", mid) } else { name.clone() };
            let mut ev = mission_event(&timestamp, event_type, title, details, mid, "contract", severity);
            ev.mission_name = (!name.is_empty()).then_some(name);
            events.push(make_event(ev));
        } else if let Some(cap) = OBJECTIVE_NOTICE_RE.captures(text) {
            if let Some(oid) = extract_bracket_field(&FIELD_OBJECTIVE_ID, line).filter(|id| is_real_id(id)) {
                let kind = cap[1].to_lowercase();
                let objective = cap[2].trim().to_string();
                let (state, title, severity) = if kind.starts_with("new") {
                    ("inprogress", "New Objective", "info")
                } else if kind.ends_with("complete") {
                    ("completed", "Objective Complete", "success")
                } else if kind.ends_with("failed") {
                    ("failed", "Objective Failed", "warning")
                } else {
                    ("withdrawn", "Objective Withdrawn", "info")
                };
                let mut ev = mission_event(&timestamp, "objective_update", title, objective.clone(), mid, "objective", severity);
                ev.objective_id = Some(oid);
                ev.objective_state = Some(state.to_string());
                ev.objective_text = (!objective.is_empty()).then_some(objective);
                events.push(make_event(ev));
            }
        }
    }

    if line.contains("<EndMission>") {
        if let Some(ref mid) = mission_id {
            let completion = extract_bracket_field(&FIELD_COMPLETION, line)
                .unwrap_or_default()
                .to_lowercase();
            let mapped = if completion.contains("abandon") || completion.contains("cancel") || completion.contains("deactivate") {
                Some(("mission_abandoned", "Contract Abandoned", "warning"))
            } else if completion.contains("fail") {
                Some(("mission_failed", "Contract Failed", "alert"))
            } else if completion.contains("complete") || completion.contains("success") {
                Some(("mission_completed", "Contract Completed", "success"))
            } else {
                None
            };
            if let Some((event_type, title, severity)) = mapped {
                events.push(make_event(mission_event(
                    &timestamp,
                    event_type,
                    title,
                    format!("Mission {}", mid),
                    mid,
                    "contract",
                    severity,
                )));
            }
        }
    }

    // Raw objective state pushes. The game pre-creates every objective hidden, then shows, hides and
    // completes them here — often with no HUD notification (e.g. "Hide Ship Signature" just finishes).
    // Ids match the "New Objective" notifications. Internal "phase_" objectives are skipped.
    if line.contains("<ObjectiveUpserted>") {
        if let Some(cap) = OBJECTIVE_RE.captures(line) {
            let mid = cap[1].trim().to_string();
            let oid = cap[2].trim().to_string();
            if !oid.starts_with("phase_") {
                let raw_state = cap[3].to_string();
                let base = raw_state
                    .strip_prefix("MISSION_OBJECTIVE_STATE_")
                    .unwrap_or(&raw_state)
                    .to_lowercase()
                    .replace('_', "");
                let hidden = FLAGS_RE
                    .captures(line)
                    .map(|c| c[1].split('|').any(|f| f == "Hidden" || f == "HiddenInUI"))
                    .unwrap_or(false);
                // An open objective that the HUD hides has been superseded by another one.
                let state = if base == "inprogress" && hidden { "hidden".to_string() } else { base };
                let is_complete = state.contains("complete") || state.contains("success");
                let mut ev = mission_event(
                    &timestamp,
                    "objective_update",
                    "Objective Updated",
                    format!("Objective state observed: {}", state),
                    &mid,
                    "objective",
                    if is_complete { "success" } else { "info" },
                );
                ev.objective_id = Some(oid);
                ev.objective_state = Some(state);
                ev.operation = Some("upsert".to_string());
                events.push(make_event(ev));
            }
        }
    }

    if let Some(ref text) = notice {
        if let Some(arm) = ARMISTICE_RE.captures(text) {
            let entering = arm[1].eq_ignore_ascii_case("entering");
            let suffix = arm.get(2).map(|m| m.as_str().trim()).unwrap_or("");
            let zone = if suffix.is_empty() {
                "Armistice Zone".to_string()
            } else {
                format!("Armistice Zone · {}", suffix)
            };
            events.push(make_event(LiveTelemetryEvent {
                id: None,
                timestamp: timestamp.clone(),
                event_type: "zone_transition".to_string(),
                title: if entering {
                    "Entered Armistice Zone".to_string()
                } else {
                    "Left Armistice Zone".to_string()
                },
                details: zone.clone(),
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
                category: Some("zone".to_string()),
                severity: Some("info".to_string()),
            }));
        } else if let Some(jur) = JURISDICTION_RE.captures(text) {
            let zone = jur[1].trim().to_string();
            events.push(make_event(LiveTelemetryEvent {
                id: None,
                timestamp: timestamp.clone(),
                event_type: "zone_transition".to_string(),
                title: "Jurisdiction Changed".to_string(),
                details: zone.clone(),
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
                category: Some("zone".to_string()),
                severity: Some("info".to_string()),
            }));
        } else if MONITORED_RE.is_match(text) {
            events.push(make_event(LiveTelemetryEvent {
                id: None,
                timestamp: timestamp.clone(),
                event_type: "zone_transition".to_string(),
                title: "Jurisdiction Changed".to_string(),
                details: "Monitored Space".to_string(),
                objective_id: None,
                objective_state: None,
                zone: Some("Monitored Space".to_string()),
                mission_id: None,
                mission_name: None,
                amount_auec: None,
                item_name: None,
                operation: None,
                objective_text: None,
                confirmed: Some(true),
                category: Some("zone".to_string()),
                severity: Some("info".to_string()),
            }));
        }
    }

    if line.contains("<Add Inventory Management Move>") {
        let item_name = display_item(extract_bracket_field(&FIELD_ITEM_CLASS, line));
        let operation = extract_bracket_field(&FIELD_TYPE, line).unwrap_or_else(|| "move".to_string());
        let details = format!(
            "{} · {} request observed; completion is not confirmed in this line.",
            item_name.as_deref().unwrap_or("Item"),
            operation
        );
        events.push(make_event(LiveTelemetryEvent {
            id: None,
            timestamp: timestamp.clone(),
            event_type: "inventory_move".to_string(),
            title: "Inventory Move Requested".to_string(),
            details,
            objective_id: None,
            objective_state: None,
            zone: None,
            mission_id: None,
            mission_name: None,
            amount_auec: None,
            item_name,
            operation: Some(operation),
            objective_text: None,
            confirmed: Some(false),
            category: Some("inventory".to_string()),
            severity: Some("info".to_string()),
        }));
    } else if line.contains("<EquipItem>") {
        let item_name = display_item(extract_bracket_field(&FIELD_ITEM_CLASS, line));
        let port = extract_bracket_field(&FIELD_PORT, line);
        let slot_part = match port {
            Some(ref p) if !p.chars().all(|c| c.is_ascii_digit()) => format!(" · slot {}", p),
            _ => String::new(),
        };
        let details = format!(
            "{}{}; completion is not confirmed in this line.",
            item_name.as_deref().unwrap_or("Item"),
            slot_part
        );
        events.push(make_event(LiveTelemetryEvent {
            id: None,
            timestamp: timestamp.clone(),
            event_type: "inventory_equip".to_string(),
            title: "Equipment Request Observed".to_string(),
            details,
            objective_id: None,
            objective_state: None,
            zone: None,
            mission_id: None,
            mission_name: None,
            amount_auec: None,
            item_name,
            operation: Some("equip".to_string()),
            objective_text: None,
            confirmed: Some(false),
            category: Some("inventory".to_string()),
            severity: Some("info".to_string()),
        }));
    } else if line.contains("<OnInventoryStoreItem>") {
        events.push(make_event(LiveTelemetryEvent {
            id: None,
            timestamp: timestamp.clone(),
            event_type: "inventory_stored".to_string(),
            title: "Storage State Updated".to_string(),
            details: "The log recorded an item storage update; item name and quantity were not included.".to_string(),
            objective_id: None,
            objective_state: None,
            zone: None,
            mission_id: None,
            mission_name: None,
            amount_auec: None,
            item_name: None,
            operation: Some("storage update".to_string()),
            objective_text: None,
            confirmed: Some(true),
            category: Some("inventory".to_string()),
            severity: Some("info".to_string()),
        }));
    }

    if line.contains("<Update Shard Id>") {
        if let Some(cap) = SHARD_RE.captures(line) {
            let shard_id = cap[1].to_string();
            events.push(make_event(LiveTelemetryEvent {
                id: None,
                timestamp,
                event_type: "shard".to_string(),
                title: "Shard Changed".to_string(),
                details: format!("Connected to shard {}.", shard_id),
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
                category: Some("system".to_string()),
                severity: Some("info".to_string()),
            }));
        }
    }

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    const FB: &str = "2026-11-18T00:00:00Z";
    const MID: &str = "676f51b4-a8f1-4263-9751-19484c224d75";

    fn parse_all(lines: &[&str]) -> Vec<LiveTelemetryEvent> {
        let mut j = LineJoiner::default();
        lines.iter().filter_map(|l| j.push(l).map(|s| parse_activity_line(&s, FB))).flatten().collect()
    }

    #[test]
    fn contract_accepted_name_is_cleaned() {
        let ev = parse_all(&[&format!(
            r#"<2026-11-18T02:05:33.690Z> [Notice] <SHUDEvent_OnNotification> Added notification "Contract Accepted:  Welcome to the System <EM4>[800 Rep] [BP]</EM4>: " [71] to queue. New queue size: 1, MissionId: [{MID}], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]"#
        )]);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].event_type, "mission_accepted");
        assert_eq!(ev[0].mission_name.as_deref(), Some("Welcome to the System"));
    }

    #[test]
    fn objective_notifications_carry_text_even_across_two_lines() {
        let ev = parse_all(&[
            &format!(r#"<2026-11-18T02:05:33.691Z> [Notice] <SHUDEvent_OnNotification> Added notification "New Objective: Talk To Battaglia In Levski: " [72] to queue. New queue size: 2, MissionId: [{MID}], ObjectiveId: [d3e9b094-edfb-9f46-9af1-a7d23bbddb94] [Team_CoreGameplayFeatures][Missions][Comms]"#),
            r#"<2026-11-18T02:05:33.700Z> [Notice] <UpdateNotificationItem> Notification "New Objective: Talk To Battaglia In Levski: " [72], Action: Next [Team_CoreGameplayFeatures][Missions][Comms]"#,
            r#"<2026-11-18T02:06:31.957Z> [Notice] <SHUDEvent_OnNotification> Added notification "Objective Complete: Talk To Battaglia In Levski"#,
            &format!(r#"<2026-11-18T02:06:31.957Z> : " [73] to queue. New queue size: 1, MissionId: [{MID}], ObjectiveId: [d3e9b094-edfb-9f46-9af1-a7d23bbddb94] [Team_CoreGameplayFeatures][Missions][Comms]"#),
        ]);
        assert_eq!(ev.len(), 2, "{ev:?}");
        assert_eq!(ev[0].objective_state.as_deref(), Some("inprogress"));
        assert_eq!(ev[0].objective_text.as_deref(), Some("Talk To Battaglia In Levski"));
        assert_eq!(ev[1].objective_state.as_deref(), Some("completed"));
        assert_eq!(ev[1].objective_text.as_deref(), Some("Talk To Battaglia In Levski"));
    }

    #[test]
    fn failures_and_hidden_phases() {
        let ev = parse_all(&[
            &format!(r#"<2026-11-18T02:08:04.615Z> [Notice] <EndMission> Ending mission for player. MissionId[{MID}] Player[Pilot] PlayerId[1] CompletionType[Fail] Reason[Mission Ended] [Team_MissionFeatures][Missions]"#),
            &format!(r#"<2026-11-18T02:11:49.386Z> [Notice] <ObjectiveUpserted> Received ObjectiveUpserted push message for: mission_id {MID} - objective_id phase_4696820f - state MISSION_OBJECTIVE_STATE_COMPLETED - created 0 - flags=Hidden|HiddenInUI|SilentUpdates| [Team_GameServices][Missions]"#),
            r#"<2026-11-21T22:07:21.731Z> [Notice] <SHUDEvent_OnNotification> Added notification "Entered People's Alliance Jurisdiction: " [2] to queue. New queue size: 3, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]"#,
        ]);
        assert_eq!(ev.len(), 2, "{ev:?}");
        assert_eq!(ev[0].event_type, "mission_failed");
        assert_eq!(ev[1].event_type, "zone_transition");
        assert_eq!(ev[1].zone.as_deref(), Some("People's Alliance"));
    }
}
