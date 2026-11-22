import React from 'react';
import { motion } from 'framer-motion';
import { Disc3 } from 'lucide-react';
import { useT } from '../../i18n/index.js';

interface ScanProgressBarProps {
  current: number;
  total: number;
  filename: string;
}

/** Non-blocking corner toast: the app (and window dragging) stays usable while logs are indexed. */
export const ScanProgressBar: React.FC<ScanProgressBarProps> = ({ current, total, filename }) => {
  const t = useT();
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-4 right-4 z-40 w-72 glass-panel hud-radius p-3 space-y-2 border border-cyan-500/30 pointer-events-none"
      role="status"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Disc3 className="w-4 h-4 text-quantum-cyan animate-spin shrink-0" />
          <span className="text-[11px] font-orbitron font-bold text-white tracking-wide truncate">{t('Indexing logs')}</span>
        </div>
        <span className="text-xs font-orbitron font-bold text-quantum-cyan tabular-nums">{percentage}%</span>
      </div>
      <div className="w-full h-1 bg-space-850 rounded-full overflow-hidden">
        <div className="h-full bg-quantum-cyan transition-[width] duration-200" style={{ width: `${percentage}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[9px] font-mono text-slate-500">
        <span className="truncate" title={filename}>
          {t(filename)}
        </span>
        <span className="shrink-0 tabular-nums">
          {current}/{total}
        </span>
      </div>
    </motion.div>
  );
};
