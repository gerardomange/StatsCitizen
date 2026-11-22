// Live data for overlay pages and the editor preview: SSE from the StatsCitizen server,
// or a local simulation (demo mode).
import { useEffect, useRef, useState } from 'react';
import type { LiveTelemetryEvent, LiveTelemetryFrame } from '../types/telemetry.js';
import { startDemo } from './demo.js';
import { shipDisplayName } from './util.js';
import { emptyFeed, type Contract, type FeedState, type Moment, type MomentKind, type OverlayLayout } from './types.js';

export interface FeedOptions {
  /** Server base, e.g. "http://127.0.0.1:47800". Empty → same origin. Null → no server (demo only). */
  api: string | null;
  layoutId?: string;
  token?: string | null;
  /** Always simulate (editor without server, or ?demo=1). */
  forceDemo?: boolean;
}

const MAX_EVENTS = 30;
const MAX_MOMENTS = 12;

let momentSeq = 0;
const moment = (kind: MomentKind, title: string, extra: Partial<Moment> = {}): Moment => ({
  id: `m${++momentSeq}-${Date.now()}`,
  kind,
  title,
  at: Date.now(),
  ...extra,
});

export const TEST_MOMENTS: Record<string, () => Moment> = {
  payout: () => moment('payout', 'Payment received', { amount: 45000 }),
  contract: () => moment('contract', 'Contract complete', { value: 'Bounty: Eliminate "Rook" Vance', amount: 45000 }),
  death: () => moment('death', 'K.I.A.'),
  downed: () => moment('downed', 'Downed'),
  missile: () => moment('missile', 'Missile lock'),
  shields: () => moment('shields', 'Shields critical'),
  quantum: () => moment('quantum', 'Quantum jump', { value: 'Hurston' }),
  ship: () => moment('ship', 'Boarding', { value: 'Drake Cutlass Black' }),
  record: () => moment('record', 'New speed record', { value: '1,284 m/s' }),
  goal: () => moment('goal', 'Stream goal reached', { amount: 250000 }),
  boot: () => moment('boot', 'Boot'),
};

/** Turn a live event into a viewer-facing moment (or nothing). */
function momentFromEvent(ev: LiveTelemetryEvent, lastPayout: { amount: number; at: number }): Moment | null {
  const title = ev.title ?? '';
  switch (ev.type) {
    case 'mission_completed':
      return moment('contract', 'Contract complete', { value: ev.missionName ?? undefined });
    case 'mission_failed':
      return moment('failed', 'Contract failed', { value: ev.missionName ?? undefined });
    case 'reward': {
      const amount = Math.abs(ev.amountAuec ?? 0);
      if (!amount) return null;
      // Game.log "aUEC Awarded" and the gRPC balance delta report the same payment.
      if (Math.abs(lastPayout.amount - amount) < 1 && Date.now() - lastPayout.at < 8000) return null;
      lastPayout.amount = amount;
      lastPayout.at = Date.now();
      return moment('payout', 'Payment received', { amount });
    }
    case 'medical':
      if (/dead|incapacitated/i.test(title)) return moment('death', 'K.I.A.');
      if (/downed/i.test(title)) return moment('downed', 'Downed');
      return null;
    case 'notice':
      if (/missile/i.test(title)) return moment('missile', 'Missile lock');
      if (/shields critical/i.test(title)) return moment('shields', 'Shields critical');
      return null;
    case 'quantum':
      return moment('quantum', 'Quantum jump', { value: ev.details || undefined });
    default:
      return null;
  }
}

