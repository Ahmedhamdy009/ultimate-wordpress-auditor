import * as electronModule from 'electron';
import fs from 'node:fs';
import path from 'node:path';

let defaultElectronApp: StorageConfigurationDependencies['app'] | undefined;
try {
  if (Object.hasOwn(electronModule, 'app')) {
    defaultElectronApp = (
      electronModule as unknown as { app?: StorageConfigurationDependencies['app'] }
    ).app;
  }
} catch {
  defaultElectronApp = undefined;
}

/**
 * Main-process filesystem storage and boundary configuration.
 * Strictly confined to Desktop Main Process / Node.js environment.
 */

export const APPLICATION_NAME = 'ultimate-wordpress-and-website-auditor';

export const APPLICATION_ID = 'com.auditor.desktop';

export const PROJECT_ROOT = 'D:\\ahmed';

/**
 * Resolves the path to the official application icon (.ico or .png).
 * Inspects packaged resourcesPath, import.meta.dirname, and project resources.
 */
export function resolveAppIconPath(customBaseDir?: string): string | undefined {
  if (process.resourcesPath) {
    const p1 = path.join(process.resourcesPath, 'resources', 'icon.ico');
    if (fs.existsSync(p1)) return p1;
    const p2 = path.join(process.resourcesPath, 'icon.ico');
    if (fs.existsSync(p2)) return p2;
    const p3 = path.join(process.resourcesPath, 'resources', 'icon.png');
    if (fs.existsSync(p3)) return p3;
  }

  const baseDir =
    customBaseDir ??
    (typeof import.meta.dirname === 'string' ? import.meta.dirname : process.cwd());

  const candidates = [
    path.join(baseDir, 'resources', 'icon.ico'),
    path.join(baseDir, '..', 'resources', 'icon.ico'),
    path.resolve(baseDir, '../../resources/icon.ico'),
    path.resolve(baseDir, '../../../resources/icon.ico'),
    path.join(baseDir, 'resources', 'icon.png'),
    path.join(baseDir, '..', 'resources', 'icon.png'),
    path.resolve(baseDir, '../../resources/icon.png'),
    path.resolve(baseDir, '../../../resources/icon.png'),
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      return cand;
    }
  }

  return undefined;
}

export const DESKTOP_STORAGE_PATHS = {
  projectRoot: 'D:\\ahmed',
  tmpDir: 'D:\\ahmed\\.tmp',
  userDataDir: 'D:\\ahmed\\.tmp\\userData',
  sessionDataDir: 'D:\\ahmed\\.tmp\\sessionData',
  crashDumpsDir: 'D:\\ahmed\\.tmp\\crashDumps',
  logsDir: 'D:\\ahmed\\.tmp\\logs',
  tempDir: 'D:\\ahmed\\.tmp\\appTemp',
} as const;

export interface StorageConfigurationDependencies {
  readonly app?: {
    setPath(name: string, path: string): void;
    getPath?(name: string): string;
    isReady?(): boolean;
  };
  readonly fs?: {
    mkdirSync(path: string, options?: fs.MakeDirectoryOptions): unknown;
  };
  readonly paths?: typeof DESKTOP_STORAGE_PATHS;
  readonly isDev?: boolean;
  readonly userDataDir?: string;
}

/**
 * Resolves an explicit isolated userData directory from options, environment
 * (`AUDITOR_USER_DATA_DIR`), or `--user-data-dir` CLI arguments.
 */
export function resolveExplicitUserDataDirectory(
  deps?: Pick<StorageConfigurationDependencies, 'userDataDir'>,
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (deps?.userDataDir && deps.userDataDir.trim()) {
    return path.resolve(deps.userDataDir.trim());
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--user-data-dir=')) {
      const value = arg.slice('--user-data-dir='.length).trim();
      if (value) {
        return path.resolve(value);
      }
    } else if (arg === '--user-data-dir' && typeof argv[i + 1] === 'string') {
      const value = argv[i + 1]!.trim();
      if (value) {
        return path.resolve(value);
      }
    }
  }

  if (env.AUDITOR_USER_DATA_DIR && env.AUDITOR_USER_DATA_DIR.trim()) {
    return path.resolve(env.AUDITOR_USER_DATA_DIR.trim());
  }

  return undefined;
}

