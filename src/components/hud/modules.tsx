import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Coins,
  CreditCard,
  Crosshair,
  Download,
  Eye,
  Gamepad2,
  Gauge,
  HeartPulse,
  MapPin,
  Navigation,
  Package,
  Rocket,
  Server,
  Shield,
  Siren,
  Target,
  Thermometer,
  Trophy,
  Wind,
  Zap,
  Coins as CoinsIcon,
  User,
} from 'lucide-react';
import type { LiveTelemetryEvent, LiveTelemetryFrame } from '../../types/telemetry.js';
import { useI18n, useT } from '../../i18n/index.js';
import { ManufacturerLogo } from '../common/ManufacturerLogo.js';
import { resolveManufacturer } from '../../themes/manufacturers.js';
import { Chip, StatTile, VitalBar } from './HudPrimitives.js';
import { EcgLine, HeadingTape, ShieldHologram, VsiGauge } from './Instruments.js';
import { Annunciators, PilotStrip, PowerMatrix, QuickActions, VehicleStateChips, WeaponsPanel } from './HudPanels.js';
import { HudMode, TONE_HEX, cleanEnum, formatAlt, fracPct, isSpaceAltitude, levelTone, pct } from './hudUtils.js';

export interface ModuleCtx {
  frame: LiveTelemetryFrame | null;
  scPath: string;
  actionsEnabled: boolean;
  events: LiveTelemetryEvent[];
  mode: HudMode;
}

export interface ModuleDef {
  /** English source title (translated at render). */
  title: string;
  icon: React.FC<{ className?: string }>;
  render: (ctx: ModuleCtx) => React.ReactNode;
  /**
   * Elastic modules (lists) absorb leftover vertical space in their column and scroll inside.
   * Fixed-content modules (vitals, gauges…) always keep their natural height.
   */
  elastic?: boolean;
  /** Starts as a full-width row (users can toggle this per module). */
  wide?: boolean;
}

// ---------------------------------------------------------------------------
// Vehicle modules
// ---------------------------------------------------------------------------
const VehicleModule: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const t = useT();
  const v = ctx.frame?.vehicle?.state;
  const theme = resolveManufacturer(v?.manufacturer, v?.class_name);
  const seat = ctx.frame?.actor?.state?.seat_name;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <ManufacturerLogo theme={theme} className="w-10 h-10 shrink-0 text-quantum-cyan" />
        <div className="min-w-0">
          <div className="text-[10px] font-mono text-cyan-300/80 tracking-widest uppercase truncate">{theme.osName}</div>
          <h3 className="text-base font-orbitron font-bold tracking-wider text-white truncate">
            {v?.class_name ? v.class_name.replace(/_/g, ' ') : v?.name ?? t('No vehicle')}
          </h3>
          <p className="text-[10px] font-mono text-slate-400 truncate">
            {v?.manufacturer || theme.name} · {cleanEnum(v?.type, 'VEHICLE_TYPE_')}
            {seat ? ` · ${t('Seat')}: ${seat}` : ''}
          </p>
        </div>
      </div>
      <VehicleStateChips frame={ctx.frame} ground={ctx.mode === 'ground'} />
    </div>
  );
};

