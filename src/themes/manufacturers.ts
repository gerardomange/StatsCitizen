// Manufacturer OS registry.
// Logos: Star Citizen Wiki shared icons (https://starcitizen.tools, "Sc-logo-*.svg"),
// artwork © Cloud Imperium Rights LLC — used under CIG's fan content terms. See src/assets/manufacturers/README.md.
import rsiLogo from '../assets/manufacturers/rsi.svg';
import aegisLogo from '../assets/manufacturers/aegis.svg';
import anvilLogo from '../assets/manufacturers/anvil-aerospace.svg';
import drakeLogo from '../assets/manufacturers/drake.svg';
import crusaderLogo from '../assets/manufacturers/crusader.svg';
import originLogo from '../assets/manufacturers/origin.svg';
import miscLogo from '../assets/manufacturers/misc.svg';
import miraiLogo from '../assets/manufacturers/mirai.svg';
import argoLogo from '../assets/manufacturers/argo-astronautics.svg';
import cnouLogo from '../assets/manufacturers/consolidated-outland.svg';
import banuLogo from '../assets/manufacturers/banu.svg';
import esperiaLogo from '../assets/manufacturers/esperia.svg';
import tumbrilLogo from '../assets/manufacturers/tumbril.svg';
import aopoaLogo from '../assets/manufacturers/aopoa.svg';
import gatacLogo from '../assets/manufacturers/gatac.svg';
import greycatLogo from '../assets/manufacturers/greycat.svg';
import krugerLogo from '../assets/manufacturers/kruger-intergalactic.svg';

/** Hex colors for the accent ramp. `accent` replaces `quantum-cyan`; 200–500 replace Tailwind `cyan-*`. */
export interface AccentRamp {
  accent: string;
  c200: string;
  c300: string;
  c400: string;
  c500: string;
  c600: string;
}

export type SoundProfile = 'clean' | 'industrial' | 'tactical' | 'luxury' | 'alien' | 'standard';

export interface ManufacturerTheme {
  id: string;
  name: string;
  short: string;
  osName: string;
  tagline: string;
  /** class_name prefixes, e.g. "DRAK" for DRAK_Cutlass_Black. */
  prefixes: string[];
  /** lowercase substrings matched against the gRPC `manufacturer` string. */
  keywords: string[];
  logo?: string;
  colors: AccentRamp;
  /** HUD panel corner radius in px. */
  radius: number;
  sound: SoundProfile;
  bootChecks: string[];
}

const DEFAULT_CHECKS = ['IFCS', 'SHIELDS', 'WEAPONS', 'LIFE SUPPORT'];

export const DEFAULT_THEME: ManufacturerTheme = {
  id: 'default',
  name: 'StatsCitizen',
  short: 'SC',
  osName: 'STATSCITIZEN',
  tagline: 'RUST TELEMETRY TERMINAL',
  prefixes: [],
  keywords: [],
  colors: {
    accent: '#00f0ff',
    c200: '#a5f3fc',
    c300: '#67e8f9',
    c400: '#22d3ee',
    c500: '#06b6d4',
    c600: '#0891b2',
  },
  radius: 12,
  sound: 'standard',
  bootChecks: DEFAULT_CHECKS,
};

export const UEE_STANDARD_THEME: ManufacturerTheme = {
  id: 'uee',
  name: 'UEE Standard',
  short: 'UEE',
  osName: 'UEE STANDARD MFD',
  tagline: 'UNIVERSAL FLIGHT SYSTEMS',
  prefixes: [],
  keywords: [],
  colors: {
    accent: '#9fb8d8',
    c200: '#dbe6f3',
    c300: '#bccfe6',
    c400: '#8fa8c8',
    c500: '#6b86aa',
    c600: '#52698a',
  },
  radius: 6,
  sound: 'standard',
  bootChecks: DEFAULT_CHECKS,
};