let configuredAppInstance: unknown = null;
let isConfigured = false;

/**
 * Returns whether desktop storage has been successfully configured and Electron paths set.
 */
export function isDesktopStorageInitialized(): boolean {
  return isConfigured;
}

/**
 * Resets the internal storage initialization state for isolated unit testing only.
 */
export function resetDesktopStorageForTesting(): void {
  isConfigured = false;
  configuredAppInstance = null;
}

/**
 * Synchronously ensures all dedicated project storage directories exist on D:
 * and redirects Electron's storage paths (userData, sessionData, crashDumps, logs, temp)
 * before Electron emits ready event, preventing any files from leaking onto the C: drive.
 *
 * Requirements:
 * - Must be called before app.whenReady().
 * - If Electron is already ready without prior configuration, throws ERR_STORAGE_INIT_TOO_LATE.
 * - Does not report successful initialization if app.setPath was not actually configured.
 * - Repeated calls with the same configured app instance are deterministic no-ops.
 * - Test dependency injection is tracked per-instance and resettable via resetDesktopStorageForTesting().
 */
export function initializeDesktopStorage(deps?: StorageConfigurationDependencies): void {
  const electronApp = deps?.app ?? defaultElectronApp;
  const fileSystem = deps?.fs ?? fs;
  const paths = deps?.paths ?? DESKTOP_STORAGE_PATHS;
  const isDev =
    deps?.isDev ??
    (electronApp && typeof electronApp === 'object' && 'isPackaged' in electronApp
      ? !(electronApp as { isPackaged?: boolean }).isPackaged
      : true);

  // If already configured for this exact app instance (or in production), repeated calls are deterministic no-ops
  if (isConfigured && (deps === undefined || configuredAppInstance === electronApp)) {
    return;
  }

  // If Electron is already ready, setting paths now is too late and strictly prohibited
  const isReady = typeof electronApp?.isReady === 'function' ? electronApp.isReady() : false;
  if (isReady && !isConfigured) {
    throw new Error(
      'ERR_STORAGE_INIT_TOO_LATE: Desktop storage paths cannot be configured after Electron emits ready event',
    );
  }

  const explicitUserDataDir = resolveExplicitUserDataDirectory(deps);

  // In production (isDev === false), preserve Electron's standard user data directory (e.g. %APPDATA%)
  // unless an explicit isolated userData directory (e.g. --user-data-dir / AUDITOR_USER_DATA_DIR) was supplied.
  if (!isDev) {
    if (explicitUserDataDir && electronApp && typeof electronApp.setPath === 'function') {
      fileSystem.mkdirSync(explicitUserDataDir, { recursive: true });
      electronApp.setPath('userData', explicitUserDataDir);
    }
    isConfigured = true;
    configuredAppInstance = electronApp;
    return;
  }

  const effectiveUserDataDir = explicitUserDataDir ?? paths.userDataDir;

  // Synchronously ensure all 6 dedicated storage directories exist on D:
  const storageDirs = [
    paths.tmpDir,
    effectiveUserDataDir,
    paths.sessionDataDir,
    paths.crashDumpsDir,
    paths.logsDir,
    paths.tempDir,
  ];

  for (const dir of storageDirs) {
    fileSystem.mkdirSync(dir, { recursive: true });
  }

  // Apply all five approved app.setPath() overrides
  if (electronApp && typeof electronApp.setPath === 'function') {
    electronApp.setPath('userData', effectiveUserDataDir);
    electronApp.setPath('sessionData', paths.sessionDataDir);
    electronApp.setPath('crashDumps', paths.crashDumpsDir);
    electronApp.setPath('logs', paths.logsDir);
    electronApp.setPath('temp', paths.tempDir);

    // Mark as successfully configured only when Electron paths were actually configured
    isConfigured = true;
    configuredAppInstance = electronApp;
  }
}