const FlightModule: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const t = useT();
  const v = ctx.frame?.vehicle?.state;
  const ins = v?.flight?.instruments;
  const ff = (ctx.frame?.forceFeedback ?? {}) as { stick_shaker?: number };
  const inSpace = isSpaceAltitude(ins?.altitude);
  const g = ins?.g_meter?.current;
  const stall = Number(ff.stick_shaker ?? 0) > 0.05;
  return (
    <div className="space-y-3">
      <HeadingTape heading={ins?.heading} />
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatTile
            label={
              <>
                <Gauge className="w-3 h-3" /> {t('Speed')}
              </>
            }
            value={Math.round(ins?.speed ?? 0)}
            sub="m/s"
            size="lg"
          />
          <StatTile label={t('Altitude')} value={formatAlt(ins?.altitude)} sub={inSpace ? t('space') : t('sea level')} />
          <StatTile label={t('Radar alt')} value={inSpace ? '—' : formatAlt(ins?.radar_altitude)} tone="cyan" sub={t('above ground')} />
          <StatTile
            label="G-meter"
            value={`${(g ?? 0).toFixed(1)} G`}
            tone={stall ? 'rose' : g !== undefined && Math.abs(g) > 6 ? 'amber' : 'white'}
            sub={stall ? 'STICK SHAKER' : ins?.g_meter?.max ? `max ${ins.g_meter.max.toFixed(0)} G` : undefined}
            className={stall ? 'animate-pulse border-rose-500/60' : ''}
          />
          <StatTile
            label={t('Atm. density')}
            value={ins?.atmospheric_density ? ins.atmospheric_density.toFixed(3) : inSpace ? t('VACUUM') : '0.000'}
            tone="cyan"
          />
          <StatTile
            label={
              <>
                <Navigation className="w-3 h-3" /> Master
              </>
            }
            value={cleanEnum(v?.master_mode?.mode, 'VEHICLE_MASTER_MODE_')}
            size="sm"
            tone="cyan"
            sub={v?.master_mode?.spooled ? 'QT SPOOLED' : undefined}
          />
        </div>
        {!inSpace && <VsiGauge vsi={ins?.vertical_speed_indicator} radarAlt={ins?.radar_altitude} />}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <VitalBar label="H₂ fuel" value={fracPct(ins?.hydrogen_fuel)} tone="emerald" />
        <VitalBar label="QT fuel" value={fracPct(ins?.quantum_fuel)} tone="cyan" />
        <div className={ins?.boost?.critical ? 'animate-pulse' : ''}>
          <VitalBar
            label={ins?.boost?.engaged ? t('Boost ▲ ACTIVE') : ins?.boost?.critical ? t('Boost CRITICAL') : 'Boost'}
            value={fracPct(ins?.boost?.reserves)}
            tone={ins?.boost?.critical ? 'rose' : 'cyan'}
          />
        </div>
      </div>
    </div>
  );
};

const DriveModule: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const t = useT();
  const ins = ctx.frame?.vehicle?.state?.flight?.instruments;
  const speed = ins?.speed ?? 0;
  const g = ins?.g_meter?.current;
  return (
    <div className="space-y-3">
      <HeadingTape heading={ins?.heading} />
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile
          label={
            <>
              <Gauge className="w-3 h-3" /> {t('Speed')}
            </>
          }
          value={Math.round(speed * 3.6)}
          sub={`km/h · ${Math.round(speed)} m/s`}
          size="lg"
        />
        <StatTile
          label="G-meter"
          value={`${(g ?? 0).toFixed(1)} G`}
          tone={g !== undefined && Math.abs(g) > 3 ? 'amber' : 'white'}
          size="lg"
        />
      </div>
    </div>
  );
};

const ShieldsModule: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const v = ctx.frame?.vehicle?.state;
  return (
    <div className="h-full flex items-center justify-center">
      <ShieldHologram faces={v?.shields?.faces} level={v?.shields?.level} hull={v?.health} />
    </div>
  );
};

const SHIP_ACTIONS = [
  { id: 'v_flightready', label: 'Flight Ready' },
  { id: 'v_toggle_landing_system', label: 'Landing gear' },
  { id: 'v_vtol_toggle', label: 'VTOL' },
  { id: 'v_lights', label: 'Lights' },
  { id: 'v_master_mode_cycle', label: 'Master Mode' },
  { id: 'v_atc_request', label: 'ATC landing' },
  { id: 'v_power_toggle_shields', label: 'Shields PWR' },
  { id: 'v_power_toggle_weapons', label: 'Weapons PWR' },
];
const GROUND_ACTIONS = [
  { id: 'v_lights', label: 'Lights' },
  { id: 'v_power_toggle_shields', label: 'Shields PWR' },
  { id: 'v_power_toggle_weapons', label: 'Weapons PWR' },
];
// Only shown if the game's ListTriggerableActions reports them.
const FPS_ACTIONS = [
  { id: 'toggle_flashlight', label: 'Flashlight' },
  { id: 'visor_wipe', label: 'Wipe visor' },
  { id: 'mobiglas', label: 'mobiGlas' },
  { id: 'helmet_toggle', label: 'Helmet' },
  { id: 'v_starmap', label: 'Starmap' },
];

