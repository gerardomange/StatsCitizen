import fs from 'fs';
import path from 'path';
import os from 'os';

export function findStarCitizenPath(): string | null {
  const possiblePaths = [
    'C:\\Program Files (x86)\\StarCitizen\\LIVE',
    'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE',
    'D:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE',
    'D:\\StarCitizen\\LIVE',
    'E:\\StarCitizen\\LIVE',
    'C:\\StarCitizen\\LIVE',
    'F:\\StarCitizen\\LIVE',
    'D:\\Games\\StarCitizen\\LIVE',
    'E:\\Games\\StarCitizen\\LIVE',
    'C:\\Games\\StarCitizen\\LIVE',
    // PTU fallbacks
    'C:\\Program Files (x86)\\StarCitizen\\PTU',
    'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\PTU',
    'D:\\StarCitizen\\PTU',
  ];

  for (const p of possiblePaths) {
    if (validateStarCitizenPath(p).isValid) {
      return p;
    }
  }

  // Try checking RSI Launcher log for actual installation directory
  try {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const launcherLog = path.join(appData, 'rsilauncher', 'logs', 'log.log');
    if (fs.existsSync(launcherLog)) {
      const content = fs.readFileSync(launcherLog, 'utf8');
      const match = content.match(/Installing Star Citizen[^\n]+at\s+([A-Za-z]:\\[^\s)]+)/i);
      if (match && match[1]) {
        const detectedBase = match[1];
        const livePath = path.join(detectedBase, 'LIVE');
        if (fs.existsSync(livePath)) {
          return livePath;
        }
        if (fs.existsSync(detectedBase) && fs.existsSync(path.join(detectedBase, 'Game.log'))) {
          return detectedBase;
        }
      }
    }
  } catch {
    // Ignore error
  }

  return null;
}

export function validateStarCitizenPath(candidatePath: string): {
  isValid: boolean;
  hasGameLog: boolean;
  hasLogBackups: boolean;
  backupsCount: number;
} {
  try {
    if (!fs.statSync(candidatePath).isDirectory()) {
      return { isValid: false, hasGameLog: false, hasLogBackups: false, backupsCount: 0 };
    }
  } catch {
    return { isValid: false, hasGameLog: false, hasLogBackups: false, backupsCount: 0 };
  }
  const gameLogPath = path.join(candidatePath, 'Game.log');
  const hasGameLog = fs.existsSync(gameLogPath) && fs.statSync(gameLogPath).isFile();
  const backupsDir = path.join(candidatePath, 'logbackups');
  let hasLogBackups = false;
  let backupsCount = 0;

  if (fs.existsSync(backupsDir)) {
    try {
      const files = fs.readdirSync(backupsDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.log'));
      backupsCount = files.length;
      hasLogBackups = backupsCount > 0;
    } catch {
      hasLogBackups = false;
    }
  }

  return {
    isValid: hasGameLog || hasLogBackups,
    hasGameLog,
    hasLogBackups,
    backupsCount,
  };
}
