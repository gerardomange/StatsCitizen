import React from 'react';
import ReactDOM from 'react-dom/client';
import '../src/index.css';
import { ShipThemeProvider } from '../src/themes/ShipThemeContext';
import { CompactHudView } from '../src/components/hud/CompactHudView';
import { HudGrid } from '../src/components/hud/HudGrid';
import { I18nProvider } from '../src/i18n';
import { AlertFrame } from '../src/components/common/AlertFrame';
import type { LiveTelemetryFrame } from '../src/types/telemetry';

const base: LiveTelemetryFrame = {
  connected: true, fps: 17.2, channel: 'PTU', port: 50051, timestamp: new Date().toISOString(), supportsActions: false,
  sessionMetrics: { uecStart: 1200000, uecCurrent: 1254300, uecDelta: 54300, maxSpeed: 1142, maxG: 7.4, deaths: 0, downedCount: 1, totalFrames: 51234 },
  actor: {
    vitals: { health: { current: 82, max: 100 }, oxygen: { current: 96, max: 100 }, hunger: { current: 44, max: 100 }, thirst: { current: 61, max: 100 }, body_temperature: { current: 36.8 }, heart_rate: 92, gravity: 0.98, pressure: 1.0 },
    state: { locomotion: 'ACTOR_LOCOMOTION_STATE_SEATED', crew_role: 'ACTOR_CREW_ROLE_PILOT', seat_name: 'Pilot Seat', uec_balance: 1254300 },
    environment: { external_temperature: 24.5, ambient_radiation_rate: 0, breathable_atmosphere: true },
  },
  vehicle: { state: {
    name: 'DRAK_Cutlass_Black_1234', class_name: 'DRAK_Cutlass_Black', manufacturer: 'Drake Interplanetary', type: 'VEHICLE_TYPE_SPACESHIP', lights_enabled: true, health: 0.78,
    shields: { level: 0.64, faces: [0.92, 0.35, 0.71, 0.18] },
    master_mode: { mode: 'VEHICLE_MASTER_MODE_SCM' }, doors: { open_state: 'DOOR_OPEN_STATE_CLOSED', lock_state: 'DOOR_LOCK_STATE_LOCKED' },
    power: { powerplants: true, engines: true, weapons: true, coolers: true, life_support: true, shield_generators: true, shield_emitters: true, sensors: true },
    annunciators: { pwr: 'ANNUNCIATOR_STATE_NOMINAL', wpn: 'ANNUNCIATOR_STATE_NOMINAL', thr: 'ANNUNCIATOR_STATE_NOMINAL', shld: 'ANNUNCIATOR_STATE_MINOR_ON', cool: 'ANNUNCIATOR_STATE_NOMINAL', qdrv: 'ANNUNCIATOR_STATE_NOMINAL', radr: 'ANNUNCIATOR_STATE_NOMINAL', hit: 'ANNUNCIATOR_STATE_MAJOR_FLASHING' },
    flight: { state: { gear: 'VEHICLE_COMPONENT_DEPLOYMENT_STATE_RETRACTED' }, instruments: { speed: 214, hydrogen_fuel: 0.81, quantum_fuel: 0.56, g_meter: { current: 3.2, max: 9 }, boost: { reserves: 0.42 }, altitude: 4830, radar_altitude: 1260, vertical_speed_indicator: -12.4, atmospheric_density: 0.812, heading: 247 } },
  } },
  weapons: { preset_index: 0, preset_name: 'ALL GUNS', settings: { gimbals_locked: true, staggered_fire: true },
    weapons: [ { name: 'M5A Cannon', is_powered: true, ready_to_fire: true, contained_in_preset: true }, { name: 'M5A Cannon', is_powered: true, ready_to_fire: true, contained_in_preset: true }, { name: 'CF-337 Panther', is_powered: true, contained_in_preset: true } ],
    countermeasures: [ { type: 'COUNTERMEASURE_TYPE_DECOY', amount: 12 }, { type: 'COUNTERMEASURE_TYPE_NOISE', amount: 4 } ] },
  forceFeedback: { gunfire: 0.6 },
};
const mode: string = (window as any).__MODE ?? 'grid';
if ((window as any).__LANG) localStorage.setItem('statscitizen.lang', (window as any).__LANG);
const fps: LiveTelemetryFrame = { ...base, vehicle: null, actor: { ...base.actor!, state: { ...base.actor!.state, locomotion: 'ACTOR_LOCOMOTION_STATE_ON_FOOT' }, vitals: { ...base.actor!.vitals, pressure: 0.12 }, environment: { external_temperature: -71, ambient_radiation_rate: 0.3, breathable_atmosphere: false } } };
const events: any[] = [
  { id: '1', timestamp: new Date().toISOString(), type: 'mission_accepted', title: 'Contract accepted', details: 'Bounty: Wanted criminal', missionId: 'm1', missionName: 'Bounty: Wanted criminal', category: 'contract', severity: 'info' },
  { id: '2', timestamp: new Date().toISOString(), type: 'reward', title: 'Reward received', details: '+12,500 aUEC', category: 'finance', severity: 'success' },
];
const isFps = mode === 'grid-fps';
const frame = isFps ? fps : base;
ReactDOM.createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <ShipThemeProvider frame={isFps ? null : base}>
      <div style={{ width: 1100 }} className={'p-4 bg-space-950 text-slate-100 ' + (isFps ? 'hud-grid-editing' : '')}>
        <HudGrid ctx={{ frame, scPath: '', actionsEnabled: false, events, mode: isFps ? 'fps' : 'pilot' }} editing={isFps} resetKey={0} />
      </div>
    </ShipThemeProvider>
  </I18nProvider>
);