const TurretVisionChip: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const t = useT();
  const nv = Boolean(ctx.frame?.turret?.light_amplification);
  return (
    <Chip tone={nv ? 'emerald' : 'slate'}>
      <Eye className="inline w-3 h-3 mr-1 -mt-0.5" />
      {t('NIGHT VISION')} {nv ? 'ON' : 'OFF'}
    </Chip>
  );
};

// ---------------------------------------------------------------------------
// Personal (on foot / EVA) modules
// ---------------------------------------------------------------------------
const VitalsModule: React.FC<{ ctx: ModuleCtx; big?: boolean }> = ({ ctx, big }) => {
  const t = useT();
  const a = ctx.frame?.actor;
  const bpm = a?.vitals?.heart_rate;
  const bodyT = a?.vitals?.body_temperature?.current;
  const size = big ? 'lg' : 'sm';
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-4">
        <div className="shrink-0">
          <div className="text-[9px] font-mono text-slate-500">BPM</div>
          <div className="text-3xl font-orbitron font-bold text-white tabular-nums leading-none">{bpm ? Math.round(bpm) : '—'}</div>
        </div>
        <div className="flex-1 text-quantum-cyan">
          <EcgLine bpm={bpm} />
        </div>
      </div>
      <div className="space-y-2.5">
        <VitalBar label={t('Health')} value={pct(a?.vitals?.health)} tone="emerald" size={size} />
        <VitalBar label={t('Oxygen')} value={pct(a?.vitals?.oxygen)} tone="cyan" size={size} />
        <VitalBar label={t('Hunger')} value={pct(a?.vitals?.hunger)} tone="amber" size={size} />
        <VitalBar label={t('Thirst')} value={pct(a?.vitals?.thirst)} tone="cyan" size={size} />
      </div>
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
        <StatTile label={t('Body temp')} value={bodyT !== undefined ? `${bodyT.toFixed(1)} °C` : '—'} size="sm" />
        <StatTile
          label={t('Intoxication')}
          value={a?.vitals?.intoxication_level ?? 0}
          tone={(a?.vitals?.intoxication_level ?? 0) > 0 ? 'amber' : 'white'}
          size="sm"
        />
      </div>
    </div>
  );
};

const EnvironmentModule: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const t = useT();
  const a = ctx.frame?.actor;
  const env = a?.environment;
  const breathable = Boolean(env?.breathable_atmosphere);
  return (
    <div className="space-y-3">
      <Chip tone={breathable ? 'emerald' : 'amber'}>{breathable ? t('BREATHABLE') : t('SEALED / VACUUM')}</Chip>
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile
          label={t('Outside temp')}
          value={env?.external_temperature !== undefined ? `${env.external_temperature.toFixed(1)} °C` : '—'}
        />
        <StatTile label={t('Pressure')} value={`${(a?.vitals?.pressure ?? 0).toFixed(2)} atm`} />
        <StatTile label={t('Gravity')} value={`${(a?.vitals?.gravity ?? 0).toFixed(2)} G`} />
        <StatTile
          label={t('Radiation')}
          value={(env?.ambient_radiation_rate ?? 0).toFixed(2)}
          tone={(env?.ambient_radiation_rate ?? 0) > 0.05 ? 'amber' : 'white'}
        />
      </div>
    </div>
  );
};

