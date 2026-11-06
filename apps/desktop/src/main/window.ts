import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { WindowSecurityRegistry } from './security/registry.js';
import { SecurityWebRequestManager } from './security/csp.js';
import { attachNavigationGuards } from './security/navigation.js';

export interface MainWindowPublicOptions {
  browserWindowOptions?: Partial<BrowserWindowConstructorOptions>;
}

/**
 * Resolves the absolute path to the compiled preload script.
 * Dynamically adapts to packaged ASAR vs development environments without hardcoded static paths.
 */
export function resolvePreloadPath(isDev: boolean): string {
  if (isDev) {
    return path.resolve(import.meta.dirname, '../preload/index.mjs');
  }

  // In packaged production, resolve from app root within ASAR or installation root
  const appRoot = app?.getAppPath ? app.getAppPath() : process.cwd();
  return path.resolve(appRoot, 'out', 'preload', 'index.mjs');
}

/**
 * Resolves the initial entry point to load into the main window.
 */
export function resolveRendererEntryPoint(isDev: boolean): { type: 'url' | 'file'; path: string } {
  if (isDev) {
    return { type: 'url', path: 'http://localhost:5173' };
  }

  const appRoot = app?.getAppPath ? app.getAppPath() : process.cwd();
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
  const isDev = !app.isPackaged;
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

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false, // Wait until ready-to-show to prevent visual flash
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
    win.show();
  });

  // 4. Load approved entry point
  const entry = resolveRendererEntryPoint(isDev);
  if (entry.type === 'url') {
    win.loadURL(entry.path);
  } else {
    win.loadFile(entry.path);
  }

  return win;
}
