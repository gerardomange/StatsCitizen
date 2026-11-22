import React from 'react';
import type { LiveTelemetryFrame } from '../../types/telemetry.js';
import { actorHazards, annState } from '../hud/hudUtils.js';
import { useShipTheme } from '../../themes/ShipThemeContext.js';
import { useT } from '../../i18n/index.js';

type AlertKind = 'missile' | 'hit' | 'critical' | 'shields' | null;

export function frameAlert(frame: LiveTelemetryFrame | null): { kind: AlertKind; label: string } {
  if (!frame?.connected) return { kind: null, label: '' };
  const ann = frame.vehicle?.state?.annunciators ?? {};
  if (annState(ann.misl) === 'major') return { kind: 'missile', label: 'INCOMING MISSILE' };
  if (annState(ann.hit) === 'major') return { kind: 'hit', label: 'HIT TAKEN' };
  const critical = actorHazards(frame).find((h) => h.level === 'critical');
  if (critical) return { kind: 'critical', label: critical.title };
  if (annState(ann.shld) === 'major') return { kind: 'shields', label: 'SHIELDS CRITICAL' };
  return { kind: null, label: '' };
}

const STYLES: Record<Exclude<AlertKind, null>, { color: string; anim: string }> = {
  missile: { color: '244 63 94', anim: 'alert-pulse 0.5s ease-in-out infinite' },
  hit: { color: '244 63 94', anim: 'alert-pulse 0.9s ease-in-out infinite' },
  critical: { color: '244 63 94', anim: 'alert-pulse 1.3s ease-in-out infinite' },
  shields: { color: '245 158 11', anim: 'alert-pulse 1.1s ease-in-out infinite' },
};

/**
 * Pulsing border around the whole window for missile lock, hits, shield failure
 * and critical survival hazards (decompression, low O₂, critical health…).
 * Purely visual; never intercepts clicks.
 */
export const AlertFrame: React.FC<{ frame: LiveTelemetryFrame | null }> = ({ frame }) => {
  const { alertFrame } = useShipTheme();
  const t = useT();
  const { kind, label } = frameAlert(frame);
  if (!alertFrame || !kind) return null;
  const st = STYLES[kind];
  return (
    <div
      className="fixed inset-0 z-[90] pointer-events-none"
      style={{ ['--alert' as string]: st.color, animation: st.anim } as React.CSSProperties}
      aria-live="assertive"
    >
      <div
        className="absolute inset-0"
        style={{
          border: '3px solid rgb(var(--alert) / 0.9)',
          boxShadow: 'inset 0 0 60px 6px rgb(var(--alert) / 0.45)',
        }}
      />
      <div
        className="absolute left-1/2 bottom-3 -translate-x-1/2 px-3 py-1 rounded font-orbitron font-bold text-[11px] tracking-[0.3em] text-white"
        style={{ background: 'rgb(var(--alert) / 0.85)' }}
      >
        {t(label)}
      </div>
    </div>
  );
};
