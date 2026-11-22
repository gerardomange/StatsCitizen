import React from 'react';
import { FatalCollisionRecord } from '../../types/telemetry.js';
import { GlassCard } from '../common/GlassCard.js';
import { useI18n } from '../../i18n/index.js';
import { AlertTriangle, Gauge, ShieldAlert, MapPin, Crosshair } from 'lucide-react';

interface BlackBoxViewProps {
  collisions: FatalCollisionRecord[];
}

export const BlackBoxView: React.FC<BlackBoxViewProps> = ({ collisions }) => {
  const { t, locale } = useI18n();
  // Calculate analytics
  const zones: Record<string, number> = {};
  const shipLosses: Record<string, number> = {};

  collisions.forEach((c) => {
    zones[c.zone] = (zones[c.zone] || 0) + 1;
    shipLosses[c.normalizedVehicleName] = (shipLosses[c.normalizedVehicleName] || 0) + 1;
  });

  const topCrashZone = Object.entries(zones).sort((a, b) => b[1] - a[1])[0];
  const mostCrashedShip = Object.entries(shipLosses).sort((a, b) => b[1] - a[1])[0];

  const highestVelocity = collisions.length > 0
    ? [...collisions].sort((a, b) => (b.impactVelocity?.magnitude || 0) - (a.impactVelocity?.magnitude || 0))[0]
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-orbitron font-bold text-white tracking-wider flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-rose-500 animate-pulse" />
          {t('BLACK BOX')}
        </h2>
        <p className="text-xs font-mono text-slate-400 mt-1">
          {t('Fatal collisions, impact zones and crash vectors from your logs')}
        </p>
      </div>

      {/* Analytics Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard variant="crimson" bracket>
          <span className="text-[10px] font-mono text-rose-400 uppercase">{t('Fatal collisions')}</span>
          <div className="mt-2 text-2xl font-orbitron font-bold text-white">
            {collisions.length} <span className="text-xs font-mono text-rose-400">{t('EVENTS')}</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 mt-1 block">
            {t('Hull losses recorded')}
          </span>
        </GlassCard>

        <GlassCard variant="default" bracket>
          <span className="text-[10px] font-mono text-slate-400 uppercase">{t('Most dangerous zone')}</span>
          <div className="mt-2 text-lg font-orbitron font-bold text-rose-400 truncate">
            {topCrashZone ? topCrashZone[0] : t('None')}
          </div>
          <span className="text-[10px] font-mono text-slate-400 mt-1 block">
            {topCrashZone ? t('{n} fatal crashes', { n: topCrashZone[1] }) : t('Zero incidents')}
          </span>
        </GlassCard>

        <GlassCard variant="default" bracket>
          <span className="text-[10px] font-mono text-slate-400 uppercase">{t('Highest impact speed')}</span>
          <div className="mt-2 text-2xl font-orbitron font-bold text-white">
            {highestVelocity?.impactVelocity ? highestVelocity.impactVelocity.magnitude.toFixed(1) : 0}
            <span className="text-xs font-mono text-slate-400 ml-1">m/s</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 mt-1 block">
            {highestVelocity ? highestVelocity.normalizedVehicleName : ''}
          </span>
        </GlassCard>

        <GlassCard variant="default" bracket>
          <span className="text-[10px] font-mono text-slate-400 uppercase">{t('Most lost ship')}</span>
          <div className="mt-2 text-lg font-semibold text-white truncate">
            {mostCrashedShip ? mostCrashedShip[0] : t('None')}
          </div>
          <span className="text-[10px] font-mono text-rose-400 mt-1 block">
            {mostCrashedShip ? t('{n} hull losses', { n: mostCrashedShip[1] }) : ''}
          </span>
        </GlassCard>
      </div>

      {/* Crash Incident Log Feed */}
      <div className="space-y-3">
        <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
          {t('Incident history')}
        </h3>

        {collisions.map((c, idx) => {
          return (
            <GlassCard
              key={`${c.timestamp}_${idx}`}
              variant="crimson"
              className="p-4 hover:border-rose-500/40 transition-all"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30">
                    <ShieldAlert className="w-5 h-5 text-rose-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white font-orbitron tracking-wide">
                        {c.normalizedVehicleName}
                      </h4>
                      <span className="px-2 py-0.2 rounded text-[9px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        {c.zone}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 flex items-center gap-3 mt-1">
                      <span>{t('Impact point')}: <span className="text-slate-200 font-semibold">{c.part}</span></span>
                      <span>•</span>
                      <span>{t('You were piloting')}: <span className="text-slate-200 font-semibold">{c.wasPilot ? t('YES') : t('NO')}</span></span>
                    </div>
                  </div>
                </div>

                <div className="text-right w-full sm:w-auto">
                  {c.impactVelocity && (
                    <div className="flex items-center sm:justify-end gap-1.5 text-rose-400 font-orbitron text-sm font-bold">
                      <Gauge className="w-4 h-4" />
                      <span>{c.impactVelocity.magnitude.toFixed(1)} m/s</span>
                    </div>
                  )}
                  <span className="text-[10px] font-mono text-slate-500 block mt-0.5">
                    {new Date(c.timestamp).toLocaleString(locale)}
                  </span>
                </div>
              </div>

              {/* Vector Breakdown */}
              {c.impactVelocity && (
                <div className="mt-3 pt-2.5 border-t border-rose-950/60 flex items-center gap-4 text-[10px] font-mono text-slate-400">
                  <span className="text-slate-500 uppercase">{t('Impact vector')}:</span>
                  <span>X: <span className="text-slate-300">{c.impactVelocity.x.toFixed(2)}</span></span>
                  <span>Y: <span className="text-slate-300">{c.impactVelocity.y.toFixed(2)}</span></span>
                  <span>Z: <span className="text-slate-300">{c.impactVelocity.z.toFixed(2)}</span></span>
                </div>
              )}
            </GlassCard>
          );
        })}

        {collisions.length === 0 && (
          <div className="p-12 text-center glass-panel rounded-xl">
            <p className="text-sm font-mono text-slate-400">
              {t('Clean record: no fatal collisions in your logs.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
