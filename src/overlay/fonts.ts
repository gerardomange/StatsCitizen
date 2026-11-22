// Fonts bundled with the overlay (served locally — OBS never fetches anything from the internet).
// Browsers only download a face when it is actually used, so unused fonts cost nothing at runtime.
import '@fontsource/orbitron/latin-400.css';
import '@fontsource/orbitron/latin-600.css';
import '@fontsource/orbitron/latin-800.css';
import '@fontsource/orbitron/latin-900.css';
import '@fontsource/rajdhani/latin-400.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/oxanium/latin-400.css';
import '@fontsource/oxanium/latin-600.css';
import '@fontsource/oxanium/latin-700.css';
import '@fontsource/exo-2/latin-400.css';
import '@fontsource/exo-2/latin-600.css';
import '@fontsource/exo-2/latin-800.css';
import '@fontsource/teko/latin-400.css';
import '@fontsource/teko/latin-600.css';
import '@fontsource/audiowide/latin-400.css';

export interface FontChoice {
  family: string;
  /** 'bundled' ships with the app; 'system' must be installed on the PC running OBS. */
  source: 'bundled' | 'system';
}

export const FONT_CHOICES: FontChoice[] = [
  { family: 'Rajdhani', source: 'bundled' },
  { family: 'Orbitron', source: 'bundled' },
  { family: 'Oxanium', source: 'bundled' },
  { family: 'Exo 2', source: 'bundled' },
  { family: 'Teko', source: 'bundled' },
  { family: 'Audiowide', source: 'bundled' },
  { family: 'JetBrains Mono', source: 'bundled' },
  { family: 'Segoe UI', source: 'system' },
  { family: 'Bahnschrift', source: 'system' },
  { family: 'Arial', source: 'system' },
  { family: 'Verdana', source: 'system' },
  { family: 'Tahoma', source: 'system' },
  { family: 'Trebuchet MS', source: 'system' },
  { family: 'Georgia', source: 'system' },
  { family: 'Impact', source: 'system' },
  { family: 'Consolas', source: 'system' },
];

/** CSS font-family value with safe fallbacks. Strips characters that could break out of the declaration. */
export const fontStack = (family: string) => `'${family.replace(/['";{}<>\\]/g, '').trim()}', 'Segoe UI', system-ui, sans-serif`;
