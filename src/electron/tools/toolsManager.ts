import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CleanShadersResult {
  success: boolean;
  freedBytes: number;
  freedFormatted: string;
  clearedFilesCount: number;
  error?: string;
}

export interface BackupResult {
  success: boolean;
  backupPath: string;
  filesBackedUp: string[];
  error?: string;
}

function getFolderSize(dirPath: string): { bytes: number; count: number } {
  let bytes = 0;
  let count = 0;
  if (!fs.existsSync(dirPath)) return { bytes, count };

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = getFolderSize(fullPath);
      bytes += sub.bytes;
      count += sub.count;
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        bytes += stat.size;
        count += 1;
      } catch {
        // ignore
      }
    }
  }
  return { bytes, count };
}

function deleteFolderRecursive(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export function cleanShaderCache(): CleanShadersResult {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const scDataDir = path.join(localAppData, 'Star Citizen');
    if (!fs.existsSync(scDataDir)) {
      return {
        success: false,
        freedBytes: 0,
        freedFormatted: '0 MB',
        clearedFilesCount: 0,
        error: 'Star Citizen cache folder was not found.',
      };
    }

    // Never remove the parent folder: it may contain settings and diagnostic data.
    const cacheDirs = fs.readdirSync(scDataDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^(shadercache|shader-cache)$/i.test(entry.name))
      .map((entry) => path.join(scDataDir, entry.name));
    if (cacheDirs.length === 0) {
      return {
        success: false,
        freedBytes: 0,
        freedFormatted: '0 MB',
        clearedFilesCount: 0,
        error: 'No clearly identified shader-cache folder was found; nothing was deleted.',
      };
    }

    let bytes = 0;
    let count = 0;
    for (const cacheDir of cacheDirs) {
      const size = getFolderSize(cacheDir);
      bytes += size.bytes;
      count += size.count;
      deleteFolderRecursive(cacheDir);
    }

    const freedMB = (bytes / (1024 * 1024)).toFixed(2);
    return {
      success: true,
      freedBytes: bytes,
      freedFormatted: `${freedMB} MB`,
      clearedFilesCount: count,
    };
  } catch (err: any) {
    return {
      success: false,
      freedBytes: 0,
      freedFormatted: '0 MB',
      clearedFilesCount: 0,
      error: err.message,
    };
  }
}

export function backupUserSettings(scPath: string, targetDir?: string): BackupResult {
  try {
    const defaultBackupDir = targetDir || path.join(os.homedir(), 'Documents', 'StatsCitizen_Backups');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFolder = path.join(defaultBackupDir, `SC_Backup_${timestamp}`);

    if (!fs.existsSync(backupFolder)) {
      fs.mkdirSync(backupFolder, { recursive: true });
    }

    const filesBackedUp: string[] = [];

    // Paths to backup
    const itemsToBackup = [
      {
        relSource: path.join('user', 'client', '0', 'Controls', 'Mappings', 'actionmaps.xml'),
        destName: 'actionmaps.xml',
      },
      {
        relSource: path.join('user', 'client', '0', 'customcharacters'),
        destName: 'customcharacters',
        isDir: true,
      },
      {
        relSource: path.join('user', 'client', '0', 'PowerPresets'),
        destName: 'PowerPresets',
        isDir: true,
      },
      {
        relSource: 'user.cfg',
        destName: 'user.cfg',
      },
    ];

    for (const item of itemsToBackup) {
      const src = path.join(scPath, item.relSource);
      if (fs.existsSync(src)) {
        const dest = path.join(backupFolder, item.destName);
        if (item.isDir) {
          fs.cpSync(src, dest, { recursive: true });
          filesBackedUp.push(item.destName);
        } else {
          fs.copyFileSync(src, dest);
          filesBackedUp.push(item.destName);
        }
      }
    }

    return {
      success: true,
      backupPath: backupFolder,
      filesBackedUp,
    };
  } catch (err: any) {
    return {
      success: false,
      backupPath: '',
      filesBackedUp: [],
      error: err.message,
    };
  }
}
