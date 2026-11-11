import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  mockApp,
  mockDefaultSession,
  mockBrowserWindowConstructor,
  mockIpcMain,
  reconcileSpy,
  getReportsDirSpy,
} = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
  const mockDefaultSession = {
    webRequest: {
      onHeadersReceived: vi.fn(),
    },
  };
  const mockWebContents = {
    id: 701,
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    session: mockDefaultSession,
    mainFrame: { url: 'http://localhost:5173', parent: null },
  };
  const mockBrowserWindowInstance = {
    id: 70,
    isDestroyed: vi.fn(() => false),
    webContents: mockWebContents,
    once: vi.fn(),
    show: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
  };
  const mockBrowserWindowConstructor = Object.assign(
    vi.fn(function () {
      return mockBrowserWindowInstance;
    }),
    { getAllWindows: vi.fn(() => [mockBrowserWindowInstance]) },
  );
  const mockApp = {
    isPackaged: false,
    getVersion: vi.fn(() => '0.1.3'),
    getAppPath: vi.fn(() => 'D:\\ahmed\\apps\\desktop'),
    getPath: vi.fn(() => 'D:\\ahmed\\.tmp\\userData'),
    whenReady: vi.fn(() => new Promise<void>(() => {})),
    on: vi.fn(),
    quit: vi.fn(),
    setPath: vi.fn(),
    isReady: vi.fn(() => false),
  };
  const mockIpcMain = {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, listener);
    }),
    removeHandler: vi.fn((channel: string) => {
      ipcHandlers.delete(channel);
    }),
  };

  return {
    mockApp,
    mockDefaultSession,
    mockBrowserWindowConstructor,
    mockIpcMain,
    reconcileSpy: vi.fn(() => ({
      scannedFiles: 0,
      activeReports: 0,
      tempFilesCleaned: 0,
      orphanFilesDeleted: 0,
      errors: [],
    })),
    getReportsDirSpy: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: mockBrowserWindowConstructor,
  session: { defaultSession: mockDefaultSession },
  ipcMain: mockIpcMain,
}));

vi.mock('../../src/main/reports/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/main/reports/index.js')>();
  return {
    ...actual,
    getReportsDirectory: (options?: string | { customDir?: string; isDev?: boolean }) => {
      getReportsDirSpy(options);
      return actual.getReportsDirectory(options);
    },
    reconcileReportsStorage: (
      activeStoragePaths: ReadonlySet<string>,
      directory?: string | { customDir?: string; isDev?: boolean },
    ) => {
      reconcileSpy(activeStoragePaths, directory);
      return {
        scannedFiles: 0,
        activeReports: activeStoragePaths.size,
        tempFilesCleaned: 0,
        orphanFilesDeleted: 0,
        errors: [],
      };
    },
  };
});

import { initializeMainProcess, shutdownMainProcess } from '../../src/main/index.js';

describe('Main Process Unpackaged Storage Isolation', () => {
  afterEach(() => {
    shutdownMainProcess();
    vi.clearAllMocks();
  });

  it('uses development reportsDir (!isPackaged) even when renderer forceMode is production', () => {
    initializeMainProcess({
      ipcMain: mockIpcMain,
      modeOptions: { isPackaged: false, forceMode: 'production' },
      storageDeps: {
        app: { setPath: vi.fn(), isReady: () => false },
        fs: { mkdirSync: vi.fn() },
      },
      databaseOptions: {
        isMemory: true,
        autoInitDatabase: true,
      },
    });

    expect(getReportsDirSpy).toHaveBeenCalledWith({ isDev: true });
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    const reconciledDir = reconcileSpy.mock.calls[0]?.[1] as string | undefined;
    expect(reconciledDir).toBe(path.resolve('D:/ahmed/reports'));
    expect(reconciledDir?.toLowerCase()).not.toContain('appdata');
  });
});
