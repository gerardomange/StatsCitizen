import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TitleBar } from './components/layout/TitleBar.js';
import { Sidebar, NavTab } from './components/layout/Sidebar.js';
import { ScanProgressBar } from './components/common/ScanProgressBar.js';
import { OverviewView } from './components/views/OverviewView.js';
import { HangarView } from './components/views/HangarView.js';
import { EconomyView } from './components/views/EconomyView.js';
import { BlackBoxView } from './components/views/BlackBoxView.js';
import { StarmapView } from './components/views/StarmapView.js';
import { VerseToolsView } from './components/views/VerseToolsView.js';
import { LiveCopilotView } from './components/views/LiveCopilotView.js';
import { ActivityLogView } from './components/views/ActivityLogView.js';
import { StreamOverlayView } from './components/views/StreamOverlayView.js';
import {
  TelemetrySummary,
  LiveTelemetryEvent,
  LiveTelemetryFrame,
  StarCitizenInstall,
  TelemetrySetupStatus,
} from './types/telemetry.js';
import { desktopApi, isTauriRuntime } from './services/desktopApi.js';
import { ShipThemeProvider } from './themes/ShipThemeContext.js';
import { CockpitBootOverlay } from './components/common/CockpitBootOverlay.js';
import { AlertFrame } from './components/common/AlertFrame.js';
import { CompactHudView } from './components/hud/CompactHudView.js';
import { detectHudMode } from './components/hud/hudUtils.js';
import { NAV_ITEMS } from './components/layout/Sidebar.js';
import { useT } from './i18n/index.js';

