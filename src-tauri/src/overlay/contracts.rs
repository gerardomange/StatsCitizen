//! Turns the loose contract events parsed from Game.log (`mission_accepted`,
//! `objective_update`, `mission_completed`, `mission_abandoned`, `reward`) into state:
//! the list of active contracts plus the few that ended recently.

use crate::models::LiveTelemetryEvent;
use chrono::{DateTime, Utc};
use serde::Serialize;

/// Ended contracts kept around so the overlay can show "CONTRACT COMPLETE" stamps.
const KEEP_ENDED: usize = 5;
/// A reward that lands this long after a completion is attributed to that contract.
const REWARD_WINDOW_SECS: i64 = 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractObjective {
    pub id: String,
    /// Player-facing text from the HUD notification ("Go to Glaciem Ring").
    pub text: String,
    /// "inprogress" | "completed" | "failed"
    pub state: String,
    /// Still open but hidden by the game's HUD (superseded by a newer objective).
    pub hidden: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contract {
    pub id: String,
    pub name: Option<String>,
    pub accepted_at: String,
    /// "active" | "completed" | "failed" | "abandoned"
    pub status: String,
    pub ended_at: Option<String>,
    pub reward: Option<f64>,
    pub objectives: Vec<ContractObjective>,
}

#[derive(Default)]
pub struct ContractTracker {
    contracts: Vec<Contract>,
    completed_total: u32,
}

fn parse_ts(ts: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(ts).ok().map(|d| d.with_timezone(&Utc))
}

impl ContractTracker {
    pub fn clear(&mut self) {
        self.contracts.clear();
        self.completed_total = 0;
    }

    /// Contracts completed this session (the list itself only keeps the last few ended ones).
    pub fn completed_total(&self) -> u32 {
        self.completed_total
    }

    pub fn list(&self) -> Vec<Contract> {
        self.contracts.clone()
    }

    fn get_or_create(&mut self, id: &str, ts: &str) -> &mut Contract {
        if let Some(i) = self.contracts.iter().position(|c| c.id == id) {
            return &mut self.contracts[i];
        }
        self.contracts.push(Contract {
            id: id.to_string(),
            name: None,
            accepted_at: ts.to_string(),
            status: "active".to_string(),
            ended_at: None,
            reward: None,
            objectives: Vec::new(),
        });
        self.contracts.last_mut().unwrap()
    }

    fn prune(&mut self) {
        let ended: Vec<usize> = self
            .contracts
            .iter()
            .enumerate()
            .filter(|(_, c)| c.status != "active")
            .map(|(i, _)| i)
            .collect();
        if ended.len() > KEEP_ENDED {
            let drop: Vec<usize> = ended[..ended.len() - KEEP_ENDED].to_vec();
            let mut idx = 0usize;
            self.contracts.retain(|_| {
                let keep = !drop.contains(&idx);
                idx += 1;
                keep
            });
        }
    }

    /// Feed one event. Returns true when the contract list changed.
    pub fn on_event(&mut self, ev: &LiveTelemetryEvent) -> bool {
        match ev.event_type.as_str() {
            "mission_accepted" => {
                let Some(id) = ev.mission_id.as_deref() else { return false };
                let c = self.get_or_create(id, &ev.timestamp);
                if c.status != "active" {
                    // Same mission id re-accepted (retry): start over.
                    c.status = "active".to_string();
                    c.ended_at = None;
                    c.reward = None;
                    c.objectives.clear();
                    c.accepted_at = ev.timestamp.clone();
                }
                if ev.mission_name.is_some() {
                    c.name = ev.mission_name.clone();
                }
                true
            }
            "objective_update" => {
                let state = ev.objective_state.clone().unwrap_or_default().replace(' ', "");
                // Raw <ObjectiveUpserted> pushes: only move objectives we already know from a HUD
                // notification (the rest are pre-created, never-shown or internal ones).
                if ev.operation.as_deref() == Some("upsert") {
                    let (Some(mid), Some(oid)) = (ev.mission_id.as_deref(), ev.objective_id.as_deref()) else {
                        return false;
                    };
                    let Some(o) = self
                        .contracts
                        .iter_mut()
                        .find(|c| c.id == mid)
                        .and_then(|c| c.objectives.iter_mut().find(|o| o.id == oid))
                    else {
                        return false;
                    };
                    let (next_state, hidden) = match state.as_str() {
                        "hidden" => (o.state.clone(), o.state == "inprogress"),
                        "completed" | "failed" | "inprogress" => (state.clone(), false),
                        _ => return false,
                    };
                    if o.state == next_state && o.hidden == hidden {
                        return false;
                    }
                    o.state = next_state;
                    o.hidden = hidden;
                    o.updated_at = ev.timestamp.clone();
                    return true;
                }
                // HUD notifications carry the text the player sees.
                let (Some(mid), Some(oid), Some(text)) =
                    (ev.mission_id.as_deref(), ev.objective_id.as_deref(), ev.objective_text.as_deref())
                else {
                    return false;
                };
                let c = self.get_or_create(mid, &ev.timestamp);
                if state == "withdrawn" {
                    let before = c.objectives.len();
                    c.objectives.retain(|o| o.id != oid);
                    return c.objectives.len() != before;
                }
                if let Some(o) = c.objectives.iter_mut().find(|o| o.id == oid) {
                    if o.state == state && o.text == text && !o.hidden {
                        return false;
                    }
                    o.state = state;
                    o.hidden = false;
                    o.text = text.to_string();
                    o.updated_at = ev.timestamp.clone();
                } else {
                    c.objectives.push(ContractObjective {
                        id: oid.to_string(),
                        text: text.to_string(),
                        state,
                        hidden: false,
                        updated_at: ev.timestamp.clone(),
                    });
                }
                true
            }
            "mission_completed" | "mission_failed" | "mission_abandoned" => {
                let Some(id) = ev.mission_id.as_deref() else { return false };
                let status = match ev.event_type.as_str() {
                    "mission_completed" => "completed",
                    "mission_failed" => "failed",
                    _ => "abandoned",
                };
                let c = self.get_or_create(id, &ev.timestamp);
                if ev.mission_name.is_some() && c.name.is_none() {
                    c.name = ev.mission_name.clone();
                }
                // The HUD notification and <EndMission> both report the outcome: only the first counts.
                if c.status == status {
                    return false;
                }
                let newly_completed = status == "completed";
                c.status = status.to_string();
                c.ended_at = Some(ev.timestamp.clone());
                if newly_completed {
                    // The game never sends "Objective Complete" for the final objective.
                    for o in c.objectives.iter_mut().filter(|o| o.state != "failed") {
                        o.state = "completed".to_string();
                    }
                }
                if newly_completed {
                    self.completed_total += 1;
                }
                self.prune();
                true
            }
            "reward" => {
                let Some(amount) = ev.amount_auec.filter(|a| *a > 0.0) else { return false };
                let Some(ts) = parse_ts(&ev.timestamp) else { return false };
                // Most recent completed contract without a reward, ended shortly before.
                let target = self.contracts.iter_mut().rev().find(|c| {
                    c.status == "completed"
                        && c.reward.is_none()
                        && c
                            .ended_at
                            .as_deref()
                            .and_then(parse_ts)
                            .map(|end| {
                                let d = (ts - end).num_seconds();
                                (-2..=REWARD_WINDOW_SECS).contains(&d)
                            })
                            .unwrap_or(false)
                });
                if let Some(c) = target {
                    c.reward = Some(amount);
                    return true;
                }
                false
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str, ts: &str) -> LiveTelemetryEvent {
        LiveTelemetryEvent {
            id: None,
            timestamp: ts.to_string(),
            event_type: kind.to_string(),
            title: String::new(),
            details: String::new(),
            objective_id: None,
            objective_state: None,
            zone: None,
            mission_id: Some("m1".into()),
            mission_name: None,
            amount_auec: None,
            item_name: None,
            operation: None,
            objective_text: None,
            confirmed: None,
            category: None,
            severity: None,
        }
    }

    #[test]
    fn lifecycle_and_reward() {
        let mut t = ContractTracker::default();
        let mut a = ev("mission_accepted", "2026-11-21T10:00:00Z");
        a.mission_name = Some("Bounty: Rook".into());
        assert!(t.on_event(&a));
        let mut o = ev("objective_update", "2026-11-21T10:01:00Z");
        o.objective_id = Some("o1".into());
        o.objective_state = Some("inprogress".into());
        o.objective_text = Some("Go to Glaciem Ring".into());
        assert!(t.on_event(&o));
        assert!(!t.on_event(&o), "same state is not a change");
        assert!(t.on_event(&ev("mission_completed", "2026-11-21T10:10:00Z")));
        let mut r = ev("reward", "2026-11-21T10:10:04Z");
        r.mission_id = None;
        r.amount_auec = Some(45000.0);
        assert!(t.on_event(&r));
        let c = &t.list()[0];
        assert_eq!(c.status, "completed");
        assert_eq!(c.reward, Some(45000.0));
        assert_eq!(c.objectives[0].state, "completed", "open objectives close with the contract");
        assert_eq!(c.objectives[0].text, "Go to Glaciem Ring");
        assert_eq!(c.name.as_deref(), Some("Bounty: Rook"));
    }

    #[test]
    fn late_reward_is_ignored() {
        let mut t = ContractTracker::default();
        t.on_event(&ev("mission_accepted", "2026-11-21T10:00:00Z"));
        t.on_event(&ev("mission_completed", "2026-11-21T10:10:00Z"));
        let mut r = ev("reward", "2026-11-21T10:30:00Z");
        r.amount_auec = Some(10.0);
        assert!(!t.on_event(&r));
    }

    #[test]
    fn keeps_only_recent_ended() {
        let mut t = ContractTracker::default();
        for i in 0..8 {
            let mut a = ev("mission_accepted", "2026-11-21T10:00:00Z");
            a.mission_id = Some(format!("m{i}"));
            t.on_event(&a);
            let mut c = ev("mission_completed", "2026-11-21T10:01:00Z");
            c.mission_id = Some(format!("m{i}"));
            t.on_event(&c);
        }
        assert_eq!(t.list().len(), KEEP_ENDED);
        assert_eq!(t.list().last().unwrap().id, "m7");
    }
}

#[cfg(test)]
mod objective_tests {
    use super::*;

    fn obj(state: &str, oid: &str, text: Option<&str>) -> LiveTelemetryEvent {
        LiveTelemetryEvent {
            id: None,
            timestamp: "2026-11-21T10:00:00Z".into(),
            event_type: "objective_update".into(),
            title: String::new(),
            details: String::new(),
            objective_id: Some(oid.into()),
            objective_state: Some(state.into()),
            zone: None,
            mission_id: Some("m1".into()),
            mission_name: None,
            amount_auec: None,
            item_name: None,
            operation: None,
            objective_text: text.map(Into::into),
            confirmed: None,
            category: None,
            severity: None,
        }
    }

    #[test]
    fn raw_upserts_are_ignored_and_withdrawn_removed() {
        let mut t = ContractTracker::default();
        assert!(!t.on_event(&obj("inprogress", "phase_x", None)), "no text → internal phase");
        assert!(t.on_event(&obj("inprogress", "o1", Some("Reach Upper Platform"))));
        assert!(t.on_event(&obj("withdrawn", "o1", Some("Reach Upper Platform"))));
        assert!(t.list()[0].objectives.is_empty());
    }

    #[test]
    fn notification_and_endmission_count_once_and_failed_sticks() {
        let mut t = ContractTracker::default();
        let mut done = obj("", "", None);
        done.event_type = "mission_completed".into();
        done.mission_name = Some("Red Wind Cargo Recovery".into());
        assert!(t.on_event(&done));
        assert!(!t.on_event(&done), "EndMission after the HUD notification");
        assert_eq!(t.completed_total(), 1);
        assert_eq!(t.list()[0].name.as_deref(), Some("Red Wind Cargo Recovery"));

        let mut fail = obj("", "", None);
        fail.event_type = "mission_failed".into();
        fail.mission_id = Some("m2".into());
        assert!(t.on_event(&fail));
        assert_eq!(t.list()[1].status, "failed");
    }
}



#[cfg(test)]
mod ambush_sequence {
    //! Real (PTU 2026-11-22) "Ambush Strike" sequence: objectives are pre-created hidden, revealed by
    //! HUD notifications, superseded (HiddenInUI) and completed silently through ObjectiveUpserted.
    use super::ContractTracker;
    use crate::activity_parser::{parse_activity_line, LineJoiner};

    const M: &str = "b13537d2-8fd7-4681-944e-121ebe11e4f7";

    fn notice(ts: &str, text: &str, oid: &str) -> String {
        format!(r#"<2026-11-22T{ts}Z> [Notice] <SHUDEvent_OnNotification> Added notification "{text}: " [1] to queue. New queue size: 1, MissionId: [{M}], ObjectiveId: [{oid}] [Team_CoreGameplayFeatures][Missions][Comms]"#)
    }
    fn upsert(ts: &str, oid: &str, state: &str, flags: &str) -> String {
        format!("<2026-11-22T{ts}Z> [Notice] <ObjectiveUpserted> Received ObjectiveUpserted push message for: mission_id {M} - objective_id {oid} - state MISSION_OBJECTIVE_STATE_{state} - created 0 - flags={flags}| [Team_GameServices][Missions]")
    }

    #[test]
    fn objectives_follow_the_game_hud() {
        let lines = [
            notice("07:54:25.899", "Contract Accepted:  New Opportunity - Ambush Strike", ""),
            notice("07:54:25.900", "New Objective: Go to Asteroid Mining Base", "255a626e"),
            upsert("08:03:48.030", "f54e928f", "INPROGRESS", "Hidden|ShowInLog"),
            upsert("08:03:48.030", "b843d829", "INPROGRESS", "Hidden|ShowInLog"),
            notice("08:04:48.503", "Objective Complete: Go to Asteroid Mining Base", "255a626e"),
            upsert("08:04:49.822", "f54e928f", "INPROGRESS", "ShowInLog|RespectInheritedVisibility"),
            notice("08:04:49.830", "New Objective: Ambush Aegis Avenger Titan", "f54e928f"),
            notice("08:04:49.830", "New Objective: Hide Ship Signature", "b843d829"),
            upsert("08:05:45.000", "b843d829", "INPROGRESS", "HiddenInUI|ShowInLog"),
            notice("08:05:45.813", "New Objective: Hide and Await the Aegis Avenger Titan", "eb4e0a54"),
            upsert("08:06:52.000", "b843d829", "COMPLETED", "HiddenInUI|ShowInLog|SilentUpdates"),
            upsert("08:06:52.000", "eb4e0a54", "COMPLETED", "Hidden|ShowInLog|SilentUpdates"),
            notice("08:07:25.152", "New Objective: Neutralize Aegis Avenger Titan", "914441d8"),
            upsert("08:07:25.200", "f54e928f", "COMPLETED", "Hidden|ShowInLog|SilentUpdates"),
        ];
        let mut joiner = LineJoiner::default();
        let mut t = ContractTracker::default();
        let mut hidden_seen = false;
        for l in &lines {
            for ev in parse_activity_line(&joiner.push(l).unwrap(), "2026-11-22T00:00:00Z") {
                t.on_event(&ev);
            }
            hidden_seen |= t.list()[0].objectives.iter().any(|o| o.hidden);
        }
        assert!(hidden_seen, "superseded objective is hidden while still open");
        let c = &t.list()[0];
        assert_eq!(c.name.as_deref(), Some("New Opportunity - Ambush Strike"));
        let states: Vec<(&str, &str)> = c.objectives.iter().map(|o| (o.text.as_str(), o.state.as_str())).collect();
        assert_eq!(
            states,
            vec![
                ("Go to Asteroid Mining Base", "completed"),
                ("Ambush Aegis Avenger Titan", "completed"),
                ("Hide Ship Signature", "completed"),
                ("Hide and Await the Aegis Avenger Titan", "completed"),
                ("Neutralize Aegis Avenger Titan", "inprogress"),
            ]
        );
    }
}
