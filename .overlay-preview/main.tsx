// Visual harness for the stream overlay: static data, every widget at several box sizes.
// Build: npx vite build --config .overlay-preview/vite.config.mjs  → .overlay-preview/dist/index.html
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../src/overlay/fonts';
import '../src/overlay/overlay.css';
import { OverlayRoot, OverlayCanvas, FitCanvas, WidgetBox } from '../src/overlay/OverlayCanvas';
import { PRESETS } from '../src/overlay/presets';
import type { Appearance, FeedState, Moment, OverlayLayout, OverlayTheme, WidgetType } from '../src/overlay/types';
import type { LiveTelemetryFrame } from '../src/types/telemetry';

const now = Date.now();
const iso = (ago: number) => new Date(now - ago).toISOString();
const combat = (window as any).__COMBAT === true;

const frame: LiveTelemetryFrame = {
  connected: true, fps: 17, channel: 'PTU', port: 0, timestamp: iso(0), supportsActions: false,
  actor: {
    vitals: { health: { current: 82, max: 100 }, oxygen: { current: 96, max: 100 }, body_temperature: { current: 37.1 }, heart_rate: 128 },
    state: { locomotion: 'ACTOR_LOCOMOTION_STATE_SEATED', crew_role: 'ACTOR_CREW_ROLE_PILOT', uec_balance: 1388800 },
  },
  vehicle: { state: {
    name: 'ANVL_Hornet_F7CM_Mk2_8812', class_name: 'ANVL_Hornet_F7CM_Mk2', manufacturer: 'Anvil Aerospace', health: 0.87,
    shields: { level: 0.64, faces: [0.92, 0.55, 0.08, 0.85] },
    master_mode: { mode: 'VEHICLE_MASTER_MODE_SCM' },
    annunciators: combat ? { misl: 'ANNUNCIATOR_STATE_MAJOR_FLASHING' } : {},
    flight: { instruments: { speed: 214, hydrogen_fuel: 0.71, quantum_fuel: 0.92, g_meter: { current: 4.2 }, altitude: 4830, heading: 247 } },
  } },
  sessionMetrics: { uecStart: 1204300, uecCurrent: 1388800, uecDelta: 184500, maxSpeed: 1284, maxG: 7.4, deaths: 3, downedCount: 5, activeShipName: 'F7C-M Super Hornet Mk II', totalFrames: 0 },
};

const history: Array<[number, number]> = Array.from({ length: 25 }, (_, i) => [
  now - 3 * 3600_000 + i * (3 * 3600_000) / 24,
  1204300 + Math.round(184500 * Math.pow(i / 24, 1.3) + (i < 24 ? Math.sin(i) * 6000 : 0)),
]);

const feed: FeedState = {
  online: true, demo: false, frame, history, sessionStart: history[0][0], layout: null, layoutDeleted: false,
  contractsCompleted: 7,
  contracts: [
    { id: 'm1', name: 'Bounty: Eliminate "Rook" Vance', acceptedAt: iso(761_000), status: 'active',
      objectives: [{ id: 'a', text: 'Locate Rook Vance', state: 'completed', updatedAt: iso(0) }, { id: 'b', text: 'Neutralize Rook Vance', state: 'inprogress', updatedAt: iso(0) }, { id: 'c', text: 'Return to a safe zone', state: 'inprogress', updatedAt: iso(0) }] },
    { id: 'm2', name: 'Hauling: Agricium → Lorville', acceptedAt: iso(2463_000), status: 'active', objectives: [{ id: 'a', state: 'completed', updatedAt: iso(0) }, { id: 'b', state: 'inprogress', updatedAt: iso(0) }] },
    { id: 'm3', name: 'Salvage: Derelict Caterpillar', acceptedAt: iso(3000_000), status: 'completed', endedAt: iso(5_000), reward: 45000, objectives: [] },
  ],
  events: [
    { id: '1', timestamp: iso(10_000), type: 'reward', title: 'aUEC Awarded', details: '', amountAuec: 45000, severity: 'success' },
    { id: '2', timestamp: iso(240_000), type: 'quantum', title: 'Quantum Route Computed', details: 'Yela' },
    { id: '3', timestamp: iso(1080_000), type: 'purchase', title: 'Purchase', details: '', amountAuec: 12400 },
    { id: '4', timestamp: iso(3120_000), type: 'medical', title: 'Pilot Downed', details: '', severity: 'warning' },
    { id: '5', timestamp: iso(3500_000), type: 'zone_transition', title: 'Entered Monitored Space', details: '', zone: 'Monitored Space', category: 'zone' },
    { id: '6', timestamp: iso(3600_000), type: 'mission_accepted', title: 'Contract Accepted', details: '', missionName: 'Bounty: Eliminate "Rook" Vance' },
  ],
};

const moments: Moment[] = [];
const layoutWith = (patch: Partial<OverlayLayout>): OverlayLayout => ({ ...PRESETS[0], ...patch });

const Box: React.FC<{ type: WidgetType; w: number; h: number; theme?: OverlayTheme; lang?: 'en' | 'es'; opts?: Record<string, unknown>; look?: Appearance }> = ({ type, w, h, theme = 'statscitizen', lang = 'en', opts, look }) => (
  <div style={{ display: 'inline-block', margin: 8, verticalAlign: 'top' }}>
    <div style={{ font: '11px monospace', color: '#7f9bb0' }}>{type} {w}×{h} {theme !== 'statscitizen' ? theme : ''} {lang}</div>
    <OverlayRoot layout={layoutWith({ theme, lang })} feed={feed} moments={moments} editing style={{ position: 'relative', width: w, height: h }}>
      <WidgetBox widget={{ id: type, type, x: 0, y: 0, w: 1, h: 1, options: opts, appearance: look }} />
    </OverlayRoot>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section style={{ margin: '18px 12px' }}>
    <h2 style={{ font: '700 14px monospace', color: '#3fd8ff', letterSpacing: '.15em' }}>{title}</h2>
    {children}
  </section>
);