const COMPACT_KEY = 'statscitizen.compactMode';
const readCompact = () => {
  try {
    return localStorage.getItem(COMPACT_KEY) === '1';
  } catch {
    return false;
  }
};
import { FolderSearch, RefreshCw, Compass } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const App: React.FC = () => {
  const t = useT();
  const [activeTab, setActiveTab] = useState<NavTab>('live');
  const [scPath, setScPath] = useState<string>('');
  const [installs, setInstalls] = useState<StarCitizenInstall[]>([]);
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetrySetupStatus | null>(null);
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{
    current: number;
    total: number;
    filename: string;
  }>({
    current: 0,
    total: 0,
    filename: '',
  });

  const [isLiveWatching, setIsLiveWatching] = useState<boolean>(false);
  const [liveEvents, setLiveEvents] = useState<LiveTelemetryEvent[]>([]);
  const [liveFrame, setLiveFrame] = useState<LiveTelemetryFrame | null>(null);
  const [liveStartedAt, setLiveStartedAt] = useState<string | null>(null);
  const [compact, setCompact] = useState<boolean>(readCompact);
  const [pinned, setPinned] = useState<boolean>(false);

  // Resize the native window when compact mode changes (and on startup only if it was left compact).
  const prevCompact = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevCompact.current;
    prevCompact.current = compact;
    if (prev === compact) return; // StrictMode re-run / no change
    try {
      localStorage.setItem(COMPACT_KEY, compact ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (!isTauriRuntime() || (prev === null && !compact)) return;
    desktopApi.setCompactWindow(compact).catch((err) => console.warn('Compact window resize failed:', err));
    if (!compact) setPinned(false);
  }, [compact]);

  const handleTogglePin = () => {
    const next = !pinned;
    setPinned(next);
    if (isTauriRuntime()) desktopApi.setAlwaysOnTop(next).catch(() => setPinned(!next));
  };

  const refreshTelemetryStatus = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const status = await desktopApi.getTelemetryStatus();
      setTelemetryStatus(status);
      setInstalls(status.installs);
    } catch {
      // ignore transient status errors
    }
  }, []);

  const handleScanLogs = useCallback(async (pathToScan: string) => {
    if (!isTauriRuntime() || !pathToScan) return;
    setIsScanning(true);
    setScanError(null);
    setScanProgress({ current: 0, total: 0, filename: 'Starting…' });

    const unsubProgress = desktopApi.onScanProgress((data) => {
      setScanProgress(data);
    });

    try {
      const result = await desktopApi.scanLogs(pathToScan);
      setSummary(result);
    } catch (err) {
      console.error('Scan failed:', err);
      setScanError(err instanceof Error ? err.message : 'Could not scan the selected folder.');
    } finally {
      unsubProgress();
      setIsScanning(false);
    }
  }, []);

  // 1. Initial Auto-Detection + Auto-Engage Live Stream
  useEffect(() => {
    const init = async () => {
      if (!isTauriRuntime()) {
        setScanError(
          'Tauri desktop runtime was not detected. Launch the app using npm run dev or the StatsCitizen executable.'
        );
        return;
      }
      try {
        const status = await desktopApi.getTelemetryStatus();
        setTelemetryStatus(status);
        setInstalls(status.installs);

        const detectedPath =
          status.installs.find((i) => i.isRunning)?.path ??
          status.installs[0]?.path ??
          (await desktopApi.findStarCitizenPath());

        if (detectedPath) {
          setScPath(detectedPath);
          void handleScanLogs(detectedPath);

          // Automatically start live gRPC + Game.log hybrid listener
          const started = await desktopApi.startLiveWatch(detectedPath);
          if (started) {
            setLiveStartedAt(new Date().toISOString());
            setIsLiveWatching(true);
          }
        }
      } catch (err) {
        setScanError(
          err instanceof Error ? err.message : 'Could not detect the Star Citizen folder.'
        );
      }
    };
    void init();
  }, [handleScanLogs]);

  // 2. Setup Live Event & Live gRPC Frame Listeners
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unsubEvent = desktopApi.onLiveEvent((event) => {
      setLiveEvents((prev) => {
        if (event.id && prev.some((existing) => existing.id === event.id)) return prev;
        return [event, ...prev.slice(0, 1999)];
      });
    });
    const unsubFrame = desktopApi.onLiveFrame((frame) => {
      setLiveFrame(frame);
    });
    return () => {
      unsubEvent();
      unsubFrame();
    };
  }, []);

  const handleSwitchInstall = async (install: StarCitizenInstall) => {
    setScPath(install.path);
    setScanError(null);
    void handleScanLogs(install.path);
    if (isLiveWatching) {
      await desktopApi.startLiveWatch(install.path);
      setLiveEvents([]);
      setLiveFrame(null);
      setLiveStartedAt(new Date().toISOString());
    }
    void refreshTelemetryStatus();
  };

  const handleSelectFolder = async () => {
    if (!isTauriRuntime()) {
      setScanError('Tauri desktop runtime is required to open native folder dialogs.');
      return;
    }
    try {
      const selected = await desktopApi.selectStarCitizenFolder();
      if (!selected) return;
      const validation = await desktopApi.validateStarCitizenPath(selected);
      if (!validation.isValid) {
        setScanError(
          'This folder does not contain StarCitizen.exe, Game.log, or logbackups. Select a LIVE or PTU folder.'
        );
        return;
      }
      setScanError(null);
      setScPath(selected);
      void handleScanLogs(selected);
      if (isLiveWatching) {
        await desktopApi.startLiveWatch(selected);
        setLiveEvents([]);
        setLiveFrame(null);
        setLiveStartedAt(new Date().toISOString());
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'The folder picker could not be opened.');
    }
  };

  const handleToggleLive = async () => {
    if (!isTauriRuntime() || !scPath) return;
    if (isLiveWatching) {
      await desktopApi.stopLiveWatch();
      setIsLiveWatching(false);
      setLiveFrame(null);
    } else {
      try {
        const started = await desktopApi.startLiveWatch(scPath);
        if (started) {
          setLiveEvents([]);
          setLiveFrame(null);
          setLiveStartedAt(new Date().toISOString());
          setScanError(null);
          setIsLiveWatching(true);
        }
      } catch (err) {
        setScanError(err instanceof Error ? err.message : 'Could not start live telemetry.');
      }
    }
    void refreshTelemetryStatus();
  };

  return (
    <ShipThemeProvider frame={liveFrame}>
    <CockpitBootOverlay />
    <AlertFrame frame={liveFrame} />
    {compact ? (
      <div className="h-screen w-screen flex flex-col bg-space-950 text-slate-100 overflow-hidden font-sans select-none">
        <TitleBar
          compact
          onToggleCompact={() => setCompact(false)}
          pinned={pinned}
          onTogglePin={handleTogglePin}
        />
        <main className="flex-1 overflow-y-auto p-3 relative bg-space-900/40">
          <div className="absolute inset-0 bg-sc-grid opacity-30 pointer-events-none" />
          <div className="relative">
            <CompactHudView frame={liveFrame} mode={detectHudMode(liveFrame)} />
          </div>
        </main>
      </div>
    ) : (
    <div className="h-screen w-screen flex flex-col bg-space-950 text-slate-100 overflow-hidden font-sans select-none">
      <TitleBar
        currentPatch={summary?.currentPatch}
        onToggleCompact={() => setCompact(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          scPath={scPath}
          installs={installs}
          onSwitchInstall={(inst) => void handleSwitchInstall(inst)}
          onSelectPath={() => void handleSelectFolder()}
          isScanning={isScanning}
          grpcConnected={liveFrame?.connected}
        />

        <main className="flex-1 flex flex-col overflow-hidden bg-space-900/40 relative">
          <div className="absolute inset-0 bg-sc-grid opacity-30 pointer-events-none" />

          {activeTab !== 'live' && (
          <header className="h-10 border-b border-cyan-500/10 px-6 flex items-center justify-between z-10 bg-space-950/40 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs font-orbitron font-bold text-quantum-cyan tracking-wider uppercase">
                {t(NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? activeTab)}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {scPath && (
                <button
                  onClick={() => void handleScanLogs(scPath)}
                  disabled={isScanning}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-space-900 border border-slate-700/80 hover:border-cyan-500/40 text-xs font-mono text-slate-300 hover:text-white transition-all shadow-sm active:scale-95 disabled:opacity-50"
                  title={t('Rescan all log backups')}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-quantum-cyan' : ''}`}
                  />
                  <span>{t('Rescan logs')}</span>
                </button>
              )}
            </div>
          </header>
          )}

          <div className={`flex-1 overflow-y-auto z-10 ${activeTab === 'live' ? 'p-4' : 'p-6'}`}>
            {scanError ? (
              <div
                className="mb-5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-mono text-rose-200"
                role="alert"
              >
                {t(scanError)}
              </div>
            ) : null}

            {summary?.scanWarnings?.length ? (
              <div
                className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-mono text-amber-200"
                role="status"
              >
                {t('{n} log file(s) could not be read. Some statistics may be incomplete.', {
                  n: summary.scanWarnings.length,
                })}
                <details className="mt-2 text-[11px] text-amber-100/80">
                  <summary className="cursor-pointer">{t('Show skipped files')}</summary>
                  <ul className="mt-1 list-disc pl-5">
                    {summary.scanWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}

            {!scPath && !isScanning && (
              <div className="h-full flex items-center justify-center p-6">
                <div className="max-w-md w-full glass-panel p-8 rounded-2xl text-center space-y-4 sc-bracket">
                  <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto shadow-glow-cyan">
                    <Compass className="w-8 h-8 text-quantum-cyan" />
                  </div>
                  <h2 className="text-lg font-orbitron font-bold text-white tracking-wide">
                    {t('STAR CITIZEN FOLDER')}
                  </h2>
                  <p className="text-xs font-mono text-slate-400">
                    {t('Select your Star Citizen PTU or LIVE folder to connect live telemetry and index your logs.')}
                  </p>
                  <button
                    onClick={() => void handleSelectFolder()}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-xs font-mono font-bold text-quantum-cyan transition-all shadow-glow-cyan"
                  >
                    <FolderSearch className="w-4 h-4" />
                    <span>{t('Locate folder')}</span>
                  </button>
                </div>
              </div>
            )}

            {scPath && (
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                >
                  {activeTab === 'live' && (
                    <LiveCopilotView
                      scPath={scPath}
                      isLiveWatching={isLiveWatching}
                      onToggleLive={() => void handleToggleLive()}
                      liveEvents={liveEvents}
                      liveFrame={liveFrame}
                      liveStartedAt={liveStartedAt}
                      telemetryStatus={telemetryStatus}
                      onRefreshStatus={refreshTelemetryStatus}
                    />
                  )}
                  {activeTab !== 'live' && activeTab !== 'tools' && activeTab !== 'overlay' && !summary && (
                    <div className="py-24 text-center text-xs font-mono text-slate-500">
                      {isScanning ? t('Indexing your logs… this view will appear when it finishes.') : t('No log data yet.')}
                    </div>
                  )}
                  {activeTab === 'overview' && summary && <OverviewView summary={summary} />}
                  {activeTab === 'activity' && summary && <ActivityLogView summary={summary} />}
                  {activeTab === 'hangar' && summary && (
                    <HangarView
                      ships={summary.ships}
                      scannedFilesCount={summary.scannedFilesCount}
                      flightControlLines={summary.flightControlLines}
                    />
                  )}
                  {activeTab === 'economy' && summary && (
                    <EconomyView
                      purchases={summary.purchases}
                      totalSpent={summary.totalAuecSpent}
                    />
                  )}
                  {activeTab === 'blackbox' && summary && (
                    <BlackBoxView collisions={summary.collisions} />
                  )}
                  {activeTab === 'starmap' && summary && (
                    <StarmapView routes={summary.quantumRoutes} />
                  )}
                  {activeTab === 'tools' && <VerseToolsView scPath={scPath} />}
                  {activeTab === 'overlay' && <StreamOverlayView />}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </main>
      </div>

      {isScanning && (
        <ScanProgressBar
          current={scanProgress.current}
          total={scanProgress.total}
          filename={scanProgress.filename}
        />
      )}
    </div>
    )}
    </ShipThemeProvider>
  );
};