export const MANUFACTURERS: ManufacturerTheme[] = [
  {
    id: 'rsi',
    name: 'Roberts Space Industries',
    short: 'RSI',
    osName: 'RSI ZEUS OS',
    tagline: 'TO THE STARS',
    prefixes: ['RSI'],
    keywords: ['roberts space', 'rsi'],
    logo: rsiLogo,
    colors: { accent: '#5cc8ff', c200: '#c6ebff', c300: '#93d8ff', c400: '#5cb8f0', c500: '#2b9fe0', c600: '#1f7fb8' },
    radius: 6,
    sound: 'clean',
    bootChecks: DEFAULT_CHECKS,
  },
  {
    id: 'aegis',
    name: 'Aegis Dynamics',
    short: 'AEGIS',
    osName: 'AEGIS COMBAT OS',
    tagline: 'MILITARY GRADE SYSTEMS',
    prefixes: ['AEGS'],
    keywords: ['aegis'],
    logo: aegisLogo,
    colors: { accent: '#ff4458', c200: '#ffc6cc', c300: '#ff8d98', c400: '#f0566a', c500: '#d9283a', c600: '#a81e2d' },
    radius: 0,
    sound: 'tactical',
    bootChecks: ['IFCS', 'SHIELDS', 'WEAPONS', 'TARGETING', 'LIFE SUPPORT'],
  },
  {
    id: 'anvil',
    name: 'Anvil Aerospace',
    short: 'ANVIL',
    osName: 'ANVIL MIL-SPEC',
    tagline: 'BUILT FOR THE FRONTLINE',
    prefixes: ['ANVL'],
    keywords: ['anvil'],
    logo: anvilLogo,
    colors: { accent: '#b5d44a', c200: '#e4f0b8', c300: '#cde282', c400: '#a3c43a', c500: '#7f9a2a', c600: '#62781f' },
    radius: 2,
    sound: 'tactical',
    bootChecks: ['IFCS', 'SHIELDS', 'WEAPONS', 'ARMOR', 'LIFE SUPPORT'],
  },
  {
    id: 'drake',
    name: 'Drake Interplanetary',
    short: 'DRAKE',
    osName: 'DRAKE OS',
    tagline: 'NO EJECTION SEAT',
    prefixes: ['DRAK'],
    keywords: ['drake'],
    logo: drakeLogo,
    colors: { accent: '#ffb020', c200: '#ffe4a8', c300: '#ffcf70', c400: '#f5a524', c500: '#e08e00', c600: '#b06f00' },
    radius: 2,
    sound: 'industrial',
    bootChecks: ['IFCS', 'SHIELDS', 'WEAPONS', 'CARGO', 'LIFE SUPPORT'],
  },
  {
    id: 'crusader',
    name: 'Crusader Industries',
    short: 'CRUSADER',
    osName: 'CRUSADER FLIGHTDECK',
    tagline: 'THE SKY IS OURS',
    prefixes: ['CRUS'],
    keywords: ['crusader'],
    logo: crusaderLogo,
    colors: { accent: '#8fd0ff', c200: '#e2f2ff', c300: '#b9e1ff', c400: '#7cc0f5', c500: '#4f9fe0', c600: '#3a7cb5' },
    radius: 10,
    sound: 'clean',
    bootChecks: DEFAULT_CHECKS,
  },
  {
    id: 'origin',
    name: 'Origin Jumpworks',
    short: 'ORIGIN',
    osName: 'ORIGIN LUXE OS',
    tagline: 'THE ART OF FLIGHT',
    prefixes: ['ORIG'],
    keywords: ['origin'],
    logo: originLogo,
    colors: { accent: '#ecd29a', c200: '#f8ecd2', c300: '#f1dcaf', c400: '#dcb978', c500: '#c9a55c', c600: '#a08144' },
    radius: 14,
    sound: 'luxury',
    bootChecks: ['IFCS', 'SHIELDS', 'CLIMATE', 'LIFE SUPPORT'],
  },
  {
    id: 'misc',
    name: 'Musashi Industrial & Starflight Concern',
    short: 'MISC',
    osName: 'MISC INDUSTRIAL OS',
    tagline: 'WORK. BUILT IN.',
    prefixes: ['MISC'],
    keywords: ['musashi', 'misc'],
    logo: miscLogo,
    colors: { accent: '#3fe0b8', c200: '#c2f7e9', c300: '#87edd2', c400: '#34d3ab', c500: '#18a886', c600: '#118268' },
    radius: 4,
    sound: 'industrial',
    bootChecks: ['IFCS', 'SHIELDS', 'CARGO', 'LIFE SUPPORT'],
  },
  {
    id: 'mirai',
    name: 'Mirai',
    short: 'MIRAI',
    osName: 'MIRAI KINETIC',
    tagline: 'SPEED IS EVERYTHING',
    prefixes: ['MRAI', 'MIRA', 'MIRAI'],
    keywords: ['mirai', 'mrai'],
    logo: miraiLogo,
    colors: { accent: '#e88bff', c200: '#f6d3ff', c300: '#eeacff', c400: '#d974f5', c500: '#b44fd9', c600: '#8d3bab' },
    radius: 12,
    sound: 'clean',
    bootChecks: ['IFCS', 'SHIELDS', 'BOOST', 'LIFE SUPPORT'],
  },
  {
    id: 'argo',
    name: 'ARGO Astronautics',
    short: 'ARGO',
    osName: 'ARGO UTILITY OS',
    tagline: 'GET THE JOB DONE',
    prefixes: ['ARGO'],
    keywords: ['argo'],
    logo: argoLogo,
    colors: { accent: '#f5dc2a', c200: '#fbf1b0', c300: '#f8e775', c400: '#e8cc1c', c500: '#c2a810', c600: '#94800b' },
    radius: 2,
    sound: 'industrial',
    bootChecks: ['IFCS', 'TRACTOR', 'CARGO', 'LIFE SUPPORT'],
  },
  {
    id: 'cnou',
    name: 'Consolidated Outland',
    short: 'C.O.',
    osName: 'CNOU PIONEER OS',
    tagline: 'FRONTIER READY',
    prefixes: ['CNOU'],
    keywords: ['consolidated outland', 'cnou'],
    logo: cnouLogo,
    colors: { accent: '#5ee88c', c200: '#c8f8d7', c300: '#94f0b2', c400: '#4ad67a', c500: '#2bb05c', c600: '#1f8645' },
    radius: 6,
    sound: 'clean',
    bootChecks: DEFAULT_CHECKS,
  },
  {
    id: 'banu',
    name: 'Banu',
    short: 'BANU',
    osName: 'BANU SOULI LINK',
    tagline: 'TRADE IS FRIENDSHIP',
    prefixes: ['BANU'],
    keywords: ['banu'],
    logo: banuLogo,
    colors: { accent: '#ff8a4a', c200: '#ffd8c2', c300: '#ffb48c', c400: '#f57a3a', c500: '#d95f20', c600: '#a84818' },
    radius: 16,
    sound: 'alien',
    bootChecks: ['FLIGHT', 'BARRIER', 'ARMS', 'BREATH'],
  },
  {
    id: 'esperia',
    name: 'Esperia',
    short: 'ESPERIA',
    osName: 'ESPERIA REPLICA OS',
    tagline: 'HISTORY RECLAIMED',
    prefixes: ['ESPR'],
    keywords: ['esperia'],
    logo: esperiaLogo,
    colors: { accent: '#48e6d6', c200: '#c4f8f2', c300: '#8ef0e6', c400: '#34d2c2', c500: '#1aa89a', c600: '#128076' },
    radius: 4,
    sound: 'alien',
    bootChecks: DEFAULT_CHECKS,
  },
  {
    id: 'tumbril',
    name: 'Tumbril Land Systems',
    short: 'TUMBRIL',
    osName: 'TUMBRIL GROUND OS',
    tagline: 'ANY TERRAIN',
    prefixes: ['TMBL'],
    keywords: ['tumbril'],
    logo: tumbrilLogo,
    colors: { accent: '#e0b47a', c200: '#f5e3cc', c300: '#ecc99c', c400: '#d4a36a', c500: '#b5834a', c600: '#8c6438' },
    radius: 2,
    sound: 'industrial',
    bootChecks: ['DRIVETRAIN', 'SHIELDS', 'WEAPONS', 'LIFE SUPPORT'],
  },
  {
    id: 'aopoa',
    name: "Aopoa (Xi'an)",
    short: 'AOPOA',
    osName: "XI'AN AOPOA LINK",
    tagline: 'HARMONY IN MOTION',
    prefixes: ['AOPO', 'XIAN', 'XNAA'],
    keywords: ['aopoa', "xi'an", 'xian'],
    logo: aopoaLogo,
    colors: { accent: '#8cffbc', c200: '#d6ffe6', c300: '#b0ffd0', c400: '#74eca6', c500: '#4cc884', c600: '#379a64' },
    radius: 18,
    sound: 'alien',
    bootChecks: ['FLIGHT', 'BARRIER', 'ARMS', 'BREATH'],
  },
  {
    id: 'gatac',
    name: 'Gatac Manufacture',
    short: 'GATAC',
    osName: 'GATAC RAILEN LINK',
    tagline: "XI'AN HEAVY INDUSTRY",
    prefixes: ['GAMA', 'GATC', 'GATAC'],
    keywords: ['gatac'],
    logo: gatacLogo,
    colors: { accent: '#b89aff', c200: '#e5dbff', c300: '#cfbcff', c400: '#a586f5', c500: '#8163d9', c600: '#634bab' },
    radius: 16,
    sound: 'alien',
    bootChecks: ['FLIGHT', 'BARRIER', 'CARGO', 'BREATH'],
  },
  {
    id: 'greycat',
    name: 'Greycat Industrial',
    short: 'GREYCAT',
    osName: 'GREYCAT WORKS',
    tagline: 'INDUSTRIAL SOLUTIONS',
    prefixes: ['GRIN'],
    keywords: ['greycat'],
    logo: greycatLogo,
    colors: { accent: '#ead04a', c200: '#f8edb8', c300: '#f2df82', c400: '#dcbf34', c500: '#b89c1e', c600: '#8c7616' },
    radius: 2,
    sound: 'industrial',
    bootChecks: ['DRIVETRAIN', 'MINING', 'CARGO', 'LIFE SUPPORT'],
  },
  {
    id: 'kruger',
    name: 'Kruger Intergalactic',
    short: 'KRUGER',
    osName: 'KRUGER INTERCEPT',
    tagline: 'PRECISION ENGINEERED',
    prefixes: ['KRIG'],
    keywords: ['kruger'],
    logo: krugerLogo,
    colors: { accent: '#ff7a4a', c200: '#ffd3c2', c300: '#ffac8c', c400: '#f56a3a', c500: '#d94f20', c600: '#a83c18' },
    radius: 4,
    sound: 'tactical',
    bootChecks: DEFAULT_CHECKS,
  },
];

