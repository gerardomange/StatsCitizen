import type { Lang } from '../i18n/index.js';
import type { LiveTelemetryEvent, LiveTelemetryFrame } from '../types/telemetry.js';

export type WidgetType =
  | 'contracts'
  | 'profit'
  | 'goal'
  | 'vitals'
  | 'ship'
  | 'flight'
  | 'moments'
  | 'deaths'
  | 'ticker'
  | 'feed'
  | 'location'
  | 'debrief'
  | 'boot';

/** When a widget is shown; it fades out otherwise. */
export type ShowWhen = 'always' | 'connected' | 'seated' | 'onFoot' | 'hasContract' | 'combat';

export type WidgetLook = 'panel' | 'minimal' | 'text';
export type WeightLevel = 'regular' | 'semibold' | 'bold' | 'heavy';

/** Visual overrides. On a layout they are the defaults for every widget; a widget can override each field. */
export interface Appearance {
  /** panel = framed HUD panel, minimal = flat panel without frame, text = no background. */
  look?: WidgetLook;
  /** CSS font family name (bundled or installed on the OBS PC). */
  font?: string;
  /** Use the chosen font for numbers too (default keeps the monospaced number font). */
  fontForNumbers?: boolean;
  /** Text size multiplier, 1 = 100%. */
  textScale?: number;
  weight?: WeightLevel;
  /** Hex colors. */
  accent?: string;
  textColor?: string;
}

export interface OverlayWidget {
  id: string;
  type: WidgetType;
  /** Position and size as fractions (0–1) of the canvas, so changing resolution keeps placement. */
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
  showWhen?: ShowWhen;
  options?: Record<string, unknown>;
  appearance?: Appearance;
}

export type OverlayTheme = 'statscitizen' | 'manufacturer' | 'mobiglas' | 'minimal' | 'mfd';

export interface OverlayLayout {
  id: string;
  name: string;
  version: 1;
  canvas: { width: number; height: number };
  lang: Lang;
  theme: OverlayTheme;
  /** Tint the whole overlay red while in combat (missile lock, hits, shields critical). */
  combatMode: boolean;
  /** While seated in a ship, tint every widget with the ship manufacturer's colors (any theme). */
  brandColors?: boolean;
  /** 0–1 panel background opacity. */
  panelOpacity: number;
  /** Default appearance for all widgets. */
  appearance?: Appearance;
  widgets: OverlayWidget[];
}

export interface ContractObjective {
  id: string;
  /** Player-facing text, e.g. "Go to Glaciem Ring". */
  text?: string;
  /** Still open but hidden by the game HUD (superseded by a newer objective). */
  hidden?: boolean;
  state: string;
  updatedAt: string;
}

export interface Contract {
  id: string;
  name?: string | null;
  acceptedAt: string;
  status: 'active' | 'completed' | 'failed' | 'abandoned';
  endedAt?: string | null;
  reward?: number | null;
  objectives: ContractObjective[];
}

export type MomentKind =
  | 'payout'
  | 'contract'
  | 'failed'
  | 'death'
  | 'downed'
  | 'missile'
  | 'shields'
  | 'quantum'
  | 'ship'
  | 'record'
  | 'goal'
  | 'boot';

export interface Moment {
  id: string;
  kind: MomentKind;
  /** English source text, translated at render. */
  title: string;
  value?: string;
  amount?: number;
  at: number;
}

export interface FeedState {
  /** Connected to the StatsCitizen overlay server (or running demo data). */
  online: boolean;
  demo: boolean;
  frame: LiveTelemetryFrame | null;
  events: LiveTelemetryEvent[];
  contracts: Contract[];
  /** Contracts completed this session (the list only keeps the last few ended ones). */
  contractsCompleted: number;
  /** [unix ms, aUEC balance] */
  history: Array<[number, number]>;
  /** When the current live session began (unix ms). */
  sessionStart: number;
  layout: OverlayLayout | null;
  layoutDeleted: boolean;
}

export const emptyFeed = (): FeedState => ({
  online: false,
  demo: false,
  frame: null,
  events: [],
  contracts: [],
  contractsCompleted: 0,
  history: [],
  sessionStart: Date.now(),
  layout: null,
  layoutDeleted: false,
});
