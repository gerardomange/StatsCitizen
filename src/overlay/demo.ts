// Simulated session so streamers can set up OBS without the game running.
import type { LiveTelemetryEvent, LiveTelemetryFrame } from '../types/telemetry.js';
import type { Contract } from './types.js';

export interface DemoSink {
  frame: (f: LiveTelemetryFrame) => void;
  event: (e: LiveTelemetryEvent) => void;
  contracts: (c: Contract[]) => void;
  history: (p: [number, number]) => void;
}

const iso = (ms = Date.now()) => new Date(ms).toISOString();

const SHIPS = [
  { name: 'F7C-M Super Hornet Mk II', cls: 'ANVL_Hornet_F7CM_Mk2', mfg: 'Anvil Aerospace' },
  { name: 'Cutlass Black', cls: 'DRAK_Cutlass_Black', mfg: 'Drake Interplanetary' },
  { name: 'Constellation Taurus', cls: 'RSI_Constellation_Taurus', mfg: 'Roberts Space Industries' },
];

const CONTRACTS = [
  'Bounty: Eliminate "Rook" Vance',
  'Hauling: Agricium to Lorville',
  'Salvage: Derelict Caterpillar',
  'Investigation: Missing Courier',
];

const DESTS = ['Hurston', 'Yela', 'ARC-L1', 'Crusader', 'Daymar'];