const BY_ID = new Map(MANUFACTURERS.map((m) => [m.id, m]));

export function getThemeById(id: string | null | undefined): ManufacturerTheme | undefined {
  if (!id) return undefined;
  if (id === DEFAULT_THEME.id) return DEFAULT_THEME;
  if (id === UEE_STANDARD_THEME.id) return UEE_STANDARD_THEME;
  return BY_ID.get(id);
}

/**
 * Resolve the manufacturer theme from the gRPC vehicle state.
 * `manufacturer` is a free-form string from the game, so we match keywords first,
 * then fall back to the class_name prefix (RSI_, AEGS_, DRAK_, ...). Unknown → UEE Standard.
 */
export function resolveManufacturer(
  manufacturer?: string | null,
  className?: string | null
): ManufacturerTheme {
  const mfg = (manufacturer ?? '').toLowerCase().trim();
  if (mfg) {
    // Prefer longer keywords so "consolidated outland" wins before shorter matches.
    let best: { theme: ManufacturerTheme; len: number } | null = null;
    for (const theme of MANUFACTURERS) {
      for (const kw of theme.keywords) {
        const hit = kw.length <= 4 ? new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`).test(mfg) : mfg.includes(kw);
        if (hit && (!best || kw.length > best.len)) best = { theme, len: kw.length };
      }
    }
    if (best) return best.theme;
  }

  const prefix = (className ?? '').split(/[_\s]/)[0]?.toUpperCase();
  if (prefix) {
    const byPrefix = MANUFACTURERS.find((m) => m.prefixes.includes(prefix));
    if (byPrefix) return byPrefix;
  }

  return UEE_STANDARD_THEME;
}

function hexToRgbChannels(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Write the theme's accent ramp into the global CSS variables consumed by Tailwind + index.css. */
export function applyThemeVars(theme: ManufacturerTheme, root: HTMLElement = document.documentElement) {
  const c = theme.colors;
  root.style.setProperty('--accent', hexToRgbChannels(c.accent));
  root.style.setProperty('--accent-200', hexToRgbChannels(c.c200));
  root.style.setProperty('--accent-300', hexToRgbChannels(c.c300));
  root.style.setProperty('--accent-400', hexToRgbChannels(c.c400));
  root.style.setProperty('--accent-500', hexToRgbChannels(c.c500));
  root.style.setProperty('--accent-600', hexToRgbChannels(c.c600));
  root.style.setProperty('--hud-radius', `${theme.radius}px`);
  root.dataset.manufacturer = theme.id;
}
