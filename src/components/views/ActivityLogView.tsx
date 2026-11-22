import React, { useMemo, useState } from 'react';
import { Activity, Download, FileText, MapPin, Package, Search, ShieldCheck, Target, Wifi } from 'lucide-react';
import { ActivityCoverage, LiveTelemetryEvent, TelemetrySummary } from '../../types/telemetry.js';
import { GlassCard } from '../common/GlassCard.js';
import { useI18n, useT } from '../../i18n/index.js';

interface ActivityLogViewProps {
  summary: TelemetrySummary;
}

type FilterKey = 'all' | 'contract' | 'objective' | 'zone' | 'inventory' | 'system';
type MissionSummary = { id: string; name: string; status: 'active' | 'completed' | 'abandoned'; updatedAt: string; objectives: number };

const filterOptions: Array<{ id: FilterKey; label: string }> = [
  { id: 'all', label: 'All activity' },
  { id: 'contract', label: 'Contracts' },
  { id: 'objective', label: 'Objectives' },
  { id: 'zone', label: 'Zones' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'system', label: 'Shard changes' },
];

const categoryOf = (event: LiveTelemetryEvent): FilterKey => {
  if (event.category === 'contract' || event.category === 'objective' || event.category === 'zone' || event.category === 'inventory') return event.category;
  return event.type === 'shard' ? 'system' : 'all';
};

const eventKey = (event: LiveTelemetryEvent) => event.id ?? [event.timestamp, event.type, event.title, event.details].join('|');

