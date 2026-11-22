import React from 'react';
import { GlassCard } from './GlassCard.js';
import { useT } from '../../i18n/index.js';

interface MetricWidgetProps {
  label: string;
  value: string | number;
  unit?: string;
  subValue?: string;
  icon: React.FC<{ className?: string }>;
  variant?: 'cyan' | 'amber' | 'crimson' | 'emerald' | 'default';
}

export const MetricWidget: React.FC<MetricWidgetProps> = ({
  label,
  value,
  unit,
  subValue,
  icon: Icon,
  variant = 'cyan',
}) => {
  const t = useT();
  const iconColor = {
    cyan: 'text-quantum-cyan bg-cyan-500/10 border-cyan-500/30',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    crimson: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    default: 'text-slate-400 bg-slate-800 border-slate-700',
  }[variant];

  return (
    <GlassCard variant={variant} className="flex flex-col justify-between" bracket>
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-mono tracking-wider text-slate-400 uppercase font-medium">
          {t(label)}
        </span>
        <div className={`p-2 rounded-lg border ${iconColor}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-orbitron font-bold text-white tracking-tight">
            {value}
          </span>
          {unit && (
            <span className="text-xs font-mono font-semibold text-slate-400">
              {t(unit)}
            </span>
          )}
        </div>

        {subValue && (
          <p className="mt-1 text-[11px] font-mono text-slate-400 truncate">
            {subValue}
          </p>
        )}
      </div>
    </GlassCard>
  );
};
