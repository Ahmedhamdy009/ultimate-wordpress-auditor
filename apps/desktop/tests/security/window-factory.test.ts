import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBrowserWindowConstructor, mockBrowserWindowInstance, mockWebContents, mockWindowOnce } =
  vi.hoisted(() => {
    const mockWebContentsOnce = vi.fn();
    const mockWindowOnce = vi.fn();
    const mockShow = vi.fn();

    const mockWebContents = {
      id: 201,
      isDestroyed: vi.fn().mockReturnValue(false),
      once: mockWebContentsOnce,
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
      once: mockWindowOnce,
      show: mockShow,
      loadURL: vi.fn(),
      loadFile: vi.fn(),
    };

    const mockBrowserWindowConstructor = vi.fn(function () {
      return {
        ...mockBrowserWindowInstance,
        webContents: {
          ...mockWebContents,
          session: {
            webRequest: {
              onHeadersReceived: vi.fn(),
            },
          },
        },
      };
    });

    return {
      mockBrowserWindowConstructor,
      mockBrowserWindowInstance,
      mockWebContents,
      mockWindowOnce,
    };
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
  isValidDevServerUrl,
  resolveEffectiveIsDev,
} from '../../src/main/window.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { createTestMainWindow } from '../helpers/window-test-factory.js';

describe('BrowserWindow Factory & Path Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ELECTRON_RENDERER_URL;
  });

  describe('Path Resolution', () => {
    it('resolves preload script path to index.cjs dynamically without static hardcoded assumptions', () => {
      const devPreload = resolvePreloadPath(true);
      expect(devPreload).toContain('preload');
      expect(devPreload.endsWith('index.cjs')).toBe(true);

      const prodPreload = resolvePreloadPath(false);
      expect(prodPreload).toContain('out');
      expect(prodPreload).toContain('preload');
      expect(prodPreload.endsWith('index.cjs')).toBe(true);
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

  describe('Dev Server URL Validation', () => {
    it('accepts valid HTTP localhost and 127.0.0.1 on port 5173 without credentials', () => {
      // 1. http://localhost:5173 -> accepted
      expect(isValidDevServerUrl('http://localhost:5173')).toBe(true);
      // 2. http://127.0.0.1:5173 -> accepted
      expect(isValidDevServerUrl('http://127.0.0.1:5173')).toBe(true);
    });

    it('rejects HTTPS, embedded credentials, invalid ports, and non-whitelisted hosts', () => {
      // 3. https://localhost:5173 -> rejected
      expect(isValidDevServerUrl('https://localhost:5173')).toBe(false);
      // 4. http://user@localhost:5173 -> rejected
      expect(isValidDevServerUrl('http://user@localhost:5173')).toBe(false);
      expect(isValidDevServerUrl('http://user:pass@localhost:5173')).toBe(false);
      // 5. http://localhost:5174 -> rejected
      expect(isValidDevServerUrl('http://localhost:5174')).toBe(false);
      // 6. http://localhost.evil.example:5173 -> rejected
      expect(isValidDevServerUrl('http://localhost.evil.example:5173')).toBe(false);

      // Additional invalid port and protocol checks
      expect(isValidDevServerUrl('http://localhost:3000')).toBe(false);
      expect(isValidDevServerUrl('http://localhost:8080')).toBe(false);
      expect(isValidDevServerUrl('http://192.168.1.5:5173')).toBe(false);
      expect(isValidDevServerUrl('ws://localhost:5173')).toBe(false);
      expect(isValidDevServerUrl('javascript:alert(1)')).toBe(false);
      expect(isValidDevServerUrl('not-a-url')).toBe(false);
      expect(isValidDevServerUrl('')).toBe(false);
      expect(isValidDevServerUrl(undefined)).toBe(false);
    });
  });

  describe('Authoritative Environment Mode Resolution', () => {
    it('packaged applications NEVER enter development mode regardless of options or env vars', () => {
      process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
      expect(
        resolveEffectiveIsDev({
          isPackaged: true,
          devServerUrl: 'http://localhost:5173',
          forceMode: 'development',
        }),
      ).toBe(false);

      expect(resolveEffectiveIsDev({ isPackaged: true })).toBe(false);
    });

    it('unpackaged applications without valid dev server URL fall back safely to production mode', () => {
      expect(resolveEffectiveIsDev({ isPackaged: false })).toBe(false);
      expect(
        resolveEffectiveIsDev({
          isPackaged: false,
          devServerUrl: 'http://localhost:3000',
        }),
      ).toBe(false);
    });

    it('unpackaged applications with valid dev server URL enter development mode', () => {
      expect(
        resolveEffectiveIsDev({
          isPackaged: false,
          devServerUrl: 'http://localhost:5173',
        }),
      ).toBe(true);

      process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173';
      expect(resolveEffectiveIsDev({ isPackaged: false })).toBe(true);
    });

    it('explicit forceMode: production selects production mode even when dev server URL is present', () => {
      expect(
        resolveEffectiveIsDev({
          isPackaged: false,
          devServerUrl: 'http://localhost:5173',
          forceMode: 'production',
        }),
      ).toBe(false);
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

    it('respects show: false to suppress win.show() on ready-to-show for test runs', () => {
      mockBrowserWindowConstructor.mockClear();
      mockWindowOnce.mockClear();
      mockBrowserWindowInstance.show.mockClear();

      createMainWindow({
        browserWindowOptions: {
          show: false,
        },
      });

      const readyCallback = mockWindowOnce.mock.calls.find(
        call => call[0] === 'ready-to-show',
      )?.[1];
      expect(readyCallback).toBeDefined();

      readyCallback!();
      expect(mockBrowserWindowInstance.show).not.toHaveBeenCalled();
    });

    it('triggers win.show() on ready-to-show when show is not explicitly false', () => {
      mockBrowserWindowConstructor.mockClear();
      mockWindowOnce.mockClear();
      mockBrowserWindowInstance.show.mockClear();

      createMainWindow();

      const readyCallback = mockWindowOnce.mock.calls.find(
        call => call[0] === 'ready-to-show',
      )?.[1];
      expect(readyCallback).toBeDefined();

      readyCallback!();
      expect(mockBrowserWindowInstance.show).toHaveBeenCalledTimes(1);
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
        preloadPathOverride: '/test/preload.cjs',
      });

      expect(win).toBeDefined();
      expect(mockBrowserWindowConstructor).toHaveBeenCalledTimes(1);
      const passedOptions = mockBrowserWindowConstructor.mock.calls[0][0];
      expect(passedOptions.webPreferences.preload).toBe('/test/preload.cjs');
    });
  });
});
