import React, { useState } from 'react';
import { GlassCard } from '../common/GlassCard.js';
import {
  Wrench,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Save,
  FolderOpen,
  Sparkles,
} from 'lucide-react';
import { BackupResult, CleanShadersResult } from '../../types/telemetry.js';
import { desktopApi } from '../../services/desktopApi.js';
import { useT } from '../../i18n/index.js';

interface VerseToolsViewProps {
  scPath: string;
}

export const VerseToolsView: React.FC<VerseToolsViewProps> = ({ scPath }) => {
  const t = useT();
  const [cleaningShaders, setCleaningShaders] = useState(false);
  const [shaderResult, setShaderResult] = useState<CleanShadersResult | null>(null);

  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);

  const handleCleanShaders = async () => {
    setCleaningShaders(true);
    setShaderResult(null);
    try {
      const res = await desktopApi.cleanShaderCache();
      setShaderResult(res);
    } catch (e: unknown) {
      setShaderResult({
        success: false,
        freedBytes: 0,
        freedFormatted: '0 MB',
        clearedFilesCount: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCleaningShaders(false);
    }
  };

  const handleBackupSettings = async () => {
    setBackingUp(true);
    setBackupResult(null);
    try {
      const res = await desktopApi.backupUserSettings(scPath);
      setBackupResult(res);
    } catch (e: unknown) {
      setBackupResult({
        success: false,
        backupPath: '',
        filesBackedUp: [],
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBackingUp(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-orbitron font-bold text-white tracking-wider flex items-center gap-2.5">
          <Wrench className="w-5 h-5 text-quantum-cyan" />
          {t('VERSE TOOLKIT')}
        </h2>
        <p className="text-xs font-mono text-slate-400 mt-1">
          {t('Maintenance and backup tools for Star Citizen')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <GlassCard variant="cyan" bracket className="space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
                <Trash2 className="w-6 h-6 text-quantum-cyan" />
              </div>
              <div>
                <h3 className="font-orbitron font-bold text-sm text-white tracking-wide">
                  {t('CLEAR SHADER CACHE')}
                </h3>
                <span className="text-[10px] font-mono text-slate-400">
                  {t('Only folders named ShaderCache')}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              {t('Removes only a folder explicitly named ShaderCache or Shader-Cache. If none is found, nothing is deleted. Star Citizen rebuilds shaders the next time it runs.')}
            </p>

            {shaderResult && (
              <div
                className={`p-3 rounded-lg border text-xs font-mono flex items-start gap-2.5 ${
                  shaderResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}
              >
                {shaderResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">
                    {shaderResult.success ? t('Shader cache cleared!') : t('Could not clear the shader cache')}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {shaderResult.success
                      ? t('Freed {size} across {n} files.', { size: shaderResult.freedFormatted, n: shaderResult.clearedFilesCount })
                      : shaderResult.error}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleCleanShaders}
            disabled={cleaningShaders}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-xs font-mono font-bold text-quantum-cyan transition-all shadow-glow-cyan hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            <span>{cleaningShaders ? t('Clearing…') : t('Clear shader cache')}</span>
          </button>
        </GlassCard>

        <GlassCard variant="amber" bracket className="space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <Save className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="font-orbitron font-bold text-sm text-white tracking-wide">
                  {t('SETTINGS BACKUP')}
                </h3>
                <span className="text-[10px] font-mono text-slate-400">
                  {t('Keybindings, characters & presets')}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              {t('Back up your keybindings (actionmaps.xml) and character presets (.chf) before patches, wipes or reinstalls.')}
            </p>

            {backupResult && (
              <div
                className={`p-3 rounded-lg border text-xs font-mono flex items-start gap-2.5 ${
                  backupResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}
              >
                {backupResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">
                    {backupResult.success ? t('Backup complete!') : t('Backup failed')}
                  </div>
                  <div
                    className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[280px]"
                    title={backupResult.backupPath}
                  >
                    {t('Saved to')}: {backupResult.backupPath}
                  </div>
                  <div className="text-[10px] text-slate-300 mt-1">
                    {t('Files')}: {backupResult.filesBackedUp.join(', ') || 'actionmaps, .chf'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleBackupSettings}
            disabled={backingUp}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-xs font-mono font-bold text-amber-300 transition-all shadow-glow-amber hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
          >
            <FolderOpen className="w-4 h-4" />
            <span>{backingUp ? t('Backing up…') : t('Back up keybinds & presets')}</span>
          </button>
        </GlassCard>
      </div>
    </div>
  );
};
