import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { SecurityWebRequestManager } from '../../src/main/security/csp.js';
import { attachNavigationGuards } from '../../src/main/security/navigation.js';
import { resolvePreloadPath, resolveRendererEntryPoint } from '../../src/main/window.js';

export interface MainWindowTestOptions {
  isDev?: boolean;
  preloadPathOverride?: string;
  loadUrlOverride?: string;
  browserWindowOptions?: Partial<BrowserWindowConstructorOptions>;
  skipAutoLoad?: boolean;
}

/**
 * Test-only factory for creating BrowserWindow instances in isolated unit test environments.
 * Exists strictly inside tests/ and is never bundled into production code.
 */
export function createTestMainWindow(options?: MainWindowTestOptions): BrowserWindow {
  const isDev = options?.isDev ?? true;
  const preloadPath = options?.preloadPathOverride ?? resolvePreloadPath(isDev);

  const secureWebPreferences: Electron.WebPreferences = {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  };

  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...options?.browserWindowOptions,
    webPreferences: secureWebPreferences,
  };

  const win = new BrowserWindow(windowOptions);

  WindowSecurityRegistry.register(win, secureWebPreferences);
  SecurityWebRequestManager.initialize({
    isDev,
    targetSession: win.webContents.session,
  });
  attachNavigationGuards(win, { isDev });

  if (!options?.skipAutoLoad) {
    if (options?.loadUrlOverride) {
      win.loadURL(options.loadUrlOverride);
    } else {
      const entry = resolveRendererEntryPoint(isDev);
      if (entry.type === 'url') {
        win.loadURL(entry.path);
      } else {
        win.loadFile(entry.path);
      }
    }
  }

  return win;
}
