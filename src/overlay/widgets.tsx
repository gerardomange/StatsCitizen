// Overlay widgets. Every widget is laid out in `em`, and WidgetBox sets the font-size from the
// box it gets, so the same component works inside a full layout, as its own OBS source at any
// size, and in the editor preview.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveTelemetryEvent } from '../types/telemetry.js';
import { getThemeById, resolveManufacturer, type ManufacturerTheme } from '../themes/manufacturers.js';
import { cockpitAudio } from '../services/cockpitAudio.js';
import { fracPct, pct, formatAlt } from '../components/hud/hudUtils.js';
import type { Contract, Moment, MomentKind, WidgetType } from './types.js';
import {
  contractFilter,
  fmtAgo,
  fmtClock,
  fmtCompact,
  fmtInt,
  fmtSigned,
  masterModeLabel,
  opt,
  shipDisplayName,
  sessionDelta,
  useNow,
  useOv,
  useTween,
} from './util.js';

export type Variant = 'card' | 'strip' | 'tall';

export interface WidgetProps {
  variant: Variant;
  options: Record<string, unknown>;
}

export interface OptionDef {
  key: string;
  label: string;
  type: 'bool' | 'number' | 'text' | 'select';
  default: unknown;
  choices?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
}

export interface WidgetDef {
  label: string;
  description: string;
  /** Design size (px at 16px font) per variant. card is required. */
  variants: Partial<Record<Variant, { w: number; h: number }>> & { card: { w: number; h: number } };
  options: OptionDef[];
  Comp: React.FC<WidgetProps>;
}

// ------------------------------------------------------------------ shared bits

const Panel: React.FC<{ title?: string; right?: React.ReactNode; className?: string; children: React.ReactNode }> = ({
  title,
  right,
  className = '',
  children,
}) => (
  <div className={`ov-panel ${className}`}>
    {title !== undefined && (
      <div className="ov-title">
        <span>{title}</span>
        {right !== undefined && <span className="ov-title-right">{right}</span>}
      </div>
    )}
    <div className="ov-body">{children}</div>
  </div>
);

