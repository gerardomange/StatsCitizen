import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { findStarCitizenPath, validateStarCitizenPath } from './parser/scDetector.js';
import { indexAllStarCitizenLogs } from './parser/logIndexer.js';
import { cleanShaderCache, backupUserSettings } from './tools/toolsManager.js';
import { LiveGameLogWatcher } from './watcher/liveWatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let liveWatcher: LiveGameLogWatcher | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    frame: false,
    backgroundColor: '#05080f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'StatsCitizen // Fleet & Telemetry Terminal',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const primaryPath = path.join(app.getAppPath(), 'dist', 'index.html');
    const fallbackPath = path.join(__dirname, '../../dist/index.html');
    const fileToLoad = fs.existsSync(primaryPath) ? primaryPath : fallbackPath;
    mainWindow.loadFile(fileToLoad).catch((err) => {
      console.error('Failed to load file:', err);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDesc, url) => {
    console.error(`Page load error (${errorCode}): ${errorDesc} at ${url}`);
  });

  mainWindow.on('closed', () => {
    liveWatcher?.stop();
    mainWindow = null;
  });
}

// Window Management
ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow?.close();
});

// SC Path Handlers
ipcMain.handle('find-sc-path', async () => {
  return findStarCitizenPath();
});

ipcMain.handle('validate-sc-path', async (_, scPath: string) => {
  return validateStarCitizenPath(scPath);
});

ipcMain.handle('select-sc-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Star Citizen Installation Directory (e.g. LIVE)',
    properties: ['openDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Log Scanner Handler
ipcMain.handle('scan-logs', async (_, scPath: string) => {
  return await indexAllStarCitizenLogs(scPath, (progress) => {
    mainWindow?.webContents.send('log-scan-progress', progress);
  });
});

// Tools Handlers
ipcMain.handle('clean-shader-cache', async () => {
  return cleanShaderCache();
});

ipcMain.handle('backup-user-settings', async (_, scPath: string) => {
  return backupUserSettings(scPath);
});

// Live Watcher Handlers
ipcMain.handle('start-live-watch', async (_, scPath: string) => {
  if (!mainWindow) return false;
  liveWatcher?.stop();
  liveWatcher = new LiveGameLogWatcher(scPath, mainWindow);
  const started = liveWatcher.start();
  if (!started) liveWatcher = null;
  return started;
});

ipcMain.handle('stop-live-watch', async () => {
  liveWatcher?.stop();
  liveWatcher = null;
  return true;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
