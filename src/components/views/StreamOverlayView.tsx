import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  CopyPlus,
  Radio,
  Sparkles,
  Upload,
  Download,
  RefreshCw,
  AlertTriangle,
  Image as ImageIcon,
  RotateCcw,
} from 'lucide-react';
import { desktopApi, isTauriRuntime } from '../../services/desktopApi.js';
import { useT } from '../../i18n/index.js';
import type { OverlayConfig, OverlaySettings } from '../../types/telemetry.js';
import { useOverlayFeed, TEST_MOMENTS } from '../../overlay/feed.js';
import { FitCanvas, OverlayCanvas, OverlayRoot } from '../../overlay/OverlayCanvas.js';
import { WIDGETS, WIDGET_TYPES, type OptionDef } from '../../overlay/widgets.js';
import { CANVAS_PRESETS, DEFAULT_SIZE, PRESETS, cloneLayout, isLayout, newId } from '../../overlay/presets.js';
import type { Appearance, OverlayLayout, OverlayTheme, OverlayWidget, ShowWhen, WeightLevel, WidgetLook, WidgetType } from '../../overlay/types.js';
import { FONT_CHOICES, fontStack } from '../../overlay/fonts.js';
import { useBox } from '../../overlay/util.js';
import '../../overlay/overlay.css';

const ACTIVE_KEY = 'statscitizen.overlay.activeLayout';
const SNAP = 0.0025;
const MIN_SIZE = 0.02;

const THEMES: Array<{ value: OverlayTheme; label: string }> = [
  { value: 'statscitizen', label: 'StatsCitizen' },
  { value: 'manufacturer', label: 'Ship manufacturer (auto)' },
  { value: 'mobiglas', label: 'mobiGlas' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'mfd', label: 'Retro MFD' },
];

const SHOW_WHEN: Array<{ value: ShowWhen; label: string }> = [
  { value: 'always', label: 'Always' },
  { value: 'connected', label: 'Game connected' },
  { value: 'seated', label: 'Seated in a ship' },
  { value: 'onFoot', label: 'On foot' },
  { value: 'hasContract', label: 'Has an active contract' },
  { value: 'combat', label: 'In combat' },
];

const MOMENT_LABELS: Record<string, string> = {
  payout: 'Payout',
  contract: 'Contract',
  death: 'K.I.A.',
  missile: 'Missile',
  quantum: 'Quantum',
  ship: 'Boarding',
  record: 'Record',
  goal: 'Goal',
  boot: 'Boot',
};

type EditorBg = 'grid' | 'dark' | 'light' | 'image';
const BG_KEY = 'statscitizen.overlay.editorBg';
const BG_IMG_KEY = 'statscitizen.overlay.editorBgImage';
const BG_LABELS: Record<EditorBg, string> = { grid: 'Grid', dark: 'Dark', light: 'Light', image: 'Screenshot' };

const readStored = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota exceeded or storage unavailable */
  }
};

const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

// ------------------------------------------------------------------ small controls

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({
  on,
  onChange,
  label,
  disabled,
}) => (
  <label className={`flex items-center justify-between gap-3 py-1 text-xs font-mono text-slate-300 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <span>{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative w-8 h-[18px] rounded-full transition-colors flex-none ${on ? 'bg-cyan-500' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${on ? 'left-[16px]' : 'left-[2px]'}`} />
    </button>
  </label>
);

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1">{children}</div>
);

const inputCls =
  'w-full bg-space-950/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500/60';