const WalletModule: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const { t, locale } = useI18n();
  const a = ctx.frame?.actor;
  const m = ctx.frame?.sessionMetrics;
  const delta = m?.uecDelta ?? 0;
  return (
    <div className="space-y-3">
      <div className="hud-radius bg-space-900/80 border border-amber-500/20 p-3">
        <div className="text-[9px] font-mono text-slate-400 uppercase">{t('Current balance')}</div>
        <div className="mt-1 text-2xl font-orbitron font-bold text-white tabular-nums">
          {a?.state?.uec_balance !== undefined ? `${a.state.uec_balance.toLocaleString(locale)} aUEC` : '—'}
        </div>
        <div className={`mt-1 text-xs font-mono tabular-nums ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {t('Session net')}: {delta >= 0 ? '+' : ''}
          {delta.toLocaleString(locale)} aUEC
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <StatTile label={t('Max speed')} value={m?.maxSpeed ? Math.round(m.maxSpeed) : '—'} sub="m/s" size="sm" tone="cyan" />
        <StatTile label={t('Max G')} value={m?.maxG ? m.maxG.toFixed(1) : '—'} sub="G" size="sm" tone="amber" />
        <StatTile label={t('Downed/dead')} value={m ? `${m.downedCount}/${m.deaths}` : '0/0'} size="sm" tone="rose" />
      </div>
    </div>
  );
};

const O2Ring: React.FC<{ value: number | null }> = ({ value }) => {
  const t = useT();
  const r = 70;
  const c = 2 * Math.PI * r;
  const color = TONE_HEX[levelTone(value, 'cyan')];
  return (
    <svg viewBox="0 0 180 180" className="w-44 h-44">
      <circle cx="90" cy="90" r={r} fill="none" stroke="rgb(30 41 59)" strokeWidth="12" />
      <circle
        cx="90"
        cy="90"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - (value ?? 0) / 100)}
        transform="rotate(-90 90 90)"
        style={{ transition: 'stroke-dashoffset 300ms, stroke 300ms', filter: `drop-shadow(0 0 6px ${color})` }}
      />
      <text x="90" y="88" textAnchor="middle" fontSize="34" fontWeight="bold" fill="#fff" className="font-orbitron">
        {value !== null ? Math.round(value) : '—'}
      </text>
      <text x="90" y="110" textAnchor="middle" fontSize="11" fill="#94a3b8" className="font-mono">
        {t('% OXYGEN')}
      </text>
    </svg>
  );
};

const SuitModule: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const t = useT();
  const a = ctx.frame?.actor;
  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <O2Ring value={pct(a?.vitals?.oxygen)} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatTile label={t('Pressure')} value={(a?.vitals?.pressure ?? 0).toFixed(2)} sub="atm" size="sm" />
        <StatTile
          label={t('Outside temp')}
          value={a?.environment?.external_temperature !== undefined ? a.environment.external_temperature.toFixed(0) : '—'}
          sub="°C"
          size="sm"
        />
        <StatTile label={t('Gravity')} value={(a?.vitals?.gravity ?? 0).toFixed(2)} sub="G" size="sm" />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Live feed + contracts (Game.log enrichment)
// ---------------------------------------------------------------------------
type LiveFilter =
  | 'all'
  | 'contract'
  | 'objective'
  | 'zone'
  | 'inventory'
  | 'ship'
  | 'finance'
  | 'navigation'
  | 'system'
  | 'combat'
  | 'medical';

const LIVE_FILTERS: Array<{ id: LiveFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'finance', label: 'Finance' },
  { id: 'ship', label: 'Ship' },
  { id: 'combat', label: 'Combat' },
  { id: 'contract', label: 'Contracts' },
  { id: 'objective', label: 'Objectives' },
  { id: 'zone', label: 'Zones' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'medical', label: 'Medical' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'system', label: 'System' },
];

const filterCategory = (event: LiveTelemetryEvent): LiveFilter => {
  if (event.category) return event.category === 'flight' ? 'ship' : (event.category as LiveFilter);
  if (event.type === 'flight_start' || event.type === 'flight_end') return 'ship';
  if (event.type === 'purchase' || event.type === 'reward') return 'finance';
  if (event.type === 'quantum') return 'navigation';
  if (event.type === 'collision') return 'combat';
  if (event.type === 'medical') return 'medical';
  if (event.type === 'shard' || event.type === 'notice') return 'system';
  return 'all';
};

const eventIcon = (type: LiveTelemetryEvent['type']) => {
  switch (type) {
    case 'flight_start':
    case 'flight_end':
      return Rocket;
    case 'purchase':
      return CreditCard;
    case 'collision':
    case 'mission_abandoned':
      return AlertTriangle;
    case 'quantum':
      return Navigation;
    case 'medical':
      return HeartPulse;
    case 'shard':
      return Server;
    case 'mission_accepted':
      return Target;
    case 'mission_completed':
      return Trophy;
    case 'objective_update':
      return CheckCircle2;
    case 'zone_transition':
      return MapPin;
    case 'inventory_move':
    case 'inventory_equip':
    case 'inventory_stored':
      return Package;
    case 'reward':
      return CoinsIcon;
    default:
      return Activity;
  }
};

const eventColor = (severity?: LiveTelemetryEvent['severity']) => {
  switch (severity) {
    case 'alert':
      return 'border-rose-500/40 text-rose-400 bg-rose-500/10';
    case 'warning':
      return 'border-amber-500/40 text-amber-400 bg-amber-500/10';
    case 'success':
      return 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10';
    default:
      return 'border-cyan-500/40 text-quantum-cyan bg-cyan-500/10';
  }
};

const liveEventKey = (event: LiveTelemetryEvent) =>
  event.id ?? [event.timestamp, event.type, event.title, event.details, event.missionId ?? '', event.amountAuec ?? ''].join(':');

const exportLiveEvents = (events: LiveTelemetryEvent[]) => {
  const columns = ['timestamp', 'type', 'title', 'details', 'mission_id', 'zone', 'amount_auec'];
  const rows = events.map((e) => [e.timestamp, e.type, e.title, e.details, e.missionId ?? '', e.zone ?? '', e.amountAuec ?? '']);
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = `﻿${[columns, ...rows].map((r) => r.map((v) => esc(String(v))).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'statscitizen-live-session.csv';
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const FeedModule: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<LiveFilter>('all');
  const visible = filter === 'all' ? ctx.events : ctx.events.filter((e) => filterCategory(e) === filter);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {LIVE_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={
              'rounded border px-2 py-0.5 text-[9px] font-mono transition ' +
              (filter === f.id ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200' : 'border-slate-800 text-slate-500 hover:text-white')
            }
          >
            {t(f.label)}
          </button>
        ))}
        <button
          onClick={() => exportLiveEvents(visible)}
          disabled={!visible.length}
          className="ml-auto flex items-center gap-1 rounded border border-cyan-500/30 px-2 py-0.5 text-[9px] font-mono text-cyan-200 disabled:opacity-40"
        >
          <Download className="h-3 w-3" /> CSV
        </button>
      </div>
      {visible.length ? (
        <div className="space-y-1.5">
          {visible.slice(0, 60).map((event) => {
            const Icon = eventIcon(event.type);
            return (
              <div key={liveEventKey(event)} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-space-900/60 px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={'rounded-md border p-1.5 ' + eventColor(event.severity)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-white">{event.title}</div>
                    <div className="truncate text-[10px] font-mono text-slate-400">{event.details}</div>
                  </div>
                </div>
                <time className="shrink-0 text-[10px] font-mono text-slate-500">{new Date(event.timestamp).toLocaleTimeString(locale)}</time>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-6 text-center text-xs font-mono text-slate-500">
          {ctx.events.length ? t('No events match this filter yet.') : t('Listening for live events…')}
        </div>
      )}
    </div>
  );
};

type MissionState = { id: string; name: string; status: 'active' | 'completed' | 'abandoned'; updatedAt: string; objectives: number };

const ContractsModule: React.FC<{ ctx: ModuleCtx }> = ({ ctx }) => {
  const t = useT();
  const missions = useMemo(() => {
    const map = new Map<string, MissionState>();
    for (const e of [...ctx.events].reverse()) {
      if (!e.missionId) continue;
      const prev = map.get(e.missionId);
      if (e.type === 'mission_accepted') {
        map.set(e.missionId, { id: e.missionId, name: e.missionName || e.details, status: 'active', updatedAt: e.timestamp, objectives: prev?.objectives ?? 0 });
      } else if (e.type === 'mission_completed' || e.type === 'mission_abandoned') {
        map.set(e.missionId, {
          id: e.missionId,
          name: prev?.name || e.missionName || e.details,
          status: e.type === 'mission_completed' ? 'completed' : 'abandoned',
          updatedAt: e.timestamp,
          objectives: prev?.objectives ?? 0,
        });
      } else if (e.type === 'objective_update') {
        map.set(e.missionId, {
          id: e.missionId,
          name: prev?.name || e.missionName || `Mission ${e.missionId}`,
          status: prev?.status ?? 'active',
          updatedAt: e.timestamp,
          objectives: (prev?.objectives ?? 0) + 1,
        });
      }
    }
    const list = [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return [...list.filter((m) => m.status === 'active'), ...list.filter((m) => m.status !== 'active')].slice(0, 12);
  }, [ctx.events]);

  if (!missions.length) {
    return <p className="py-6 text-center text-xs font-mono text-slate-500">{t('Contracts you accept this session show up here.')}</p>;
  }
  return (
    <div className="space-y-1.5">
      {missions.map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-space-900/60 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-white">{m.name}</div>
            <div className="text-[9px] font-mono text-slate-500">{t('{n} objective updates', { n: m.objectives })}</div>
          </div>
          <span
            className={`shrink-0 rounded border px-2 py-0.5 text-[9px] font-mono uppercase ${
              m.status === 'completed'
                ? 'border-emerald-500/30 text-emerald-300'
                : m.status === 'abandoned'
                ? 'border-amber-500/30 text-amber-300'
                : 'border-cyan-500/30 text-cyan-300'
            }`}
          >
            {t(m.status)}
          </span>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const MODULES: Record<string, ModuleDef> = {
  vehicle: { title: 'Vehicle', icon: Rocket, render: (c) => <VehicleModule ctx={c} />, wide: true },
  pilot: { title: 'Pilot', icon: User, render: (c) => <PilotStrip frame={c.frame} />, wide: true },
  shields: { title: 'Shields & hull', icon: Shield, render: (c) => <ShieldsModule ctx={c} /> },
  flight: { title: 'Flight instruments', icon: Gauge, render: (c) => <FlightModule ctx={c} /> },
  drive: { title: 'Drive', icon: Gauge, render: (c) => <DriveModule ctx={c} /> },
  systems: {
    title: 'Systems',
    icon: Zap,
    render: (c) => (
      <div className="space-y-4">
        <Annunciators ann={c.frame?.vehicle?.state?.annunciators} />
        <PowerMatrix power={c.frame?.vehicle?.state?.power} />
      </div>
    ),
  },
  threats: {
    title: 'Threats',
    icon: Siren,
    render: (c) => (
      <div className="space-y-3">
        <Annunciators ann={c.frame?.vehicle?.state?.annunciators} only={['misl', 'hit', 'shld', 'wpn', 'pwr']} title={false} />
        <TurretVisionChip ctx={c} />
      </div>
    ),
  },
  weapons: {
    title: 'Weapons',
    icon: Crosshair,
    render: (c) => <WeaponsPanel frame={c.frame} large={c.mode === 'gunner'} />,
  },
  controls: {
    title: 'Controls',
    icon: Gamepad2,
    render: (c) => (
      <QuickActions scPath={c.scPath} enabled={c.actionsEnabled} actions={c.mode === 'ground' ? GROUND_ACTIONS : SHIP_ACTIONS} />
    ),
  },
  footActions: {
    title: 'On-foot actions',
    icon: Gamepad2,
    render: (c) => <QuickActions scPath={c.scPath} enabled={c.actionsEnabled} actions={FPS_ACTIONS} />,
  },
  vitals: { title: 'Vitals', icon: HeartPulse, render: (c) => <VitalsModule ctx={c} big={c.mode === 'fps'} /> },
  environment: { title: 'Environment & suit', icon: Thermometer, render: (c) => <EnvironmentModule ctx={c} /> },
  wallet: { title: 'Wallet & records', icon: Coins, render: (c) => <WalletModule ctx={c} /> },
  suit: { title: 'EVA suit', icon: Wind, render: (c) => <SuitModule ctx={c} /> },
  feed: { title: 'Live feed', icon: Activity, render: (c) => <FeedModule ctx={c} />, elastic: true },
  contracts: { title: 'Contracts', icon: Target, render: (c) => <ContractsModule ctx={c} />, elastic: true },
};

/** Default module order per HUD mode. Layout is computed from this order, never from coordinates. */
const SHIP = ['vehicle', 'pilot', 'flight', 'shields', 'systems', 'weapons', 'controls', 'contracts', 'feed'];

export const DEFAULT_ORDER: Record<HudMode, string[]> = {
  pilot: SHIP,
  crew: SHIP.filter((id) => id !== 'controls'),
  gunner: ['vehicle', 'pilot', 'weapons', 'shields', 'threats', 'contracts', 'feed'],
  ground: ['vehicle', 'pilot', 'drive', 'shields', 'threats', 'weapons', 'controls', 'contracts', 'feed'],
  fps: ['vitals', 'environment', 'wallet', 'footActions', 'contracts', 'feed'],
  eva: ['suit', 'vitals', 'wallet', 'contracts', 'feed'],
  offline: ['vitals', 'environment', 'wallet', 'contracts', 'feed'],
};