export function startDemo(sink: DemoSink): () => void {
  const start = Date.now() - 2.9 * 3600_000;
  const uecStart = 1_204_300;
  let balance = uecStart + 184_500;
  let deaths = 3;
  const downed = 5;
  let maxSpeed = 1284;
  let shipIdx = 0;
  let missileUntil = 0;
  let step = 0;
  let contractSeq = 0;
  const contracts: Contract[] = [
    {
      id: 'demo-0',
      name: CONTRACTS[0],
      acceptedAt: iso(Date.now() - 761_000),
      status: 'active',
      objectives: [
        { id: 'o1', text: 'Travel to the Yela belt', state: 'completed', updatedAt: iso() },
        { id: 'o2', text: 'Locate Rook Vance', state: 'inprogress', updatedAt: iso() },
        { id: 'o3', text: 'Neutralize Rook Vance', state: 'pending', updatedAt: iso() },
      ],
    },
  ];

  // Seed a balance curve for the sparkline.
  for (let i = 0; i <= 24; i++) {
    const t = start + (i / 24) * (Date.now() - start);
    const v = uecStart + Math.round(184_500 * Math.pow(i / 24, 1.3) + Math.sin(i) * 6000);
    sink.history([t, i === 24 ? balance : v]);
  }
  sink.contracts(contracts.map((c) => ({ ...c })));

  const ev = (e: Partial<LiveTelemetryEvent> & Pick<LiveTelemetryEvent, 'type' | 'title'>): LiveTelemetryEvent => ({
    id: `demo|${Date.now()}|${Math.random()}`,
    timestamp: iso(),
    details: '',
    confirmed: true,
    ...e,
  });

  const frame = () => {
    const t = Date.now() / 1000;
    const ship = SHIPS[shipIdx];
    const combat = Date.now() < missileUntil;
    const speed = 180 + Math.sin(t / 3) * 120 + (combat ? 90 : 0);
    const bpm = Math.round((combat ? 150 : 92) + Math.sin(t / 2) * 8);
    const rear = combat ? 0.05 : 0.6 + Math.sin(t / 5) * 0.3;
    const f: LiveTelemetryFrame = {
      connected: true,
      fps: 17,
      channel: 'DEMO',
      port: 0,
      timestamp: iso(),
      supportsActions: false,
      actor: {
        vitals: {
          health: { current: combat ? 61 : 82, max: 100 },
          oxygen: { current: 96, max: 100 },
          body_temperature: { current: 37.1, max: 100 },
          heart_rate: bpm,
          hunger: { current: 70, max: 100 },
          thirst: { current: 64, max: 100 },
        },
        state: { locomotion: 'LOCOMOTION_SEATED', crew_role: 'CREW_ROLE_PILOT', uec_balance: balance },
      },
      vehicle: {
        state: {
          name: ship.name,
          class_name: ship.cls,
          manufacturer: ship.mfg,
          health: combat ? 0.41 : 0.87,
          shields: { level: combat ? 0.3 : 0.64, faces: [0.9, 0.75, rear, 0.85] },
          master_mode: { mode: 'MASTER_MODE_SCM', spooled: false },
          annunciators: combat ? { misl: 'ANNUNCIATOR_STATE_MAJOR', hit: 'ANNUNCIATOR_STATE_MAJOR' } : {},
          flight: {
            instruments: {
              speed,
              hydrogen_fuel: 0.71,
              quantum_fuel: 0.92,
              g_meter: { current: 1 + Math.abs(Math.sin(t / 2)) * (combat ? 6 : 3) },
              altitude: 1e13,
              heading: (t * 8) % 360,
            },
          },
        },
      },
      weapons: { countermeasures: [{ type: 'DECOY', amount: 4 }, { type: 'NOISE', amount: 2 }] },
      sessionMetrics: {
        uecStart,
        uecCurrent: balance,
        uecDelta: balance - uecStart,
        maxSpeed,
        maxG: 7.4,
        deaths,
        downedCount: downed,
        activeShipName: ship.name,
        activeShipSince: iso(start),
        totalFrames: 0,
      },
    };
    sink.frame(f);
  };

  const script = () => {
    step++;
    const active = contracts.find((c) => c.status === 'active');
    switch (step % 8) {
      case 1: {
        const dest = DESTS[step % DESTS.length];
        sink.event(ev({ type: 'quantum', title: 'Quantum Route Computed', details: dest, category: 'navigation' }));
        break;
      }
      case 2:
        if (active) {
          const next = active.objectives.find((o) => o.state !== 'completed');
          if (next) next.state = 'completed';
          const after = active.objectives.find((o) => o.state !== 'completed');
          if (after) after.state = 'inprogress';
          sink.event(ev({ type: 'objective_update', title: 'Objective Updated', category: 'objective', missionId: active.id }));
          sink.contracts(contracts.map((c) => ({ ...c, objectives: c.objectives.map((o) => ({ ...o })) })));
        }
        break;
      case 3:
        missileUntil = Date.now() + 5000;
        sink.event(ev({ type: 'notice', title: 'MISSILE LOCK / INCOMING', category: 'combat', severity: 'alert' }));
        break;
      case 4:
        if (active) {
          active.status = 'completed';
          active.endedAt = iso();
          active.objectives.forEach((o) => (o.state = 'completed'));
          const reward = 45_000;
          active.reward = reward;
          balance += reward;
          sink.event(ev({ type: 'mission_completed', title: 'Contract Completed', category: 'contract', missionId: active.id, missionName: active.name ?? undefined }));
          sink.event(ev({ type: 'reward', title: 'aUEC Awarded', category: 'finance', amountAuec: reward, severity: 'success' }));
          sink.history([Date.now(), balance]);
          sink.contracts(contracts.map((c) => ({ ...c })));
        }
        break;
      case 5: {
        contractSeq++;
        const c: Contract = {
          id: `demo-${contractSeq}`,
          name: CONTRACTS[contractSeq % CONTRACTS.length],
          acceptedAt: iso(),
          status: 'active',
          objectives: [
            { id: 'a', text: 'Go to the pickup location', state: 'inprogress', updatedAt: iso() },
            { id: 'b', text: 'Collect the cargo', state: 'pending', updatedAt: iso() },
            { id: 'c', text: 'Deliver to the drop-off', state: 'pending', updatedAt: iso() },
          ],
        };
        contracts.push(c);
        while (contracts.filter((x) => x.status !== 'active').length > 3) {
          contracts.splice(contracts.findIndex((x) => x.status !== 'active'), 1);
        }
        sink.event(ev({ type: 'mission_accepted', title: 'Contract Accepted', category: 'contract', missionId: c.id, missionName: c.name ?? undefined }));
        sink.contracts(contracts.map((x) => ({ ...x })));
        break;
      }
      case 6:
        balance -= 12_400;
        sink.event(ev({ type: 'purchase', title: 'Purchase', details: 'Size 3 Laser Repeater', amountAuec: 12_400, category: 'finance' }));
        sink.history([Date.now(), balance]);
        break;
      case 7:
        if (step % 16 === 7) {
          deaths++;
          sink.event(ev({ type: 'medical', title: 'Pilot Incapacitated / Dead', category: 'combat', severity: 'alert' }));
        } else {
          shipIdx = (shipIdx + 1) % SHIPS.length;
          maxSpeed += 40;
          sink.event(ev({ type: 'flight_start', title: 'Entered Vehicle Seat', category: 'flight' }));
        }
        break;
      default:
        break;
    }
  };

  frame();
  const fTimer = window.setInterval(frame, 125);
  const sTimer = window.setInterval(script, 6000);
  return () => {
    window.clearInterval(fTimer);
    window.clearInterval(sTimer);
  };
}