const exportCsv = (events: LiveTelemetryEvent[]) => {
  const columns = ['timestamp', 'category', 'event', 'details', 'mission_id', 'objective_id', 'objective_state', 'zone', 'item', 'confirmed'];
  const rows = events.map((event) => [
    event.timestamp,
    categoryOf(event),
    event.title,
    event.details,
    event.missionId ?? '',
    event.objectiveId ?? '',
    event.objectiveState ?? '',
    event.zone ?? '',
    event.itemName ?? '',
    event.confirmed === undefined ? '' : event.confirmed ? 'yes' : 'no',
  ]);
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const contents = `\uFEFF${[columns, ...rows].map((row) => row.map((value) => escape(String(value))).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'statscitizen-activity-log.csv';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const CoverageCard: React.FC<{ label: string; count: number; icon: React.ElementType; tone: string }> = ({ label, count, icon: Icon, tone }) => {
  const t = useT();
  return (
  <GlassCard variant="default" className="min-h-[104px]">
    <div className="flex items-start justify-between gap-2">
      <div><div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">{t(label)}</div><div className="mt-2 text-2xl font-orbitron font-bold tabular-nums text-white">{count}</div><div className="mt-1 text-[9px] font-mono text-slate-500">{t('observed events')}</div></div>
      <Icon className={'h-5 w-5 ' + tone} />
    </div>
  </GlassCard>
  );
};

const statusStyle: Record<MissionSummary['status'], string> = {
  active: 'border-cyan-500/30 text-cyan-300',
  completed: 'border-emerald-500/30 text-emerald-300',
  abandoned: 'border-amber-500/30 text-amber-300',
};

const missionSummaries = (events: LiveTelemetryEvent[]): MissionSummary[] => {
  const missions = new Map<string, MissionSummary>();
  for (const event of [...events].reverse()) {
    if (!event.missionId) continue;
    const previous = missions.get(event.missionId);
    if (event.type === 'mission_accepted') {
      missions.set(event.missionId, {
        id: event.missionId,
        name: event.missionName || event.details || `Mission ${event.missionId}`,
        status: 'active',
        updatedAt: event.timestamp,
        objectives: previous?.objectives ?? 0,
      });
    } else if (event.type === 'mission_completed' || event.type === 'mission_abandoned') {
      missions.set(event.missionId, {
        id: event.missionId,
        name: previous?.name || event.missionName || `Mission ${event.missionId}`,
        status: event.type === 'mission_completed' ? 'completed' : 'abandoned',
        updatedAt: event.timestamp,
        objectives: previous?.objectives ?? 0,
      });
    } else if (event.type === 'objective_update') {
      missions.set(event.missionId, {
        id: event.missionId,
        name: previous?.name || `Mission ${event.missionId}`,
        status: previous?.status ?? 'active',
        updatedAt: event.timestamp,
        objectives: (previous?.objectives ?? 0) + 1,
      });
    }
  }
  return Array.from(missions.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const ActivityLogView: React.FC<ActivityLogViewProps> = ({ summary }) => {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const events = summary.activityEvents ?? [];
  const coverage: ActivityCoverage = summary.activityCoverage ?? { contracts: 0, objectives: 0, zones: 0, inventory: 0, shards: 0 };
  const missions = useMemo(() => missionSummaries(events), [events]);
  const zones = useMemo(() => {
    const totals = new Map<string, number>();
    for (const event of events) if (event.category === 'zone') totals.set(event.zone || event.details, (totals.get(event.zone || event.details) ?? 0) + 1);
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [events]);
  const filtered = useMemo(() => events.filter((event) => {
    const categoryMatch = filter === 'all' || categoryOf(event) === filter;
    const query = search.trim().toLowerCase();
    const textMatch = !query || [event.title, event.details, event.missionName, event.missionId, event.zone, event.itemName]
      .some((value) => value?.toLowerCase().includes(query));
    return categoryMatch && textMatch;
  }), [events, filter, search]);

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2.5 text-xl font-orbitron font-bold tracking-wider text-white"><FileText className="h-5 w-5 text-quantum-cyan" />{t('MISSION LOGBOOK')}</h2>
        <p className="mt-1 text-xs font-mono text-slate-400">{t('Contracts, objectives, zones, inventory and shard changes found in your logs.')}</p>
      </div>
      <button onClick={() => exportCsv(filtered)} disabled={!filtered.length} className="flex items-center justify-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-mono text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-4 w-4" />{t('Export CSV')}</button>
    </div>

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <CoverageCard label="Contracts" count={coverage.contracts} icon={Target} tone="text-quantum-cyan" />
      <CoverageCard label="Objective updates" count={coverage.objectives} icon={Activity} tone="text-violet-400" />
      <CoverageCard label="Zone transitions" count={coverage.zones} icon={MapPin} tone="text-amber-400" />
      <CoverageCard label="Inventory signals" count={coverage.inventory} icon={Package} tone="text-emerald-400" />
      <CoverageCard label="Shard changes" count={coverage.shards} icon={Wifi} tone="text-sky-400" />
    </div>

    <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
      <GlassCard variant="cyan" className="space-y-3 xl:col-span-3">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Target className="h-4 w-4 text-quantum-cyan" /><h3 className="text-xs font-orbitron font-bold tracking-wider text-white">{t('MISSION JOURNAL')}</h3></div><span className="text-[10px] font-mono text-slate-500">{t('{n} missions identified', { n: missions.length })}</span></div>
        {missions.length ? <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">{missions.map((mission) => <div key={mission.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-space-900/60 px-3 py-2.5"><div className="min-w-0"><div className="truncate text-xs font-semibold text-white">{mission.name}</div><div className="mt-1 truncate text-[9px] font-mono text-slate-500">{mission.id} · {t('{n} objective updates', { n: mission.objectives })} · {new Date(mission.updatedAt).toLocaleString(locale)}</div></div><span className={'shrink-0 rounded border px-2 py-1 text-[9px] font-mono uppercase ' + statusStyle[mission.status]}>{t(mission.status)}</span></div>)}</div> : <p className="py-8 text-center text-xs font-mono text-slate-500">{t('No contract acceptance or completion events were found in these logs.')}</p>}
      </GlassCard>

      <GlassCard variant="default" className="space-y-3 xl:col-span-2">
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-amber-400" /><h3 className="text-xs font-orbitron font-bold tracking-wider text-white">{t('ZONES OBSERVED')}</h3></div>
        <p className="text-[10px] leading-relaxed text-slate-400">{t('Jurisdiction and armistice notices describe zone transitions. They do not confirm crimes, fines or CrimeStat.')}</p>
        {zones.length ? <div className="space-y-2">{zones.slice(0, 7).map(([zone, count]) => <div key={zone} className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-space-900/60 px-3 py-2"><span className="truncate text-xs text-slate-200">{zone}</span><span className="shrink-0 text-[10px] font-mono text-amber-300">{t('{n} notices', { n: count })}</span></div>)}</div> : <p className="py-5 text-center text-xs font-mono text-slate-500">{t('No zone transition notifications were found.')}</p>}
      </GlassCard>
    </div>

    <GlassCard variant="default" className="p-0 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-800 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">{filterOptions.map((option) => <button key={option.id} onClick={() => setFilter(option.id)} className={'rounded border px-2.5 py-1.5 text-[10px] font-mono transition ' + (filter === option.id ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200' : 'border-slate-800 bg-space-900 text-slate-400 hover:text-white')}>{t(option.label)}</button>)}</div>
        <div className="relative w-full lg:w-72"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search activity…')} className="w-full rounded-lg border border-slate-700/80 bg-space-900 py-2 pl-8 pr-3 text-xs font-mono text-white placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none" /></div>
      </div>
      <div className="max-h-[540px] divide-y divide-slate-800/70 overflow-y-auto">
        {filtered.slice(0, 500).map((event) => <div key={eventKey(event)} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded border border-slate-700 px-1.5 py-0.5 text-[9px] font-mono uppercase text-slate-400">{t(categoryOf(event))}</span><span className="text-xs font-semibold text-white">{event.title}</span>{event.confirmed === false && <span className="text-[9px] font-mono uppercase text-amber-300">{t('request observed')}</span>}</div><p className="mt-1 break-words text-[10px] font-mono text-slate-400">{event.details}</p>{event.missionId && <p className="mt-1 text-[9px] font-mono text-slate-600">{t('Mission')} {event.missionId}{event.objectiveId ? ` · ${t('Objective')} ${event.objectiveId}` : ''}</p>}</div><time className="shrink-0 text-[10px] font-mono text-slate-500">{new Date(event.timestamp).toLocaleString(locale)}</time></div>)}
        {!filtered.length && <div className="p-12 text-center text-xs font-mono text-slate-500">{t('No matching activity. Empty trackers mean the logs did not contain a recognized event.')}</div>}
        {filtered.length > 500 && <div className="p-3 text-center text-[10px] font-mono text-slate-500">{t('Showing the latest 500 of {n} events. Filter or search to narrow it down.', { n: filtered.length })}</div>}
      </div>
    </GlassCard>

    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] font-mono leading-relaxed text-amber-100/80">{t('Counts only describe events visible in your logs. Repeated objective markers are deduplicated, and inventory requests are marked unconfirmed unless the log shows a storage update.')}</div>
  </div>;
};
