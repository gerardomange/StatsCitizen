import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, EyeOff, GripVertical, MoveHorizontal, Plus } from 'lucide-react';
import { useT } from '../../i18n/index.js';
import { DEFAULT_ORDER, MODULES, ModuleCtx } from './modules.js';
import type { HudMode } from './hudUtils.js';

/*
 * Flow layout for the live HUD.
 *
 * The user only decides ORDER, which modules are HIDDEN and which are FULL-WIDTH.
 * We never store coordinates, so the same arrangement works on any monitor:
 *   1. The column count comes from the available width (1–4 columns).
 *   2. Full-width modules split the list into sections; inside a section, modules are
 *      placed in order into the currently shortest column (masonry), so no holes appear.
 *   3. Only "elastic" modules (lists: feed, contracts, weapons) stretch to absorb leftover
 *      height in their column and scroll inside; fixed-content modules keep their natural size.
 *   4. The last section stretches to the bottom of the window.
 */

const STORE_PREFIX = 'statscitizen.hudFlow.v1.';
const GAP = 12;
const ELASTIC_MIN = 240; // px — also the height used for packing elastic modules
const DEFAULT_ESTIMATE = 260;

interface Saved {
  order: string[];
  hidden: string[];
  wide: string[];
}

const columnsFor = (width: number) => (width < 620 ? 1 : width < 1000 ? 2 : width < 1450 ? 3 : 4);

function defaults(mode: HudMode): Saved {
  const order = [...DEFAULT_ORDER[mode]];
  return { order, hidden: [], wide: order.filter((id) => MODULES[id]?.wide) };
}

function load(mode: HudMode): Saved {
  const base = defaults(mode);
  try {
    const raw = localStorage.getItem(STORE_PREFIX + mode);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Saved>;
    const allowed = new Set(base.order);
    const order = (saved.order ?? []).filter((id) => allowed.has(id));
    for (const id of base.order) if (!order.includes(id)) order.push(id); // modules added in later versions
    return {
      order,
      hidden: (saved.hidden ?? []).filter((id) => allowed.has(id)),
      wide: (saved.wide ?? base.wide).filter((id) => allowed.has(id)),
    };
  } catch {
    return base;
  }
}

function save(mode: HudMode, data: Saved) {
  try {
    localStorage.setItem(STORE_PREFIX + mode, JSON.stringify(data));
  } catch {
    /* storage unavailable */
  }
}

export function resetHudLayout(mode: HudMode) {
  try {
    localStorage.removeItem(STORE_PREFIX + mode);
  } catch {
    /* storage unavailable */
  }
}

type Section = { kind: 'wide'; id: string } | { kind: 'cols'; columns: string[][] };

/**
 * Masonry that keeps the user's order (each column lists modules in global order):
 * every module goes into the currently shortest column, except elastic ones, which prefer
 * the shortest column that has no elastic module yet — so as many columns as possible
 * have something able to fill down to the bottom.
 */
function pack(ids: string[], cols: number, heightOf: (id: string) => number): string[][] {
  const columns = Array.from({ length: cols }, () => ({ h: 0, ids: [] as string[], elastic: false }));
  const shortest = (list: typeof columns) => list.reduce((best, c) => (c.h < best.h - 1 ? c : best), list[0]);
  for (const id of ids) {
    const elastic = Boolean(MODULES[id].elastic);
    const free = columns.filter((c) => !c.elastic);
    const target = elastic && free.length ? shortest(free) : shortest(columns);
    target.ids.push(id);
    target.h += heightOf(id) + GAP;
    if (elastic) target.elastic = true;
  }
  return columns.map((c) => c.ids);
}

