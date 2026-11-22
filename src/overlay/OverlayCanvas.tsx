import React, { useMemo } from 'react';
import { resolveManufacturer, type ManufacturerTheme } from '../themes/manufacturers.js';
import type { LiveTelemetryFrame } from '../types/telemetry.js';
import type { Appearance, FeedState, Moment, OverlayLayout, OverlayWidget, WeightLevel } from './types.js';
import { fontStack } from './fonts.js';
import { WIDGETS, type Variant, type WidgetDef } from './widgets.js';
import { OverlayCtx, localeFor, makeT, useBox, useCombat, useOv, useShipBrand, widgetVisible } from './util.js';

// ------------------------------------------------------------------ theme

const hexRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

export function themeStyle(
  layout: OverlayLayout,
  frame: LiveTelemetryFrame | null,
  brand: ManufacturerTheme | null = null
): React.CSSProperties {
  const a = Math.max(0, Math.min(1, layout.panelOpacity ?? 0.78));
  let accent = '#3fd8ff';
  let accent2 = '#8af0ff';
  let panel = `rgba(8, 14, 26, ${a})`;
  let radius = 6;
  switch (layout.theme) {
    case 'manufacturer': {
      const st = frame?.vehicle?.state;
      const m = resolveManufacturer(st?.manufacturer, st?.class_name);
      accent = m.colors.accent;
      accent2 = m.colors.c300;
      radius = m.radius;
      break;
    }
    case 'mobiglas':
      accent = '#5cf2c4';
      accent2 = '#b4ffe8';
      panel = `rgba(6, 24, 28, ${a})`;
      radius = 14;
      break;
    case 'minimal':
      accent = '#ffffff';
      accent2 = '#dfe8f0';
      panel = `rgba(0, 0, 0, ${a * 0.85})`;
      radius = 10;
      break;
    case 'mfd':
      accent = '#ffb347';
      accent2 = '#ffd9a0';
      panel = `rgba(22, 14, 4, ${a})`;
      radius = 0;
      break;
  }
  // Optional: follow the ship manufacturer's colors on top of any theme.
  if (layout.brandColors && brand) {
    accent = brand.colors.accent;
    accent2 = brand.colors.c300;
  }
  return {
    ['--ov-accent' as string]: accent,
    ['--ov-accent2' as string]: accent2,
    ['--ov-accent-rgb' as string]: hexRgb(accent),
    ['--ov-panel' as string]: panel,
    ['--ov-radius' as string]: `${radius / 16}em`,
  };
}

// ------------------------------------------------------------------ widget box

