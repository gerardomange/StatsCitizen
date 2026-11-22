import { ElectronAPI } from '../electron/preload.cjs';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
