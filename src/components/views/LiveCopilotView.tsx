import React, { useMemo, useState } from 'react';
import { LayoutGrid, Play, RefreshCw, RotateCcw, Settings2, Square, Check } from 'lucide-react';
import {
  EnableTelemetryResult,
  LiveTelemetryEvent,
  LiveTelemetryFrame,
  StarCitizenInstall,
  TelemetrySetupStatus,
} from '../../types/telemetry.js';
import { GlassCard } from '../common/GlassCard.js';
import { desktopApi } from '../../services/desktopApi.js';
import { useT } from '../../i18n/index.js';
import { HUD_MODE_LABELS, HudMode, actorHazards, detectHudMode } from '../hud/hudUtils.js';
import { HazardList } from '../hud/HudPrimitives.js';
import { HudGrid, resetHudLayout } from '../hud/HudGrid.js';

interface LiveCopilotViewProps {
  scPath: string;
  isLiveWatching: boolean;
  onToggleLive: () => void;
  liveEvents: LiveTelemetryEvent[];
  liveFrame: LiveTelemetryFrame | null;
  liveStartedAt: string | null;
  telemetryStatus: TelemetrySetupStatus | null;
  onRefreshStatus: () => Promise<void>;
}

const MANUAL_MODES: HudMode[] = ['fps', 'eva', 'pilot', 'gunner', 'ground'];

const BTN = 'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-mono transition';
const BTN_IDLE = `${BTN} border-slate-800 text-slate-400 hover:text-white hover:border-slate-600`;
const BTN_ON = `${BTN} border-cyan-500/50 bg-cyan-500/15 text-cyan-200`;

export const LiveCopilotView: React.FC<LiveCopilotViewProps> = ({
  scPath,
  isLiveWatching,
  onToggleLive,
  liveEvents,
  liveFrame,
  telemetryStatus,
  onRefreshStatus,
}) => {
  const t = useT();
  const [enabling, setEnabling] = useState(false);
  const [enableActionsFlag, setEnableActionsFlag] = useState(true);
  const [setupMsg, setSetupMsg] = useState<EnableTelemetryResult | null>(null);
  const [modeOverride, setModeOverride] = useState<HudMode | null>(null);
  const [editing, setEditing] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const activeInstall: StarCitizenInstall | undefined = useMemo(() => {
    if (!telemetryStatus?.installs?.length) return undefined;
    return (
      telemetryStatus.installs.find((i) => i.path.toLowerCase() === scPath.toLowerCase()) ?? telemetryStatus.installs[0]
    );
  }, [telemetryStatus, scPath]);

  const handleEnableTelemetry = async () => {
    setEnabling(true);
    setSetupMsg(null);
    try {
      const res = await desktopApi.enableGameTelemetry(activeInstall?.channel, enableActionsFlag);
      setSetupMsg(res);
      await onRefreshStatus();
    } catch (e: unknown) {
      setSetupMsg({
        changedChannels: [],
        elevatedChannels: [],
        envUpdated: false,
        needsRestart: false,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setEnabling(false);
    }
  };

  const autoMode = detectHudMode(liveFrame);
  const hudMode: HudMode = modeOverride ?? autoMode;
  const needsSetup = Boolean(activeInstall && (!activeInstall.cfgReady || !telemetryStatus?.envEnabled));
  const hazards = hudMode === 'fps' || hudMode === 'eva' ? actorHazards(liveFrame) : [];

  const ctx = {
    frame: liveFrame,
    scPath,
    actionsEnabled: Boolean(liveFrame?.supportsActions && activeInstall?.actionsCfgEnabled),
    events: liveEvents,
    mode: hudMode,
  };

  const modeBtn = (active: boolean) =>
    'rounded-md border px-2.5 py-1 text-[10px] font-mono transition ' +
    (active ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200 font-bold' : 'border-slate-800 text-slate-500 hover:text-white');

  return (
    <div className="space-y-3">
      {/* Setup assistant (only while the game still needs configuring) */}
      {(needsSetup || telemetryStatus?.needsRestart || setupMsg) && (
        <GlassCard variant="amber" bracket className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-orbitron font-bold text-amber-300">
                <Settings2 className="w-4 h-4" />
                <span>
                  {needsSetup
                    ? t('Live telemetry needs to be enabled for {channel}', { channel: activeInstall?.channel ?? 'Star Citizen' })
                    : t('Restart the RSI Launcher and Star Citizen to apply')}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400">
                {t('Your existing user.cfg settings are kept (a backup is made). Fully quit the RSI Launcher from the tray afterwards.')}
              </p>
            </div>

            {needsSetup && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
                {activeInstall?.supportsActions && (
                  <label className="flex items-center gap-2 text-[10px] font-mono text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableActionsFlag}
                      onChange={(e) => setEnableActionsFlag(e.target.checked)}
                      className="accent-[rgb(var(--accent))]"
                    />
                    <span>{t('Enable cockpit actions (PTU)')}</span>
                  </label>
                )}
                <button
                  onClick={handleEnableTelemetry}
                  disabled={enabling}
                  className="px-4 py-2 rounded-lg border border-amber-400/50 bg-amber-500/20 hover:bg-amber-500/30 text-xs font-mono font-bold text-amber-200 transition-all disabled:opacity-50"
                >
                  {enabling ? t('Configuring…') : t('Enable telemetry')}
                </button>
              </div>
            )}
          </div>

          {setupMsg && (
            <div className="text-[11px] font-mono border-t border-amber-500/20 pt-2 space-y-1">
              {(setupMsg.changedChannels.length > 0 || setupMsg.elevatedChannels.length > 0 || setupMsg.envUpdated) && (
                <div className="text-emerald-300">✓ {t('Done. Quit the RSI Launcher completely and restart Star Citizen.')}</div>
              )}
              {setupMsg.errors.map((err) => (
                <div key={err} className="text-rose-300">
                  ✗ {err}
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Toolbar: HUD mode + layout + stream controls */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setModeOverride(null)} className={modeBtn(modeOverride === null)}>
          AUTO · {t(HUD_MODE_LABELS[autoMode])}
        </button>
        {MANUAL_MODES.map((m) => (
          <button key={m} onClick={() => setModeOverride(m)} className={modeBtn(modeOverride === m)}>
            {t(HUD_MODE_LABELS[m])}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1.5">
          {editing && (
            <button
              onClick={() => {
                resetHudLayout(hudMode);
                setResetKey((k) => k + 1);
              }}
              className={BTN_IDLE}
              title={t('Restore the default layout for this mode')}
            >
              <RotateCcw className="w-3.5 h-3.5" /> {t('Reset')}
            </button>
          )}
          <button
            onClick={() => setEditing((e) => !e)}
            className={editing ? BTN_ON : BTN_IDLE}
            title={t('Move, resize or hide modules')}
          >
            {editing ? <Check className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
            {editing ? t('Done') : t('Customize')}
          </button>
          <button onClick={() => void onRefreshStatus()} className={BTN_IDLE} title={t('Refresh game configuration status')}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggleLive}
            className={
              isLiveWatching
                ? `${BTN} border-slate-800 text-slate-400 hover:text-rose-300 hover:border-rose-500/50`
                : `${BTN} border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10`
            }
            title={isLiveWatching ? t('Stop live telemetry') : t('Start live telemetry')}
          >
            {isLiveWatching ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
            {!isLiveWatching && t('Start')}
          </button>
        </div>
      </div>

      <HazardList hazards={hazards} />

      <HudGrid ctx={ctx} editing={editing} resetKey={resetKey} />
    </div>
  );
};
