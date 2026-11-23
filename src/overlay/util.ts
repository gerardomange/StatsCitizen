import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { translate, type Lang, type Vars } from '../i18n/index.js';
import type { LiveTelemetryFrame } from '../types/telemetry.js';
import { annState } from '../components/hud/hudUtils.js';
import { getThemeById, resolveManufacturer, type ManufacturerTheme } from '../themes/manufacturers.js';
import type { Contract, FeedState, Moment, OverlayLayout, OverlayWidget, ShowWhen } from './types.js';

export interface OverlayCtxValue {
  feed: FeedState;
  moments: Moment[];
  layout: OverlayLayout;
  combat: boolean;
  /** Manufacturer of the ship the pilot is seated in (kept a few seconds after standing up). */
  brand: ManufacturerTheme | null;
  editing: boolean;
  t: (text: string, vars?: Vars) => string;
  locale: string;
}

export const OverlayCtx = createContext<OverlayCtxValue | null>(null);
export const useOv = () => {
  const v = useContext(OverlayCtx);
  if (!v) throw new Error('OverlayCtx missing');
  return v;
};

export const makeT = (lang: Lang) => (text: string, vars?: Vars) => translate(lang, text, vars);
export const localeFor = (lang: Lang) => (lang === 'es' ? 'es-MX' : 'en-US');

/** Element size, updated on resize. */
export function useBox<T extends HTMLElement>() {
  // Callback ref: re-attaches when the element mounts later (e.g. after a loading state).
  const [el, setEl] = useState<T | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, box] as const;
}

/** Re-render every `ms` (clocks, timers). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Smoothly animate a number towards `target` (odometer effect). */
export function useTween(target: number, duration = 900) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const valueRef = useRef(target);
  valueRef.current = value;
  useEffect(() => {
    from.current = valueRef.current;
    if (from.current === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(from.current + (target - from.current) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export const fmtInt = (n: number, locale: string) => Math.round(n).toLocaleString(locale);
export const fmtSigned = (n: number, locale: string) => `${n >= 0 ? '+' : '−'}${fmtInt(Math.abs(n), locale)}`;
export const fmtCompact = (n: number, locale: string) =>
  new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

export const fmtAgo = (iso: string, now: number, t: OverlayCtxValue['t']) => {
  const d = Math.max(0, now - Date.parse(iso)) / 1000;
  if (!Number.isFinite(d) || d < 45) return t('now');
  if (d < 3600) return `${Math.round(d / 60)}m`;
  return `${Math.round(d / 3600)}h`;
};

/** Session profit: prefer the backend's metric, fall back to the balance history. */
export function sessionDelta(feed: FeedState): number {
  const m = feed.frame?.sessionMetrics;
  if (m && (m.uecStart ?? null) !== null) return m.uecDelta ?? 0;
  const h = feed.history;
  return h.length > 1 ? h[h.length - 1][1] - h[0][1] : 0;
}

/** Combat = missile/hit/shields annunciators at MAJOR. */
export function frameInCombat(frame: LiveTelemetryFrame | null) {
  const ann = frame?.vehicle?.state?.annunciators ?? {};
  return ['misl', 'hit', 'shld'].some((k) => annState(ann[k]) === 'major');
}

/** Combat flag that lingers a few seconds so the overlay doesn't flicker. */
export function useCombat(frame: LiveTelemetryFrame | null, linger = 6000) {
  const [until, setUntil] = useState(0);
  const now = useNow(1000);
  const hot = frameInCombat(frame);
  useEffect(() => {
    if (hot) setUntil(Date.now() + linger);
  }, [hot, frame, linger]);
  return hot || now < until;
}

export function isSeated(frame: LiveTelemetryFrame | null) {
  const loco = frame?.actor?.state?.locomotion ?? '';
  return loco.includes('SEATED') && Boolean(frame?.vehicle?.state?.name || frame?.vehicle?.state?.class_name);
}

export function widgetVisible(w: OverlayWidget, feed: FeedState, combat: boolean): boolean {
  if (w.hidden) return false;
  const when: ShowWhen = w.showWhen ?? 'always';
  const connected = Boolean(feed.frame?.connected);
  switch (when) {
    case 'always':
      return true;
    case 'connected':
      return connected;
    case 'seated':
      return connected && isSeated(feed.frame);
    case 'onFoot':
      return connected && !isSeated(feed.frame);
    case 'hasContract': {
      // Same filter the contracts widget uses, so hidden contracts (e.g. "A Call to Arms")
      // never keep a widget on screen with nothing to show.
      const keep = contractFilter(w.options ?? {});
      return feed.contracts.some(
        (c) => keep(c) && (c.status === 'active' || (c.endedAt && Date.now() - Date.parse(c.endedAt) < 45_000))
      );
    }
    case 'combat':
      return combat;
  }
}

export const opt = <T,>(options: Record<string, unknown> | undefined, key: string, fallback: T): T => {
  const v = options?.[key];
  return v === undefined || v === null ? fallback : (v as T);
};

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Contracts the viewer shouldn't see: "A Call to Arms" (an open-ended subsidy contract that
 * never completes) when enabled, plus any names listed in the free-text option.
 */
export const contractFilter = (options: Record<string, unknown>) => {
  const patterns = String(opt(options, 'hideContracts', ''))
    .split(',')
    .map(normName)
    .filter(Boolean);
  if (opt(options, 'hideCallToArms', true)) patterns.push('call to arms');
  return (c: Contract) => {
    const name = normName(c.name ?? '');
    return !patterns.some((p) => name.includes(p));
  };
};

/** "DRAK_Cutlass_Black_1234" → "Cutlass Black". Prefers the backend's normalized name. */
export function shipDisplayName(frame: LiveTelemetryFrame | null): string | null {
  const v = frame?.vehicle?.state;
  const normalized = frame?.sessionMetrics?.activeShipName;
  if (normalized && v?.name) return normalized;
  const raw = v?.name || v?.class_name || '';
  if (!raw) return null;
  if (!raw.includes('_')) return raw;
  const parts = raw.split('_').filter((p) => !/^\d+$/.test(p));
  const body = parts.length > 1 && parts[0] === parts[0].toUpperCase() ? parts.slice(1) : parts;
  return body.join(' ').trim() || null;
}

/** "VEHICLE_MASTER_MODE_SCM" / "MASTER_MODE_NAV" → "SCM" / "NAV". */
export const masterModeLabel = (raw?: string) => (raw ? raw.replace(/^.*MASTER_MODE_/, '').replace(/_/g, ' ') : null);

/** Ship manufacturer while seated; cleared a few seconds after standing up (avoids flicker on seat swaps). */
export function useShipBrand(frame: LiveTelemetryFrame | null, exitMs = 4000): ManufacturerTheme | null {
  const st = frame?.vehicle?.state;
  const id = frame?.connected && isSeated(frame) ? resolveManufacturer(st?.manufacturer, st?.class_name).id : null;
  const [brandId, setBrandId] = useState<string | null>(id);
  useEffect(() => {
    if (id) {
      setBrandId(id);
      return;
    }
    const timer = window.setTimeout(() => setBrandId(null), exitMs);
    return () => window.clearTimeout(timer);
  }, [id, exitMs]);
  return brandId ? getThemeById(brandId) ?? null : null;
}
