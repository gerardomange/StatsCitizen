import type { GaugeValue, LiveTelemetryFrame } from '../../types/telemetry.js';

// NOTE: the backend serializes proto3 with default-value fields omitted, so `undefined`
// on a bool/number usually means false/0 — not "unknown".

export type HudMode = 'offline' | 'fps' | 'eva' | 'pilot' | 'gunner' | 'crew' | 'ground';

/** English source labels — pass through t() when rendering. */
export const HUD_MODE_LABELS: Record<HudMode, string> = {
  offline: 'NO SIGNAL',
  fps: 'ON FOOT',
  eva: 'EVA',
  pilot: 'PILOT',
  gunner: 'GUNNER',
  crew: 'CREW',
  ground: 'GROUND',
};

/** Pick the HUD layout from the live gRPC frame. */
export function detectHudMode(frame: LiveTelemetryFrame | null): HudMode {
  if (!frame?.connected || !frame.actor) return 'offline';
  const loco = frame.actor.state?.locomotion ?? '';
  const role = frame.actor.state?.crew_role ?? '';
  const vType = frame.vehicle?.state?.type ?? '';
  const hasVehicle = Boolean(frame.vehicle?.state?.class_name || frame.vehicle?.state?.name);

  if (loco.includes('EVA')) return 'eva';
  if (loco.includes('SEATED') && hasVehicle) {
    if (role.includes('GUNNER')) return 'gunner';
    if (vType.includes('GROUND') || vType.includes('GRAVLEV') || vType.includes('BOAT')) return 'ground';
    if (role.includes('PILOT')) return 'pilot';
    return 'crew';
  }
  return 'fps';
}

export const pct = (g?: GaugeValue) => {
  if (!g || typeof g.current !== 'number') return null;
  const max = g.max && g.max > 0 ? g.max : 100;
  return Math.max(0, Math.min(100, (g.current / max) * 100));
};

/** 0–1 fraction → 0–100 (clamped). Values already >1 are treated as percentages. */
export const fracPct = (v?: number | null) => {
  if (v === undefined || v === null || !Number.isFinite(v)) return null;
  const p = v > 1.0001 ? v : v * 100;
  return Math.max(0, Math.min(100, p));
};

export const cleanEnum = (raw?: string, prefix?: string) => {
  if (!raw) return '—';
  let s = raw;
  if (prefix) s = s.replace(prefix, '');
  return s.replace(/_/g, ' ').trim();
};

export const isSpaceAltitude = (alt?: number) =>
  alt === undefined || alt === null || !Number.isFinite(alt) || alt > 1e12;

export const formatAlt = (alt?: number) => {
  if (isSpaceAltitude(alt)) return 'SPACE';
  if (alt! >= 1000) return `${(alt! / 1000).toFixed(1)} km`;
  return `${Math.round(alt!)} m`;
};

export const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
};

export type Tone = 'emerald' | 'cyan' | 'amber' | 'rose' | 'slate';

/** Health-style tone: red <25, amber <50, otherwise the base tone. */
export const levelTone = (value: number | null, base: Tone = 'emerald'): Tone =>
  value === null ? 'slate' : value < 25 ? 'rose' : value < 50 ? 'amber' : base;

export const TONE_TEXT: Record<Tone, string> = {
  emerald: 'text-emerald-300',
  cyan: 'text-cyan-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  slate: 'text-slate-500',
};

export const TONE_BAR: Record<Tone, string> = {
  emerald: 'bg-emerald-400',
  cyan: 'bg-quantum-cyan',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  slate: 'bg-slate-600',
};

export const TONE_HEX: Record<Tone, string> = {
  emerald: '#34d399',
  cyan: 'rgb(var(--accent))',
  amber: '#fbbf24',
  rose: '#fb7185',
  slate: '#475569',
};

export type AnnState = 'major' | 'minor' | 'nominal' | 'off';
export const annState = (raw?: string): AnnState =>
  !raw ? 'off' : raw.includes('MAJOR') ? 'major' : raw.includes('MINOR') ? 'minor' : raw.includes('NOMINAL') ? 'nominal' : 'off';

/** `title` / `detail` are English source strings; render with t(title) and t(detail, vars). */
export interface Hazard {
  id: string;
  level: 'warning' | 'critical';
  title: string;
  detail: string;
  vars?: Record<string, string | number>;
}

/** Survival hazards derived from actor vitals/environment (shown in FPS / EVA / pilot strip). */
export function actorHazards(frame: LiveTelemetryFrame | null): Hazard[] {
  const a = frame?.actor;
  if (!a) return [];
  const out: Hazard[] = [];
  const loco = a.state?.locomotion ?? '';
  const pressure = a.vitals?.pressure;
  const breathable = Boolean(a.environment?.breathable_atmosphere);
  const o2 = pct(a.vitals?.oxygen);
  const temp = a.environment?.external_temperature;
  const rad = a.environment?.ambient_radiation_rate ?? 0;
  const intox = a.vitals?.intoxication_level ?? 0;
  const hp = pct(a.vitals?.health);

  if (loco.includes('ON_FOOT') && typeof pressure === 'number' && pressure < 0.25 && !breathable) {
    out.push({ id: 'decomp', level: 'critical', title: 'DECOMPRESSION', detail: 'Pressure {p} atm · seal your helmet', vars: { p: pressure.toFixed(2) } });
  }
  if (o2 !== null && o2 < 25) {
    out.push({ id: 'o2', level: o2 < 10 ? 'critical' : 'warning', title: 'LOW OXYGEN', detail: '{n}% remaining', vars: { n: Math.round(o2) } });
  }
  if (hp !== null && hp < 30) {
    out.push({ id: 'hp', level: 'critical', title: 'CRITICAL HEALTH', detail: '{n}%', vars: { n: Math.round(hp) } });
  }
  if (rad > 0.05) {
    out.push({ id: 'rad', level: rad > 1 ? 'critical' : 'warning', title: 'RADIATION', detail: 'Rate {n}', vars: { n: rad.toFixed(2) } });
  }
  if (typeof temp === 'number' && (temp > 60 || temp < -40)) {
    out.push({ id: 'temp', level: 'warning', title: temp > 0 ? 'EXTREME HEAT' : 'EXTREME COLD', detail: '{n} °C outside', vars: { n: temp.toFixed(0) } });
  }
  if (intox > 0) {
    out.push({ id: 'intox', level: intox > 2 ? 'critical' : 'warning', title: 'INTOXICATION', detail: 'Level {n}', vars: { n: intox } });
  }
  return out;
}
