import type { OverlayLayout, OverlayWidget, WidgetType, ShowWhen } from './types.js';

let seq = 0;
export const newId = (prefix = 'w') =>
  `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const w = (
  type: WidgetType,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: { showWhen?: ShowWhen; options?: Record<string, unknown>; id?: string } = {}
): OverlayWidget => ({
  id: extra.id ?? type,
  type,
  x,
  y,
  w: width,
  h: height,
  showWhen: extra.showWhen ?? 'always',
  options: extra.options ?? {},
});

const base = (id: string, name: string, widgets: OverlayWidget[], patch: Partial<OverlayLayout> = {}): OverlayLayout => ({
  id,
  name,
  version: 1,
  canvas: { width: 1920, height: 1080 },
  lang: 'en',
  theme: 'statscitizen',
  combatMode: true,
  panelOpacity: 0.78,
  widgets,
  ...patch,
});

export const PRESETS: OverlayLayout[] = [
  base('cockpit-classic', 'Cockpit Classic', [
    w('contracts', 0.021, 0.037, 0.245, 0.3, { showWhen: 'hasContract' }),
    w('profit', 0.75, 0.037, 0.229, 0.2),
    w('goal', 0.75, 0.245, 0.229, 0.075),
    w('feed', 0.75, 0.34, 0.229, 0.24),
    w('moments', 0.22, 0.25, 0.56, 0.17),
    w('ship', 0.021, 0.665, 0.292, 0.24, { showWhen: 'seated' }),
    w('vitals', 0.323, 0.7, 0.172, 0.205, { showWhen: 'connected' }),
    w('ticker', 0, 0.952, 1, 0.048),
  ]),
  base(
    'minimal',
    'Minimal',
    [
      w('contracts', 0.015, 0.025, 0.42, 0.065, { showWhen: 'hasContract', options: { maxContracts: 1 } }),
      w('profit', 0.735, 0.025, 0.25, 0.065, { options: { showSparkline: false } }),
      w('moments', 0.25, 0.22, 0.5, 0.15),
    ],
    { combatMode: false, panelOpacity: 0.6, theme: 'minimal' }
  ),
  base(
    'bounty-hunter',
    'Bounty Hunter',
    [
      w('contracts', 0.021, 0.037, 0.245, 0.26, { showWhen: 'hasContract' }),
      w('moments', 0.22, 0.2, 0.56, 0.17),
      w('feed', 0.75, 0.037, 0.229, 0.26),
      w('ship', 0.021, 0.64, 0.31, 0.27, { showWhen: 'seated' }),
      w('vitals', 0.34, 0.735, 0.16, 0.17, { showWhen: 'connected' }),
      w('deaths', 0.83, 0.72, 0.15, 0.185),
      w('flight', 0.6, 0.78, 0.2, 0.125, { showWhen: 'seated' }),
    ],
    { theme: 'manufacturer' }
  ),
  base('trader', 'Trader / Hauler', [
    w('profit', 0.72, 0.037, 0.26, 0.27),
    w('goal', 0.72, 0.32, 0.26, 0.08),
    w('contracts', 0.021, 0.037, 0.21, 0.45, { options: { maxContracts: 3 } }),
    w('moments', 0.25, 0.22, 0.5, 0.15),
    w('ticker', 0, 0.952, 1, 0.048),
  ]),
  base(
    'ending-screen',
    'Ending Screen',
    [w('debrief', 0.1, 0.08, 0.8, 0.84)],
    { combatMode: false, panelOpacity: 0.85 }
  ),
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** Common OBS canvas resolutions offered in the editor. */
export const CANVAS_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: '1920 × 1080 (1080p)', width: 1920, height: 1080 },
  { label: '2560 × 1440 (1440p)', width: 2560, height: 1440 },
  { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
  { label: '1280 × 720 (720p)', width: 1280, height: 720 },
  { label: '1080 × 1920 (vertical)', width: 1080, height: 1920 },
  { label: '2560 × 1080 (ultrawide)', width: 2560, height: 1080 },
];

/** Default box for a widget added from the editor. */
export const DEFAULT_SIZE: Record<WidgetType, { w: number; h: number; showWhen?: ShowWhen }> = {
  contracts: { w: 0.245, h: 0.28, showWhen: 'hasContract' },
  profit: { w: 0.23, h: 0.2 },
  goal: { w: 0.23, h: 0.075 },
  vitals: { w: 0.17, h: 0.2, showWhen: 'connected' },
  ship: { w: 0.29, h: 0.24, showWhen: 'seated' },
  flight: { w: 0.16, h: 0.16, showWhen: 'seated' },
  moments: { w: 0.56, h: 0.17 },
  deaths: { w: 0.15, h: 0.185 },
  ticker: { w: 1, h: 0.048 },
  feed: { w: 0.23, h: 0.24 },
  location: { w: 0.21, h: 0.08 },
  debrief: { w: 0.8, h: 0.84 },
  boot: { w: 0.3, h: 0.32 },
};

export const cloneLayout = (l: OverlayLayout, patch: Partial<OverlayLayout> = {}): OverlayLayout =>
  ({ ...JSON.parse(JSON.stringify(l)), ...patch }) as OverlayLayout;

/** Light validation for imported/stored layouts. */
export function isLayout(v: unknown): v is OverlayLayout {
  const l = v as OverlayLayout;
  return (
    !!l &&
    typeof l.id === 'string' &&
    typeof l.name === 'string' &&
    !!l.canvas &&
    typeof l.canvas.width === 'number' &&
    typeof l.canvas.height === 'number' &&
    Array.isArray(l.widgets)
  );
}
