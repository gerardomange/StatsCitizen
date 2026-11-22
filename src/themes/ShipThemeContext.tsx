import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveTelemetryFrame } from '../types/telemetry.js';
import {
  DEFAULT_THEME,
  ManufacturerTheme,
  applyThemeVars,
  getThemeById,
  resolveManufacturer,
} from './manufacturers.js';
import { cockpitAudio } from '../services/cockpitAudio.js';

/** How long the player must be out of the seat (or the stream gone) before we drop the brand. */
const EXIT_DEBOUNCE_MS = 1500;
const ALERT_COOLDOWN_MS = 4000;
const PREFS_KEY = 'statscitizen.shipTheme.prefs';

interface Prefs {
  muted: boolean;
  bootEnabled: boolean;
  alertFrame: boolean;
}

const DEFAULT_PREFS: Prefs = { muted: false, bootEnabled: true, alertFrame: true };

export interface BootState {
  key: number;
  theme: ManufacturerTheme;
  shipName: string;
}

interface ShipThemeValue {
  theme: ManufacturerTheme;
  isBranded: boolean;
  shipName: string | null;
  boot: BootState | null;
  dismissBoot: () => void;
  muted: boolean;
  setMuted: (m: boolean) => void;
  bootEnabled: boolean;
  setBootEnabled: (b: boolean) => void;
  alertFrame: boolean;
  setAlertFrame: (b: boolean) => void;
  previewId: string | null;
  setPreviewId: (id: string | null) => void;
}

const ShipThemeCtx = createContext<ShipThemeValue | null>(null);

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_PREFS;
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

function prettyShipName(frame: LiveTelemetryFrame | null): string {
  const v = frame?.vehicle?.state;
  const raw = v?.class_name || v?.name || '';
  // "DRAK_Cutlass_Black" -> "Cutlass Black"
  const parts = raw.split('_');
  const body = parts.length > 1 && parts[0] === parts[0].toUpperCase() ? parts.slice(1) : parts;
  return body.join(' ').trim() || 'UNKNOWN VESSEL';
}

