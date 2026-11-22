import React, { useState } from 'react';
import { TelemetrySummary } from '../../types/telemetry.js';
import { GlassCard } from '../common/GlassCard.js';
import { MetricWidget } from '../common/MetricWidget.js';
import { useI18n } from '../../i18n/index.js';
import {
  Clock,
  Coins,
  Rocket,
  AlertTriangle,
  Compass,
  Cpu,
  Share2,
  Check,
  Shield,
  Activity,
  MapPin,
  Download,
} from 'lucide-react';

interface OverviewViewProps {
  summary: TelemetrySummary;
}

export const OverviewView: React.FC<OverviewViewProps> = ({ summary }) => {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);

  const topShip = summary.ships[0];
  const recentCollision = summary.collisions[0];

  const handleCopyDossier = () => {
    const text = `🚀 PILOT DOSSIER // STATSCITIZEN
Callsign: ${summary.pilotCallsign}
Time Covered by Logs: ${summary.totalPlaytimeHours} Hours (${summary.totalSessions} Sessions; not verified active playtime)
Current Patch: ${summary.currentPatch}
Favorite Ship: ${topShip ? `${topShip.normalizedName} (${topShip.totalFlightHours}h)` : 'N/A'}
Total aUEC Spent: ${summary.totalAuecSpent.toLocaleString()} aUEC
Quantum Routes: ${summary.quantumRoutes.length} Computed
Black Box Crashes: ${summary.collisions.length} Recorded`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (contents: string, filename: string, mimeType: string) => {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportDossier = () => {
    // Exclude local install/log paths from a file intended to be shared.
    const { scInstallPath: _localPath, sessions, activityEvents: _localActivityEvents, ...publicSummary } = summary;
    const publicSessions = sessions.map(({ filePath: _filePath, ...session }) => session);
    downloadFile(
      JSON.stringify({ ...publicSummary, sessions: publicSessions }, null, 2),
      'statscitizen-dossier.json',
      'application/json;charset=utf-8',
    );
  };

  const exportPurchases = () => {
    const escapeCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ['timestamp', 'shop', 'item', 'category', 'quantity', 'unit_price_auec', 'total_auec'],
      ...summary.purchases.map((purchase) => [
        purchase.timestamp, purchase.shopName, purchase.cleanItemName, purchase.category,
        purchase.quantity, purchase.price, purchase.totalCost,
      ]),
    ];
    downloadFile(`\uFEFF${rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')}`, 'statscitizen-purchases.csv', 'text/csv;charset=utf-8');
  };

  return (
    <div className="space-y-6">
      {/* Top Hero Banner / Pilot Dossier Card */}
      <GlassCard variant="cyan" bracket className="bg-gradient-to-r from-space-900 via-space-850 to-space-900">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-quantum-blue/10 border-2 border-quantum-cyan flex items-center justify-center shadow-glow-cyan">
                <Shield className="w-8 h-8 text-quantum-cyan" />
              </div>
              <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-quantum-cyan text-space-950 uppercase">
                UEE
              </span>
            </div>

            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-orbitron font-extrabold text-white tracking-wider">
                  {t('PILOT')} // <span className="text-quantum-cyan">{summary.pilotCallsign.toUpperCase()}</span>
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-cyan-500/10 text-quantum-cyan border border-cyan-500/30">
                  {t('ACTIVE')}
                </span>
              </div>
              <p className="mt-1 text-xs font-mono text-slate-400">
                {summary.currentPatch}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <button
              onClick={exportDossier}
              className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-space-900/70 hover:bg-space-800 border border-slate-700 text-xs font-mono text-slate-200 transition-all"
              title={t('Export privacy-safe JSON dossier')}
            >
              <Download className="w-4 h-4" /> JSON
            </button>
            <button
              onClick={exportPurchases}
              className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-space-900/70 hover:bg-space-800 border border-slate-700 text-xs font-mono text-slate-200 transition-all"
              title={t('Export purchases as CSV')}
            >
              <Download className="w-4 h-4" /> CSV
            </button>
            <button
              onClick={handleCopyDossier}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-xs font-mono font-semibold text-quantum-cyan transition-all shadow-glow-cyan hover:scale-[1.02] active:scale-[0.98]"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>{t('Copied!')}</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4" />
                  <span>{t('Share pilot card')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Primary Telemetry Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricWidget
          label="Time Covered by Logs"
          value={summary.totalPlaytimeHours}
          unit="HOURS"
          subValue={t('{n} sessions (estimate; avg {avg}h)', { n: summary.totalSessions, avg: summary.averageSessionHours })}
          icon={Clock}
          variant="cyan"
        />

        <MetricWidget
          label="Financial Outlay"
          value={(summary.totalAuecSpent / 1_000_000).toFixed(1)}
          unit="M aUEC"
          subValue={t('{amount} aUEC across {n} purchases', { amount: summary.totalAuecSpent.toLocaleString(locale), n: summary.totalPurchasesCount })}
          icon={Coins}
          variant="amber"
        />

        <MetricWidget
          label="Primary Vessel"
          value={topShip ? topShip.normalizedName : t('None')}
          subValue={topShip ? t('{h}h logged ({n} sorties)', { h: topShip.totalFlightHours, n: topShip.sortiesCount }) : t('No flight records')}
          icon={Rocket}
          variant="emerald"
        />

        <MetricWidget
          label="Black Box Incidents"
          value={summary.collisions.length}
          unit="CRASHES"
          subValue={recentCollision ? t('Latest: {zone}', { zone: recentCollision.zone }) : t('No hull losses')}
          icon={AlertTriangle}
          variant="crimson"
        />
      </div>

      {/* Middle Layout: Favorite Ship Spotlight + Hardware & System Specs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Ships Spotlight */}
        <div className="lg:col-span-2">
          <GlassCard variant="cyan" className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-quantum-cyan" />
                <h3 className="font-orbitron font-bold text-sm text-white tracking-wide">
                  {t('TOP SHIPS')}
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {t('{n} ships logged', { n: summary.ships.length })}
              </span>
            </div>

            <div className="space-y-3">
              {summary.ships.slice(0, 4).map((ship, idx) => {
                const percentage =
                  summary.totalPlaytimeHours > 0
                    ? Math.min(100, Math.round((ship.totalFlightHours / summary.totalPlaytimeHours) * 100))
                    : 0;

                return (
                  <div
                    key={ship.name}
                    className="p-3.5 rounded-lg bg-space-900/70 border border-slate-800 hover:border-cyan-500/30 transition-all flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-5 h-5 rounded flex items-center justify-center bg-cyan-500/10 border border-cyan-500/30 text-xs font-mono font-bold text-quantum-cyan">
                          0{idx + 1}
                        </span>
                        <div>
                          <h4 className="text-sm font-semibold text-white tracking-wide">
                            {ship.normalizedName}
                          </h4>
                          <span className="text-[10px] font-mono text-slate-400">
                            {ship.manufacturer}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-orbitron font-bold text-white">
                          {ship.totalFlightHours}h
                        </span>
                        <div className="text-[10px] font-mono text-slate-400">
                          {t('{n} sorties', { n: ship.sortiesCount })}
                        </div>
                      </div>
                    </div>

                    {/* Flight Time Bar */}
                    <div className="w-full h-1.5 bg-space-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-quantum-blue rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </div>

        {/* Hardware & Client Telemetry */}
        <div className="space-y-6">
          <GlassCard variant="default" className="space-y-4">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-quantum-blue" />
              <h3 className="font-orbitron font-bold text-sm text-white tracking-wide">
                {t('SYSTEM SPECS')}
              </h3>
            </div>

            <div className="space-y-2.5 text-xs font-mono">
              <div className="p-2.5 rounded bg-space-900/60 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">CPU</span>
                <span className="text-slate-200 font-semibold">{summary.systemSpecs.cpu || 'AMD / Intel x86'}</span>
              </div>

              <div className="p-2.5 rounded bg-space-900/60 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">{t('Displays')}</span>
                <span className="text-slate-200 font-semibold">{summary.systemSpecs.displays || '1'}</span>
              </div>

              <div className="p-2.5 rounded bg-space-900/60 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">{t('Shards visited')}</span>
                <span className="text-quantum-cyan font-semibold">{summary.shardsCount}</span>
              </div>

              <div className="p-2.5 rounded bg-space-900/60 border border-slate-800/80">
                <span className="text-[10px] text-slate-500 uppercase block">{t('Quantum routes')}</span>
                <span className="text-quantum-blue font-semibold">{summary.quantumRoutes.length}</span>
              </div>
            </div>
          </GlassCard>

          {/* Quick Black Box Alert */}
          {recentCollision && (
            <GlassCard variant="crimson" className="space-y-2">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="w-4 h-4" />
                <h4 className="font-orbitron text-xs font-bold tracking-wider uppercase">
                  {t('LATEST COLLISION')}
                </h4>
              </div>
              <p className="text-xs text-slate-300">
                {recentCollision.normalizedVehicleName} · <span className="text-rose-400 font-semibold">{recentCollision.zone}</span>
              </p>
              <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                <span>{t('Part')}: {recentCollision.part}</span>
                <span>{t('Speed')}: {recentCollision.impactVelocity ? `${recentCollision.impactVelocity.magnitude.toFixed(1)} m/s` : 'N/A'}</span>
              </div>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
};
