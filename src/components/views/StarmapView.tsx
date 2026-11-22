import React, { useState } from 'react';
import { QuantumRouteRecord } from '../../types/telemetry.js';
import { GlassCard } from '../common/GlassCard.js';
import { useI18n } from '../../i18n/index.js';
import { Navigation, Compass, Search, MapPin, Orbit } from 'lucide-react';

interface StarmapViewProps {
  routes: QuantumRouteRecord[];
}

export const StarmapView: React.FC<StarmapViewProps> = ({ routes }) => {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');

  // Frequency aggregation
  const destTotals: Record<string, number> = {};
  routes.forEach((r) => {
    destTotals[r.cleanDestination] = (destTotals[r.cleanDestination] || 0) + 1;
  });

  const sortedDestinations = Object.entries(destTotals).sort((a, b) => b[1] - a[1]);

  const filteredRoutes = routes.filter((r) => {
    return (
      r.cleanDestination.toLowerCase().includes(search.toLowerCase()) ||
      r.destination.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-orbitron font-bold text-white tracking-wider flex items-center gap-2.5">
          <Navigation className="w-5 h-5 text-quantum-cyan" />
          {t('QUANTUM ROUTES')}
        </h2>
        <p className="text-xs font-mono text-slate-400 mt-1">
          {t('{n} quantum routes calculated in your logs', { n: routes.length })}
        </p>
      </div>

      {/* Top Waypoints Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {sortedDestinations.slice(0, 4).map(([dest, count], idx) => (
          <GlassCard key={dest} variant="cyan" bracket>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-400 uppercase">{t('Destination')} #0{idx + 1}</span>
              <Orbit className="w-4 h-4 text-quantum-cyan" />
            </div>
            <div className="mt-2 text-base font-orbitron font-bold text-white truncate" title={dest}>
              {dest}
            </div>
            <span className="text-[10px] font-mono text-quantum-cyan mt-1 block">
              {t('{n} quantum calculations', { n: count })}
            </span>
          </GlassCard>
        ))}
      </div>

      {/* Search and Navigation Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t('Search destination…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-space-900 border border-slate-700/80 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          <span className="text-[11px] font-mono text-slate-400">
            {t('Showing {a} of {b} routes', { a: filteredRoutes.length, b: routes.length })}
          </span>
        </div>

        <GlassCard variant="default" className="p-0 overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-space-900/90 text-slate-400 border-b border-slate-800 uppercase text-[10px] sticky top-0 z-10 backdrop-blur-md">
                <tr>
                  <th className="py-3 px-4">{t('Date / time')}</th>
                  <th className="py-3 px-4">{t('Destination')}</th>
                  <th className="py-3 px-4">{t('Internal code')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {filteredRoutes.map((r, idx) => (
                  <tr key={`${r.timestamp}_${idx}`} className="hover:bg-space-850/50 transition-colors">
                    <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                      {new Date(r.timestamp).toLocaleString(locale)}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-quantum-cyan flex items-center gap-2">
                      <MapPin className="w-3 h-3 text-quantum-blue" />
                      <span>{r.cleanDestination}</span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-400 text-[11px] font-mono">
                      {r.destination}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
