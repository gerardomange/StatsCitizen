import React, { useState } from 'react';
import {
  LayoutDashboard,
  Rocket,
  CreditCard,
  AlertTriangle,
  Navigation,
  Wrench,
  Radio,
  FolderSearch,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
  Clapperboard,
} from 'lucide-react';
import { StarCitizenInstall } from '../../types/telemetry.js';
import { useShipTheme } from '../../themes/ShipThemeContext.js';
import { ManufacturerLogo } from '../common/ManufacturerLogo.js';
import { useT } from '../../i18n/index.js';

export type NavTab = 'overview' | 'activity' | 'hangar' | 'economy' | 'blackbox' | 'starmap' | 'tools' | 'live' | 'overlay';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  scPath?: string;
  installs?: StarCitizenInstall[];
  onSwitchInstall?: (install: StarCitizenInstall) => void;
  onSelectPath?: () => void;
  isScanning?: boolean;
  grpcConnected?: boolean;
}

const COLLAPSE_KEY = 'statscitizen.sidebarCollapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
};

/** English source labels, translated at render. */
export const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'live', label: 'Live HUD', icon: Radio },
  { id: 'overlay', label: 'Stream Overlay', icon: Clapperboard },
  { id: 'overview', label: 'Pilot Dossier', icon: LayoutDashboard },
  { id: 'activity', label: 'Mission Logbook', icon: ScrollText },
  { id: 'hangar', label: 'Flight Operations', icon: Rocket },
  { id: 'economy', label: 'Financial Ledger', icon: CreditCard },
  { id: 'blackbox', label: 'Black Box', icon: AlertTriangle },
  { id: 'starmap', label: 'Quantum Routes', icon: Navigation },
  { id: 'tools', label: 'Verse Toolkit', icon: Wrench },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  scPath,
  installs = [],
  onSwitchInstall,
  onSelectPath,
  isScanning,
  grpcConnected,
}) => {
  const t = useT();
  const { theme, isBranded, shipName } = useShipTheme();
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !c;
    });

  const activeChannel =
    installs.find((i) => i.path.toLowerCase() === (scPath || '').toLowerCase())?.channel ??
    (scPath ? scPath.split(/[\\/]/).filter(Boolean).pop()?.toUpperCase() : '—');

  return (
    <aside
      className={`${collapsed ? 'w-14' : 'w-56'} shrink-0 bg-space-950/80 border-r border-cyan-500/10 flex flex-col justify-between py-3 ${
        collapsed ? 'px-2' : 'px-3'
      } select-none transition-[width] duration-200`}
    >
      <div className="space-y-1">
        <button
          onClick={toggle}
          className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-end'} p-1.5 rounded text-slate-500 hover:text-quantum-cyan`}
          title={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const isLive = item.id === 'live';
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={collapsed ? t(item.label) : undefined}
              className={`relative w-full flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} py-2.5 rounded-lg text-xs font-medium transition-all group ${
                isActive
                  ? 'bg-gradient-to-r from-cyan-500/20 to-transparent text-white border-l-2 border-quantum-cyan'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-space-850/60'
              }`}
            >
              <Icon
                className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                  isActive ? 'text-quantum-cyan' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              />
              {!collapsed && <span className="font-rajdhani text-sm tracking-wide font-semibold truncate">{t(item.label)}</span>}
              {isLive && grpcConnected && (
                <span
                  className={`${collapsed ? 'absolute top-1.5 right-1.5' : 'ml-auto'} w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse`}
                  title={t('Live')}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="pt-3 border-t border-cyan-500/10 space-y-2">
        {isBranded &&
          (collapsed ? (
            <div className="flex justify-center py-1" title={`${theme.osName} · ${shipName ?? theme.name}`}>
              <ManufacturerLogo theme={theme} className="w-8 h-8 text-quantum-cyan" />
            </div>
          ) : (
            <div className="relative overflow-hidden p-3 hud-radius bg-gradient-to-br from-cyan-500/15 to-transparent border border-cyan-500/30">
              <ManufacturerLogo theme={theme} className="absolute -right-3 -bottom-3 w-20 h-20 text-quantum-cyan opacity-10" />
              <div className="relative flex items-center gap-2.5">
                <ManufacturerLogo theme={theme} className="w-8 h-8 shrink-0 text-quantum-cyan" />
                <div className="min-w-0">
                  <div className="text-[9px] font-mono text-cyan-300/80 tracking-widest uppercase truncate">{theme.osName}</div>
                  <div className="text-xs font-orbitron font-bold text-white truncate uppercase">{shipName ?? theme.name}</div>
                </div>
              </div>
            </div>
          ))}

        {collapsed ? (
          <button
            onClick={onSelectPath}
            className="w-full flex flex-col items-center gap-1 py-1.5 rounded text-[9px] font-mono text-slate-400 hover:text-quantum-cyan"
            title={scPath}
          >
            <FolderSearch className="w-4 h-4" />
            {activeChannel}
          </button>
        ) : (
          <>
            {installs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {installs.map((inst) => {
                  const selected = inst.path.toLowerCase() === (scPath || '').toLowerCase();
                  return (
                    <button
                      key={inst.channel}
                      onClick={() => onSwitchInstall?.(inst)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                        selected ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-slate-800 bg-space-900 text-slate-400 hover:text-white'
                      }`}
                      title={inst.path}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          inst.isRunning ? 'bg-emerald-400 animate-pulse' : selected ? 'bg-quantum-cyan' : 'bg-slate-600'
                        }`}
                      />
                      <span>{inst.channel}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-space-900 border border-slate-800">
              <span className="text-[10px] font-mono text-slate-400 truncate" title={scPath}>
                {scPath ? scPath.split(/[\\/]/).slice(-2).join('\\') : t('Not detected')}
              </span>
              <button
                onClick={onSelectPath}
                className="p-1 rounded text-slate-400 hover:text-quantum-cyan hover:bg-space-800 transition-colors"
                title={t('Select Star Citizen folder')}
              >
                <FolderSearch className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
