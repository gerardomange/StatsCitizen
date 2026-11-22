import React from 'react';
import { Coins, Gauge } from 'lucide-react';
import type { LiveTelemetryFrame } from '../../types/telemetry.js';
import { useI18n } from '../../i18n/index.js';
import { ManufacturerLogo } from '../common/ManufacturerLogo.js';
import { resolveManufacturer } from '../../themes/manufacturers.js';
import { HazardList, StatTile, VitalBar } from './HudPrimitives.js';
import { HeadingTape, ShieldHologram, VsiGauge } from './Instruments.js';
import { Annunciators, WeaponsPanel } from './HudPanels.js';
import {
  HUD_MODE_LABELS,
  HudMode,
  actorHazards,
  cleanEnum,
  formatAlt,
  fracPct,
  isSpaceAltitude,
  pct,
} from './hudUtils.js';

/** Dense single-screen HUD for a second monitor / small always-on-top window. */
export const CompactHudView: React.FC<{ frame: LiveTelemetryFrame | null; mode: HudMode }> = ({ frame, mode }) => {
  const { t, locale } = useI18n();
  const a = frame?.actor;
  const v = frame?.vehicle?.state;
  const ins = v?.flight?.instruments;
  const hazards = actorHazards(frame);
  const vehicleMode = mode === 'pilot' || mode === 'crew' || mode === 'gunner' || mode === 'ground';
  const theme = resolveManufacturer(v?.manufacturer, v?.class_name);
  const delta = frame?.sessionMetrics?.uecDelta ?? 0;

  if (mode === 'offline') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center font-mono text-xs text-slate-500">
        <div className="text-sm font-orbitron text-slate-300">{t('WAITING FOR TELEMETRY')}</div>
        {t('Launch Star Citizen with live telemetry enabled.')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Identity row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {vehicleMode && <ManufacturerLogo theme={theme} className="w-7 h-7 shrink-0 text-quantum-cyan" />}
          <div className="min-w-0">
            <div className="text-[9px] font-mono text-cyan-300/80 tracking-widest uppercase truncate">
              {vehicleMode ? theme.osName : 'mobiGlas'} · {t(HUD_MODE_LABELS[mode])}
            </div>
            <div className="text-sm font-orbitron font-bold text-white truncate">
              {vehicleMode ? (v?.class_name ?? v?.name ?? '—').replace(/_/g, ' ') : t(HUD_MODE_LABELS[mode])}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono shrink-0">
          <Coins className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-white font-bold tabular-nums">
            {a?.state?.uec_balance !== undefined ? a.state.uec_balance.toLocaleString(locale) : '—'}
          </span>
          <span className={`tabular-nums ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {delta >= 0 ? '+' : ''}
            {delta.toLocaleString(locale)}
          </span>
        </div>
      </div>

      <HazardList hazards={hazards} compact />

      {vehicleMode ? (
        <>
          <div className="grid grid-cols-[minmax(150px,200px)_1fr] gap-3">
            <div className="hud-radius bg-space-900/40 border border-slate-800 p-2">
              <ShieldHologram faces={v?.shields?.faces} level={v?.shields?.level} hull={v?.health} />
            </div>

            {mode === 'gunner' ? (
              <WeaponsPanel frame={frame} large />
            ) : (
              <div className="space-y-2">
                <HeadingTape heading={ins?.heading} />
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    <StatTile
                      label={
                        <>
                          <Gauge className="w-3 h-3" /> {mode === 'ground' ? 'km/h' : 'm/s'}
                        </>
                      }
                      value={Math.round((ins?.speed ?? 0) * (mode === 'ground' ? 3.6 : 1))}
                      size="lg"
                    />
                    {mode === 'ground' ? (
                      <StatTile label="Master" value={cleanEnum(v?.master_mode?.mode, 'VEHICLE_MASTER_MODE_')} size="sm" tone="cyan" />
                    ) : (
                      <StatTile
                        label={isSpaceAltitude(ins?.altitude) ? t('Altitude') : t('Radar alt')}
                        value={isSpaceAltitude(ins?.altitude) ? 'SPACE' : formatAlt(ins?.radar_altitude)}
                        tone="cyan"
                      />
                    )}
                    <StatTile
                      label="G"
                      value={(ins?.g_meter?.current ?? 0).toFixed(1)}
                      tone={Math.abs(ins?.g_meter?.current ?? 0) > 6 ? 'amber' : 'white'}
                    />
                  </div>
                  {mode !== 'ground' && !isSpaceAltitude(ins?.altitude) && (
                    <VsiGauge vsi={ins?.vertical_speed_indicator} radarAlt={ins?.radar_altitude} />
                  )}
                </div>
                {mode !== 'ground' && (
                  <div className="grid grid-cols-3 gap-2">
                    <VitalBar label="H₂" value={fracPct(ins?.hydrogen_fuel)} tone="emerald" />
                    <VitalBar label="QT" value={fracPct(ins?.quantum_fuel)} tone="cyan" />
                    <VitalBar
                      label={ins?.boost?.critical ? t('Boost CRITICAL') : 'Boost'}
                      value={fracPct(ins?.boost?.reserves)}
                      tone={ins?.boost?.critical ? 'rose' : 'cyan'}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <Annunciators ann={v?.annunciators} />
          <div className="grid grid-cols-4 gap-3 pt-2 border-t border-slate-800">
            <VitalBar label="HP" value={pct(a?.vitals?.health)} tone="emerald" />
            <VitalBar label="O₂" value={pct(a?.vitals?.oxygen)} tone="cyan" />
            <VitalBar label={t('FOOD')} value={pct(a?.vitals?.hunger)} tone="amber" />
            <VitalBar label={t('WATER')} value={pct(a?.vitals?.thirst)} tone="cyan" />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2.5 hud-radius bg-space-900/40 border border-slate-800 p-3">
            <VitalBar label={t('Health')} value={pct(a?.vitals?.health)} tone="emerald" size="lg" />
            <VitalBar label={t('Oxygen')} value={pct(a?.vitals?.oxygen)} tone="cyan" size="lg" />
            <VitalBar label={t('Hunger')} value={pct(a?.vitals?.hunger)} tone="amber" size="lg" />
            <VitalBar label={t('Thirst')} value={pct(a?.vitals?.thirst)} tone="cyan" size="lg" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="BPM" value={a?.vitals?.heart_rate ? Math.round(a.vitals.heart_rate) : '—'} size="lg" />
            <StatTile label={t('Pressure')} value={(a?.vitals?.pressure ?? 0).toFixed(2)} sub="atm" />
            <StatTile
              label={t('Outside temp')}
              value={a?.environment?.external_temperature !== undefined ? a.environment.external_temperature.toFixed(0) : '—'}
              sub="°C"
            />
            <StatTile
              label={t('Atmosphere')}
              value={a?.environment?.breathable_atmosphere ? 'OK' : t('SEALED')}
              tone={a?.environment?.breathable_atmosphere ? 'emerald' : 'amber'}
              size="sm"
            />
          </div>
        </div>
      )}
    </div>
  );
};
