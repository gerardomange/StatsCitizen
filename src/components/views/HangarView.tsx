import React, { useState } from 'react';
import { ShipUsage } from '../../types/telemetry.js';
import { GlassCard } from '../common/GlassCard.js';
import { useI18n } from '../../i18n/index.js';
import { Rocket, Search, Filter, Clock, Flame, Calendar } from 'lucide-react';

interface HangarViewProps {
  ships: ShipUsage[];
  scannedFilesCount: number;
  flightControlLines: number;
}

export const HangarView: React.FC<HangarViewProps> = ({ ships, scannedFilesCount, flightControlLines }) => {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');
  const [selectedMfg, setSelectedMfg] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'hours' | 'sorties' | 'name'>('hours');

  const manufacturers = ['all', ...Array.from(new Set(ships.map((s) => s.manufacturer)))];

  const filteredShips = ships
    .filter((ship) => {
      const matchSearch =
        ship.normalizedName.toLowerCase().includes(search.toLowerCase()) ||
        ship.name.toLowerCase().includes(search.toLowerCase());
      const matchMfg = selectedMfg === 'all' || ship.manufacturer === selectedMfg;
      return matchSearch && matchMfg;
    })
    .sort((a, b) => {
      if (sortBy === 'hours') return b.totalFlightTimeMs - a.totalFlightTimeMs;
      if (sortBy === 'sorties') return b.sortiesCount - a.sortiesCount;
      return a.normalizedName.localeCompare(b.normalizedName);
    });

  const totalTrackedHours = ships.reduce((acc, s) => acc + s.totalFlightHours, 0);

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-orbitron font-bold text-white tracking-wider flex items-center gap-2.5">
            <Rocket className="w-5 h-5 text-quantum-cyan" />
            {t('FLIGHT OPERATIONS')}
          </h2>
          <p className="text-xs font-mono text-slate-400 mt-1">
            {t('{ships} ships · {logs} logs scanned', { ships: ships.length, logs: scannedFilesCount })}
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t('Filter ship…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-space-900 border border-slate-700/80 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          {/* Mfg Select */}
          <select
            value={selectedMfg}
            onChange={(e) => setSelectedMfg(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-space-900 border border-slate-700/80 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500/50"
          >
            {manufacturers.map((m) => (
              <option key={m} value={m}>
                {m === 'all' ? t('All manufacturers') : m}
              </option>
            ))}
          </select>

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 rounded-lg bg-space-900 border border-slate-700/80 text-xs font-mono text-slate-300 focus:outline-none focus:border-cyan-500/50"
          >
            <option value="hours">{t('Sort: flight hours')}</option>
            <option value="sorties">{t('Sort: sorties')}</option>
            <option value="name">{t('Sort: name')}</option>
          </select>
        </div>
      </div>

      {/* Ships Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredShips.map((ship, idx) => {
          return (
            <GlassCard
              key={`${ship.name}_${idx}`}
              variant="cyan"
              className="group hover:border-cyan-500/40 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-cyan-500/10 text-quantum-cyan border border-cyan-500/20">
                    {ship.manufacturer}
                  </span>
                  <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                    <Clock className="w-3.5 h-3.5 text-quantum-cyan" />
                    <span className="font-orbitron font-bold text-white text-sm">
                      {ship.totalFlightHours}h
                    </span>
                  </div>
                </div>

                <div className="mt-3">
                  <h3 className="text-base font-bold text-white group-hover:text-quantum-cyan transition-colors tracking-wide">
                    {ship.normalizedName}
                  </h3>
                  <p className="text-[10px] font-mono text-slate-500 truncate mt-0.5" title={ship.name}>
                    ID: {ship.name}
                  </p>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-1.5 text-slate-300">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('{n} sorties', { n: ship.sortiesCount })}</span>
                </div>

                {ship.lastFlown && (
                  <div className="flex items-center gap-1 text-[10px] text-slate-500">
                    <Calendar className="w-3 h-3" />
                    <span>{new Date(ship.lastFlown).toLocaleDateString(locale)}</span>
                  </div>
                )}
              </div>
            </GlassCard>
          );
        })}
      </div>

      {filteredShips.length === 0 && (
        <div className="p-12 text-center glass-panel rounded-xl">
          <p className="text-sm font-mono text-slate-400">
            {ships.length > 0
              ? t('No ships match the current filters.')
              : flightControlLines > 0
                ? t('Found {lines} ship control lines in {logs} logs, but no flights could be paired. The log format may have changed.', { lines: flightControlLines, logs: scannedFilesCount })
                : t('No ship control events were found in {logs} logs. Make sure these are LIVE or PTU logs from recent sessions.', { logs: scannedFilesCount })}
          </p>
        </div>
      )}
    </div>
  );
};
