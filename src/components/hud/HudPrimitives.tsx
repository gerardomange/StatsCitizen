import React from 'react';
import { AlertTriangle, Siren } from 'lucide-react';
import { Hazard, TONE_BAR, TONE_TEXT, Tone, levelTone } from './hudUtils.js';
import { useT } from '../../i18n/index.js';

export const HudTitle: React.FC<{ icon?: React.FC<{ className?: string }>; children: React.ReactNode; right?: React.ReactNode }> = ({
  icon: Icon,
  children,
  right,
}) => (
  <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-2">
      {Icon && <Icon className="w-4 h-4 text-quantum-cyan" />}
      <h3 className="text-xs font-orbitron font-bold tracking-wider text-white uppercase">{children}</h3>
    </div>
    {right}
  </div>
);

export const VitalBar: React.FC<{
  label: string;
  value: number | null;
  display?: string;
  tone?: Tone;
  /** Use health-style thresholds (low = bad). Disable for "higher is worse" stats. */
  thresholds?: boolean;
  size?: 'sm' | 'lg';
}> = ({ label, value, display, tone = 'cyan', thresholds = true, size = 'sm' }) => {
  const t = thresholds ? levelTone(value, tone) : value === null ? 'slate' : tone;
  return (
    <div className="space-y-1">
      <div className={`flex items-center justify-between font-mono ${size === 'lg' ? 'text-xs' : 'text-[10px]'}`}>
        <span className="text-slate-400 uppercase">{label}</span>
        <span className={`tabular-nums ${size === 'lg' ? TONE_TEXT[t] + ' font-bold' : 'text-white'}`}>
          {display ?? (value !== null ? `${Math.round(value)}%` : '—')}
        </span>
      </div>
      <div
        className={`w-full rounded-full bg-space-900 overflow-hidden border border-slate-800 ${size === 'lg' ? 'h-2.5' : 'h-1.5'}`}
      >
        <div className={`h-full transition-all duration-200 ${TONE_BAR[t]}`} style={{ width: `${value ?? 0}%` }} />
      </div>
    </div>
  );
};

export const StatTile: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: Tone | 'white';
  size?: 'sm' | 'md' | 'lg';
  sub?: React.ReactNode;
  className?: string;
}> = ({ label, value, tone = 'white', size = 'md', sub, className = '' }) => {
  const sizes = { sm: 'text-xs', md: 'text-base', lg: 'text-2xl' };
  return (
    <div className={`hud-radius bg-space-900/70 border border-slate-800 p-2.5 ${className}`}>
      <div className="text-[9px] font-mono text-slate-500 uppercase flex items-center gap-1">{label}</div>
      <div
        className={`mt-1 font-orbitron font-bold tabular-nums ${sizes[size]} ${tone === 'white' ? 'text-white' : TONE_TEXT[tone]}`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[9px] font-mono text-slate-500">{sub}</div>}
    </div>
  );
};

export const Chip: React.FC<{ on?: boolean; tone?: Tone; children: React.ReactNode; title?: string; pulse?: boolean }> = ({
  on = true,
  tone = 'cyan',
  children,
  title,
  pulse,
}) => {
  const styles: Record<Tone, string> = {
    cyan: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
    emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
    rose: 'border-rose-500/60 bg-rose-500/20 text-rose-200',
    slate: 'border-slate-700 bg-space-900 text-slate-300',
  };
  return (
    <span
      title={title}
      className={`px-2 py-1 rounded border text-[10px] font-mono uppercase ${
        on ? styles[tone] : 'border-slate-800 bg-space-900 text-slate-500'
      } ${pulse ? 'animate-pulse' : ''}`}
    >
      {children}
    </span>
  );
};

export const HazardList: React.FC<{ hazards: Hazard[]; compact?: boolean }> = ({ hazards, compact }) => {
  const t = useT();
  if (!hazards.length) return null;
  return (
    <div className={compact ? 'flex flex-wrap gap-1.5' : 'grid grid-cols-1 sm:grid-cols-2 gap-2'}>
      {hazards.map((h) => {
        const critical = h.level === 'critical';
        const Icon = critical ? Siren : AlertTriangle;
        return compact ? (
          <Chip key={h.id} tone={critical ? 'rose' : 'amber'} pulse={critical} title={t(h.detail, h.vars)}>
            {t(h.title)}
          </Chip>
        ) : (
          <div
            key={h.id}
            className={`flex items-center gap-3 hud-radius border px-3 py-2 ${
              critical ? 'border-rose-500/70 bg-rose-500/15 animate-pulse' : 'border-amber-500/50 bg-amber-500/10'
            }`}
          >
            <Icon className={`w-5 h-5 shrink-0 ${critical ? 'text-rose-300' : 'text-amber-300'}`} />
            <div className="min-w-0">
              <div className={`text-xs font-orbitron font-bold ${critical ? 'text-rose-200' : 'text-amber-200'}`}>{t(h.title)}</div>
              <div className="text-[10px] font-mono text-slate-300 truncate">{t(h.detail, h.vars)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
