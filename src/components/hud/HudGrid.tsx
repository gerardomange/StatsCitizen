import React, { useCallback, useMemo, useState } from 'react';
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { EyeOff, GripVertical, Plus } from 'lucide-react';
import { useT } from '../../i18n/index.js';
import { DEFAULT_SLOTS, MODULES, ModuleCtx } from './modules.js';
import type { HudMode } from './hudUtils.js';

const ResponsiveGrid = WidthProvider(Responsive);

const BREAKPOINTS = { lg: 1000, md: 680, sm: 0 };
const COLS = { lg: 12, md: 8, sm: 4 };
const STORE_PREFIX = 'statscitizen.hudLayout.v1.';

interface Saved {
  layouts: Layouts;
  hidden: string[];
}

function defaultLayouts(mode: HudMode, available: Set<string>): Layouts {
  const slots = DEFAULT_SLOTS[mode].filter(([id]) => available.has(id));
  const base = (cols: number): Layout[] =>
    slots.map(([i, x, y, w, h]) => {
      const scale = cols / 12;
      const def = MODULES[i];
      return {
        i,
        x: Math.min(Math.round(x * scale), cols - 1),
        y,
        w: Math.max(Math.round(w * scale), Math.min(def.minW ?? 1, cols)),
        h,
        minW: Math.min(def.minW ?? 1, cols),
        minH: def.minH,
      };
    });
  // Small screens: single column stack in default order.
  let y = 0;
  const sm = slots.map(([i, , , , h]) => {
    const item = { i, x: 0, y, w: COLS.sm, h, minH: MODULES[i].minH };
    y += h;
    return item;
  });
  return { lg: base(COLS.lg), md: base(COLS.md), sm };
}

function load(mode: HudMode): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + mode);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
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

/**
 * Draggable / resizable HUD dashboard. Each mode keeps its own arrangement in localStorage.
 * Editing is off by default so a stray click never moves a module mid-flight.
 */
export const HudGrid: React.FC<{ ctx: ModuleCtx; editing: boolean; resetKey: number }> = ({ ctx, editing, resetKey }) => {
  const t = useT();
  const mode = ctx.mode;
  const available = useMemo(() => new Set(DEFAULT_SLOTS[mode].map(([id]) => id)), [mode]);

  const initial = useMemo<Saved>(() => {
    const saved = load(mode);
    const defaults = defaultLayouts(mode, available);
    if (!saved) return { layouts: defaults, hidden: [] };
    // Drop modules that no longer exist in this mode; add new ones at their default spot.
    const fix = (bp: keyof typeof COLS) => {
      const list = (saved.layouts[bp] ?? []).filter((l) => available.has(l.i));
      for (const d of defaults[bp]) if (!list.some((l) => l.i === d.i)) list.push(d);
      return list.map((l) => ({ ...l, minW: MODULES[l.i].minW ? Math.min(MODULES[l.i].minW!, COLS[bp]) : undefined, minH: MODULES[l.i].minH }));
    };
    return { layouts: { lg: fix('lg'), md: fix('md'), sm: fix('sm') }, hidden: saved.hidden.filter((h) => available.has(h)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, available, resetKey]);

  const [state, setState] = useState<Saved>(initial);
  const [stateKey, setStateKey] = useState(`${mode}|${resetKey}`);
  if (stateKey !== `${mode}|${resetKey}`) {
    setStateKey(`${mode}|${resetKey}`);
    setState(initial);
  }

  const onLayoutChange = useCallback(
    (_current: Layout[], all: Layouts) => {
      setState((prev) => {
        const next = { ...prev, layouts: { ...prev.layouts, ...all } };
        save(mode, next);
        return next;
      });
    },
    [mode]
  );

  const setHidden = (id: string, hide: boolean) =>
    setState((prev) => {
      const hidden = hide ? [...new Set([...prev.hidden, id])] : prev.hidden.filter((h) => h !== id);
      const next = { ...prev, hidden };
      save(mode, next);
      return next;
    });

  const visibleIds = [...available].filter((id) => !state.hidden.includes(id));
  const visibleLayouts: Layouts = Object.fromEntries(
    Object.entries(state.layouts).map(([bp, list]) => [bp, list.filter((l) => visibleIds.includes(l.i))])
  );

  return (
    <div className={editing ? 'hud-grid-editing' : ''}>
      {editing && state.hidden.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono text-slate-500 uppercase">{t('Hidden modules')}:</span>
          {state.hidden.map((id) => (
            <button
              key={id}
              onClick={() => setHidden(id, false)}
              className="flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono text-cyan-200 hover:bg-cyan-500/20"
            >
              <Plus className="w-3 h-3" />
              {t(MODULES[id].title)}
            </button>
          ))}
        </div>
      )}
      <ResponsiveGrid
        className="hud-grid"
        layouts={visibleLayouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={30}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={editing}
        isResizable={editing}
        draggableHandle=".hud-drag"
        draggableCancel=".hud-nodrag"
        onLayoutChange={onLayoutChange}
        compactType="vertical"
        useCSSTransforms
      >
        {visibleIds.map((id) => {
          const def = MODULES[id];
          const Icon = def.icon;
          return (
            <div key={id} className="glass-panel hud-radius flex flex-col overflow-hidden border-cyan-500/15">
              <div
                className={`hud-drag flex items-center justify-between gap-2 px-3 h-7 shrink-0 border-b border-slate-800/70 ${
                  editing ? 'cursor-move bg-cyan-500/5' : ''
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {editing && <GripVertical className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                  <Icon className="w-3.5 h-3.5 text-quantum-cyan shrink-0" />
                  <span className="text-[10px] font-orbitron font-bold tracking-wider text-slate-200 uppercase truncate">
                    {t(def.title)}
                  </span>
                </div>
                {editing && (
                  <button
                    onClick={() => setHidden(id, true)}
                    className="hud-nodrag p-0.5 rounded text-slate-500 hover:text-rose-300"
                    title={t('Hide module')}
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-3">{def.render(ctx)}</div>
            </div>
          );
        })}
      </ResponsiveGrid>
    </div>
  );
};