export const ShipThemeProvider: React.FC<{ frame: LiveTelemetryFrame | null; children: React.ReactNode }> = ({
  frame,
  children,
}) => {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [liveTheme, setLiveTheme] = useState<ManufacturerTheme>(DEFAULT_THEME);
  const [shipName, setShipName] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [boot, setBoot] = useState<BootState | null>(null);

  const exitTimer = useRef<number | null>(null);
  const lastAlertAt = useRef(0);
  const prevMisl = useRef(false);
  const prevPressure = useRef<number | null>(null);
  const bootKey = useRef(0);
  const appliedId = useRef<string>(DEFAULT_THEME.id);

  useEffect(() => {
    cockpitAudio.setMuted(prefs.muted);
    savePrefs(prefs);
  }, [prefs]);

  // 1. Derive the live (gRPC-driven) theme from the frame.
  const locomotion = frame?.actor?.state?.locomotion ?? '';
  const vState = frame?.vehicle?.state;
  const seated = Boolean(frame?.connected && locomotion.includes('SEATED') && (vState?.class_name || vState?.name));
  const resolvedId = seated ? resolveManufacturer(vState?.manufacturer, vState?.class_name).id : DEFAULT_THEME.id;
  const currentShip = seated ? prettyShipName(frame) : null;

  useEffect(() => {
    if (seated) {
      if (exitTimer.current) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      const t = getThemeById(resolvedId) ?? DEFAULT_THEME;
      setLiveTheme((prev) => (prev.id === t.id ? prev : t));
      setShipName((prev) => (prev === currentShip ? prev : currentShip));
    } else if (!exitTimer.current && liveTheme.id !== DEFAULT_THEME.id) {
      exitTimer.current = window.setTimeout(() => {
        exitTimer.current = null;
        setLiveTheme(DEFAULT_THEME);
        setShipName(null);
      }, EXIT_DEBOUNCE_MS);
    }
  }, [seated, resolvedId, currentShip, liveTheme.id]);

  useEffect(() => () => {
    if (exitTimer.current) window.clearTimeout(exitTimer.current);
  }, []);

  // 2. Preview override (manual brand preview) wins over live state.
  const previewTheme = getThemeById(previewId);
  const theme = previewTheme ?? liveTheme;
  const effectiveShip = previewTheme ? (previewTheme.id === DEFAULT_THEME.id ? null : 'PREVIEW') : shipName;

  // 3. Apply CSS vars + boot / power-down on brand changes (and on ship swaps between brands).
  const shipKey = `${theme.id}|${effectiveShip ?? ''}`;
  const appliedShipKey = useRef(shipKey);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-transition');
    applyThemeVars(theme, root);
    const clear = window.setTimeout(() => root.classList.remove('theme-transition'), 700);

    const wasBranded = appliedId.current !== DEFAULT_THEME.id;
    const isBranded = theme.id !== DEFAULT_THEME.id;
    const changed = appliedShipKey.current !== shipKey;
    if (changed && isBranded) {
      cockpitAudio.boot(theme.sound);
      if (prefs.bootEnabled) {
        bootKey.current += 1;
        setBoot({ key: bootKey.current, theme, shipName: effectiveShip ?? theme.osName });
      }
    } else if (changed && wasBranded && !isBranded) {
      cockpitAudio.powerDown();
      setBoot(null);
    }
    appliedId.current = theme.id;
    appliedShipKey.current = shipKey;
    return () => window.clearTimeout(clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipKey]);

  // 4. Short alert tone for incoming missile (MISL MAJOR rising edge) or decompression.
  useEffect(() => {
    if (!frame?.connected) return;
    const now = Date.now();
    const misl = String(frame.vehicle?.state?.annunciators?.misl ?? '').includes('MAJOR');
    const pressure = frame.actor?.vitals?.pressure;
    const onFoot = locomotion.includes('ON_FOOT');
    const decompression =
      onFoot && typeof pressure === 'number' && pressure < 0.25 && (prevPressure.current ?? 1) >= 0.5;

    if (((misl && !prevMisl.current) || decompression) && now - lastAlertAt.current > ALERT_COOLDOWN_MS) {
      lastAlertAt.current = now;
      cockpitAudio.alert();
    }
    prevMisl.current = misl;
    if (typeof pressure === 'number') prevPressure.current = pressure;
  }, [frame, locomotion]);

  const dismissBoot = useCallback(() => setBoot(null), []);
  const setMuted = useCallback((muted: boolean) => setPrefs((p) => ({ ...p, muted })), []);
  const setBootEnabled = useCallback((bootEnabled: boolean) => setPrefs((p) => ({ ...p, bootEnabled })), []);
  const setAlertFrame = useCallback((alertFrame: boolean) => setPrefs((p) => ({ ...p, alertFrame })), []);

  const value = useMemo<ShipThemeValue>(
    () => ({
      theme,
      isBranded: theme.id !== DEFAULT_THEME.id,
      shipName: effectiveShip,
      boot,
      dismissBoot,
      muted: prefs.muted,
      setMuted,
      bootEnabled: prefs.bootEnabled,
      setBootEnabled,
      alertFrame: prefs.alertFrame,
      setAlertFrame,
      previewId,
      setPreviewId,
    }),
    [theme, effectiveShip, boot, dismissBoot, prefs, setMuted, setBootEnabled, setAlertFrame, previewId]
  );

  return <ShipThemeCtx.Provider value={value}>{children}</ShipThemeCtx.Provider>;
};

export function useShipTheme(): ShipThemeValue {
  const v = useContext(ShipThemeCtx);
  if (!v) throw new Error('useShipTheme must be used inside <ShipThemeProvider>');
  return v;
}
