import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { WindowSecurityRegistry } from './security/registry.js';
import { SecurityWebRequestManager } from './security/csp.js';
import { attachNavigationGuards } from './security/navigation.js';
import { resolveAppIconPath } from './config/paths.js';

export interface ModeResolutionOptions {
  readonly isPackaged?: boolean;
  readonly devServerUrl?: string;
  readonly forceMode?: 'development' | 'production';
}

export interface MainWindowPublicOptions {
  browserWindowOptions?: Partial<BrowserWindowConstructorOptions>;
  modeOptions?: ModeResolutionOptions;
}

/**
 * Validates whether a given URL is an approved development server URL.
 * Strictly adheres to the established development-origin policy enforced by
 * SecurityWebRequestManager.isAppRendererOrigin and SenderGuard:
 * - Protocol must be exactly http:
 * - Hostname must be exactly localhost or 127.0.0.1
 * - Port must be exactly 5173
 * - Username and password must be empty (no embedded credentials)
 * - Malformed URLs return false
 */
export function isValidDevServerUrl(urlStr?: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') {
    return false;
  }
  return SecurityWebRequestManager.isAppRendererOrigin(urlStr, true, false);
}

/**
 * Resolves the effective runtime environment mode (development vs production).
 * Enforces the authoritative security model:
 * 1. Packaged applications must NEVER enter development mode under any circumstances.
 * 2. An explicit test configuration may force production mode (built renderer).
 * 3. Development mode requires an unpackaged app and an explicitly valid localhost/127.0.0.1 renderer URL on port 5173.
 * 4. Unpackaged applications without an active/valid dev server URL fall back safely to production mode.
 */
export function resolveEffectiveIsDev(options?: ModeResolutionOptions): boolean {
  const isPackaged =
    options?.isPackaged ?? (typeof app !== 'undefined' ? Boolean(app.isPackaged) : false);

  if (isPackaged) {
    return false;
  }

  if (options?.forceMode === 'production') {
    return false;
  }

  const devUrl = options?.devServerUrl ?? process.env.ELECTRON_RENDERER_URL;
  return isValidDevServerUrl(devUrl);
}

/**
 * Resolves the absolute path to the compiled preload script.
 * Dynamically adapts to packaged ASAR vs development environments without hardcoded static paths.
 * Resolves the CommonJS `index.cjs` artifact.
 */
export function resolvePreloadPath(
  isDev: boolean,
  customRoots?: { appRoot?: string; moduleDir?: string },
): string {
  const moduleDir =
    customRoots?.moduleDir ??
    (typeof import.meta.dirname === 'string' ? import.meta.dirname : process.cwd());

  if (isDev) {
    return path.resolve(moduleDir, '../preload/index.cjs');
  }

  const appRoot = customRoots?.appRoot ?? (app?.getAppPath ? app.getAppPath() : process.cwd());
  return path.resolve(appRoot, 'out', 'preload', 'index.cjs');
}

/**
 * Resolves the initial entry point to load into the main window.
 */
export function resolveRendererEntryPoint(
  isDev: boolean,
  options?: { appRoot?: string; devServerUrl?: string },
): { type: 'url' | 'file'; path: string } {
  if (isDev) {
    const devUrl =
      options?.devServerUrl ?? process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173';
    return { type: 'url', path: devUrl };
  }

  const appRoot = options?.appRoot ?? (app?.getAppPath ? app.getAppPath() : process.cwd());
  return {
    type: 'file',
    path: path.resolve(appRoot, 'out', 'renderer', 'index.html'),
  };
}

/**
 * Creates and configures the hardened Main BrowserWindow.
 * Enforces all required Electron security flags and registers window in WindowSecurityRegistry.
 * Strips and overrides any conflicting webPreferences passed in options.
 */
export function createMainWindow(options?: MainWindowPublicOptions): BrowserWindow {
  const isDev = resolveEffectiveIsDev(options?.modeOptions);
  const preloadPath = resolvePreloadPath(isDev);

  const secureWebPreferences: Electron.WebPreferences = {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  };

  // Strip any caller-provided webPreferences to ensure complete immutability of security flags
  const sanitizedBrowserWindowOptions: Partial<BrowserWindowConstructorOptions> = {
    ...options?.browserWindowOptions,
  };
  delete sanitizedBrowserWindowOptions.webPreferences;

  const iconPath = resolveAppIconPath();
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false, // Wait until ready-to-show to prevent visual flash
    ...(iconPath ? { icon: iconPath } : {}),
    ...sanitizedBrowserWindowOptions,
    webPreferences: secureWebPreferences,
  };

  const win = new BrowserWindow(windowOptions);

  // 1. Register in WindowSecurityRegistry with snapshot of creation options
  WindowSecurityRegistry.register(win, secureWebPreferences);

  // 2. Initialize SecurityWebRequestManager for the window's session (Fail-Closed CSP)
  SecurityWebRequestManager.initialize({
    isDev,
    targetSession: win.webContents.session,
  });

  // 3. Attach Navigation Guards (blocks will-navigate and intercepts external links)
  attachNavigationGuards(win, { isDev });

  win.once('ready-to-show', () => {
    if (options?.browserWindowOptions?.show !== false) {
      win.show();
    }
  });

  // 4. Load approved entry point
  const entry = resolveRendererEntryPoint(isDev, {
    devServerUrl: options?.modeOptions?.devServerUrl,
  });
  if (entry.type === 'url') {
    win.loadURL(entry.path);
  } else {
    win.loadFile(entry.path);
  }

  return win;
}