const Bar: React.FC<{ value: number | null; tone?: 'accent' | 'good' | 'warn' | 'bad'; shine?: boolean }> = ({
  value,
  tone = 'accent',
  shine,
}) => (
  <div className={`ov-bar ${shine ? 'ov-shine' : ''}`}>
    <i className={`ov-tone-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
  </div>
);

const levelTone = (v: number | null, warnBelow = 50, badBelow = 25) =>
  v === null ? 'accent' : v < badBelow ? 'bad' : v < warnBelow ? 'warn' : 'good';

const Sparkline: React.FC<{ points: Array<[number, number]> }> = ({ points }) => {
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const t0 = points[0][0];
    const t1 = points[points.length - 1][0] || t0 + 1;
    const vs = points.map((p) => p[1]);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const span = hi - lo || 1;
    const xy = points.map(([t, v]) => [((t - t0) / (t1 - t0 || 1)) * 100, 28 - ((v - lo) / span) * 26]);
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    return { line, area: `${line} L100 30 L0 30 Z`, end: xy[xy.length - 1] };
  }, [points]);
  if (!path) return <div className="ov-spark ov-spark-empty" />;
  return (
    <svg className="ov-spark" viewBox="0 0 100 30" preserveAspectRatio="none">
      <path d={path.area} className="ov-spark-area" />
      <path d={path.line} className="ov-spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

// ------------------------------------------------------------------ contracts

const objectiveKind = (state: string) =>
  /complete|success/.test(state) ? 'done' : /fail|abandon/.test(state) ? 'failed' : 'open';

const contractName = (c: Contract, t: (s: string) => string) =>
  c.name?.trim() || `${t('Contract')} ${c.id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`;

const RECENT_OBJECTIVE_MS = 60_000;

/** Panels that shrink to their content (up to the widget box) instead of filling it. */
const fitPanelClass = (options: Record<string, unknown>) =>
  opt(options, 'fitHeight', true) ? `ov-autoh ${opt<string>(options, 'growFrom', 'top') === 'bottom' ? 'ov-autoh-bottom' : ''}` : '';

const Contracts: React.FC<WidgetProps> = ({ variant, options }) => {
  const { feed, t, locale } = useOv();
  const now = useNow(1000);
  const max = opt(options, 'maxContracts', 2);
  const showObjectives = opt(options, 'showObjectives', true);
  const showTimer = opt(options, 'showTimer', true);
  const showReward = opt(options, 'showReward', true);
  const keepCompleted = opt(options, 'keepCompletedObjectives', false);
  const fitClass = fitPanelClass(options);
  // Like the in-game HUD: open objectives the game is showing, plus ones just completed.
  const visibleObjectives = (c: Contract) =>
    c.objectives.filter(
      (o) =>
        !o.hidden &&
        (objectiveKind(o.state) !== 'done' || keepCompleted || now - Date.parse(o.updatedAt) < RECENT_OBJECTIVE_MS)
    );
  const shown = feed.contracts.filter(contractFilter(options));
  const list = shown
    .filter((c) => c.status === 'active' || (c.endedAt && now - Date.parse(c.endedAt) < 45_000))
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1))
    .slice(0, Math.max(1, max));
  const activeCount = shown.filter((c) => c.status === 'active').length;

  const meta = (c: Contract) => {
    const counted = c.objectives.filter((o) => !o.hidden || objectiveKind(o.state) === 'done');
    const done = counted.filter((o) => objectiveKind(o.state) === 'done').length;
    const elapsed = (c.endedAt ? Date.parse(c.endedAt) : now) - Date.parse(c.acceptedAt);
    return (
      <div className="ov-contract-meta">
        {showTimer && <span className="ov-mono">⏱ {fmtClock(elapsed)}</span>}
        {counted.length > 0 && (
          <span>
            {done}/{counted.length}
          </span>
        )}
        {showReward && c.reward ? <span className="ov-good ov-mono">+{fmtInt(c.reward, locale)} aUEC</span> : null}
      </div>
    );
  };

  if (variant === 'strip') {
    const c = list[0];
    return (
      <Panel className="ov-strip">
        <div className="ov-strip-row">
          <span className="ov-kicker">{t('Contract')}</span>
          {c ? (
            <>
              <span className={`ov-contract-name ${c.status !== 'active' ? `ov-${c.status}` : ''}`}>{contractName(c, t)}</span>
              {c.status === 'completed' && <span className="ov-stamp">{t('Complete')}</span>}
              {meta(c)}
            </>
          ) : (
            <span className="ov-muted">{t('No active contracts')}</span>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={t('Active contracts')} right={<span className="ov-mono">{activeCount}</span>} className={fitClass}>
      {list.length === 0 && <div className="ov-muted ov-empty">{t('No active contracts')}</div>}
      {list.map((c, i) => {
        let openSeen = false;
        return (
          <div key={c.id} className={`ov-contract ov-${c.status}`}>
            <div className="ov-contract-head">
              <span className="ov-contract-name">{contractName(c, t)}</span>
              {c.status === 'completed' && <span className="ov-stamp">{t('Complete')}</span>}
              {c.status === 'abandoned' && <span className="ov-stamp ov-stamp-bad">{t('Abandoned')}</span>}
              {c.status === 'failed' && <span className="ov-stamp ov-stamp-bad">{t('Failed')}</span>}
            </div>
            {meta(c)}
            {showObjectives && c.status === 'active' && (i === 0 || variant === 'tall') && (
              <div className="ov-objectives">
                {visibleObjectives(c).map((o, n) => {
                  const kind = objectiveKind(o.state);
                  const current = kind === 'open' && !openSeen;
                  if (current) openSeen = true;
                  return (
                    <div key={o.id} className={`ov-obj ov-obj-${kind} ${current ? 'ov-obj-current' : ''}`}>
                      <i />
                      <span className="ov-obj-text">{o.text || t('Objective {n}', { n: n + 1 })}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
};

// ------------------------------------------------------------------ profit / goal

const Profit: React.FC<WidgetProps> = ({ variant, options }) => {
  const { feed, t, locale } = useOv();
  const now = useNow(5000);
  const delta = sessionDelta(feed);
  const shown = useTween(delta);
  const hours = (now - feed.sessionStart) / 3_600_000;
  const rate = hours > 0.05 ? delta / hours : null;
  const showRate = opt(options, 'showRate', true);
  const showSpark = opt(options, 'showSparkline', true);
  const showBalance = opt(options, 'showBalance', false);
  const label = opt(options, 'label', '') || t('Session profit');
  const balance = feed.frame?.actor?.state?.uec_balance ?? feed.history[feed.history.length - 1]?.[1];
  const tone = delta >= 0 ? 'ov-good' : 'ov-bad';

  if (variant === 'strip') {
    return (
      <Panel className="ov-strip">
        <div className="ov-strip-row">
          <span className="ov-kicker">{label}</span>
          <span className={`ov-big ov-mono ${tone}`}>{fmtSigned(shown, locale)}</span>
          <span className="ov-muted">aUEC</span>
          {showRate && rate !== null && (
            <span className="ov-muted ov-mono">
              {fmtCompact(rate, locale)}/{t('h')}
            </span>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={label} right="aUEC">
      <div className={`ov-big ov-mono ${tone}`}>{fmtSigned(shown, locale)}</div>
      {showSpark && <Sparkline points={feed.history} />}
      <div className="ov-sub">
        {showRate && rate !== null && (
          <span>
            <b className="ov-mono">{fmtCompact(rate, locale)}</b> / {t('h')}
          </span>
        )}
        <span>{fmtClock(now - feed.sessionStart)}</span>
        {showBalance && typeof balance === 'number' && (
          <span>
            {t('Balance')} <b className="ov-mono">{fmtInt(balance, locale)}</b>
          </span>
        )}
      </div>
    </Panel>
  );
};

const Goal: React.FC<WidgetProps> = ({ variant, options }) => {
  const { feed, t, locale } = useOv();
  const target = Math.max(1, Number(opt(options, 'target', 250000)) || 250000);
  const label = opt(options, 'label', '') || t('Stream goal');
  const delta = Math.max(0, sessionDelta(feed));
  const p = (delta / target) * 100;
  const done = p >= 100;
  return (
    <Panel className={variant === 'strip' ? 'ov-strip' : ''}>
      <div className="ov-goal">
        <div className="ov-goal-row">
          <span className="ov-kicker">{label}</span>
          <span className="ov-mono">
            {done ? '✔ ' : ''}
            {fmtCompact(delta, locale)} / {fmtCompact(target, locale)}
          </span>
        </div>
        <Bar value={p} tone={done ? 'warn' : 'good'} shine />
      </div>
    </Panel>
  );
};

// ------------------------------------------------------------------ pilot

const Heart: React.FC<{ bpm: number }> = ({ bpm }) => (
  <svg
    className="ov-heart"
    viewBox="0 0 24 24"
    style={{ animationDuration: `${Math.max(0.3, Math.min(1.5, 60 / Math.max(bpm, 30)))}s` }}
  >
    <path d="M12 21s-7-4.4-9.5-9C.8 8.7 3 5 6.5 5c2 0 3.5 1.2 5.5 3.3C14 6.2 15.5 5 17.5 5 21 5 23.2 8.7 21.5 12 19 16.6 12 21 12 21z" />
  </svg>
);

const Vitals: React.FC<WidgetProps> = ({ variant, options }) => {
  const { feed, t } = useOv();
  const v = feed.frame?.actor?.vitals;
  const hp = pct(v?.health);
  const o2 = pct(v?.oxygen);
  const temp = v?.body_temperature?.current;
  const bpm = v?.heart_rate ?? 0;
  const rows: Array<{ key: string; label: string; value: number | null; text: string; tone: string }> = [];
  if (opt(options, 'showHealth', true)) rows.push({ key: 'hp', label: t('HP'), value: hp, text: hp === null ? '—' : `${Math.round(hp)}%`, tone: levelTone(hp) });
  if (opt(options, 'showOxygen', true)) rows.push({ key: 'o2', label: 'O₂', value: o2, text: o2 === null ? '—' : `${Math.round(o2)}%`, tone: levelTone(o2, 40, 20) === 'good' ? 'accent' : levelTone(o2, 40, 20) });
  if (opt(options, 'showTemperature', true))
    rows.push({
      key: 'temp',
      label: t('TEMP'),
      value: typeof temp === 'number' ? ((temp - 34) / 6) * 100 : null,
      text: typeof temp === 'number' ? `${temp.toFixed(1)}°` : '—',
      tone: typeof temp === 'number' && (temp > 38.5 || temp < 35.5) ? 'bad' : 'warn',
    });
  const showBpm = opt(options, 'showHeartRate', true) && bpm > 0;
  const critical = hp !== null && hp < 25;

  return (
    <Panel title={variant === 'strip' ? undefined : t('Pilot')} className={`${variant === 'strip' ? 'ov-strip' : ''} ${critical ? 'ov-critical' : ''}`}>
      <div className={`ov-vitals ov-vitals-${variant}`}>
        {rows.map((r) => (
          <div key={r.key} className="ov-vit">
            <span className="ov-vit-k">{r.label}</span>
            <Bar value={r.value} tone={r.tone as 'good'} />
            <span className="ov-vit-v ov-mono">{r.text}</span>
          </div>
        ))}
        {showBpm && (
          <div className="ov-bpm">
            <Heart bpm={bpm} />
            <span className="ov-mono">{Math.round(bpm)}</span>
            <small>BPM</small>
          </div>
        )}
      </div>
    </Panel>
  );
};

// ------------------------------------------------------------------ ship / flight

const ShieldRing: React.FC<{ faces?: number[]; level?: number }> = ({ faces, level }) => {
  const f = faces && faces.length >= 4 ? faces.slice(0, 4) : [level ?? 0, level ?? 0, level ?? 0, level ?? 0];
  const arcs = ['M50 6 A44 44 0 0 1 94 50', 'M94 50 A44 44 0 0 1 50 94', 'M50 94 A44 44 0 0 1 6 50', 'M6 50 A44 44 0 0 1 50 6'];
  return (
    <svg className="ov-shield" viewBox="0 0 100 100">
      {arcs.map((d, i) => {
        const p = fracPct(f[i]) ?? 0;
        return <path key={i} d={d} className={`ov-arc ${p < 15 ? 'ov-arc-down' : p < 40 ? 'ov-arc-low' : ''}`} style={{ opacity: 0.35 + (p / 100) * 0.65 }} />;
      })}
      <path d="M50 26 L62 66 L50 59 L38 66Z" className="ov-ship-glyph" />
    </svg>
  );
};

const Ship: React.FC<WidgetProps> = ({ variant, options }) => {
  const { feed, t, locale } = useOv();
  const st = feed.frame?.vehicle?.state;
  const inst = st?.flight?.instruments;
  const theme = resolveManufacturer(st?.manufacturer, st?.class_name);
  const hull = fracPct(st?.health);
  const shields = fracPct(st?.shields?.level);
  const h2 = fracPct(inst?.hydrogen_fuel);
  const qt = fracPct(inst?.quantum_fuel);
  const mode = masterModeLabel(st?.master_mode?.mode);
  const name = shipDisplayName(feed.frame) || t('No ship');
  const showShields = opt(options, 'showShields', true);
  const logo = theme.logo ? (
    <span className="ov-logo" style={{ WebkitMaskImage: `url("${theme.logo}")`, maskImage: `url("${theme.logo}")` }} />
  ) : (
    <span className="ov-logo-text">{theme.short}</span>
  );

  if (variant === 'strip') {
    return (
      <Panel className="ov-strip">
        <div className="ov-strip-row">
          {logo}
          <span className="ov-ship-name">{name}</span>
          {mode && <span className="ov-pill">{mode}</span>}
          <span className="ov-kicker">{t('Hull')}</span>
          <span className="ov-mini-bar"><Bar value={hull} tone={levelTone(hull) as 'good'} /></span>
          {shields !== null && (
            <>
              <span className="ov-kicker">{t('Shields')}</span>
              <span className="ov-mini-bar"><Bar value={shields} /></span>
            </>
          )}
          <span className="ov-mono">{fmtInt(inst?.speed ?? 0, locale)} m/s</span>
        </div>
      </Panel>
    );
  }

  const stat = (label: string, value: string) => (
    <div>
      {label} <b className="ov-mono">{value}</b>
    </div>
  );
  const p = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);

  return (
    <Panel title={t('Ship')} right={mode ?? undefined}>
      <div className="ov-ship-head">
        {logo}
        <div>
          <div className="ov-ship-name">{name}</div>
          <div className="ov-ship-mfg">{st?.manufacturer || theme.name}</div>
        </div>
      </div>
      <div className="ov-ship-body">
        {showShields && <ShieldRing faces={st?.shields?.faces} level={st?.shields?.level} />}
        <div className="ov-stats">
          {stat(t('Hull'), p(hull))}
          {stat(t('Shields'), p(shields))}
          {stat('H₂', p(h2))}
          {stat('QT', p(qt))}
          {stat(t('Speed'), `${fmtInt(inst?.speed ?? 0, locale)} m/s`)}
          {stat('G', (inst?.g_meter?.current ?? 0).toFixed(1))}
        </div>
      </div>
    </Panel>
  );
};

const Flight: React.FC<WidgetProps> = ({ variant }) => {
  const { feed, t, locale } = useOv();
  const inst = feed.frame?.vehicle?.state?.flight?.instruments;
  const speed = useTween(inst?.speed ?? 0, 200);
  const g = inst?.g_meter?.current ?? 0;
  const heading = inst?.heading;
  const cells = (
    <>
      <div className="ov-flight-speed">
        <span className="ov-big ov-mono">{fmtInt(speed, locale)}</span>
        <small>m/s</small>
      </div>
      <div className="ov-flight-row">
        <span>
          G <b className="ov-mono">{g.toFixed(1)}</b>
        </span>
        <span>
          {t('ALT')} <b className="ov-mono">{formatAlt(inst?.altitude)}</b>
        </span>
        {typeof heading === 'number' && (
          <span>
            HDG <b className="ov-mono">{String(Math.round(heading) % 360).padStart(3, '0')}°</b>
          </span>
        )}
      </div>
    </>
  );
  return variant === 'strip' ? (
    <Panel className="ov-strip">
      <div className="ov-strip-row">{cells}</div>
    </Panel>
  ) : (
    <Panel title={t('Flight')}>{cells}</Panel>
  );
};

// ------------------------------------------------------------------ moments

const KIND_OPTION: Record<MomentKind, string> = {
  boot: 'boot',
  failed: 'contracts',
  payout: 'payouts',
  contract: 'contracts',
  death: 'deaths',
  downed: 'deaths',
  missile: 'combat',
  shields: 'combat',
  quantum: 'quantum',
  ship: 'ships',
  record: 'records',
  goal: 'goals',
};
const KIND_TONE: Record<MomentKind, 'good' | 'bad' | 'info'> = {
  boot: 'info',
  failed: 'bad',
  payout: 'good',
  contract: 'good',
  goal: 'good',
  death: 'bad',
  downed: 'bad',
  missile: 'bad',
  shields: 'bad',
  quantum: 'info',
  ship: 'info',
  record: 'info',
};
const MOMENT_MS = 3800;

let audioCtx: AudioContext | null = null;
function chime(tone: 'good' | 'bad' | 'info') {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const notes = tone === 'good' ? [660, 880, 1320] : tone === 'bad' ? [440, 330, 440, 330] : [520, 780];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = tone === 'bad' ? 'square' : 'sine';
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(tone === 'bad' ? 0.05 : 0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.3);
    });
  } catch {
    /* audio unavailable */
  }
}

const Moments: React.FC<WidgetProps> = ({ options }) => {
  const { feed, moments, t, locale, layout, editing } = useOv();
  const [queue, setQueue] = useState<Moment[]>([]);
  const [current, setCurrent] = useState<Moment | null>(null);
  const seen = useRef(new Set<string>());
  const minPayout = Number(opt(options, 'minPayout', 5000)) || 0;
  const showDest = opt(options, 'showDestination', false);
  const sound = opt(options, 'sound', false);

  // Goal crossing → moment (uses the layout's goal widget target).
  const goalTarget = Number(layout.widgets.find((w) => w.type === 'goal')?.options?.target ?? 0);
  const delta = sessionDelta(feed);
  const prevDelta = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevDelta.current;
    prevDelta.current = delta;
    if (goalTarget > 0 && prev !== null && prev < goalTarget && delta >= goalTarget) {
      setQueue((q) => [...q, { id: `goal-${Date.now()}`, kind: 'goal', title: 'Stream goal reached', amount: goalTarget, at: Date.now() }]);
    }
  }, [delta, goalTarget]);

  useEffect(() => {
    const fresh = moments.filter((m) => !seen.current.has(m.id));
    fresh.forEach((m) => seen.current.add(m.id));
    const allowed = fresh.filter(
      (m) =>
        m.kind !== 'boot' && // played by the Ship boot widget
        opt(options, KIND_OPTION[m.kind], true) &&
        !(m.kind === 'payout' && (m.amount ?? 0) < minPayout)
    );
    if (allowed.length) setQueue((q) => [...q, ...allowed].slice(-6));
  }, [moments, options, minPayout]);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCurrent(next);
    if (sound) chime(KIND_TONE[next.kind]);
  }, [queue, current, sound]);

  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => setCurrent(null), MOMENT_MS);
    return () => window.clearTimeout(id);
  }, [current]);

  const deaths = feed.frame?.sessionMetrics?.deaths ?? 0;
  const m = current ?? (editing ? { id: 'preview', kind: 'payout' as const, title: 'Payment received', amount: 45000, at: 0 } : null);
  if (!m) return <div className="ov-moments" />;

  let big = '';
  let small = t(m.title);
  switch (m.kind) {
    case 'payout':
    case 'goal':
      big = `${m.kind === 'payout' ? '+' : ''}${fmtInt(m.amount ?? 0, locale)} aUEC`;
      break;
    case 'contract':
      big = m.amount ? `+${fmtInt(m.amount, locale)} aUEC` : t('Contract complete');
      small = m.amount ? t('Contract complete') : m.value ?? '';
      break;
    case 'death':
      big = `K.I.A. #${Math.max(1, deaths)}`;
      small = t('Pilot down');
      break;
    case 'failed':
      big = t('CONTRACT FAILED');
      small = m.value ?? '';
      break;
    case 'downed':
      big = t('DOWNED');
      small = t('Medical assistance needed');
      break;
    case 'missile':
      big = t('MISSILE LOCK');
      small = t('Warning');
      break;
    case 'shields':
      big = t('SHIELDS CRITICAL');
      small = t('Warning');
      break;
    case 'quantum':
      big = showDest && m.value ? `→ ${m.value}` : t('QUANTUM JUMP');
      small = t('Quantum travel');
      break;
    case 'ship':
      big = m.value ?? '';
      small = t('Boarding');
      break;
    case 'record':
      big = m.value ?? '';
      small = t('New speed record');
      break;
  }

  return (
    <div className="ov-moments">
      <div key={m.id} className={`ov-moment ov-moment-${KIND_TONE[m.kind]} ${editing && !current ? 'ov-moment-preview' : ''}`}>
        <div className="ov-moment-small">{small}</div>
        <div className="ov-moment-big">{big}</div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ deaths / ticker / feed / location

const Deaths: React.FC<WidgetProps> = ({ variant, options }) => {
  const { feed, t } = useOv();
  const m = feed.frame?.sessionMetrics;
  const deaths = m?.deaths ?? 0;
  const label = opt(options, 'label', '') || t('Deaths this stream');
  const showDowned = opt(options, 'showDowned', true);
  if (variant === 'strip') {
    return (
      <Panel className="ov-strip">
        <div className="ov-strip-row">
          <span className="ov-kicker">{label}</span>
          <span className="ov-big ov-bad ov-mono">{deaths}</span>
          {showDowned && <span className="ov-muted">{t('Downed')} {m?.downedCount ?? 0}</span>}
        </div>
      </Panel>
    );
  }
  return (
    <Panel className="ov-deaths">
      <div className="ov-kicker">{label}</div>
      <div className="ov-deaths-n ov-bad">{deaths}</div>
      {showDowned && (
        <div className="ov-muted">
          {t('Downed')} {m?.downedCount ?? 0}
        </div>
      )}
    </Panel>
  );
};

function latestZone(events: LiveTelemetryEvent[], delayMin: number, now: number) {
  const cutoff = now - delayMin * 60_000;
  return events.find((e) => (e.type === 'zone_transition' || e.category === 'zone') && Date.parse(e.timestamp) <= cutoff)?.zone ?? null;
}

const SENSITIVE = new Set(['quantum', 'zone_transition', 'shard']);

const eventLabel = (e: LiveTelemetryEvent, t: (s: string, v?: Record<string, string | number>) => string, locale: string) => {
  if (e.type === 'reward' && e.amountAuec) return `${t('Payment')} +${fmtInt(e.amountAuec, locale)}`;
  if (e.type === 'purchase' && e.amountAuec) return `${t('Purchase')} −${fmtInt(e.amountAuec, locale)}`;
  if (e.type === 'mission_accepted') return `${t('Contract accepted')}${e.missionName ? ` · ${e.missionName}` : ''}`;
  if (e.type === 'mission_completed') return t('Contract complete');
  if (e.type === 'mission_failed') return `${t('Contract failed')}${e.missionName ? ` · ${e.missionName}` : ''}`;
  if (e.type === 'objective_update' && e.objectiveText) return `${t(e.title)} · ${e.objectiveText}`;
  if (e.type === 'quantum') return t('Quantum jump');
  return t(e.title);
};

const eventTone = (e: LiveTelemetryEvent) =>
  e.severity === 'alert' ? 'bad' : e.severity === 'warning' ? 'warn' : e.type === 'reward' || e.severity === 'success' ? 'good' : 'accent';

const Ticker: React.FC<WidgetProps> = ({ options }) => {
  const { feed, t, locale } = useOv();
  const now = useNow(1000);
  const m = feed.frame?.sessionMetrics;
  const message = String(opt(options, 'message', ''));
  const showEvents = opt(options, 'showEvents', true);
  const showZone = opt(options, 'showZone', false);
  const zone = showZone ? latestZone(feed.events, Number(opt(options, 'locationDelay', 5)), now) : null;
  const items = [
    ...(message ? [message] : []),
    ...(showEvents
      ? feed.events
          .filter((e) => !SENSITIVE.has(e.type) && e.type !== 'objective_update')
          .slice(0, 6)
          .map((e) => eventLabel(e, t, locale))
      : []),
  ];
  return (
    <div className="ov-ticker">
      <div className="ov-seg">
        <span>{t('SESSION')}</span>
        <b className="ov-mono">{fmtClock(now - feed.sessionStart)}</b>
      </div>
      <div className="ov-seg">
        <span>{t('PROFIT')}</span>
        <b className={`ov-mono ${sessionDelta(feed) >= 0 ? 'ov-good' : 'ov-bad'}`}>{fmtSigned(sessionDelta(feed), locale)} aUEC</b>
      </div>
      <div className="ov-seg">
        <span>{t('DEATHS')}</span>
        <b className="ov-bad">{m?.deaths ?? 0}</b>
      </div>
      {m?.activeShipName && (
        <div className="ov-seg ov-seg-ship">
          <span>{t('SHIP')}</span>
          <b>{m.activeShipName}</b>
        </div>
      )}
      {zone && (
        <div className="ov-seg">
          <span className="ov-pill">{zone}</span>
        </div>
      )}
      <div className="ov-crawl">
        {items.length > 0 && (
          <div style={{ animationDuration: `${Math.max(18, items.join('').length * 0.28)}s` }}>{items.join('   ·   ')}</div>
        )}
      </div>
    </div>
  );
};

const Feed: React.FC<WidgetProps> = ({ options }) => {
  const { feed, t, locale } = useOv();
  const now = useNow(15000);
  const count = Math.max(1, Number(opt(options, 'count', 5)) || 5);
  const showLocations = opt(options, 'showLocations', false);
  const list = feed.events
    .filter((e) => (e.type !== 'objective_update' || Boolean(e.objectiveText)) && (showLocations || !SENSITIVE.has(e.type)))
    .slice(0, count);
  return (
    <Panel title={t('Live feed')} className={fitPanelClass(options)}>
      {list.length === 0 && <div className="ov-muted ov-empty">{t('Waiting for activity…')}</div>}
      {list.map((e, i) => (
        <div key={e.id ?? `${e.timestamp}-${i}`} className="ov-ev">
          <i className={`ov-dot ov-tone-${eventTone(e)}`} />
          <span className="ov-ev-text">
            {eventLabel(e, t, locale)}
            {showLocations && e.type === 'quantum' && e.details ? ` → ${e.details}` : ''}
          </span>
          <span className="ov-ev-time">{fmtAgo(e.timestamp, now, t)}</span>
        </div>
      ))}
    </Panel>
  );
};

const Location: React.FC<WidgetProps> = ({ variant, options }) => {
  const { feed, t } = useOv();
  const now = useNow(5000);
  const delay = Math.max(0, Number(opt(options, 'delay', 5)) || 0);
  const zone = latestZone(feed.events, delay, now);
  return (
    <Panel className="ov-strip">
      <div className="ov-strip-row">
        <span className="ov-kicker">{t('Zone')}</span>
        <span className="ov-loc">{zone ?? t('Unknown')}</span>
        {delay > 0 && <span className="ov-muted">({t('{n} min delay', { n: delay })})</span>}
      </div>
    </Panel>
  );
};

// ------------------------------------------------------------------ debrief

// ------------------------------------------------------------------ ship boot

const BOOT_MS = 2600;
const PREVIEW_SHIP = 'F7C-M Super Hornet Mk II';

const rgbOf = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

/** Manufacturer boot splash (same idea as the desktop HUD) when the pilot boards a ship. */
const Boot: React.FC<WidgetProps> = ({ options }) => {
  const { feed, brand, moments, editing, t } = useOv();
  const sound = opt(options, 'sound', false);
  const ship = shipDisplayName(feed.frame);
  const key = brand ? `${brand.id}|${ship ?? ''}` : null;
  const [run, setRun] = useState<{ theme: ManufacturerTheme; ship: string; n: number } | null>(null);

  const play = (theme: ManufacturerTheme, shipName: string) => {
    setRun({ theme, ship: shipName, n: Date.now() });
    if (sound) cockpitAudio.boot(theme.sound);
  };

  // Board a ship (or switch to another one) → play. Not on first render, so refreshing OBS mid-flight stays quiet.
  const prevKey = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevKey.current;
    prevKey.current = key;
    if (prev !== undefined && key && key !== prev && brand) play(brand, ship ?? brand.osName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // "Test a moment → Boot" from the editor.
  const mountedAt = useRef(Date.now());
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const m of moments) {
      if (m.kind !== 'boot' || seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (m.at >= mountedAt.current) play(brand ?? getThemeById('anvil')!, ship ?? PREVIEW_SHIP);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moments]);

  useEffect(() => {
    if (!run) return;
    const id = window.setTimeout(() => setRun(null), BOOT_MS);
    return () => window.clearTimeout(id);
  }, [run]);

  const shown = run ?? (editing ? { theme: brand ?? getThemeById('anvil')!, ship: ship ?? PREVIEW_SHIP, n: 0 } : null);
  if (!shown) return null;
  const { theme } = shown;
  const checks = theme.bootChecks;
  const step = 1.3 / Math.max(checks.length, 1);
  const vars = {
    ['--ov-accent' as string]: theme.colors.accent,
    ['--ov-accent2' as string]: theme.colors.c300,
    ['--ov-accent-rgb' as string]: rgbOf(theme.colors.accent),
  } as React.CSSProperties;

  return (
    <div key={shown.n} className={`ov-boot ${run ? 'ov-boot-run' : 'ov-boot-preview'}`} style={vars}>
      <div className="ov-panel">
        <div className="ov-boot-inner">
          {theme.logo ? (
            <span className="ov-boot-logo" style={{ WebkitMaskImage: `url("${theme.logo}")`, maskImage: `url("${theme.logo}")` }} />
          ) : (
            <span className="ov-boot-logo-text">{theme.short}</span>
          )}
          <div className="ov-boot-os">{theme.osName}</div>
          <div className="ov-boot-tag">{theme.tagline}</div>
          <div className="ov-boot-ship">{shown.ship}</div>
          <div className="ov-boot-bar">
            <i />
          </div>
          <div className="ov-boot-checks">
            {checks.map((c, i) => (
              <div key={c} style={{ animationDelay: `${0.45 + i * step}s` }}>
                <span>{c}</span>
                <b style={{ animationDelay: `${0.55 + i * step}s` }}>{t('ONLINE')}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const Debrief: React.FC<WidgetProps> = ({ options }) => {
  const { feed, t, locale } = useOv();
  const now = useNow(5000);
  const m = feed.frame?.sessionMetrics;
  const delta = sessionDelta(feed);
  const title = opt(options, 'title', '') || t('Thanks for watching');
  const best = feed.contracts.filter((c) => c.reward).sort((a, b) => (b.reward ?? 0) - (a.reward ?? 0))[0];
  const topPayout = Math.max(0, ...feed.events.filter((e) => e.type === 'reward').map((e) => e.amountAuec ?? 0));
  const stat = (label: string, value: React.ReactNode, cls = '') => (
    <div className="ov-panel ov-debrief-stat">
      <div className="ov-kicker">{label}</div>
      <div className={`ov-debrief-n ov-mono ${cls}`}>{value}</div>
    </div>
  );
  return (
    <div className="ov-debrief">
      <div className="ov-debrief-kicker">{t('Mission debrief')}</div>
      <div className="ov-debrief-title">{title}</div>
      <div className="ov-debrief-grid">
        {stat(t('Profit'), `${fmtSigned(delta, locale)} aUEC`, delta >= 0 ? 'ov-good' : 'ov-bad')}
        {stat(t('Contracts'), feed.contractsCompleted)}
        {stat(t('Deaths'), m?.deaths ?? 0, 'ov-bad')}
        {stat(t('Time'), fmtClock(now - feed.sessionStart))}
      </div>
      <div className="ov-debrief-row">
        <div className="ov-panel">
          <div className="ov-kicker">{t('Top moment')}</div>
          <div>
            {best
              ? `${contractName(best, t)} — +${fmtInt(best.reward ?? 0, locale)} aUEC`
              : topPayout > 0
                ? `${t('Payment')} +${fmtInt(topPayout, locale)} aUEC`
                : '—'}
          </div>
        </div>
        <div className="ov-panel">
          <div className="ov-kicker">{t('Ship')}</div>
          <div>{m?.activeShipName ?? '—'}</div>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ registry

const bool = (key: string, label: string, def = true): OptionDef => ({ key, label, type: 'bool', default: def });

const FIT_OPTIONS: OptionDef[] = [
  bool('fitHeight', 'Shrink to content (box is the max size)'),
  {
    key: 'growFrom',
    label: 'Grow from',
    type: 'select',
    default: 'top',
    choices: [
      { value: 'top', label: 'Top' },
      { value: 'bottom', label: 'Bottom' },
    ],
  },
];

export const WIDGETS: Record<WidgetType, WidgetDef> = {
  contracts: {
    label: 'Active contracts',
    description: 'Contract name, timer, objectives checklist and reward.',
    variants: { card: { w: 460, h: 300 }, strip: { w: 900, h: 64 }, tall: { w: 340, h: 560 } },
    options: [
      { key: 'maxContracts', label: 'Max contracts', type: 'number', default: 2, min: 1, max: 5, step: 1 },
      bool('showObjectives', 'Objectives checklist'),
      bool('showTimer', 'Timer'),
      bool('showReward', 'Reward'),
      bool('keepCompletedObjectives', 'Keep completed objectives', false),
      bool('hideCallToArms', 'Hide "A Call to Arms"'),
      { key: 'hideContracts', label: 'Hide contracts named (comma separated)', type: 'text', default: '' },
      ...FIT_OPTIONS,
    ],
    Comp: Contracts,
  },
  profit: {
    label: 'Session profit',
    description: 'aUEC earned this session with sparkline and rate per hour.',
    variants: { card: { w: 440, h: 230 }, strip: { w: 640, h: 64 } },
    options: [
      { key: 'label', label: 'Title', type: 'text', default: '' },
      bool('showSparkline', 'Sparkline'),
      bool('showRate', 'aUEC per hour'),
      bool('showBalance', 'Show total balance', false),
    ],
    Comp: Profit,
  },
  goal: {
    label: 'Stream goal',
    description: 'Progress bar towards an aUEC target.',
    variants: { card: { w: 440, h: 86 }, strip: { w: 900, h: 56 } },
    options: [
      { key: 'label', label: 'Title', type: 'text', default: '' },
      { key: 'target', label: 'Target (aUEC)', type: 'number', default: 250000, min: 1000, step: 1000 },
    ],
    Comp: Goal,
  },
  vitals: {
    label: 'Pilot vitals',
    description: 'Health, oxygen, temperature and a live heartbeat.',
    variants: { card: { w: 330, h: 220 }, strip: { w: 900, h: 56 }, tall: { w: 200, h: 380 } },
    options: [bool('showHealth', 'Health'), bool('showOxygen', 'Oxygen'), bool('showTemperature', 'Temperature'), bool('showHeartRate', 'Heart rate')],
    Comp: Vitals,
  },
  ship: {
    label: 'Ship',
    description: 'Ship, manufacturer, shields per face, hull and fuel.',
    variants: { card: { w: 560, h: 260 }, strip: { w: 1000, h: 64 } },
    options: [bool('showShields', 'Shield hologram')],
    Comp: Ship,
  },
  flight: {
    label: 'Flight',
    description: 'Speed, G-force, altitude and heading.',
    variants: { card: { w: 300, h: 170 }, strip: { w: 640, h: 60 } },
    options: [],
    Comp: Flight,
  },
  moments: {
    label: 'Moments',
    description: 'Big animated banners: payouts, K.I.A., missile lock, quantum jumps…',
    variants: { card: { w: 1000, h: 170 } },
    options: [
      bool('payouts', 'Payouts'),
      { key: 'minPayout', label: 'Minimum payout (aUEC)', type: 'number', default: 5000, min: 0, step: 500 },
      bool('contracts', 'Contracts completed'),
      bool('deaths', 'Deaths / downed'),
      bool('combat', 'Missile lock / shields'),
      bool('quantum', 'Quantum jumps'),
      bool('showDestination', 'Show destination', false),
      bool('ships', 'Boarding a ship'),
      bool('records', 'Speed records'),
      bool('goals', 'Stream goal reached'),
      bool('sound', 'Sound', false),
    ],
    Comp: Moments,
  },
  deaths: {
    label: 'Death counter',
    description: 'Deaths and downs this session.',
    variants: { card: { w: 280, h: 200 }, strip: { w: 480, h: 60 } },
    options: [{ key: 'label', label: 'Title', type: 'text', default: '' }, bool('showDowned', 'Show downed')],
    Comp: Deaths,
  },
  ticker: {
    label: 'Bottom ticker',
    description: 'Session time, profit, deaths, ship and a scrolling feed.',
    variants: { card: { w: 1920, h: 52 } },
    options: [
      { key: 'message', label: 'Custom message', type: 'text', default: '' },
      bool('showEvents', 'Scroll recent events'),
      bool('showZone', 'Show zone', false),
      { key: 'locationDelay', label: 'Zone delay (min)', type: 'number', default: 5, min: 0, max: 30, step: 1 },
    ],
    Comp: Ticker,
  },
  feed: {
    label: 'Event feed',
    description: 'Latest events: payments, purchases, contracts, deaths.',
    variants: { card: { w: 440, h: 260 }, tall: { w: 360, h: 600 } },
    options: [
      { key: 'count', label: 'Events shown', type: 'number', default: 5, min: 1, max: 15, step: 1 },
      bool('showLocations', 'Show locations', false),
      ...FIT_OPTIONS,
    ],
    Comp: Feed,
  },
  location: {
    label: 'Location',
    description: 'Current zone, delayed to prevent stream sniping.',
    variants: { card: { w: 420, h: 70 } },
    options: [{ key: 'delay', label: 'Delay (min)', type: 'number', default: 5, min: 0, max: 30, step: 1 }],
    Comp: Location,
  },
  debrief: {
    label: 'Mission debrief',
    description: 'End-of-stream summary scene.',
    variants: { card: { w: 1500, h: 860 } },
    options: [{ key: 'title', label: 'Title', type: 'text', default: '' }],
    Comp: Debrief,
  },
  boot: {
    label: 'Ship boot',
    description: 'Manufacturer boot animation when you board a ship (invisible the rest of the time).',
    variants: { card: { w: 520, h: 320 } },
    options: [bool('sound', 'Sound', false)],
    Comp: Boot,
  },
};

export const WIDGET_TYPES = Object.keys(WIDGETS) as WidgetType[];