export function useOverlayFeed(opts: FeedOptions) {
  const { api, layoutId, token, forceDemo } = opts;
  const [state, setState] = useState<FeedState>(emptyFeed);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [nonce, setNonce] = useState(0);
  const serverDemo = state.demo;
  const demo = Boolean(forceDemo || serverDemo);
  const demoRef = useRef(demo);
  demoRef.current = demo;

  const pushMoment = (m: Moment | null) => {
    if (m) setMoments((prev) => [...prev.slice(-(MAX_MOMENTS - 1)), m]);
  };

  // Frame-derived moments (ship change, speed record).
  const prevShip = useRef<string | null | undefined>(undefined);
  const record = useRef<{ speed: number; at: number }>({ speed: 0, at: 0 });
  const onFrame = (frame: LiveTelemetryFrame, initial = false) => {
    // Key on the raw class so a late-updating display name can't fire twice; only a *different*
    // ship than the last one boarded counts (hopping in and out of the same ship stays quiet).
    const key = frame.vehicle?.state?.class_name || frame.vehicle?.state?.name || null;
    if (key && key !== prevShip.current) {
      if (!initial && prevShip.current !== undefined) {
        pushMoment(moment('ship', 'Boarding', { value: shipDisplayName(frame) ?? key }));
      }
      prevShip.current = key;
    } else if (initial && !key) {
      prevShip.current = null;
    }
    const max = frame.sessionMetrics?.maxSpeed ?? 0;
    if (initial || record.current.speed === 0) {
      record.current.speed = max;
    } else if (max > 250 && max > record.current.speed * 1.05 && Date.now() - record.current.at > 90_000) {
      record.current = { speed: max, at: Date.now() };
      pushMoment(moment('record', 'New speed record', { value: `${Math.round(max).toLocaleString('en-US')} m/s` }));
    }
  };

  // ---- SSE connection
  useEffect(() => {
    if (api === null) return;
    const params = new URLSearchParams();
    if (layoutId) params.set('layout', layoutId);
    if (token) params.set('k', token);
    const es = new EventSource(`${api}/events?${params.toString()}`);
    const lastPayout = { amount: 0, at: 0 };

    es.onmessage = (msg) => {
      let data: any;
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }
      const live = !demoRef.current;
      switch (data.t) {
        case 'hello': {
          const history = (data.history ?? []) as Array<[number, number]>;
          if (data.frame) onFrame(data.frame, true);
          else prevShip.current = null;
          setState((s) => ({
            ...s,
            online: true,
            demo: Boolean(data.demo),
            frame: live ? data.frame ?? null : s.frame,
            events: live ? data.events ?? [] : s.events,
            contracts: live ? data.contracts ?? [] : s.contracts,
            contractsCompleted: live ? data.contractsCompleted ?? 0 : s.contractsCompleted,
            history: live ? history : s.history,
            sessionStart: live ? data.sessionStart ?? history[0]?.[0] ?? s.sessionStart : s.sessionStart,
            layout: (data.layout as OverlayLayout | null) ?? s.layout,
          }));
          break;
        }
        case 'frame':
          if (!live) break;
          onFrame(data.frame);
          setState((s) => ({ ...s, frame: data.frame }));
          break;
        case 'event':
          if (!live) break;
          pushMoment(momentFromEvent(data.event, lastPayout));
          setState((s) => ({ ...s, events: [data.event, ...s.events].slice(0, MAX_EVENTS) }));
          break;
        case 'contracts':
          if (live) setState((s) => ({ ...s, contracts: data.contracts as Contract[], contractsCompleted: data.completed ?? s.contractsCompleted }));
          break;
        case 'history':
          if (live) setState((s) => ({ ...s, history: [...s.history, data.point].slice(-1200) }));
          break;
        case 'reset':
          if (live) {
            prevShip.current = undefined;
            record.current = { speed: 0, at: 0 };
            setState((s) => ({ ...s, frame: null, events: [], contracts: [], contractsCompleted: 0, history: [], sessionStart: data.sessionStart ?? Date.now() }));
          }
          break;
        case 'demo':
          setState((s) => ({ ...s, demo: Boolean(data.on) }));
          break;
        case 'layout':
          if (data.layout?.id === layoutId) setState((s) => ({ ...s, layout: data.layout, layoutDeleted: false }));
          break;
        case 'layoutDeleted':
          if (data.id === layoutId) setState((s) => ({ ...s, layoutDeleted: true }));
          break;
        case 'test': {
          const make = TEST_MOMENTS[data.kind];
          if (make) pushMoment(make());
          break;
        }
      }
    };
    es.onerror = () => setState((s) => ({ ...s, online: false }));
    return () => es.close();
  }, [api, layoutId, token, nonce]);

  // ---- Demo simulation
  useEffect(() => {
    if (!demo) return;
    const lastPayout = { amount: 0, at: 0 };
    prevShip.current = undefined;
    setState((s) => ({ ...s, frame: null, events: [], contracts: [], history: [], sessionStart: Date.now() - 2.9 * 3600_000 }));
    let first = true;
    const stop = startDemo({
      frame: (f) => {
        onFrame(f, first);
        first = false;
        setState((s) => ({ ...s, frame: f }));
      },
      event: (e) => {
        pushMoment(momentFromEvent(e, lastPayout));
        setState((s) => ({ ...s, events: [e, ...s.events].slice(0, MAX_EVENTS) }));
      },
      contracts: (c) =>
        setState((s) => ({ ...s, contracts: c, contractsCompleted: 4 + c.filter((x) => x.status === "completed").length })),
      history: (p) =>
        setState((s) => ({ ...s, history: [...s.history, p], sessionStart: Math.min(s.sessionStart, p[0]) })),
    });
    return () => {
      stop();
      // Back to live data: reconnect to get a fresh snapshot.
      setState((s) => ({ ...s, frame: null, events: [], contracts: [], history: [] }));
      setNonce((n) => n + 1);
    };
  }, [demo]);

  const online = demo || state.online;
  return { feed: { ...state, online, demo }, moments, pushTestMoment: (kind: string) => pushMoment(TEST_MOMENTS[kind]?.() ?? null) };
}
