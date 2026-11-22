import React, { useState } from 'react';
import { PurchaseRecord } from '../../types/telemetry.js';
import { GlassCard } from '../common/GlassCard.js';
import { useI18n } from '../../i18n/index.js';
import { CreditCard, ShoppingBag, Search, Filter, ArrowUpDown } from 'lucide-react';

interface EconomyViewProps {
  purchases: PurchaseRecord[];
  totalSpent: number;
}

export const EconomyView: React.FC<EconomyViewProps> = ({ purchases, totalSpent }) => {
  const { t, locale } = useI18n();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filteredPurchases = purchases.filter((p) => {
    const matchSearch =
      p.cleanItemName.toLowerCase().includes(search.toLowerCase()) ||
      p.shopName.toLowerCase().includes(search.toLowerCase()) ||
      p.itemName.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === 'all' || p.category === categoryFilter;
    return matchSearch && matchCat;
  });

  // Calculate statistics
  const totalItems = purchases.reduce((acc, p) => acc + p.quantity, 0);
  const mostExpensive = purchases.length > 0
    ? [...purchases].sort((a, b) => b.totalCost - a.totalCost)[0]
    : null;

  // Shop breakdown
  const shopTotals: Record<string, number> = {};
  purchases.forEach((p) => {
    shopTotals[p.shopName] = (shopTotals[p.shopName] || 0) + p.totalCost;
  });
  const topShop = Object.entries(shopTotals).sort((a, b) => b[1] - a[1])[0];

  const categoryBadges: Record<string, string> = {
    weapons: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    ammo: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    armor: 'bg-cyan-500/10 text-quantum-cyan border-cyan-500/30',
    components: 'bg-quantum-blue/10 text-quantum-blue border-quantum-blue/30',
    consumable: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    other: 'bg-slate-700/30 text-slate-400 border-slate-700',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-orbitron font-bold text-white tracking-wider flex items-center gap-2.5">
          <CreditCard className="w-5 h-5 text-amber-400" />
          {t('FINANCIAL LEDGER')}
        </h2>
        <p className="text-xs font-mono text-slate-400 mt-1">
          {t('Equipment, weapon and component purchases found in your logs')}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard variant="amber" bracket>
          <span className="text-[10px] font-mono text-slate-400 uppercase">{t('Total spent')}</span>
          <div className="mt-2 text-2xl font-orbitron font-bold text-amber-400">
            {totalSpent.toLocaleString(locale)} <span className="text-xs font-mono text-slate-400">aUEC</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500 mt-1 block">
            {t('Across {n} purchases', { n: purchases.length })}
          </span>
        </GlassCard>

        <GlassCard variant="cyan" bracket>
          <span className="text-[10px] font-mono text-slate-400 uppercase">{t('Items acquired')}</span>
          <div className="mt-2 text-2xl font-orbitron font-bold text-white">
            {totalItems.toLocaleString(locale)} <span className="text-xs font-mono text-slate-400">{t('UNITS')}</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500 mt-1 block">
            {t('Ammo, armor & components')}
          </span>
        </GlassCard>

        <GlassCard variant="emerald" bracket>
          <span className="text-[10px] font-mono text-slate-400 uppercase">{t('Biggest purchase')}</span>
          <div className="mt-2 text-lg font-orbitron font-bold text-white truncate" title={mostExpensive?.cleanItemName}>
            {mostExpensive ? mostExpensive.totalCost.toLocaleString(locale) : 0} <span className="text-xs font-mono text-slate-400">aUEC</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 truncate mt-1 block" title={mostExpensive?.cleanItemName}>
            {mostExpensive?.cleanItemName || 'N/A'}
          </span>
        </GlassCard>

        <GlassCard variant="default" bracket>
          <span className="text-[10px] font-mono text-slate-400 uppercase">{t('Top shop')}</span>
          <div className="mt-2 text-sm font-semibold text-white truncate" title={topShop ? topShop[0] : 'N/A'}>
            {topShop ? topShop[0] : 'N/A'}
          </div>
          <span className="text-[10px] font-mono text-amber-400 mt-1 block">
            {topShop ? t('{n} aUEC spent', { n: topShop[1].toLocaleString(locale) }) : ''}
          </span>
        </GlassCard>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={t('Search item, shop, category…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-space-900 border border-slate-700/80 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Category Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          {['all', 'weapons', 'ammo', 'armor', 'components', 'consumable'].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 rounded text-xs font-mono font-medium uppercase transition-all ${
                categoryFilter === cat
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-glow-amber/10'
                  : 'bg-space-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {t(cat)}
            </button>
          ))}
        </div>
      </div>

      {/* Transaction Table */}
      <GlassCard variant="default" className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-space-900/90 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
              <tr>
                <th className="py-3 px-4">{t('Date / time')}</th>
                <th className="py-3 px-4">{t('Shop')}</th>
                <th className="py-3 px-4">{t('Item')}</th>
                <th className="py-3 px-4">{t('Category')}</th>
                <th className="py-3 px-4 text-center">{t('Qty')}</th>
                <th className="py-3 px-4 text-right">{t('Unit price')}</th>
                <th className="py-3 px-4 text-right">{t('Total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {filteredPurchases.map((p) => (
                <tr key={p.id} className="hover:bg-space-850/50 transition-colors">
                  <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                    {new Date(p.timestamp).toLocaleString(locale)}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-white truncate max-w-[180px]">
                    {p.shopName}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-semibold text-slate-100">{p.cleanItemName}</div>
                    <div className="text-[9px] text-slate-500 truncate max-w-[200px]" title={p.itemName}>
                      {p.itemName}
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[9px] font-semibold uppercase border ${
                        categoryBadges[p.category] || categoryBadges.other
                      }`}
                    >
                      {t(p.category)}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-center font-bold text-white">
                    {p.quantity}
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-400">
                    {p.price.toLocaleString(locale)} aUEC
                  </td>
                  <td className="py-2.5 px-4 text-right font-orbitron font-bold text-amber-400">
                    {p.totalCost.toLocaleString(locale)} aUEC
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredPurchases.length === 0 && (
          <div className="p-10 text-center text-xs font-mono text-slate-500">
            {t('No transactions match the current filters.')}
          </div>
        )}
      </GlassCard>
    </div>
  );
};
