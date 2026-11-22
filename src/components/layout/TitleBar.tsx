import React, { useEffect, useRef, useState } from 'react';
import {
  Minus,
  Square,
  X,
  Compass,
  Volume2,
  VolumeX,
  Settings,
  PictureInPicture2,
  Maximize2,
  Pin,
  PinOff,
} from 'lucide-react';
import { desktopApi } from '../../services/desktopApi.js';
import { useShipTheme } from '../../themes/ShipThemeContext.js';
import { ManufacturerLogo } from '../common/ManufacturerLogo.js';
import { MANUFACTURERS, UEE_STANDARD_THEME } from '../../themes/manufacturers.js';
import { Lang, useI18n } from '../../i18n/index.js';

interface TitleBarProps {
  currentPatch?: string;
  compact?: boolean;
  onToggleCompact?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}

const LANGS: Array<{ id: Lang; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
];

export const TitleBar: React.FC<TitleBarProps> = ({ currentPatch, compact, onToggleCompact, pinned, onTogglePin }) => {
  const { t, lang, setLang } = useI18n();
  const {
    theme,
    isBranded,
    shipName,
    muted,
    setMuted,
    bootEnabled,
    setBootEnabled,
    alertFrame,
    setAlertFrame,
    previewId,
    setPreviewId,
  } = useShipTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const winBtn = 'w-9 h-7 flex items-center justify-center hover:bg-space-800 transition-colors';

  return (
    <div
      data-tauri-drag-region
      className="h-10 bg-space-950/90 border-b border-cyan-500/10 flex items-center justify-between px-4 select-none z-50"
    >
      {/* Brand */}
      <div data-tauri-drag-region className="flex items-center gap-3 min-w-0">
        <div data-tauri-drag-region className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded bg-cyan-500/10 border border-cyan-500/30 pointer-events-none text-quantum-cyan">
            {isBranded ? (
              <ManufacturerLogo theme={theme} className="w-3.5 h-3.5 block" />
            ) : (
              <Compass className="w-3.5 h-3.5 text-quantum-cyan" />
            )}
          </div>
          {isBranded ? (
            <>
              <span className="font-orbitron font-bold tracking-wider text-xs text-quantum-cyan pointer-events-none">
                {theme.osName}
              </span>
              <span className="text-[10px] text-slate-400 font-mono tracking-tight pointer-events-none uppercase truncate">
                // {shipName ?? theme.name}
              </span>
            </>
          ) : (
            <span className="font-orbitron font-bold tracking-wider text-xs text-white pointer-events-none">
              STATS<span className="text-quantum-cyan">CITIZEN</span>
            </span>
          )}
        </div>

        {currentPatch && !compact && !isBranded && (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded bg-space-850 border border-slate-700/50 text-[10px] text-slate-400 font-mono pointer-events-none">
            {currentPatch}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center">
        {compact && (
          <button
            onClick={onTogglePin}
            className={`${winBtn} ${pinned ? 'text-quantum-cyan' : 'text-slate-400 hover:text-quantum-cyan'}`}
            title={pinned ? t('Unpin window') : t('Keep window on top')}
          >
            {pinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
          </button>
        )}
        <button
          onClick={onToggleCompact}
          className={`${winBtn} ${compact ? 'text-quantum-cyan' : 'text-slate-400 hover:text-quantum-cyan'}`}
          title={compact ? t('Exit compact mode') : t('Compact mode (second monitor)')}
        >
          {compact ? <Maximize2 className="w-3.5 h-3.5" /> : <PictureInPicture2 className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => setMuted(!muted)}
          className={`${winBtn} text-slate-400 hover:text-quantum-cyan`}
          title={muted ? t('Unmute cockpit sounds') : t('Mute cockpit sounds')}
        >
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className={`${winBtn} ${menuOpen || previewId ? 'text-quantum-cyan' : 'text-slate-400 hover:text-quantum-cyan'}`}
            title={t('Settings')}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 w-72 glass-panel rounded-lg p-3 space-y-3 text-[11px] font-mono z-50">
              <div className="space-y-1.5">
                <div className="text-slate-500 uppercase tracking-wider text-[10px]">{t('Language')}</div>
                <div className="grid grid-cols-2 gap-1">
                  {LANGS.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLang(l.id)}
                      className={`px-2 py-1 rounded border text-[10px] ${
                        lang === l.id
                          ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                          : 'border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-slate-300">{t('Boot sequence when seated')}</span>
                <input
                  type="checkbox"
                  checked={bootEnabled}
                  onChange={(e) => setBootEnabled(e.target.checked)}
                  className="accent-[rgb(var(--accent))]"
                />
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-slate-300">{t('Alert border (missile / hit)')}</span>
                <input
                  type="checkbox"
                  checked={alertFrame}
                  onChange={(e) => setAlertFrame(e.target.checked)}
                  className="accent-[rgb(var(--accent))]"
                />
              </label>

              <div className="space-y-1.5">
                <div className="text-slate-500 uppercase tracking-wider text-[10px]">{t('Brand preview')}</div>
                <div className="grid grid-cols-4 gap-1">
                  <button
                    onClick={() => setPreviewId(null)}
                    className={`col-span-4 px-2 py-1 rounded border text-[10px] ${
                      !previewId
                        ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                        : 'border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    {t('AUTO (live)')}
                  </button>
                  {[...MANUFACTURERS, UEE_STANDARD_THEME].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setPreviewId(m.id)}
                      title={m.name}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded border transition-colors ${
                        previewId === m.id ? 'border-cyan-500/50 bg-cyan-500/15' : 'border-slate-800 hover:border-slate-600'
                      }`}
                      style={{ color: m.colors.accent }}
                    >
                      <ManufacturerLogo theme={m} className="w-6 h-6 block" />
                      <span className="text-[8px] text-slate-400 truncate w-full text-center">{m.short}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <button onClick={() => void desktopApi.windowMinimize()} className={`${winBtn} text-slate-400 hover:text-white`} title={t('Minimize')}>
          <Minus className="w-3.5 h-3.5" />
        </button>
        {!compact && (
          <button onClick={() => void desktopApi.windowMaximize()} className={`${winBtn} text-slate-400 hover:text-white`} title={t('Maximize')}>
            <Square className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={() => void desktopApi.windowClose()}
          className="w-9 h-7 flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 transition-colors"
          title={t('Close')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
