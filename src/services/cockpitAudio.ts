// Subtle synthesized cockpit sounds (Web Audio, no asset files).
import type { SoundProfile } from '../themes/manufacturers.js';

type Note = { freq: number; at: number; dur: number; type?: OscillatorType; gain?: number; glideTo?: number };

const PROFILES: Record<SoundProfile, Note[]> = {
  // Clean harmonic rise (RSI, Crusader, Mirai, CNOU)
  clean: [
    { freq: 523.25, at: 0, dur: 0.35, type: 'sine' },
    { freq: 783.99, at: 0.12, dur: 0.4, type: 'sine' },
    { freq: 1046.5, at: 0.26, dur: 0.6, type: 'sine', gain: 0.7 },
  ],
  // Low, gritty industrial thunk (Drake, MISC, ARGO, Tumbril, Greycat)
  industrial: [
    { freq: 70, at: 0, dur: 0.35, type: 'sawtooth', gain: 0.5, glideTo: 110 },
    { freq: 196, at: 0.18, dur: 0.18, type: 'square', gain: 0.25 },
    { freq: 293.66, at: 0.32, dur: 0.35, type: 'triangle', gain: 0.6 },
  ],
  // Short, clipped military double-tone (Aegis, Anvil, Kruger)
  tactical: [
    { freq: 880, at: 0, dur: 0.09, type: 'square', gain: 0.3 },
    { freq: 880, at: 0.14, dur: 0.09, type: 'square', gain: 0.3 },
    { freq: 1318.5, at: 0.3, dur: 0.3, type: 'triangle', gain: 0.6 },
  ],
  // Soft, warm luxury chord (Origin)
  luxury: [
    { freq: 392, at: 0, dur: 1.0, type: 'sine', gain: 0.55 },
    { freq: 493.88, at: 0.08, dur: 0.95, type: 'sine', gain: 0.45 },
    { freq: 587.33, at: 0.16, dur: 0.9, type: 'sine', gain: 0.4 },
    { freq: 783.99, at: 0.3, dur: 0.8, type: 'sine', gain: 0.3 },
  ],
  // Glassy alien glide (Banu, Esperia, Xi'an)
  alien: [
    { freq: 330, at: 0, dur: 0.7, type: 'sine', gain: 0.5, glideTo: 660 },
    { freq: 990, at: 0.25, dur: 0.6, type: 'triangle', gain: 0.25, glideTo: 740 },
  ],
  standard: [
    { freq: 660, at: 0, dur: 0.25, type: 'sine' },
    { freq: 990, at: 0.15, dur: 0.45, type: 'sine', gain: 0.7 },
  ],
};

const POWER_DOWN: Note[] = [
  { freq: 660, at: 0, dur: 0.4, type: 'sine', gain: 0.5, glideTo: 220 },
];

const ALERT: Note[] = [
  { freq: 1200, at: 0, dur: 0.12, type: 'square', gain: 0.25 },
  { freq: 900, at: 0.16, dur: 0.12, type: 'square', gain: 0.25 },
  { freq: 1200, at: 0.32, dur: 0.12, type: 'square', gain: 0.25 },
];

const MASTER_GAIN = 0.07; // "sutil"

class CockpitAudio {
  private ctx: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  private context(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private play(notes: Note[]) {
    if (this.muted) return;
    const ctx = this.context();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = n.type ?? 'sine';
      const start = t0 + n.at;
      const end = start + n.dur;
      osc.frequency.setValueAtTime(n.freq, start);
      if (n.glideTo) osc.frequency.exponentialRampToValueAtTime(n.glideTo, end);
      const peak = n.gain ?? 1;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.03, n.dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g).connect(master);
      osc.start(start);
      osc.stop(end + 0.05);
    }
  }

  boot(profile: SoundProfile) {
    this.play(PROFILES[profile] ?? PROFILES.standard);
  }

  powerDown() {
    this.play(POWER_DOWN);
  }

  alert() {
    this.play(ALERT);
  }

  /** Create/resume the AudioContext on the first user gesture, as a fallback when autoplay is blocked. */
  installUnlock() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.context();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }
}

export const cockpitAudio = new CockpitAudio();
cockpitAudio.installUnlock();