/** Pick the variant whose design aspect ratio is closest to the box's. */
export function pickVariant(def: WidgetDef, w: number, h: number): Variant {
  if (w <= 0 || h <= 0) return 'card';
  const r = Math.log(w / h);
  let best: Variant = 'card';
  let bestD = Infinity;
  for (const [name, size] of Object.entries(def.variants) as Array<[Variant, { w: number; h: number }]>) {
    const d = Math.abs(r - Math.log(size.w / size.h));
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

const WEIGHTS: Record<WeightLevel, [number, number, number, number]> = {
  regular: [400, 600, 700, 800],
  semibold: [600, 700, 800, 900],
  bold: [700, 800, 900, 900],
  heavy: [800, 900, 900, 900],
};

/** Layout defaults merged with the widget's own overrides (unset fields inherit). */
export function effectiveAppearance(layout: OverlayLayout, widget: OverlayWidget): Appearance {
  const out: Appearance = {};
  for (const src of [layout.appearance, widget.appearance]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;

function appearanceStyle(a: Appearance, combat: boolean): React.CSSProperties {
  const st: Record<string, string> = {};
  if (a.font) {
    const stack = fontStack(a.font);
    st['--ov-font'] = stack;
    st['--ov-head'] = stack;
    if (a.fontForNumbers) st['--ov-mono'] = stack;
  }
  if (a.weight && WEIGHTS[a.weight]) {
    const [w, wb, wh, wx] = WEIGHTS[a.weight];
    st['--ov-w'] = String(w);
    st['--ov-wb'] = String(wb);
    st['--ov-wh'] = String(wh);
    st['--ov-wx'] = String(wx);
  }
  // Combat mode wins over a custom accent so alerts stay red.
  if (a.accent && HEX.test(a.accent) && !combat) {
    st['--ov-accent'] = a.accent;
    st['--ov-accent2'] = a.accent;
    st['--ov-accent-rgb'] = hexRgb(a.accent);
  }
  if (a.textColor && HEX.test(a.textColor)) st['--ov-text'] = a.textColor;
  return st as React.CSSProperties;
}

export const WidgetBox: React.FC<{ widget: OverlayWidget }> = ({ widget }) => {
  const [ref, box] = useBox<HTMLDivElement>();
  const { layout, combat } = useOv();
  const def = WIDGETS[widget.type];
  if (!def) return null;
  const look = effectiveAppearance(layout, widget);
  const variant = pickVariant(def, box.w, box.h);
  const base = def.variants[variant] ?? def.variants.card;
  const fit = widget.type === 'ticker' ? box.h / base.h : Math.min(box.w / base.w, box.h / base.h);
  const textScale = Math.max(0.3, Math.min(3, look.textScale ?? 1));
  const Comp = def.Comp;
  return (
    <div
      ref={ref}
      className={`ov-widget ov-w-${widget.type} ov-v-${variant}`}
      data-look={look.look ?? (layout.theme === 'minimal' ? 'minimal' : 'panel')}
      style={{ fontSize: `${Math.max(3, fit * 16 * textScale)}px`, ...appearanceStyle(look, combat && layout.combatMode) }}
    >
      {box.w > 0 && <Comp variant={variant} options={widget.options ?? {}} />}
    </div>
  );
};

// ------------------------------------------------------------------ root + canvas

export const OverlayRoot: React.FC<{
  layout: OverlayLayout;
  feed: FeedState;
  moments: Moment[];
  editing?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ layout, feed, moments, editing = false, className = '', style, children }) => {
  const inCombat = useCombat(feed.frame);
  const combat = layout.combatMode && inCombat;
  const brand = useShipBrand(feed.frame);
  const ctx = useMemo(
    () => ({ feed, moments, layout, combat: inCombat, brand, editing, t: makeT(layout.lang), locale: localeFor(layout.lang) }),
    [feed, moments, layout, inCombat, brand, editing]
  );
  return (
    <OverlayCtx.Provider value={ctx}>
      <div
        className={`ov-root ${className}`}
        data-theme={layout.theme}
        data-combat={combat ? '1' : undefined}
        style={{ ...themeStyle(layout, feed.frame, brand), ...style }}
      >
        {combat && <div className="ov-combat-frame" />}
        {children}
      </div>
    </OverlayCtx.Provider>
  );
};

export interface SlotHooks {
  /** Extra props for each widget slot (editor drag handlers, selection class). */
  slotProps?: (w: OverlayWidget) => React.HTMLAttributes<HTMLDivElement> & { className?: string };
  /** Extra children for each slot (resize handles, labels). */
  slotExtra?: (w: OverlayWidget) => React.ReactNode;
  /** Render widgets whose visibility condition is false (dimmed) instead of fading them out. */
  showAll?: boolean;
}

/** Widgets positioned on a canvas of layout.canvas size (caller scales it). */
export const OverlayCanvas: React.FC<SlotHooks> = ({ slotProps, slotExtra, showAll }) => {
  const { layout, feed, combat } = useOv();
  return (
  <div className="ov-canvas" style={{ width: layout.canvas.width, height: layout.canvas.height }}>
    {layout.widgets.map((w) => {
      const visible = widgetVisible(w, feed, combat);
      const extra = slotProps?.(w) ?? {};
      if (w.hidden && !showAll) return null;
      return (
        <div
          key={w.id}
          {...extra}
          className={`ov-slot ${visible ? '' : showAll ? 'ov-slot-dim' : 'ov-slot-hidden'} ${extra.className ?? ''}`}
          style={{
            left: `${w.x * 100}%`,
            top: `${w.y * 100}%`,
            width: `${w.w * 100}%`,
            height: `${w.h * 100}%`,
            ...(extra.style ?? {}),
          }}
        >
          <WidgetBox widget={w} />
          {slotExtra?.(w)}
        </div>
      );
    })}
  </div>
  );
};

/** Scale a W×H canvas to fit its container (letterboxed, centered). */
export const FitCanvas: React.FC<{ width: number; height: number; children: React.ReactNode; className?: string }> = ({
  width,
  height,
  children,
  className = '',
}) => {
  const [ref, box] = useBox<HTMLDivElement>();
  const s = box.w > 0 && box.h > 0 ? Math.min(box.w / width, box.h / height) : 0;
  return (
    <div ref={ref} className={`ov-fit ${className}`}>
      <div
        style={{
          position: 'absolute',
          width,
          height,
          left: (box.w - width * s) / 2,
          top: (box.h - height * s) / 2,
          transform: `scale(${s})`,
          transformOrigin: '0 0',
          visibility: s > 0 ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
};
