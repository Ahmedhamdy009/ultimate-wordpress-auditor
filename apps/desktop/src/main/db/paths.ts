import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as electronModule from 'electron';
import {
  APPLICATION_NAME,
  DESKTOP_STORAGE_PATHS,
  resolveExplicitUserDataDirectory,
} from '../config/paths.js';

export interface DatabasePathOptions {
  customDir?: string;
  isDev?: boolean;
}

/**
 * Resolves standard platform-specific application userData directory for production execution.
 * When Electron is running in a packaged production environment, uses app.getPath('userData').
 * Outside Electron (e.g. standalone CLI) or in development, resolves standard OS userData directory
 * using APPLICATION_NAME ('ultimate-wordpress-and-website-auditor').
 */
export function getProductionUserDataDirectory(): string {
  const explicitUserData = resolveExplicitUserDataDirectory();
  if (explicitUserData) {
    return explicitUserData;
  }

  try {
    if (Object.hasOwn(electronModule, 'app')) {
      const electronApp = (
        electronModule as {
          app?: { getPath(name: string): string; isPackaged?: boolean };
        }
      ).app;
      if (electronApp && typeof electronApp.getPath === 'function' && electronApp.isPackaged) {
        const userData = electronApp.getPath('userData');
        if (userData) {
          return path.resolve(userData);
        }
      }
    }
  } catch {
    // Outside Electron runtime
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, APPLICATION_NAME);
  } else if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APPLICATION_NAME);
  } else {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(configHome, APPLICATION_NAME);
  }
}

/**
 * Returns the resolved directory where SQLite databases are stored.
 * Priority:
 * 1. customDir if provided (for isolated unit/integration tests).
 * 2. If isDev === false explicitly requested: returns production database directory.
 * 3. Electron app.getPath('userData')/database if Electron is ready:
 *    - In Production: persistent path under standard user application data (e.g. %APPDATA%/.../database)
 *    - In Development: redirected by initializeDesktopStorage to D:\ahmed\.tmp\userData\database
 * 4. Standalone outside Electron:
 *    - In Development: DESKTOP_STORAGE_PATHS.userDataDir/database on Drive D:
 */
export function getDatabaseDirectory(options?: string | DatabasePathOptions): string {
  const customDir = typeof options === 'string' ? options : options?.customDir;
  if (customDir) {
    return path.resolve(customDir);
  }

  const explicitUserData = resolveExplicitUserDataDirectory();
  if (explicitUserData) {
    return path.join(explicitUserData, 'database');
  }

  const isDev = typeof options === 'object' ? options?.isDev : undefined;

  if (isDev === false) {
    return path.join(getProductionUserDataDirectory(), 'database');
  }

  try {
    if (Object.hasOwn(electronModule, 'app')) {
      const electronApp = (electronModule as { app?: { getPath(name: string): string } }).app;
      if (electronApp && typeof electronApp.getPath === 'function') {
        const userData = electronApp.getPath('userData');
        if (userData) {
          return path.join(userData, 'database');
        }
      }
    }
  } catch {
    // Electron app not ready or running outside Electron runtime
  }

  return path.join(DESKTOP_STORAGE_PATHS.userDataDir, 'database');
}

/**
 * Returns the resolved path to the primary SQLite database file.
 * Handles ':memory:' for transient in-memory operations and tests.
 */
export function getDatabasePath(customPath?: string, options?: DatabasePathOptions): string {
  if (customPath) {
    if (customPath === ':memory:') {
      return ':memory:';
    }
    return path.resolve(customPath);
  }
  return path.join(getDatabaseDirectory(options), 'auditor.db');
}

/**
 * Returns the directory dedicated to pre-migration and hot database backups.
 */
export function getBackupDirectory(
  customDir?: string | DatabasePathOptions,
  options?: DatabasePathOptions,
): string {
  const resolvedOpts: DatabasePathOptions | undefined =
    typeof customDir === 'string' ? { customDir, ...(options ?? {}) } : (customDir ?? options);
  return path.join(getDatabaseDirectory(resolvedOpts), 'backups');
}

/**
 * Synchronously ensures the directory housing the target database exists.
 * Does nothing for ':memory:'.
 */
export function ensureDatabaseDirectory(targetPath: string): void {
  if (targetPath === ':memory:') {
    return;
  }
  const dir = path.dirname(path.resolve(targetPath));
  fs.mkdirSync(dir, { recursive: true });
}