const which = (window as any).__SECTION ?? 'all';

const App = () => (
  <div style={{ background: 'linear-gradient(180deg,#050912,#0b1322 70%,#141b26)', minHeight: '100vh', padding: 4 }}>
    {(which === 'all' || which === 'layout') && (
      <Section title={`LAYOUT: ${(window as any).__LAYOUT ?? 'cockpit-classic'}`}>
        {(() => {
          const l = PRESETS.find((p) => p.id === ((window as any).__LAYOUT ?? 'cockpit-classic'))!;
          return (
            <div style={{ position: 'relative', width: 1200, height: 675, border: '1px solid #1b2a3a' }}>
              <OverlayRoot layout={{ ...l, lang: (window as any).__LANG ?? 'en' }} feed={feed} moments={moments} editing style={{ position: 'absolute', inset: 0 }}>
                <FitCanvas width={l.canvas.width} height={l.canvas.height}>
                  <OverlayCanvas />
                </FitCanvas>
              </OverlayRoot>
            </div>
          );
        })()}
      </Section>
    )}
    {(which === 'all' || which === 'widgets') && (
      <Section title="WIDGETS · CARD / STRIP / TALL">
        <Box type="contracts" w={460} h={300} />
        <Box type="contracts" w={340} h={520} />
        <Box type="profit" w={440} h={230} />
        <Box type="vitals" w={330} h={220} />
        <Box type="vitals" w={180} h={330} />
        <Box type="ship" w={560} h={260} />
        <Box type="deaths" w={280} h={200} />
        <Box type="feed" w={440} h={260} />
        <Box type="flight" w={300} h={170} />
        <Box type="goal" w={440} h={86} />
        <Box type="location" w={420} h={70} />
      </Section>
    )}
    {(which === 'all' || which === 'strips') && (
      <Section title="STRIPS (wide OBS sources)">
        <Box type="contracts" w={900} h={60} />
        <Box type="profit" w={640} h={60} />
        <Box type="vitals" w={900} h={56} />
        <Box type="ship" w={1000} h={60} />
        <Box type="goal" w={900} h={50} />
        <Box type="deaths" w={480} h={60} />
        <Box type="ticker" w={1200} h={40} />
      </Section>
    )}
    {(which === 'all' || which === 'themes') && (
      <Section title="THEMES + SPANISH">
        <Box type="profit" w={440} h={230} theme="manufacturer" lang="es" />
        <Box type="ship" w={560} h={260} theme="manufacturer" lang="es" />
        <Box type="contracts" w={460} h={300} theme="mobiglas" lang="es" />
        <Box type="vitals" w={330} h={220} theme="mfd" />
        <Box type="profit" w={440} h={230} theme="minimal" />
        <Box type="moments" w={1000} h={170} />
      </Section>
    )}
    {(which === 'all' || which === 'look') && (
      <Section title="APPEARANCE OVERRIDES">
        <Box type="contracts" w={460} h={300} look={{ look: 'minimal' }} />
        <Box type="profit" w={440} h={230} look={{ look: 'text', font: 'Teko', fontForNumbers: true, weight: 'bold', textScale: 1.15 }} />
        <Box type="vitals" w={330} h={220} look={{ look: 'minimal', font: 'Oxanium', accent: '#ff9a3c' }} />
        <Box type="ship" w={560} h={260} look={{ font: 'Exo 2', weight: 'heavy', accent: '#b47cff' }} />
        <Box type="contracts" w={900} h={60} look={{ look: 'text', font: 'Audiowide' }} />
        <Box type="ticker" w={1200} h={40} look={{ look: 'minimal', textColor: '#ffe9a8' }} />
      </Section>
    )}
    {(which === 'all' || which === 'fit') && (
      <Section title="SHRINK TO CONTENT + BOOT">
        <div style={{ display: 'inline-block', outline: '1px dashed #3fd8ff55', margin: 8 }}><Box type="contracts" w={460} h={480} opts={{ maxContracts: 1 }} /></div>
        <div style={{ display: 'inline-block', outline: '1px dashed #3fd8ff55', margin: 8 }}><Box type="contracts" w={460} h={480} opts={{ maxContracts: 1, growFrom: 'bottom' }} /></div>
        <Box type="boot" w={520} h={320} />
      </Section>
    )}
    {(which === 'all' || which === 'debrief') && (
      <Section title="DEBRIEF">
        <Box type="debrief" w={1200} h={675} lang={(window as any).__LANG ?? 'en'} />
      </Section>
    )}
  </div>
);

if ((window as any).__SECTION !== 'editor') ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);

// ---- Editor preview: fake the Tauri bridge so StreamOverlayView renders outside the app.
if ((window as any).__SECTION === 'editor') {
  (window as any).__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd: string) => {
      if (cmd === 'overlay_get_config')
        return { settings: { enabled: true, port: 47800, allowLan: false, token: 'x'.repeat(32) }, layouts: [], server: { running: false, port: 0, lan: false, lanIps: [] } };
      return null;
    },
  };
  void Promise.all([import('../src/index.css'), import('../src/components/views/StreamOverlayView'), import('../src/i18n')]).then(
    ([, { StreamOverlayView }, { I18nProvider }]) => {
      ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
        <I18nProvider>
          <div className="dark bg-space-950 text-slate-100 min-h-screen p-6">
            <StreamOverlayView />
          </div>
        </I18nProvider>
      );
    }
  );
}