const CopyButton: React.FC<{ text: string; label: string; primary?: boolean }> = ({ text, label, primary }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        });
      }}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono font-bold whitespace-nowrap transition-all ${
        primary
          ? 'bg-cyan-500/90 hover:bg-cyan-400 text-space-950'
          : 'border border-cyan-500/40 text-quantum-cyan hover:bg-cyan-500/10'
      }`}
    >
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
};

const LOOKS: Array<{ value: WidgetLook | ''; label: string }> = [
  { value: '', label: 'Default' },
  { value: 'panel', label: 'Panel' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'text', label: 'Text only' },
];
const WEIGHT_CHOICES: Array<{ value: WeightLevel | ''; label: string }> = [
  { value: '', label: 'Default' },
  { value: 'regular', label: 'Regular' },
  { value: 'semibold', label: 'Semibold' },
  { value: 'bold', label: 'Bold' },
  { value: 'heavy', label: 'Extra bold' },
];
const CUSTOM_FONT = '__custom__';

/** Look, font, size, weight and colors. Empty fields inherit (widget ← layout ← theme). */
const AppearanceEditor: React.FC<{
  value: Appearance | undefined;
  onChange: (next: Appearance) => void;
  /** Shown as the "Default" hint, e.g. what the layout currently uses. */
  inherited?: Appearance;
}> = ({ value, onChange, inherited }) => {
  const t = useT();
  const a = value ?? {};
  const set = (patch: Partial<Appearance>) => {
    const next: Appearance = { ...a, ...patch };
    for (const k of Object.keys(next) as Array<keyof Appearance>) {
      if (next[k] === undefined || next[k] === '') delete next[k];
    }
    onChange(next);
  };
  const known = !a.font || FONT_CHOICES.some((f) => f.family === a.font);
  const [customFont, setCustomFont] = useState(!known);
  const scale = a.textScale ?? 1;
  const colorField = (key: 'accent' | 'textColor', label: string, fallback: string) => (
    <div className="flex items-center justify-between gap-2 py-1 text-xs font-mono text-slate-300">
      <span>{t(label)}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={a[key] ?? inherited?.[key] ?? fallback}
          onChange={(e) => set({ [key]: e.target.value })}
          className="w-7 h-6 rounded border border-slate-700 bg-transparent cursor-pointer"
        />
        <button
          onClick={() => set({ [key]: undefined })}
          disabled={!a[key]}
          className="text-[10px] text-slate-500 hover:text-white disabled:opacity-30"
          title={t('Use default')}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <div>
        <FieldLabel>{t('Style')}</FieldLabel>
        <div className="grid grid-cols-4 rounded-md border border-slate-700 overflow-hidden text-[10px] font-mono">
          {LOOKS.map((l) => (
            <button
              key={l.value || 'default'}
              onClick={() => set({ look: (l.value || undefined) as WidgetLook | undefined })}
              className={`py-1.5 transition-colors ${
                (a.look ?? '') === l.value ? 'bg-cyan-500/20 text-quantum-cyan' : 'text-slate-400 hover:bg-space-900'
              }`}
            >
              {t(l.label)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <FieldLabel>{t('Font')}</FieldLabel>
        <select
          className={inputCls}
          value={customFont ? CUSTOM_FONT : a.font ?? ''}
          style={a.font && !customFont ? { fontFamily: fontStack(a.font) } : undefined}
          onChange={(e) => {
            if (e.target.value === CUSTOM_FONT) {
              setCustomFont(true);
              return;
            }
            setCustomFont(false);
            set({ font: e.target.value || undefined });
          }}
        >
          <option value="">{t('Default')}{inherited?.font ? ` (${inherited.font})` : ''}</option>
          <optgroup label={t('Included with StatsCitizen')}>
            {FONT_CHOICES.filter((f) => f.source === 'bundled').map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: fontStack(f.family) }}>
                {f.family}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('Windows fonts')}>
            {FONT_CHOICES.filter((f) => f.source === 'system').map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: fontStack(f.family) }}>
                {f.family}
              </option>
            ))}
          </optgroup>
          <option value={CUSTOM_FONT}>{t('Other installed font…')}</option>
        </select>
        {customFont && (
          <input
            className={`${inputCls} mt-1.5`}
            placeholder={t('Font name, e.g. Eurostile')}
            defaultValue={a.font ?? ''}
            onBlur={(e) => set({ font: e.target.value.trim() || undefined })}
          />
        )}
        <Toggle on={Boolean(a.fontForNumbers)} onChange={(v) => set({ fontForNumbers: v || undefined })} label={t('Use it for numbers too')} />
      </div>
      <div>
        <FieldLabel>
          {t('Text size')} · {Math.round(scale * 100)}%
        </FieldLabel>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={scale}
            onChange={(e) => set({ textScale: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}
            className="flex-1 accent-cyan-400"
          />
          <button onClick={() => set({ textScale: undefined })} disabled={!a.textScale} className="text-slate-500 hover:text-white disabled:opacity-30" title={t('Use default')}>
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div>
        <FieldLabel>{t('Weight')}</FieldLabel>
        <select className={inputCls} value={a.weight ?? ''} onChange={(e) => set({ weight: (e.target.value || undefined) as WeightLevel | undefined })}>
          {WEIGHT_CHOICES.map((w) => (
            <option key={w.value || 'default'} value={w.value}>
              {t(w.label)}
            </option>
          ))}
        </select>
      </div>
      {colorField('accent', 'Accent color', '#3fd8ff')}
      {colorField('textColor', 'Text color', '#e6f6ff')}
    </div>
  );
};

const OptionControl: React.FC<{ def: OptionDef; value: unknown; onChange: (v: unknown) => void }> = ({ def, value, onChange }) => {
  const t = useT();
  const v = value === undefined ? def.default : value;
  if (def.type === 'bool') return <Toggle on={Boolean(v)} onChange={onChange} label={t(def.label)} />;
  return (
    <div className="py-1">
      <FieldLabel>{t(def.label)}</FieldLabel>
      {def.type === 'number' ? (
        <input
          type="number"
          className={inputCls}
          value={Number(v)}
          min={def.min}
          max={def.max}
          step={def.step}
          onChange={(e) => onChange(e.target.value === '' ? def.default : Number(e.target.value))}
        />
      ) : def.type === 'select' ? (
        <select className={inputCls} value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {def.choices?.map((c) => (
            <option key={c.value} value={c.value}>
              {t(c.label)}
            </option>
          ))}
        </select>
      ) : (
        <input type="text" className={inputCls} value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
};

// ------------------------------------------------------------------ canvas editor

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w';

const EditorCanvas: React.FC<{
  layout: OverlayLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChangeWidget: (id: string, patch: Partial<OverlayWidget>) => void;
}> = ({ layout, selectedId, onSelect, onChangeWidget }) => {
  const t = useT();
  const drag = useRef<{
    id: string;
    mode: DragMode;
    startX: number;
    startY: number;
    rect: { x: number; y: number; w: number; h: number };
    canvas: DOMRect;
  } | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / d.canvas.width;
      const dy = (e.clientY - d.startY) / d.canvas.height;
      let { x, y, w, h } = d.rect;
      const corner = d.mode.length === 2;
      if (d.mode === 'move') {
        x = clamp(snap(x + dx), 0, 1 - w);
        y = clamp(snap(y + dy), 0, 1 - h);
      } else if (corner && e.shiftKey) {
        // Shift + corner: scale uniformly from the opposite corner, keeping the widget's shape.
        const left = d.mode.includes('w');
        const top = d.mode.includes('n');
        const ax = left ? x + w : x;
        const ay = top ? y + h : y;
        const pw = left ? w - dx : w + dx;
        const ph = top ? h - dy : h + dy;
        const maxS = Math.min((left ? ax : 1 - ax) / w, (top ? ay : 1 - ay) / h);
        const minS = Math.max(MIN_SIZE / w, MIN_SIZE / h);
        const s = clamp(Math.max(pw / w, ph / h), minS, maxS);
        w = d.rect.w * s;
        h = d.rect.h * s;
        x = left ? ax - w : ax;
        y = top ? ay - h : ay;
      } else {
        if (d.mode.includes('e')) w = clamp(snap(w + dx), MIN_SIZE, 1 - x);
        if (d.mode.includes('s')) h = clamp(snap(h + dy), MIN_SIZE, 1 - y);
        if (d.mode.includes('w')) {
          const nx = clamp(snap(x + dx), 0, x + w - MIN_SIZE);
          w = w + (x - nx);
          x = nx;
        }
        if (d.mode.includes('n')) {
          const ny = clamp(snap(y + dy), 0, y + h - MIN_SIZE);
          h = h + (y - ny);
          y = ny;
        }
      }
      onChangeWidget(d.id, { x, y, w, h });
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [onChangeWidget]);

  const start = (e: React.PointerEvent, w: OverlayWidget, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();
    const canvasEl = (e.currentTarget as HTMLElement).closest('.ov-canvas');
    if (!canvasEl) return;
    onSelect(w.id);
    drag.current = {
      id: w.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      rect: { x: w.x, y: w.y, w: w.w, h: w.h },
      canvas: canvasEl.getBoundingClientRect(),
    };
  };

  return (
    <OverlayCanvas
      showAll
      slotProps={(w) => ({
        className: `ov-edit-slot ${w.id === selectedId ? 'ov-edit-selected' : ''} ${w.hidden ? 'ov-edit-hidden' : ''}`,
        onPointerDown: (e) => start(e, w, 'move'),
      })}
      slotExtra={(w) => (
        <>
          <div className="ov-edit-label">
            {t(WIDGETS[w.type]?.label ?? w.type)}
            {w.id === selectedId && (
              <span className="ov-edit-size">
                {Math.round(w.w * layout.canvas.width)} × {Math.round(w.h * layout.canvas.height)}
              </span>
            )}
          </div>
          {w.id === selectedId &&
            (['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'] as DragMode[]).map((m) => (
              <div key={m} className={`ov-edit-handle ov-edit-${m}`} onPointerDown={(e) => start(e, w, m)} />
            ))}
        </>
      )}
    />
  );
};

// ------------------------------------------------------------------ main view

export const StreamOverlayView: React.FC = () => {
  const t = useT();
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [layouts, setLayouts] = useState<OverlayLayout[]>([]);
  const [activeId, setActiveId] = useState<string | null>(readActive);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewDemo, setPreviewDemo] = useState(true);
  const [obsDemo, setObsDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, number>>({});

  // ---- load
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void (async () => {
      try {
        const cfg = await desktopApi.overlayGetConfig();
        let stored = cfg.layouts.filter(isLayout);
        if (stored.length === 0) {
          stored = PRESETS.map((p) => cloneLayout(p));
          await Promise.all(stored.map((l) => desktopApi.overlaySaveLayout(l)));
        }
        setConfig(cfg);
        setLayouts(stored);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const layout = layouts.find((l) => l.id === activeId) ?? layouts[0] ?? null;
  useEffect(() => {
    if (!layout) return;
    try {
      localStorage.setItem(ACTIVE_KEY, layout.id);
    } catch {
      /* storage unavailable */
    }
  }, [layout?.id]);

  const server = config?.server;
  const settings = config?.settings;
  const base = server?.running ? `http://127.0.0.1:${server.port}` : null;

  const { feed, moments, pushTestMoment } = useOverlayFeed({
    api: base,
    layoutId: layout?.id,
    forceDemo: previewDemo || !server?.running,
  });

  // ---- persistence
  const scheduleSave = useCallback((l: OverlayLayout) => {
    window.clearTimeout(saveTimers.current[l.id]);
    saveTimers.current[l.id] = window.setTimeout(() => {
      desktopApi.overlaySaveLayout(l).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 300);
  }, []);

  const updateLayout = useCallback(
    (id: string, fn: (l: OverlayLayout) => OverlayLayout) => {
      setLayouts((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          const next = fn(l);
          scheduleSave(next);
          return next;
        })
      );
    },
    [scheduleSave]
  );

  const patchLayout = (patch: Partial<OverlayLayout>) => layout && updateLayout(layout.id, (l) => ({ ...l, ...patch }));

  const changeWidget = useCallback(
    (wid: string, patch: Partial<OverlayWidget>) => {
      if (!layout) return;
      updateLayout(layout.id, (l) => ({ ...l, widgets: l.widgets.map((w) => (w.id === wid ? { ...w, ...patch } : w)) }));
    },
    [layout?.id, updateLayout]
  );

  const addWidget = (type: WidgetType) => {
    if (!layout) return;
    const size = DEFAULT_SIZE[type];
    const w: OverlayWidget = {
      id: newId(type),
      type,
      x: clamp(0.5 - size.w / 2, 0, 1 - size.w),
      y: clamp(0.5 - size.h / 2, 0, 1 - size.h),
      w: size.w,
      h: size.h,
      showWhen: size.showWhen ?? 'always',
      options: {},
    };
    updateLayout(layout.id, (l) => ({ ...l, widgets: [...l.widgets, w] }));
    setSelectedId(w.id);
  };

  /** The boot animation is a widget (so it can be placed or used as its own OBS source); this toggles it. */
  const setBootWidget = (on: boolean) => {
    if (!layout) return;
    const existing = layout.widgets.find((w) => w.type === 'boot');
    if (on && !existing) {
      addWidget('boot');
    } else if (existing) {
      changeWidget(existing.id, { hidden: !on });
      if (on) setSelectedId(existing.id);
    }
  };

  const removeWidget = (wid: string) => {
    if (!layout) return;
    updateLayout(layout.id, (l) => ({ ...l, widgets: l.widgets.filter((w) => w.id !== wid) }));
    setSelectedId(null);
  };

  const createLayout = (from: OverlayLayout, name: string) => {
    const l = cloneLayout(from, { id: newId('layout'), name });
    setLayouts((prev) => [...prev, l]);
    setActiveId(l.id);
    setSelectedId(null);
    void desktopApi.overlaySaveLayout(l);
  };

  const deleteLayout = async () => {
    if (!layout || layouts.length <= 1) return;
    if (!window.confirm(t('Delete layout "{name}"? OBS sources using it will fall back to a preset.', { name: layout.name }))) return;
    await desktopApi.overlayDeleteLayout(layout.id);
    const rest = layouts.filter((l) => l.id !== layout.id);
    setLayouts(rest);
    setActiveId(rest[0]?.id ?? null);
    setSelectedId(null);
  };

  const importLayout = () => {
    try {
      const parsed = JSON.parse(importText ?? '');
      if (!isLayout(parsed)) throw new Error('invalid');
      createLayout(parsed, parsed.name);
      setImportText(null);
    } catch {
      setError(t('That is not a valid overlay layout.'));
    }
  };

  // ---- server settings
  const applySettings = async (patch: Partial<OverlaySettings>) => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      setConfig(await desktopApi.overlaySetSettings({ ...settings, ...patch }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleObsDemo = async (on: boolean) => {
    setObsDemo(on);
    await desktopApi.overlaySetDemo(on).catch(() => setObsDemo(!on));
  };

  const testMoment = (kind: string) => {
    if (server?.running) void desktopApi.overlayTestMoment(kind);
    else pushTestMoment(kind);
  };

  // ---- keyboard: delete / nudge selected widget
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (!layout || !selectedId || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const w = layout.widgets.find((x) => x.id === selectedId);
      if (!w) return;
      const step = e.shiftKey ? 0.01 : 0.001;
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (nudge[e.key]) {
        e.preventDefault();
        const [dx, dy] = nudge[e.key];
        changeWidget(w.id, { x: clamp(w.x + dx, 0, 1 - w.w), y: clamp(w.y + dy, 0, 1 - w.h) });
      } else if (e.key === 'Delete') {
        removeWidget(w.id);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- preview sizing: use the full width; only tall (vertical) canvases are capped by the window height
  const [stageRef, stageBox] = useBox<HTMLDivElement>();
  const PAD = 14; // room around the canvas so edge handles are never clipped
  const innerW = Math.max(0, stageBox.w - PAD * 2);
  const stageHeight = layout
    ? Math.min(window.innerHeight * 0.85, (innerW * layout.canvas.height) / layout.canvas.width + PAD * 2) || 300
    : 300;
  const stageScale =
    layout && innerW > 0 ? Math.min(innerW / layout.canvas.width, (stageHeight - PAD * 2) / layout.canvas.height) : 1;

  // ---- editor background (only in the editor, never sent to OBS)
  const [editorBg, setEditorBg] = useState<EditorBg>(() => readStored(BG_KEY, 'grid') as EditorBg);
  const [bgImage, setBgImage] = useState<string | null>(() => readStored(BG_IMG_KEY, '') || null);
  const pickBgImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setBgImage(url);
      setEditorBg('image');
      writeStored(BG_IMG_KEY, url); // may exceed storage quota: then it just lasts this session
    };
    reader.readAsDataURL(file);
  };
  useEffect(() => writeStored(BG_KEY, editorBg), [editorBg]);

  const selected = layout?.widgets.find((w) => w.id === selectedId) ?? null;
  const tokenQs = settings?.allowLan ? `?k=${settings.token}` : '';
  const urlFor = (path: string) => (base ? `${base}${path}` : '');
  const lanUrlFor = (path: string) =>
    server?.lan && server.lanIps[0] ? `http://${server.lanIps[0]}:${server.port}${path}${tokenQs}` : '';

  if (!isTauriRuntime()) {
    return <div className="py-24 text-center text-xs font-mono text-slate-500">{t('Tauri desktop runtime is required.')}</div>;
  }
  if (!config || !layout) {
    return (
      <div className="py-24 text-center text-xs font-mono text-slate-500">
        {error ? <span className="text-rose-300">{error}</span> : t('Loading…')}
      </div>
    );
  }

  const aspectChanged = (() => {
    const preset = PRESETS.find((p) => p.id === layout.id);
    if (!preset) return false;
    return Math.abs(preset.canvas.width / preset.canvas.height - layout.canvas.width / layout.canvas.height) > 0.05;
  })();
  const canvasPreset = CANVAS_PRESETS.find((c) => c.width === layout.canvas.width && c.height === layout.canvas.height);
  const layoutPath = `/overlay/${encodeURIComponent(layout.id)}`;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-orbitron font-bold text-white tracking-wider flex items-center gap-2.5">
            <Clapperboard className="w-5 h-5 text-quantum-cyan" />
            {t('STREAM OVERLAY')}
          </h2>
          <p className="text-xs font-mono text-slate-400 mt-1">
            {t('Live widgets for OBS: add them as a Browser Source. Everything stays on this PC.')}
          </p>
        </div>

        <div className="glass-panel hud-radius px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 border border-cyan-500/15">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className={`w-2 h-2 rounded-full ${server?.running ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400' : 'bg-slate-600'}`} />
            <span className={server?.running ? 'text-emerald-300' : 'text-slate-400'}>
              {server?.running ? t('Server on · port {port}', { port: server.port }) : t('Server off')}
            </span>
          </div>
          <div className="w-44">
            <Toggle on={settings!.enabled} disabled={busy} onChange={(v) => void applySettings({ enabled: v })} label={t('Overlay server')} />
          </div>
          <div className="w-44">
            <Toggle on={obsDemo} disabled={!server?.running} onChange={(v) => void toggleObsDemo(v)} label={t('Demo data in OBS')} />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-mono text-rose-200 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">×</button>
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 xl:grid-cols-[200px_minmax(0,1fr)_270px]">
        {/* ---------------- left: layouts + widgets */}
        <div className="glass-panel hud-radius p-3 space-y-4 border border-cyan-500/10 self-start">
          <div>
            <FieldLabel>{t('Layout')}</FieldLabel>
            <select
              className={inputCls}
              value={layout.id}
              onChange={(e) => {
                setActiveId(e.target.value);
                setSelectedId(null);
              }}
            >
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <div className="flex gap-1.5 mt-2">
              <button
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border border-slate-700 text-[11px] font-mono text-slate-300 hover:border-cyan-500/40"
                onClick={() => createLayout(layout, `${layout.name} (${t('copy')})`)}
                title={t('Duplicate layout')}
              >
                <CopyPlus className="w-3.5 h-3.5" /> {t('Duplicate')}
              </button>
              <button
                className="px-2 py-1.5 rounded-md border border-slate-700 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 disabled:opacity-30"
                disabled={layouts.length <= 1}
                onClick={() => void deleteLayout()}
                title={t('Delete layout')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <select
              className={`${inputCls} mt-2`}
              value=""
              onChange={(e) => {
                const p = PRESETS.find((x) => x.id === e.target.value);
                if (p) createLayout(p, t(p.name));
              }}
            >
              <option value="">{t('+ New from template…')}</option>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.name)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel>{t('Widgets')}</FieldLabel>
            <div className="space-y-1">
              {layout.widgets.map((w) => (
                <div
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs font-mono transition-colors ${
                    w.id === selectedId ? 'bg-cyan-500/15 text-quantum-cyan ring-1 ring-cyan-500/40' : 'bg-space-950/50 text-slate-300 hover:bg-space-900'
                  } ${w.hidden ? 'opacity-50' : ''}`}
                >
                  <span className="truncate">{t(WIDGETS[w.type]?.label ?? w.type)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      changeWidget(w.id, { hidden: !w.hidden });
                    }}
                    className="text-slate-500 hover:text-white"
                    title={w.hidden ? t('Show') : t('Hide')}
                  >
                    {w.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
            <select
              className={`${inputCls} mt-2`}
              value=""
              onChange={(e) => e.target.value && addWidget(e.target.value as WidgetType)}
            >
              <option value="">{t('+ Add widget…')}</option>
              {WIDGET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(WIDGETS[type].label)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FieldLabel>{t('Test a moment')}</FieldLabel>
            <div className="grid grid-cols-2 gap-1">
              {Object.keys(TEST_MOMENTS)
                .filter((k) => MOMENT_LABELS[k])
                .map((k) => (
                  <button
                    key={k}
                    onClick={() => testMoment(k)}
                    className="px-1.5 py-1 rounded border border-slate-700 text-[10px] font-mono text-slate-300 hover:border-cyan-500/40 hover:text-white"
                  >
                    {t(MOMENT_LABELS[k])}
                  </button>
                ))}
            </div>
            <p className="text-[10px] font-mono text-slate-500 mt-1.5">
              {server?.running ? t('Plays in OBS and here.') : t('Plays here only (server is off).')}
            </p>
          </div>
        </div>

        {/* ---------------- center: preview */}
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 uppercase tracking-widest text-[10px]">{t('Background')}</span>
              <div className="flex rounded-md border border-slate-700 overflow-hidden">
                {(['grid', 'dark', 'light', 'image'] as EditorBg[]).map((b) => (
                  <button
                    key={b}
                    disabled={b === 'image' && !bgImage}
                    onClick={() => setEditorBg(b)}
                    className={`px-2.5 py-1 transition-colors disabled:opacity-30 ${
                      editorBg === b ? 'bg-cyan-500/20 text-quantum-cyan' : 'hover:bg-space-900 text-slate-400'
                    }`}
                  >
                    {t(BG_LABELS[b])}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700 hover:border-cyan-500/40 cursor-pointer">
                <ImageIcon className="w-3.5 h-3.5" />
                {t('Use a game screenshot…')}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => pickBgImage(e.target.files?.[0])} />
              </label>
            </div>
            <div className="w-56">
              <Toggle on={previewDemo || !server?.running} disabled={!server?.running} onChange={setPreviewDemo} label={t('Preview with demo data')} />
            </div>
          </div>
          <div ref={stageRef} className="w-full">
            <div
              className="relative w-full rounded-lg overflow-hidden border border-slate-800 ov-editor-stage"
              data-bg={editorBg}
              style={{ height: stageHeight, ['--ed' as string]: String(1 / Math.max(stageScale, 0.05)) }}
              onPointerDown={() => setSelectedId(null)}
            >
              <OverlayRoot layout={layout} feed={feed} moments={moments} editing style={{ position: 'absolute', inset: PAD }}>
                <FitCanvas width={layout.canvas.width} height={layout.canvas.height} className="ov-fit-visible">
                  <div
                    className="ov-editor-bg"
                    style={editorBg === 'image' && bgImage ? { backgroundImage: `url("${bgImage}")` } : undefined}
                  />
                  <EditorCanvas layout={layout} selectedId={selectedId} onSelect={setSelectedId} onChangeWidget={changeWidget} />
                </FitCanvas>
              </OverlayRoot>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-500">
            <span>
              {layout.canvas.width} × {layout.canvas.height} ·{' '}
              {feed.demo ? t('Demo data') : feed.frame?.connected ? t('Live data') : t('Waiting for the game…')}
            </span>
            <span>{t('Drag to move · corners/edges to resize · Shift + corner keeps the shape')}</span>
          </div>

          {/* OBS setup */}
          <div className="glass-panel hud-radius p-4 border border-cyan-500/10 space-y-3">
            <div className="flex items-center gap-2 text-xs font-orbitron font-bold tracking-wider text-quantum-cyan">
              <Radio className="w-4 h-4" /> {t('ADD TO OBS')}
            </div>
            {!server?.running ? (
              <div className="text-xs font-mono text-slate-400 flex items-center justify-between gap-3">
                <span>{t('Turn on the overlay server to get the OBS link.')}</span>
                <button
                  onClick={() => void applySettings({ enabled: true })}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-md bg-cyan-500/90 hover:bg-cyan-400 text-space-950 font-bold"
                >
                  {t('Turn on')}
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md bg-space-950/60 border border-slate-800 p-3 space-y-2">
                    <div className="text-[11px] font-mono font-bold text-slate-200">{t('Option A · Whole layout (one source)')}</div>
                    <div className="text-[11px] font-mono text-slate-500 break-all">{urlFor(layoutPath)}</div>
                    <div className="text-[11px] font-mono text-amber-200/90">
                      {t('Browser Source size: {w} × {h}', { w: layout.canvas.width, h: layout.canvas.height })}
                    </div>
                    <CopyButton text={urlFor(layoutPath)} label={t('Copy layout URL')} primary />
                  </div>
                  <div className="rounded-md bg-space-950/60 border border-slate-800 p-3 space-y-2">
                    <div className="text-[11px] font-mono font-bold text-slate-200">{t('Option B · One source per widget')}</div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {t('Select a widget and copy its URL. Any size works: widgets adapt to the source (wide → strip, tall → column).')}
                    </div>
                    {selected ? (
                      <CopyButton text={urlFor(`${layoutPath}/${encodeURIComponent(selected.id)}`)} label={t('Copy URL: {name}', { name: t(WIDGETS[selected.type].label) })} />
                    ) : (
                      <div className="text-[11px] font-mono text-slate-600">{t('No widget selected.')}</div>
                    )}
                  </div>
                </div>
                <p className="text-[10px] font-mono text-slate-500">
                  {t('In OBS: Sources → + → Browser → paste the URL. Leave "Shutdown source when not visible" off so moments are never missed.')}
                </p>
                {server.lan && lanUrlFor(layoutPath) && (
                  <div className="text-[11px] font-mono text-slate-400 flex flex-wrap items-center gap-2">
                    <span>{t('From another PC:')}</span>
                    <span className="text-slate-500 break-all">{lanUrlFor(layoutPath)}</span>
                    <CopyButton text={lanUrlFor(layoutPath)} label={t('Copy')} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ---------------- right: properties */}
        <div className="glass-panel hud-radius p-3 border border-cyan-500/10 self-start space-y-3">
          {selected ? (
            <>
              <div>
                <div className="text-xs font-orbitron font-bold tracking-wider text-quantum-cyan uppercase">
                  {t(WIDGETS[selected.type].label)}
                </div>
                <p className="text-[11px] font-mono text-slate-500 mt-0.5">{t(WIDGETS[selected.type].description)}</p>
              </div>
              <div>
                <FieldLabel>{t('Visible when')}</FieldLabel>
                <select
                  className={inputCls}
                  value={selected.showWhen ?? 'always'}
                  onChange={(e) => changeWidget(selected.id, { showWhen: e.target.value as ShowWhen })}
                >
                  {SHOW_WHEN.map((s) => (
                    <option key={s.value} value={s.value}>
                      {t(s.label)}
                    </option>
                  ))}
                </select>
              </div>
              {WIDGETS[selected.type].options.length > 0 && (
                <div className="border-t border-slate-800 pt-2">
                  {WIDGETS[selected.type].options.map((def) => (
                    <OptionControl
                      key={def.key}
                      def={def}
                      value={selected.options?.[def.key]}
                      onChange={(v) => changeWidget(selected.id, { options: { ...(selected.options ?? {}), [def.key]: v } })}
                    />
                  ))}
                </div>
              )}
              <div className="border-t border-slate-800 pt-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-orbitron font-bold tracking-wider text-quantum-cyan uppercase">{t('Appearance')}</span>
                  {selected.appearance && Object.keys(selected.appearance).length > 0 && (
                    <button
                      onClick={() => changeWidget(selected.id, { appearance: undefined })}
                      className="text-[10px] font-mono text-slate-500 hover:text-white"
                    >
                      {t('Reset')}
                    </button>
                  )}
                </div>
                <AppearanceEditor
                  key={selected.id}
                  value={selected.appearance}
                  inherited={layout.appearance}
                  onChange={(appearance) => changeWidget(selected.id, { appearance })}
                />
              </div>
              <div className="border-t border-slate-800 pt-2 grid grid-cols-2 gap-2">
                {(['x', 'y', 'w', 'h'] as const).map((k) => {
                  const dim = k === 'x' || k === 'w' ? layout.canvas.width : layout.canvas.height;
                  return (
                    <div key={k}>
                      <FieldLabel>{k === 'w' ? t('Width') : k === 'h' ? t('Height') : k.toUpperCase()} (px)</FieldLabel>
                      <input
                        type="number"
                        className={inputCls}
                        value={Math.round(selected[k] * dim)}
                        onChange={(e) => {
                          const v = clamp(Number(e.target.value) / dim, k === 'w' || k === 'h' ? MIN_SIZE : 0, 1);
                          changeWidget(selected.id, { [k]: v });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => changeWidget(selected.id, { hidden: !selected.hidden })}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-slate-700 text-[11px] font-mono text-slate-300 hover:border-cyan-500/40"
                >
                  {selected.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {selected.hidden ? t('Show') : t('Hide')}
                </button>
                <button
                  onClick={() => removeWidget(selected.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-slate-700 text-[11px] font-mono text-slate-300 hover:text-rose-300 hover:border-rose-500/40"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {t('Remove')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-orbitron font-bold tracking-wider text-quantum-cyan uppercase">{t('Layout settings')}</div>
              <div>
                <FieldLabel>{t('Name')}</FieldLabel>
                <input className={inputCls} value={layout.name} onChange={(e) => patchLayout({ name: e.target.value })} />
              </div>
              <div>
                <FieldLabel>{t('OBS canvas resolution')}</FieldLabel>
                <select
                  className={inputCls}
                  value={canvasPreset ? `${canvasPreset.width}x${canvasPreset.height}` : 'custom'}
                  onChange={(e) => {
                    if (e.target.value === 'custom') return;
                    const [w, h] = e.target.value.split('x').map(Number);
                    patchLayout({ canvas: { width: w, height: h } });
                  }}
                >
                  {CANVAS_PRESETS.map((c) => (
                    <option key={c.label} value={`${c.width}x${c.height}`}>
                      {t(c.label)}
                    </option>
                  ))}
                  <option value="custom">{t('Custom')}</option>
                </select>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {(['width', 'height'] as const).map((k) => (
                    <input
                      key={k}
                      type="number"
                      min={320}
                      max={7680}
                      className={inputCls}
                      value={layout.canvas[k]}
                      onChange={(e) => {
                        const v = clamp(Math.round(Number(e.target.value) || 0), 320, 7680);
                        patchLayout({ canvas: { ...layout.canvas, [k]: v } });
                      }}
                      title={k === 'width' ? t('Width') : t('Height')}
                    />
                  ))}
                </div>
                <p className="text-[10px] font-mono text-slate-500 mt-1.5">
                  {t('Match your OBS canvas (Settings → Video → Base resolution). Positions are relative, so widgets stay in place when you change it.')}
                </p>
                {aspectChanged && (
                  <p className="text-[10px] font-mono text-amber-300 mt-1 flex gap-1">
                    <AlertTriangle className="w-3 h-3 flex-none mt-px" />
                    {t('The aspect ratio changed — check widget positions.')}
                  </p>
                )}
              </div>
              <div>
                <FieldLabel>{t('Viewer language')}</FieldLabel>
                <select className={inputCls} value={layout.lang} onChange={(e) => patchLayout({ lang: e.target.value as OverlayLayout['lang'] })}>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                </select>
              </div>
              <div>
                <FieldLabel>{t('Theme')}</FieldLabel>
                <select className={inputCls} value={layout.theme} onChange={(e) => patchLayout({ theme: e.target.value as OverlayTheme })}>
                  {THEMES.map((th) => (
                    <option key={th.value} value={th.value}>
                      {t(th.label)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>
                  {t('Panel opacity')} · {Math.round(layout.panelOpacity * 100)}%
                </FieldLabel>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={layout.panelOpacity}
                  onChange={(e) => patchLayout({ panelOpacity: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>
              <Toggle on={layout.combatMode} onChange={(v) => patchLayout({ combatMode: v })} label={t('Combat mode (red tint on missile lock / hits)')} />
              <Toggle
                on={Boolean(layout.brandColors)}
                onChange={(v) => patchLayout({ brandColors: v })}
                label={t('Ship brand colors while seated')}
              />
              <Toggle
                on={layout.widgets.some((w) => w.type === 'boot' && !w.hidden)}
                onChange={(v) => setBootWidget(v)}
                label={t('Boot animation when boarding a ship')}
              />

              <div className="border-t border-slate-800 pt-2">
                <div className="text-[11px] font-orbitron font-bold tracking-wider text-quantum-cyan uppercase">{t('Widget appearance')}</div>
                <p className="text-[10px] font-mono text-slate-500 mb-2">{t('Applies to every widget. Select a widget to override it individually.')}</p>
                <AppearanceEditor key={layout.id} value={layout.appearance} onChange={(appearance) => patchLayout({ appearance })} />
              </div>

              <div className="border-t border-slate-800 pt-2 space-y-2">
                <FieldLabel>{t('Share')}</FieldLabel>
                <div className="flex gap-2">
                  <CopyButton text={JSON.stringify(layout, null, 2)} label={t('Export')} />
                  <button
                    onClick={() => setImportText(importText === null ? '' : null)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono font-bold border border-cyan-500/40 text-quantum-cyan hover:bg-cyan-500/10"
                  >
                    <Upload className="w-3.5 h-3.5" /> {t('Import')}
                  </button>
                </div>
                {importText !== null && (
                  <div className="space-y-2">
                    <textarea
                      className={`${inputCls} h-24`}
                      placeholder={t('Paste a layout JSON here')}
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                    />
                    <button
                      onClick={importLayout}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-cyan-500/90 hover:bg-cyan-400 text-space-950 text-[11px] font-mono font-bold"
                    >
                      <Download className="w-3.5 h-3.5" /> {t('Add layout')}
                    </button>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-800 pt-2 space-y-1">
                <FieldLabel>{t('Server')}</FieldLabel>
                <div>
                  <FieldLabel>{t('Port')}</FieldLabel>
                  <input
                    type="number"
                    className={inputCls}
                    defaultValue={settings!.port}
                    min={1024}
                    max={65535}
                    onBlur={(e) => {
                      const p = clamp(Math.round(Number(e.target.value) || 47800), 1024, 65535);
                      if (p !== settings!.port) void applySettings({ port: p });
                    }}
                  />
                </div>
                <Toggle
                  on={settings!.allowLan}
                  disabled={busy}
                  onChange={(v) => void applySettings({ allowLan: v })}
                  label={t('Allow other PCs on my network (2-PC setup)')}
                />
                {settings!.allowLan && (
                  <div className="text-[10px] font-mono text-amber-200/90 space-y-1">
                    <p>{t('Other devices need the access key in the URL. Keep it out of your stream.')}</p>
                    <button
                      onClick={() => void desktopApi.overlayRegenerateToken().then(setConfig)}
                      className="flex items-center gap-1 text-slate-400 hover:text-white"
                    >
                      <RefreshCw className="w-3 h-3" /> {t('New access key')}
                    </button>
                  </div>
                )}
              </div>
              <p className="text-[10px] font-mono text-slate-500 flex gap-1 pt-1">
                <Sparkles className="w-3 h-3 flex-none mt-px" />
                {t('Tip: drag widgets to move them, drag corners or edges to resize (hold Shift on a corner to keep the shape), arrows to nudge, Delete to remove.')}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
