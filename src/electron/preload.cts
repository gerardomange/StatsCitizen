import { contextBridge, ipcRenderer } from 'electron';
import { TelemetrySummary, LiveTelemetryEvent } from '../types/telemetry.js';
import { CleanShadersResult, BackupResult } from './tools/toolsManager.js';

export interface ElectronAPI {
  findStarCitizenPath: () => Promise<string | null>;
  validateStarCitizenPath: (scPath: string) => Promise<{
    isValid: boolean;
    hasGameLog: boolean;
    hasLogBackups: boolean;
    backupsCount: number;
  }>;
  selectStarCitizenFolder: () => Promise<string | null>;
  scanLogs: (scPath: string) => Promise<TelemetrySummary>;
  onScanProgress: (callback: (data: { current: number; total: number; filename: string }) => void) => () => void;
  cleanShaderCache: () => Promise<CleanShadersResult>;
  backupUserSettings: (scPath: string) => Promise<BackupResult>;
  startLiveWatch: (scPath: string) => Promise<boolean>;
  stopLiveWatch: () => Promise<boolean>;
  onLiveEvent: (callback: (event: LiveTelemetryEvent) => void) => () => void;
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
}

const api: ElectronAPI = {
  findStarCitizenPath: () => ipcRenderer.invoke('find-sc-path'),
  validateStarCitizenPath: (scPath: string) => ipcRenderer.invoke('validate-sc-path', scPath),
  selectStarCitizenFolder: () => ipcRenderer.invoke('select-sc-folder'),
  scanLogs: (scPath: string) => ipcRenderer.invoke('scan-logs', scPath),
  onScanProgress: (callback) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('log-scan-progress', subscription);
    return () => {
      ipcRenderer.removeListener('log-scan-progress', subscription);
    };
  },
  cleanShaderCache: () => ipcRenderer.invoke('clean-shader-cache'),
  backupUserSettings: (scPath: string) => ipcRenderer.invoke('backup-user-settings', scPath),
  startLiveWatch: (scPath: string) => ipcRenderer.invoke('start-live-watch', scPath),
  stopLiveWatch: () => ipcRenderer.invoke('stop-live-watch'),
  onLiveEvent: (callback) => {
    const subscription = (_: any, event: any) => callback(event);
    ipcRenderer.on('live-telemetry-event', subscription);
    return () => {
      ipcRenderer.removeListener('live-telemetry-event', subscription);
    };
  },
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
