import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import {
  BackupResult,
  CleanShadersResult,
  EnableTelemetryResult,
  LiveTelemetryEvent,
  LiveTelemetryFrame,
  OverlayConfig,
  OverlaySettings,
  PathValidation,
  StarCitizenInstall,
  TelemetrySetupStatus,
  TelemetrySummary,
  TriggerActionResult,
  TriggerableActionInfo,
} from '../types/telemetry.js';

export const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const COMPACT_SIZE = { width: 760, height: 560 };
const COMPACT_MIN = { width: 480, height: 360 };
const FULL_MIN = { width: 1080, height: 720 };
let savedWindowSize: { width: number; height: number } | null = null;

export const desktopApi = {
  findStarCitizenPath: () => invoke<string | null>('find_sc_path'),
  discoverInstalls: () => invoke<StarCitizenInstall[]>('discover_sc_installs'),
  validateStarCitizenPath: (scPath: string) =>
    invoke<PathValidation>('validate_sc_path', { scPath }),

  selectStarCitizenFolder: async (): Promise<string | null> => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Star Citizen Channel Directory (e.g. PTU or LIVE)',
    });
    if (typeof selected === 'string') return selected;
    return null;
  },

  scanLogs: (scPath: string) => invoke<TelemetrySummary>('scan_logs', { scPath }),

  onScanProgress: (
    callback: (data: { current: number; total: number; filename: string }) => void
  ): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    listen<{ current: number; total: number; filename: string }>('log-scan-progress', (ev) => {
      if (!disposed) callback(ev.payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  cleanShaderCache: () => invoke<CleanShadersResult>('clean_shader_cache'),
  backupUserSettings: (scPath: string) =>
    invoke<BackupResult>('backup_user_settings', { scPath }),

  getTelemetryStatus: () => invoke<TelemetrySetupStatus>('get_telemetry_status'),
  enableGameTelemetry: (channel?: string, enableActions = false) =>
    invoke<EnableTelemetryResult>('enable_game_telemetry', {
      channel: channel ?? null,
      enableActions,
    }),

  startLiveWatch: (scPath: string) => invoke<boolean>('start_live_watch', { scPath }),
  stopLiveWatch: () => invoke<boolean>('stop_live_watch'),

  onLiveEvent: (callback: (event: LiveTelemetryEvent) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    listen<LiveTelemetryEvent>('live-telemetry-event', (ev) => {
      if (!disposed) callback(ev.payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  onLiveFrame: (callback: (frame: LiveTelemetryFrame) => void): (() => void) => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    listen<LiveTelemetryFrame>('live-telemetry-frame', (ev) => {
      if (!disposed) callback(ev.payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  },

  listGameActions: (scPath: string) =>
    invoke<TriggerableActionInfo[]>('list_game_actions', { scPath }),
  triggerGameAction: (scPath: string, actionName: string, holdMs = 0) =>
    invoke<TriggerActionResult>('trigger_game_action', { scPath, actionName, holdMs }),

  // ---- Stream overlay
  overlayGetConfig: () => invoke<OverlayConfig>('overlay_get_config'),
  overlaySetSettings: (settings: OverlaySettings) => invoke<OverlayConfig>('overlay_set_settings', { settings }),
  overlayRegenerateToken: () => invoke<OverlayConfig>('overlay_regenerate_token'),
  overlaySaveLayout: (layout: unknown) => invoke<void>('overlay_save_layout', { layout }),
  overlayDeleteLayout: (id: string) => invoke<void>('overlay_delete_layout', { id }),
  overlaySetDemo: (on: boolean) => invoke<void>('overlay_set_demo', { on }),
  overlayTestMoment: (kind: string) => invoke<void>('overlay_test_moment', { kind }),

  windowMinimize: () => getCurrentWindow().minimize(),
  windowMaximize: () => getCurrentWindow().toggleMaximize(),
  windowClose: () => getCurrentWindow().close(),

  /** Shrink the window to a second-monitor HUD (and back, restoring the previous size). */
  setCompactWindow: async (on: boolean) => {
    const w = getCurrentWindow();
    if (on) {
      if (await w.isMaximized()) await w.unmaximize();
      const scale = await w.scaleFactor();
      const size = await w.innerSize();
      savedWindowSize = { width: size.width / scale, height: size.height / scale };
      await w.setMinSize(new LogicalSize(COMPACT_MIN.width, COMPACT_MIN.height));
      await w.setSize(new LogicalSize(COMPACT_SIZE.width, COMPACT_SIZE.height));
    } else {
      await w.setAlwaysOnTop(false);
      await w.setMinSize(new LogicalSize(FULL_MIN.width, FULL_MIN.height));
      await w.setSize(
        new LogicalSize(
          Math.max(savedWindowSize?.width ?? 1380, FULL_MIN.width),
          Math.max(savedWindowSize?.height ?? 900, FULL_MIN.height)
        )
      );
    }
  },
  setAlwaysOnTop: (on: boolean) => getCurrentWindow().setAlwaysOnTop(on),
};