export const HudGrid: React.FC<{ ctx: ModuleCtx; editing: boolean; resetKey: number }> = ({ ctx, editing, resetKey }) => {
  const t = useT();
  const mode = ctx.mode;

  // --- persisted arrangement -------------------------------------------------
  const [state, setState] = useState<Saved>(() => load(mode));
  const [stateKey, setStateKey] = useState(`${mode}|${resetKey}`);
  if (stateKey !== `${mode}|${resetKey}`) {
    setStateKey(`${mode}|${resetKey}`);
    setState(load(mode));
  }
  const update = useCallback(
    (fn: (prev: Saved) => Saved) =>
      setState((prev) => {
        const next = fn(prev);
        save(mode, next);
        return next;
      }),
    [mode]
  );

  // --- container width → columns, and the height left until the window bottom ---
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [fillHeight, setFillHeight] = useState(0);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      const scroller = el.closest('.overflow-y-auto') as HTMLElement | null;
      if (scroller) {
        const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        const padBottom = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
        setFillHeight(Math.max(0, scroller.clientHeight - top - padBottom));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const cols = columnsFor(width);

  // --- natural heights of fixed-content modules (used only for packing) ---------
  const [heights, setHeights] = useState<Record<string, number>>({});
  const observer = useRef<ResizeObserver | null>(null);
  if (!observer.current && typeof ResizeObserver !== 'undefined') {
    observer.current = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.hudModule;
          if (!id) continue;
          const h = Math.round((e.target as HTMLElement).offsetHeight);
          if (Math.abs((prev[id] ?? 0) - h) >= 8) {
            next[id] = h;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
  }
  useEffect(() => () => observer.current?.disconnect(), []);
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    if (el && observer.current) observer.current.observe(el);
  }, []);

  // --- layout ----------------------------------------------------------------
  const visible = state.order.filter((id) => !state.hidden.includes(id) && MODULES[id]);
  const heightKey = visible.map((id) => `${id}:${Math.round((heights[id] ?? 0) / 24)}`).join('|');
  const sections = useMemo<Section[]>(() => {
    const heightOf = (id: string) => (MODULES[id].elastic ? ELASTIC_MIN : heights[id] ?? DEFAULT_ESTIMATE);
    if (cols === 1) return [{ kind: 'cols', columns: [visible] }];
    const out: Section[] = [];
    let run: string[] = [];
    const flush = () => {
      if (run.length) out.push({ kind: 'cols', columns: pack(run, Math.min(cols, run.length), heightOf) });
      run = [];
    };
    for (const id of visible) {
      if (state.wide.includes(id)) {
        flush();
        out.push({ kind: 'wide', id });
      } else run.push(id);
    }
    flush();
    return out;
    // heightKey buckets heights so tiny content changes don't reshuffle modules.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, visible.join(','), state.wide.join(','), heightKey]);

  // --- reordering (pointer-based; HTML5 drag & drop is intercepted by the desktop shell) ---
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null);
  const dropRef = useRef(dropTarget);
  dropRef.current = dropTarget;

  const moveTo = useCallback(
    (id: string, targetId: string, before: boolean) =>
      update((prev) => {
        if (id === targetId) return prev;
        const order = prev.order.filter((x) => x !== id);
        const at = order.indexOf(targetId) + (before ? 0 : 1);
        order.splice(at, 0, id);
        return { ...prev, order };
      }),
    [update]
  );

  const startDrag = (id: string) => (e: React.PointerEvent) => {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    setDragId(id);
    document.body.style.cursor = 'grabbing';
    const onMove = (ev: PointerEvent) => {
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(
        '[data-hud-module]'
      ) as HTMLElement | null;
      const target = el?.dataset.hudModule;
      if (!el || !target || target === id) return setDropTarget(null);
      const r = el.getBoundingClientRect();
      setDropTarget({ id: target, before: ev.clientY < r.top + r.height / 2 });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      const drop = dropRef.current;
      if (drop) moveTo(id, drop.id, drop.before);
      setDragId(null);
      setDropTarget(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const nudge = (id: string, dir: -1 | 1) =>
    update((prev) => {
      const vis = prev.order.filter((x) => !prev.hidden.includes(x));
      const i = vis.indexOf(id);
      const neighbour = vis[i + dir];
      if (!neighbour) return prev;
      const order = prev.order.filter((x) => x !== id);
      order.splice(order.indexOf(neighbour) + (dir === 1 ? 1 : 0), 0, id);
      return { ...prev, order };
    });

  const toggle = (key: 'hidden' | 'wide', id: string, on: boolean) =>
    update((prev) => ({
      ...prev,
      [key]: on ? [...new Set([...prev[key], id])] : prev[key].filter((x) => x !== id),
    }));

  // --- render ----------------------------------------------------------------
  const renderCard = (id: string, stretch: boolean) => {
    const def = MODULES[id];
    const Icon = def.icon;
    const elastic = Boolean(def.elastic);
    const isDrop = dropTarget?.id === id;
    const btn = 'p-0.5 rounded text-slate-500 hover:text-quantum-cyan';
    return (
      <div
        key={id}
        data-hud-module={id}
        ref={elastic ? undefined : measureRef}
        className={`glass-panel hud-radius flex flex-col overflow-hidden border-cyan-500/15 transition-opacity ${
          elastic && stretch ? 'flex-[1_1_0%]' : 'flex-none'
        } ${dragId === id ? 'opacity-40' : ''} ${editing ? 'outline outline-1 outline-dashed outline-cyan-500/25' : ''}`}
        style={{
          minHeight: elastic ? ELASTIC_MIN : undefined,
          boxShadow: isDrop
            ? `${dropTarget!.before ? 'inset 0 3px 0' : 'inset 0 -3px 0'} rgb(var(--accent))`
            : undefined,
        }}
      >
        <div
          className={`flex items-center justify-between gap-2 px-3 h-7 shrink-0 border-b border-slate-800/70 ${
            editing ? 'bg-cyan-500/5' : ''
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {editing && (
              <span
                onPointerDown={startDrag(id)}
                className="cursor-grab active:cursor-grabbing touch-none text-slate-500 hover:text-quantum-cyan"
                title={t('Drag to reorder')}
              >
                <GripVertical className="w-3.5 h-3.5" />
              </span>
            )}
            <Icon className="w-3.5 h-3.5 text-quantum-cyan shrink-0" />
            <span className="text-[10px] font-orbitron font-bold tracking-wider text-slate-200 uppercase truncate">
              {t(def.title)}
            </span>
          </div>
          {editing && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={() => nudge(id, -1)} className={btn} title={t('Move up')}>
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => nudge(id, 1)} className={btn} title={t('Move down')}>
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              {cols > 1 && (
                <button
                  onClick={() => toggle('wide', id, !state.wide.includes(id))}
                  className={`${btn} ${state.wide.includes(id) ? '!text-quantum-cyan' : ''}`}
                  title={t('Full width')}
                >
                  <MoveHorizontal className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => toggle('hidden', id, true)} className={`${btn} hover:!text-rose-300`} title={t('Hide module')}>
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className={`p-3 ${elastic ? 'flex-1 min-h-0 overflow-auto' : ''}`}>{def.render(ctx)}</div>
      </div>
    );
  };

  return (
    <div>
      {editing && state.hidden.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono text-slate-500 uppercase">{t('Hidden modules')}:</span>
          {state.hidden.map((id) => (
            <button
              key={id}
              onClick={() => toggle('hidden', id, false)}
              className="flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono text-cyan-200 hover:bg-cyan-500/20"
            >
              <Plus className="w-3 h-3" />
              {t(MODULES[id].title)}
            </button>
          ))}
        </div>
      )}

      <div ref={containerRef} className="flex flex-col" style={{ gap: GAP, minHeight: fillHeight || undefined }}>
        {sections.map((section, si) => {
          const last = si === sections.length - 1;
          if (section.kind === 'wide') {
            return (
              <div key={`w-${section.id}`} className={`flex flex-col ${last ? 'flex-1' : ''}`}>
                {renderCard(section.id, last)}
              </div>
            );
          }
          return (
            <div key={`c-${si}`} className={`flex items-stretch ${last ? 'flex-1' : ''}`} style={{ gap: GAP }}>
              {section.columns.map((ids, ci) => (
                <div key={ci} className="flex-1 min-w-0 flex flex-col" style={{ gap: GAP }}>
                  {ids.map((id) => renderCard(id, true))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
