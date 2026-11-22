import React from 'react';
import { TONE_HEX, fracPct, levelTone } from './hudUtils.js';
import { useT } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// Shield hologram: top-down ship silhouette with one arc per shield face.
// Face order coming from the game is not documented; we assume
// FWD, AFT, LEFT, RIGHT, TOP, BOTTOM (6) / FWD, AFT, LEFT, RIGHT (4) / FWD, AFT (2).
// Hover a segment to see its raw index so the mapping can be verified in-game.
// ---------------------------------------------------------------------------

const LABELS: Record<number, string[]> = {
  1: ['OMNI'],
  2: ['FWD', 'AFT'],
  4: ['FWD', 'AFT', 'LEFT', 'RIGHT'],
  6: ['FWD', 'AFT', 'LEFT', 'RIGHT', 'TOP', 'BTM'],
};

/** Planar arcs (center angle in degrees, 0 = up/forward) for each label. */
const ARC_CENTER: Record<string, number> = { FWD: 0, RIGHT: 90, AFT: 180, LEFT: 270 };

function arcPath(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) {
  const p = (a: number) => {
    const r = ((a - 90) * Math.PI) / 180;
    return [cx + rx * Math.cos(r), cy + ry * Math.sin(r)];
  };
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${rx} ${ry} 0 ${large} 1 ${x1} ${y1}`;
}

export const ShieldHologram: React.FC<{ faces?: number[]; level?: number; hull?: number }> = ({ faces, level, hull }) => {
  const t = useT();
  const list = faces && faces.length ? faces : level !== undefined ? [level] : [];
  const labels = LABELS[list.length] ?? list.map((_, i) => `F${i + 1}`);
  const hullPct = fracPct(hull);
  const hullColor = TONE_HEX[levelTone(hullPct)];
  const cx = 100;
  const cy = 90;

  const planar: Array<{ label: string; v: number | null; idx: number; a0: number; a1: number }> = [];
  const vertical: Array<{ label: string; v: number | null; idx: number }> = [];

  list.forEach((raw, idx) => {
    const label = labels[idx] ?? `F${idx + 1}`;
    const v = fracPct(raw);
    if (label === 'OMNI') planar.push({ label, v, idx, a0: 0, a1: 359.9 });
    else if (label in ARC_CENTER) {
      const span = list.length === 2 ? 170 : 80;
      const c = label === 'AFT' && list.length === 2 ? 180 : ARC_CENTER[label];
      planar.push({ label, v, idx, a0: c - span / 2, a1: c + span / 2 });
    } else if (label === 'TOP' || label === 'BTM') vertical.push({ label, v, idx });
    else planar.push({ label, v, idx, a0: (idx * 360) / list.length + 4, a1: ((idx + 1) * 360) / list.length - 4 });
  });

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 180" className="w-full max-w-[260px]" role="img" aria-label="Shield faces">
        <defs>
          <filter id="shGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* grid ellipse */}
        <ellipse cx={cx} cy={cy} rx={78} ry={74} fill="none" stroke="rgb(var(--accent) / 0.12)" strokeDasharray="2 4" />
        {/* ship silhouette */}
        <path
          d={`M ${cx} ${cy - 46} L ${cx + 12} ${cy - 14} L ${cx + 40} ${cy + 18} L ${cx + 40} ${cy + 28} L ${cx + 12} ${cy + 22} L ${cx + 9} ${cy + 42} L ${cx - 9} ${cy + 42} L ${cx - 12} ${cy + 22} L ${cx - 40} ${cy + 28} L ${cx - 40} ${cy + 18} L ${cx - 12} ${cy - 14} Z`}
          fill={hullColor}
          fillOpacity={0.14}
          stroke={hullColor}
          strokeWidth={1.4}
        />
        <text x={cx} y={cy + 6} textAnchor="middle" className="font-mono" fontSize="13" fontWeight="bold" fill="#fff">
          {hullPct !== null ? `${Math.round(hullPct)}%` : '—'}
        </text>
        <text x={cx} y={cy + 17} textAnchor="middle" className="font-mono" fontSize="6" fill="#94a3b8">
          {t('HULL')}
        </text>

        {planar.map((f) => {
          const color = TONE_HEX[f.v === null ? 'slate' : f.v < 25 ? 'rose' : f.v < 60 ? 'amber' : 'cyan'];
          const opacity = f.v === null ? 0.3 : 0.35 + (f.v / 100) * 0.65;
          const mid = ((f.a0 + f.a1) / 2 - 90) * (Math.PI / 180);
          return (
            <g key={f.idx}>
              <title>{`${f.label} (face[${f.idx}]) · ${f.v !== null ? Math.round(f.v) + '%' : '—'}`}</title>
              <path d={arcPath(cx, cy, 70, 66, f.a0, f.a1)} fill="none" stroke="rgb(30 41 59)" strokeWidth={7} strokeLinecap="round" />
              <path
                d={arcPath(cx, cy, 70, 66, f.a0, f.a1)}
                fill="none"
                stroke={color}
                strokeOpacity={opacity}
                strokeWidth={7}
                strokeLinecap="round"
                filter="url(#shGlow)"
                style={{ transition: 'stroke 300ms, stroke-opacity 300ms' }}
              />
              {f.label !== 'OMNI' && (
                <text
                  x={cx + 86 * Math.cos(mid)}
                  y={cy + 82 * Math.sin(mid) + 3}
                  textAnchor="middle"
                  fontSize="7"
                  className="font-mono"
                  fill="#94a3b8"
                >
                  {f.v !== null ? Math.round(f.v) : '—'}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {vertical.length > 0 && (
        <div className="flex gap-2 -mt-1">
          {vertical.map((f) => (
            <span
              key={f.idx}
              title={`face[${f.idx}]`}
              className="px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-[9px] font-mono text-cyan-200"
            >
              {f.label} {f.v !== null ? `${Math.round(f.v)}%` : '—'}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 text-[10px] font-mono text-slate-400">
        {t('SHIELDS')}{' '}
        <span className="text-white tabular-nums">{fracPct(level) !== null ? `${Math.round(fracPct(level)!)}%` : '—'}</span>
        {list.length > 1 && <span className="text-slate-500"> · {t('{n} faces', { n: list.length })}</span>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Heading tape (compass strip)
// ---------------------------------------------------------------------------
const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

export const HeadingTape: React.FC<{ heading?: number }> = ({ heading }) => {
  const h = heading !== undefined && Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null;
  const pxPerDeg = 3;
  const span = 70; // degrees each side
  const ticks: number[] = [];
  if (h !== null) {
    const start = Math.floor((h - span) / 5) * 5;
    for (let d = start; d <= h + span; d += 5) ticks.push(d);
  }
  return (
    <div className="relative h-12 hud-radius bg-space-900/70 border border-slate-800 overflow-hidden">
      <div className="absolute inset-y-0 left-1/2" style={{ width: 0 }}>
        {ticks.map((d) => {
          const norm = ((d % 360) + 360) % 360;
          const x = (d - (h ?? 0)) * pxPerDeg;
          const major = norm % 15 === 0;
          const label = CARDINALS[norm] ?? (norm % 30 === 0 ? String(norm).padStart(3, '0') : '');
          return (
            <div key={d} className="absolute top-0" style={{ transform: `translateX(${x}px)` }}>
              <div className={`w-px ${major ? 'h-3 bg-slate-400' : 'h-1.5 bg-slate-600'}`} />
              {label && (
                <div
                  className={`absolute top-3.5 -translate-x-1/2 text-[9px] font-mono ${
                    CARDINALS[norm] ? 'text-cyan-300 font-bold' : 'text-slate-500'
                  }`}
                >
                  {label}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="absolute left-1/2 top-0 -translate-x-1/2 w-0 h-0 border-x-[5px] border-x-transparent border-t-[6px] border-t-quantum-cyan" />
      <div className="absolute left-1/2 bottom-1 -translate-x-1/2 px-1.5 rounded bg-space-950/90 border border-cyan-500/40 text-[11px] font-orbitron font-bold text-white tabular-nums">
        {h !== null ? `${Math.round(h).toString().padStart(3, '0')}°` : '---'}
      </div>
      <div className="absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-space-900 to-transparent pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-space-900 to-transparent pointer-events-none" />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Vertical speed indicator
// ---------------------------------------------------------------------------
export const VsiGauge: React.FC<{ vsi?: number; radarAlt?: number; max?: number }> = ({ vsi, radarAlt, max = 50 }) => {
  const v = vsi ?? 0;
  const clamped = Math.max(-max, Math.min(max, v));
  const fill = (Math.abs(clamped) / max) * 50;
  // Fast descent close to the ground is the dangerous case.
  const danger = v < -15 && radarAlt !== undefined && radarAlt < 300;
  const warn = v < -8 && radarAlt !== undefined && radarAlt < 600;
  const color = danger ? 'bg-rose-400' : warn ? 'bg-amber-400' : 'bg-quantum-cyan';
  return (
    <div className="flex items-stretch gap-2 h-full min-h-[110px]">
      <div className="relative w-3 hud-radius bg-space-900 border border-slate-800 overflow-hidden">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-500" />
        <div
          className={`absolute left-0 right-0 ${color} transition-all duration-150`}
          style={clamped >= 0 ? { bottom: '50%', height: `${fill}%` } : { top: '50%', height: `${fill}%` }}
        />
      </div>
      <div className="flex flex-col justify-between text-[9px] font-mono text-slate-500">
        <span>+{max}</span>
        <div>
          <div className="text-[9px] text-slate-500">VSI</div>
          <div className={`text-sm font-orbitron font-bold tabular-nums ${danger ? 'text-rose-300 animate-pulse' : 'text-white'}`}>
            {vsi !== undefined ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : '0.0'}
          </div>
          <div className="text-[9px]">m/s</div>
        </div>
        <span>-{max}</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Animated ECG line (FPS mode heart rate)
// ---------------------------------------------------------------------------
export const EcgLine: React.FC<{ bpm?: number; tone?: string }> = ({ bpm, tone = 'rgb(var(--accent))' }) => {
  const beat = bpm && bpm > 0 ? 60 / bpm : 0;
  return (
    <svg viewBox="0 0 200 40" className="w-full h-10" preserveAspectRatio="none">
      <polyline
        points="0,20 30,20 38,20 42,8 47,32 52,4 57,26 62,20 100,20 130,20 138,20 142,8 147,32 152,4 157,26 162,20 200,20"
        fill="none"
        stroke={tone}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeDasharray="400"
        style={
          beat
            ? { animation: `ecg-sweep ${Math.max(beat * 2, 0.6)}s linear infinite`, filter: 'drop-shadow(0 0 3px currentColor)' }
            : { opacity: 0.25 }
        }
      />
    </svg>
  );
};
