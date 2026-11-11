import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import {
  PROJECT_ROOT,
  DESKTOP_STORAGE_PATHS,
  initializeDesktopStorage,
  isDesktopStorageInitialized,
  resetDesktopStorageForTesting,
} from '../../src/main/config/paths.js';

describe('Desktop Main Path Configuration & Character Encoding Verification', () => {
  beforeEach(() => {
    resetDesktopStorageForTesting();
    vi.clearAllMocks();
  });

  const BACKSLASH = String.fromCharCode(92);
  const DOUBLE_BACKSLASH = String.fromCharCode(92, 92);

  const expectedRootChars = ['D', ':', BACKSLASH, 'a', 'h', 'm', 'e', 'd'];
  const expectedRootString = expectedRootChars.join('');
  const expectedRootCodes = [68, 58, 92, 97, 104, 109, 101, 100];

  const expectedTmpChars = [...expectedRootChars, BACKSLASH, '.', 't', 'm', 'p'];
  const expectedTmpString = expectedTmpChars.join('');
  const expectedTmpCodes = [68, 58, 92, 97, 104, 109, 101, 100, 92, 46, 116, 109, 112];

  const expectedUserDataChars = [
    ...expectedTmpChars,
    BACKSLASH,
    'u',
    's',
    'e',
    'r',
    'D',
    'a',
    't',
    'a',
  ];
  const expectedUserDataString = expectedUserDataChars.join('');
  const expectedUserDataCodes = [
    68, 58, 92, 97, 104, 109, 101, 100, 92, 46, 116, 109, 112, 92, 117, 115, 101, 114, 68, 97, 116,
    97,
  ];

  const expectedSessionDataChars = [
    ...expectedTmpChars,
    BACKSLASH,
    's',
    'e',
    's',
    's',
    'i',
    'o',
    'n',
    'D',
    'a',
    't',
    'a',
  ];
  const expectedSessionDataString = expectedSessionDataChars.join('');
  const expectedSessionDataCodes = [
    68, 58, 92, 97, 104, 109, 101, 100, 92, 46, 116, 109, 112, 92, 115, 101, 115, 115, 105, 111,
    110, 68, 97, 116, 97,
  ];

  it('enforces exact PROJECT_ROOT runtime string and character codes without ambiguous literals', () => {
    // 1. Independent string equality against character array assembly
    expect(PROJECT_ROOT).toBe(expectedRootString);
    expect(DESKTOP_STORAGE_PATHS.projectRoot).toBe(expectedRootString);

    // 2. Exact runtime length
    expect(PROJECT_ROOT.length).toBe(8);

    // 3. Exact character-code comparison
    const actualCodes = Array.from(PROJECT_ROOT).map(char => char.charCodeAt(0));
    expect(actualCodes).toEqual(expectedRootCodes);

    // 4. Exactly one backslash at index 2
    expect(PROJECT_ROOT.indexOf(BACKSLASH)).toBe(2);
    expect(PROJECT_ROOT.lastIndexOf(BACKSLASH)).toBe(2);

    // 5. No consecutive duplicated backslashes exist in runtime path
    expect(PROJECT_ROOT.includes(DOUBLE_BACKSLASH)).toBe(false);
  });

  it('enforces exact storage directory paths without duplicate backslashes', () => {
    // tmpDir
    expect(DESKTOP_STORAGE_PATHS.tmpDir).toBe(expectedTmpString);
    expect(DESKTOP_STORAGE_PATHS.tmpDir.length).toBe(13);
    expect(Array.from(DESKTOP_STORAGE_PATHS.tmpDir).map(c => c.charCodeAt(0))).toEqual(
      expectedTmpCodes,
    );
    expect(DESKTOP_STORAGE_PATHS.tmpDir.includes(DOUBLE_BACKSLASH)).toBe(false);

    // userDataDir
    expect(DESKTOP_STORAGE_PATHS.userDataDir).toBe(expectedUserDataString);
    expect(DESKTOP_STORAGE_PATHS.userDataDir.length).toBe(22);
    expect(Array.from(DESKTOP_STORAGE_PATHS.userDataDir).map(c => c.charCodeAt(0))).toEqual(
      expectedUserDataCodes,
    );
    expect(DESKTOP_STORAGE_PATHS.userDataDir.includes(DOUBLE_BACKSLASH)).toBe(false);

    // sessionDataDir
    expect(DESKTOP_STORAGE_PATHS.sessionDataDir).toBe(expectedSessionDataString);
    expect(DESKTOP_STORAGE_PATHS.sessionDataDir.length).toBe(25);
    expect(Array.from(DESKTOP_STORAGE_PATHS.sessionDataDir).map(c => c.charCodeAt(0))).toEqual(
      expectedSessionDataCodes,
    );
    expect(DESKTOP_STORAGE_PATHS.sessionDataDir.includes(DOUBLE_BACKSLASH)).toBe(false);

    // crashDumpsDir
    expect(DESKTOP_STORAGE_PATHS.crashDumpsDir).toBe('D:\\ahmed\\.tmp\\crashDumps');
    expect(DESKTOP_STORAGE_PATHS.crashDumpsDir.includes(DOUBLE_BACKSLASH)).toBe(false);

    // logsDir
    expect(DESKTOP_STORAGE_PATHS.logsDir).toBe('D:\\ahmed\\.tmp\\logs');
    expect(DESKTOP_STORAGE_PATHS.logsDir.includes(DOUBLE_BACKSLASH)).toBe(false);

    // tempDir
    expect(DESKTOP_STORAGE_PATHS.tempDir).toBe('D:\\ahmed\\.tmp\\appTemp');
    expect(DESKTOP_STORAGE_PATHS.tempDir.includes(DOUBLE_BACKSLASH)).toBe(false);

    // All directories resolve cleanly via path.win32.normalize with 0 changes
    expect(path.win32.normalize(DESKTOP_STORAGE_PATHS.tmpDir)).toBe(expectedTmpString);
    expect(path.win32.normalize(DESKTOP_STORAGE_PATHS.userDataDir)).toBe(expectedUserDataString);
    expect(path.win32.normalize(DESKTOP_STORAGE_PATHS.sessionDataDir)).toBe(
      expectedSessionDataString,
    );
    expect(path.win32.normalize(DESKTOP_STORAGE_PATHS.crashDumpsDir)).toBe(
      'D:\\ahmed\\.tmp\\crashDumps',
    );
    expect(path.win32.normalize(DESKTOP_STORAGE_PATHS.logsDir)).toBe('D:\\ahmed\\.tmp\\logs');
    expect(path.win32.normalize(DESKTOP_STORAGE_PATHS.tempDir)).toBe('D:\\ahmed\\.tmp\\appTemp');
  });

  describe('initializeDesktopStorage & Lifecycle Safety', () => {
    it('creates all dedicated storage directories and redirects Electron storage paths', () => {
      const mkdirCalls: string[] = [];
      const setPathCalls: Record<string, string> = {};

      const mockFs = {
        mkdirSync: vi.fn((dirPath: string) => {
          mkdirCalls.push(dirPath);
        }),
      };

      const mockApp = {
        setPath: vi.fn((name: string, dirPath: string) => {
          setPathCalls[name] = dirPath;
        }),
      };

      initializeDesktopStorage({
        fs: mockFs,
        app: mockApp,
      });

      expect(mockFs.mkdirSync).toHaveBeenCalledTimes(6);
      expect(mkdirCalls).toContain(DESKTOP_STORAGE_PATHS.tmpDir);
      expect(mkdirCalls).toContain(DESKTOP_STORAGE_PATHS.userDataDir);
      expect(mkdirCalls).toContain(DESKTOP_STORAGE_PATHS.sessionDataDir);
      expect(mkdirCalls).toContain(DESKTOP_STORAGE_PATHS.crashDumpsDir);
      expect(mkdirCalls).toContain(DESKTOP_STORAGE_PATHS.logsDir);
      expect(mkdirCalls).toContain(DESKTOP_STORAGE_PATHS.tempDir);

      expect(setPathCalls).toEqual({
        userData: DESKTOP_STORAGE_PATHS.userDataDir,
        sessionData: DESKTOP_STORAGE_PATHS.sessionDataDir,
        crashDumps: DESKTOP_STORAGE_PATHS.crashDumpsDir,
        logs: DESKTOP_STORAGE_PATHS.logsDir,
        temp: DESKTOP_STORAGE_PATHS.tempDir,
      });

      expect(isDesktopStorageInitialized()).toBe(true);
    });

    it('gracefully completes directory creation without falsely marking configured when app is undefined', () => {
      const mockFs = {
        mkdirSync: vi.fn(),
      };

      expect(() => {
        initializeDesktopStorage({
          fs: mockFs,
          app: undefined,
        });
      }).not.toThrow();

      expect(mockFs.mkdirSync).toHaveBeenCalledTimes(6);
      // When app.setPath is not called, it must NOT report isDesktopStorageInitialized as true
      expect(isDesktopStorageInitialized()).toBe(false);
    });

    it('rejects late initialization attempts when Electron is already ready', () => {
      const mockFs = {
        mkdirSync: vi.fn(),
      };
      const mockApp = {
        isReady: vi.fn().mockReturnValue(true),
        setPath: vi.fn(),
      };

      expect(() => {
        initializeDesktopStorage({
          fs: mockFs,
          app: mockApp,
        });
      }).toThrow('ERR_STORAGE_INIT_TOO_LATE');

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockApp.setPath).not.toHaveBeenCalled();
    });

    it('enforces deterministic idempotency on repeated legitimate calls without re-invoking setPath', () => {
      const mockFs = {
        mkdirSync: vi.fn(),
      };

      const mockApp = {
        isReady: vi.fn().mockReturnValue(false),
        setPath: vi.fn(),
      };

      // First call configures paths
      initializeDesktopStorage({ fs: mockFs, app: mockApp });
      expect(isDesktopStorageInitialized()).toBe(true);
      expect(mockApp.setPath).toHaveBeenCalledTimes(5);
      expect(mockFs.mkdirSync).toHaveBeenCalledTimes(6);

      // Second call with same configured app: deterministic no-op
      initializeDesktopStorage({ fs: mockFs, app: mockApp });
      expect(isDesktopStorageInitialized()).toBe(true);
      expect(mockApp.setPath).toHaveBeenCalledTimes(5); // Not called again
      expect(mockFs.mkdirSync).toHaveBeenCalledTimes(6); // Not called again
    });

    it('isolates test dependency injection state via resetDesktopStorageForTesting', () => {
      const mockFs = { mkdirSync: vi.fn() };
      const mockApp = { isReady: () => false, setPath: vi.fn() };

      initializeDesktopStorage({ fs: mockFs, app: mockApp });
      expect(isDesktopStorageInitialized()).toBe(true);

      resetDesktopStorageForTesting();
      expect(isDesktopStorageInitialized()).toBe(false);
    });

    it('preserves system paths in production (isDev: false) without redirecting to Drive D:', () => {
      const mockFs = { mkdirSync: vi.fn() };
      const mockApp = { isReady: () => false, setPath: vi.fn() };

      initializeDesktopStorage({ fs: mockFs, app: mockApp, isDev: false });

      // In production, D: directories are NOT created and setPath is NOT invoked
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockApp.setPath).not.toHaveBeenCalled();
      // Storage is marked as initialized so lifecycle checks succeed
      expect(isDesktopStorageInitialized()).toBe(true);
    });
  });
});
