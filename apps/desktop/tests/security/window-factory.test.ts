import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBrowserWindowConstructor, mockWebContents } = vi.hoisted(() => {
  const mockOnce = vi.fn();
  const mockWebContents = {
    id: 201,
    isDestroyed: vi.fn().mockReturnValue(false),
    once: mockOnce,
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    session: {
      webRequest: {
        onHeadersReceived: vi.fn(),
      },
    },
  };

  const mockBrowserWindowInstance = {
    id: 10,
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: mockWebContents,
    once: mockOnce,
    show: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
  };

  const mockBrowserWindowConstructor = vi.fn(function () {
    return mockBrowserWindowInstance;
  });

  return { mockBrowserWindowConstructor, mockBrowserWindowInstance, mockWebContents };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'D:\\ahmed\\apps\\desktop',
  },
  BrowserWindow: mockBrowserWindowConstructor,
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: vi.fn(),
      },
    },
  },
}));

import {
  resolvePreloadPath,
  resolveRendererEntryPoint,
  createMainWindow,
} from '../../src/main/window.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { createTestMainWindow } from '../helpers/window-test-factory.js';

describe('BrowserWindow Factory & Path Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Path Resolution', () => {
    it('resolves preload script path dynamically without static hardcoded assumptions', () => {
      const devPreload = resolvePreloadPath(true);
      expect(devPreload).toContain('preload');
      expect(devPreload.endsWith('index.mjs') || devPreload.endsWith('index.js')).toBe(true);

      const prodPreload = resolvePreloadPath(false);
      expect(prodPreload).toContain('out');
      expect(prodPreload).toContain('preload');
    });

    it('resolves renderer entry point based on environment', () => {
      const devEntry = resolveRendererEntryPoint(true);
      expect(devEntry.type).toBe('url');
      expect(devEntry.path).toBe('http://localhost:5173');

      const prodEntry = resolveRendererEntryPoint(false);
      expect(prodEntry.type).toBe('file');
      expect(prodEntry.path).toContain('renderer');
      expect(prodEntry.path.endsWith('index.html')).toBe(true);
    });
  });

  describe('BrowserWindow Security Hardening & API Separation', () => {
    it('production createMainWindow enforces mandatory security preferences and registers in WindowSecurityRegistry', () => {
      const win = createMainWindow();
      expect(win).toBeDefined();

      expect(mockBrowserWindowConstructor).toHaveBeenCalledTimes(1);
      const passedOptions = mockBrowserWindowConstructor.mock.calls[0][0];

      expect(passedOptions.webPreferences).toBeDefined();
      expect(passedOptions.webPreferences.contextIsolation).toBe(true);
      expect(passedOptions.webPreferences.nodeIntegration).toBe(false);
      expect(passedOptions.webPreferences.nodeIntegrationInWorker).toBe(false);
      expect(passedOptions.webPreferences.sandbox).toBe(true);
      expect(passedOptions.webPreferences.webSecurity).toBe(true);
      expect(passedOptions.webPreferences.allowRunningInsecureContent).toBe(false);

      // Verify window is registered in WindowSecurityRegistry with CONFIRMED_ACTIVE
      const snapshot = WindowSecurityRegistry.getSnapshot(mockWebContents.id);
      expect(snapshot).toBeDefined();
      expect(WindowSecurityRegistry.isSnapshotSecure(snapshot!)).toBe(true);
      expect(snapshot?.options.contextIsolation).toBe('CONFIRMED_ACTIVE');
      expect(snapshot?.options.allowRunningInsecureContent).toBe('CONFIRMED_ACTIVE');
    });

    it('production createMainWindow strictly strips and overrides any webPreferences passed in browserWindowOptions', () => {
      mockBrowserWindowConstructor.mockClear();

      // Attempt to tamper with webPreferences via browserWindowOptions
      const win = createMainWindow({
        browserWindowOptions: {
          width: 1400,
          // @ts-expect-error verifying runtime stripping of malicious webPreferences
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
          },
        },
      });

      expect(win).toBeDefined();
      expect(mockBrowserWindowConstructor).toHaveBeenCalledTimes(1);
      const passedOptions = mockBrowserWindowConstructor.mock.calls[0][0];

      // Custom width must be applied, but malicious webPreferences must be strictly stripped & secure values enforced
      expect(passedOptions.width).toBe(1400);
      expect(passedOptions.webPreferences.contextIsolation).toBe(true);
      expect(passedOptions.webPreferences.nodeIntegration).toBe(false);
      expect(passedOptions.webPreferences.sandbox).toBe(true);
    });

    it('proves that production window.ts module does NOT export test factory or test options', async () => {
      const windowModule = (await import('../../src/main/window.js')) as Record<string, unknown>;
      expect(windowModule['_createMainWindowForTesting']).toBeUndefined();
      expect(windowModule['createTestMainWindow']).toBeUndefined();
      expect(windowModule['MainWindowTestOptions']).toBeUndefined();
    });

    it('isolated createTestMainWindow helper is available only via separate test module', () => {
      const win = createTestMainWindow({
        isDev: true,
        skipAutoLoad: true,
        preloadPathOverride: '/test/preload.mjs',
      });

      expect(win).toBeDefined();
      expect(mockBrowserWindowConstructor).toHaveBeenCalledTimes(1);
      const passedOptions = mockBrowserWindowConstructor.mock.calls[0][0];
      expect(passedOptions.webPreferences.preload).toBe('/test/preload.mjs');
    });
  });
});
