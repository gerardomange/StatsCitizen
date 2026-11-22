import React, { useEffect, useState } from 'react';
import { AlertTriangle, Coins, Zap, DoorOpen, Lock, Unlock } from 'lucide-react';
import type { LiveTelemetryFrame } from '../../types/telemetry.js';
import { desktopApi } from '../../services/desktopApi.js';
import { useI18n, useT } from '../../i18n/index.js';
import { Chip, HazardList, VitalBar } from './HudPrimitives.js';
import { actorHazards, annState, cleanEnum, pct } from './hudUtils.js';

// ---------------------------------------------------------------------------
// Compact pilot strip (vitals + aUEC), used in vehicle modes.
// ---------------------------------------------------------------------------
export const PilotStrip: React.FC<{ frame: LiveTelemetryFrame | null }> = ({ frame }) => {
  const { t, locale } = useI18n();
  const a = frame?.actor;
  const m = frame?.sessionMetrics;
  const hazards = actorHazards(frame);
  const delta = m?.uecDelta ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {(
        [
          ['HP', pct(a?.vitals?.health), 'emerald'],
          ['O₂', pct(a?.vitals?.oxygen), 'cyan'],
          ['FOOD', pct(a?.vitals?.hunger), 'amber'],
          ['WATER', pct(a?.vitals?.thirst), 'cyan'],
        ] as const
      ).map(([label, v, tone]) => (
        <div key={label} className="w-24">
          <VitalBar label={t(label)} value={v} tone={tone} />
        </div>
      ))}
      <div className="text-[10px] font-mono text-slate-400">
        BPM <span className="text-white tabular-nums">{a?.vitals?.heart_rate ? Math.round(a.vitals.heart_rate) : '—'}</span>
      </div>
      <HazardList hazards={hazards} compact />
      <div className="ml-auto flex items-center gap-2 text-xs font-mono">
        <Coins className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-white tabular-nums font-bold">
          {a?.state?.uec_balance !== undefined ? a.state.uec_balance.toLocaleString(locale) : '—'}
        </span>
        <span className="text-slate-500">aUEC</span>
        <span className={`tabular-nums ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {delta >= 0 ? '+' : ''}
          {delta.toLocaleString(locale)}
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Power matrix + annunciators
// ---------------------------------------------------------------------------
const POWER_ORDER = [
  'powerplants',
  'engines',
  'weapons',
  'shield_generators',
  'shield_emitters',
  'coolers',
  'life_support',
  'gravity_generators',
  'sensors',
];
const ANN_ORDER = ['pwr', 'wpn', 'thr', 'shld', 'cool', 'qdrv', 'radr', 'prox', 'hit', 'misl'];

export const PowerMatrix: React.FC<{ power?: Record<string, boolean> }> = ({ power = {} }) => {
  const t = useT();
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1.5">
        <Zap className="w-3.5 h-3.5 text-amber-400" /> {t('Power')}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {POWER_ORDER.map((key) => {
          const on = Boolean(power[key]);
          return (
            <div
              key={key}
              className={`px-2 py-1.5 rounded text-[9px] font-mono uppercase text-center border ${
                on ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-800 bg-space-900 text-slate-500'
              }`}
            >
              {key.replace(/_/g, ' ')}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const Annunciators: React.FC<{ ann?: Record<string, string>; only?: string[]; title?: boolean }> = ({
  ann = {},
  only,
  title = true,
}) => (
  <div className="space-y-2">
    {title && (
      <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> Annunciators
      </div>
    )}
    <div className="grid grid-cols-5 gap-1.5">
      {(only ?? ANN_ORDER).map((key) => {
        const st = annState(ann[key]);
        return (
          <div
            key={key}
            title={ann[key] ?? 'OFF'}
            className={`px-1.5 py-1.5 rounded text-[10px] font-mono font-bold uppercase text-center border ${
              st === 'major'
                ? 'border-rose-500 bg-rose-500/25 text-rose-200 animate-pulse'
                : st === 'minor'
                ? 'border-amber-500/60 bg-amber-500/20 text-amber-200'
                : st === 'nominal'
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                : 'border-slate-800 bg-space-900 text-slate-600'
            }`}
          >
            {key}
          </div>
        );
      })}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Weapons, preset, aiming settings and countermeasures
// ---------------------------------------------------------------------------
const AIM_SETTINGS: Array<[string, string]> = [
  ['gimbals_locked', 'GIMBAL LOCK'],
  ['staggered_fire', 'STAGGERED'],
  ['use_lag_pips', 'LAG PIPS'],
  ['use_single_pips', 'SINGLE PIP'],
  ['precision_lines', 'PRECISION'],
  ['magnified_ui', 'MAGNIFIED'],
];

export const WeaponsPanel: React.FC<{ frame: LiveTelemetryFrame | null; large?: boolean }> = ({ frame, large }) => {
  const t = useT();
  const w = frame?.weapons;
  const settings = (w?.settings ?? {}) as Record<string, boolean | undefined>;
  const gunfire = Number((frame?.forceFeedback as { gunfire?: number } | null)?.gunfire ?? 0);
  const list = w?.weapons ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1.5">
          {gunfire > 0.01 && <span className="ml-1 px-1.5 rounded bg-rose-500/30 text-rose-200 animate-pulse">{t('FIRING')}</span>}
        </div>
        <span className="text-[10px] font-mono text-cyan-200">
          {t('GROUP {n}', { n: (w?.preset_index ?? 0) + 1 })}
          {w?.preset_name ? ` · ${w.preset_name}` : ''}
        </span>
      </div>
      <div className={`space-y-1 ${large ? '' : ''}`}>
        {list.length === 0 && <div className="text-[10px] font-mono text-slate-600">{t('No weapons reported')}</div>}
        {list.map((wp, idx) => (
          <div
            key={`${wp.name}-${idx}`}
            className={`flex items-center justify-between font-mono bg-space-900/60 rounded px-2 border ${
              wp.contained_in_preset ? 'border-cyan-500/30' : 'border-slate-800 opacity-60'
            } ${large ? 'py-1.5 text-xs' : 'py-1 text-[10px]'}`}
          >
            <span className="truncate text-slate-200">{wp.name || t('Weapon {n}', { n: idx + 1 })}</span>
            <span className={wp.ready_to_fire ? 'text-emerald-400' : wp.is_powered ? 'text-amber-300' : 'text-slate-500'}>
              {wp.ready_to_fire ? t('READY') : wp.is_powered ? 'PWR' : 'OFF'}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(w?.countermeasures ?? []).map((cm, idx) => (
          <Chip key={idx} tone={(cm.amount ?? 0) > 0 ? 'cyan' : 'rose'}>
            {cleanEnum(cm.type, 'COUNTERMEASURE_TYPE_')}: {cm.amount ?? 0}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {AIM_SETTINGS.map(([key, label]) => (
          <span
            key={key}
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono border ${
              settings[key] ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200' : 'border-slate-800 text-slate-600'
            }`}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Doors / gear / VTOL / transformation / landed / lights chips
// ---------------------------------------------------------------------------
const DEPLOY = 'VEHICLE_COMPONENT_DEPLOYMENT_STATE_';
const deployTone = (s?: string) =>
  !s ? 'slate' : s.includes('DEPLOYED') && !s.includes('RETRACT') ? 'amber' : s.includes('ING') ? 'cyan' : 'slate';

export const VehicleStateChips: React.FC<{ frame: LiveTelemetryFrame | null; ground?: boolean }> = ({ frame, ground }) => {
  const t = useT();
  const v = frame?.vehicle?.state;
  const f = v?.flight?.state;
  const open = v?.doors?.open_state ?? '';
  const lock = v?.doors?.lock_state ?? '';
  const doorsOpen = open.includes('OPENED');
  const locked = lock.includes('LOCKED') && !lock.includes('UNLOCKED');
  const dep = (s?: string) => t(cleanEnum(s, DEPLOY));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {v?.master_mode?.mode && (
        <Chip tone="cyan">
          {cleanEnum(v.master_mode.mode, 'VEHICLE_MASTER_MODE_')}
          {v.master_mode.spooled ? ' · QT SPOOLED' : ''}
        </Chip>
      )}
      {!ground && <Chip tone={f?.is_landed ? 'emerald' : 'slate'}>{f?.is_landed ? t('LANDED') : t('IN FLIGHT')}</Chip>}
      {!ground && <Chip tone={deployTone(f?.gear)}>{t('GEAR')}: {dep(f?.gear)}</Chip>}
      {!ground && f?.vtol && <Chip tone={deployTone(f.vtol)}>VTOL: {dep(f.vtol)}</Chip>}
      {f?.transformation && <Chip tone={deployTone(f.transformation)}>{t('WINGS/MODE')}: {dep(f.transformation)}</Chip>}
      <Chip tone={doorsOpen ? 'amber' : 'slate'}>
        <DoorOpen className="inline w-3 h-3 mr-1 -mt-0.5" />
        {open ? t(cleanEnum(open, 'DOOR_OPEN_STATE_')) : t('DOORS') + ' —'}
      </Chip>
      <Chip tone={locked ? 'emerald' : 'amber'}>
        {locked ? <Lock className="inline w-3 h-3 mr-1 -mt-0.5" /> : <Unlock className="inline w-3 h-3 mr-1 -mt-0.5" />}
        {lock ? t(cleanEnum(lock, 'DOOR_LOCK_STATE_')) : 'LOCK —'}
      </Chip>
      <Chip tone={v?.lights_enabled ? 'amber' : 'slate'}>
        {t('LIGHTS')} {v?.lights_enabled ? 'ON' : 'OFF'}
      </Chip>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Quick actions (PTU 5.0 TriggerGameAction).
// ---------------------------------------------------------------------------
export interface QuickAction {
  id: string;
  /** English source label (translated at render). */
  label: string;
}

export const QuickActions: React.FC<{
  scPath: string;
  enabled: boolean;
  actions: QuickAction[];
}> = ({ scPath, enabled, actions }) => {
  const t = useT();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [available, setAvailable] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    desktopApi
      .listGameActions(scPath)
      .then((list) => alive && setAvailable(new Set(list.map((a) => a.actionName))))
      .catch(() => alive && setAvailable(null));
    return () => {
      alive = false;
    };
  }, [enabled, scPath]);

  if (!enabled) {
    return (
      <div className="text-[10px] font-mono text-slate-500">
        {t('Game actions need the PTU 5.0 API with actions enabled in user.cfg.')}
      </div>
    );
  }
  // If the game told us which actions exist, hide the ones it doesn't know.
  const shown = available ? actions.filter((a) => available.has(a.id)) : actions;
  if (!shown.length) {
    return <div className="text-[10px] font-mono text-slate-500">{t('No matching actions reported by the game.')}</div>;
  }

  const trigger = async (id: string) => {
    try {
      const res = await desktopApi.triggerGameAction(scPath, id, 0);
      setFeedback(`${id} → ${res.status}${res.message ? ` (${res.message})` : ''}`);
    } catch (e: unknown) {
      setFeedback(`${id} → ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {shown.map((a) => (
          <button
            key={a.id}
            onClick={() => void trigger(a.id)}
            className="px-3 py-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-[10px] font-mono font-bold text-cyan-200 active:scale-95 transition"
          >
            {t(a.label)}
          </button>
        ))}
      </div>
      {feedback && <div className="text-[10px] font-mono text-amber-300 truncate">{feedback}</div>}
    </div>
  );
};
