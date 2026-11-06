/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';

const { mockApp, mockDefaultSession, mockBrowserWindowConstructor, mockIpcMain } = vi.hoisted(
  () => {
    const lifecycleCallbacks: Record<string, ((...args: unknown[]) => void)[]> = {};
    const ipcHandlers = new Map<
      string,
      (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
    >();

    const mockDefaultSession = {
      webRequest: {
        onHeadersReceived: vi.fn(),
      },
    };

    const mockWebContents = {
      id: 501,
      isDestroyed: vi.fn().mockReturnValue(false),
      once: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: mockDefaultSession,
      mainFrame: {
        url: 'http://localhost:5173',
        parent: null,
      },
    };

    const mockBrowserWindowInstance = {
      id: 50,
      isDestroyed: vi.fn().mockReturnValue(false),
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
      {
        getAllWindows: vi.fn(() => [mockBrowserWindowInstance]),
      },
    );

    // Use a non-auto-resolving whenReady by default so module import does not race with test setup
    const mockApp = {
      isPackaged: false,
      getVersion: vi.fn(() => '0.1.0'),
      getAppPath: vi.fn(() => 'D:\\ahmed\\apps\\desktop'),
      whenReady: vi.fn(() => new Promise<void>(() => {})),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (!lifecycleCallbacks[event]) {
          lifecycleCallbacks[event] = [];
        }
        lifecycleCallbacks[event].push(listener);
      }),
      quit: vi.fn(),
    };

    const mockIpcMain = {
      handlers: ipcHandlers,
      handle: vi.fn(
        (
          channel: string,
          listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
        ) => {
          ipcHandlers.set(channel, listener);
        },
      ),
      removeHandler: vi.fn((channel: string) => {
        ipcHandlers.delete(channel);
      }),
    };

    return {
      mockApp,
      mockDefaultSession,
      mockWebContents,
      mockBrowserWindowInstance,
      mockBrowserWindowConstructor,
      mockIpcMain,
      lifecycleCallbacks,
    };
  },
);

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: mockBrowserWindowConstructor,
  session: {
    defaultSession: mockDefaultSession,
  },
  ipcMain: mockIpcMain,
}));

import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  SAFE_IPC_ERROR_MESSAGES,
  type IPCResult,
  type AppPingResponse,
  type AppSystemInfoResponse,
  type AuditValidateTargetResponse,
} from '@auditor/shared';
import * as sharedScopeGuard from '@auditor/shared';
import {
  SecureIpcDispatcher,
  CentralIpcRegistrationManager,
  createAppPingHandler,
  createGetSystemInfoHandler,
  createValidateTargetHandler,
  registerCoreIpcHandlers,
  type IpcMainLike,
} from '../../src/main/ipc/index.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { SecurityWebRequestManager } from '../../src/main/security/csp.js';
import { initializeMainProcess, shutdownMainProcess } from '../../src/main/index.js';

describe('Phase 1.2.3.4 — Initial Main Process Handlers & IPC Integration', () => {
  const activeDispatchers: SecureIpcDispatcher[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.isPackaged = false;
    mockApp.getVersion.mockReturnValue('0.1.0');
  });

  afterEach(() => {
    shutdownMainProcess();
    while (activeDispatchers.length > 0) {
      const dispatcher = activeDispatchers.pop();
      try {
        dispatcher?.teardown();
      } catch {
        // Ignore teardown cleanup errors in afterEach
      }
    }
    mockIpcMain.handlers.clear();
  });

  const createLocalMockIpcMain = (): IpcMainLike & {
    handlers: Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>;
  } => {
    const handlers = new Map<
      string,
      (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
    >();
    return {
      handlers,
      handle: vi.fn((channel, listener) => {
        handlers.set(channel, listener);
      }),
      removeHandler: vi.fn(channel => {
        handlers.delete(channel);
      }),
    };
  };

  const createDispatcherWithHandlers = (options?: {
    ipcMain?: IpcMainLike;
    now?: () => number;
    systemInfo?: Parameters<typeof createGetSystemInfoHandler>[0];
  }) => {
    const ipcMainInstance = options?.ipcMain ?? createLocalMockIpcMain();
    const dispatcher = new SecureIpcDispatcher({
      isDev: true,
      isPackaged: false,
      ipcMain: ipcMainInstance,
    });
    activeDispatchers.push(dispatcher);

    registerCoreIpcHandlers(dispatcher, {
      ping: options?.now ? { now: options.now } : undefined,
      systemInfo: options?.systemInfo,
    });

    return {
      dispatcher,
      ipcMain: ipcMainInstance as ReturnType<typeof createLocalMockIpcMain>,
    };
  };

  const createAuthorizedEvent = (overrides?: {
    webContentsId?: number;
    windowId?: number;
    url?: string;
    isSubFrame?: boolean;
    unregisteredWindow?: boolean;
    unregisteredSession?: boolean;
  }) => {
    const webContentsId = overrides?.webContentsId ?? 701;
    const windowId = overrides?.windowId ?? 70;
    const url = overrides?.url ?? 'http://localhost:5173';

    const listeners: Record<string, (() => void)[]> = {};
    let isWcDestroyed = false;

    const mainFrame = {
      url,
      parent: null,
    };

    const senderFrame = overrides?.isSubFrame
      ? {
          url: 'https://untrusted-iframe.example.com',
          parent: mainFrame,
        }
      : mainFrame;

    const targetSession: any = {
      webRequest: {
        onHeadersReceived: vi.fn(),
      },
    };

    if (!overrides?.unregisteredSession) {
      SecurityWebRequestManager.initialize({
        isDev: true,
        targetSession,
      });
    }

    const webContents: any = {
      id: webContentsId,
      isDestroyed: vi.fn(() => isWcDestroyed),
      mainFrame,
      session: targetSession,
      once: vi.fn((evt: string, cb: () => void) => {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(cb);
      }),
      removeListener: vi.fn((evt: string, cb: () => void) => {
        if (listeners[evt]) {
          listeners[evt] = listeners[evt].filter(fn => fn !== cb);
        }
      }),
      triggerDestroy: () => {
        isWcDestroyed = true;
        for (const cb of listeners['destroyed'] ?? []) {
          cb();
        }
      },
    };

    const browserWindow: any = {
      id: windowId,
      isDestroyed: vi.fn(() => false),
      webContents,
      once: vi.fn(),
    };

    if (!overrides?.unregisteredWindow) {
      WindowSecurityRegistry.register(browserWindow, {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });
    }

    const event = {
      sender: webContents,
      senderFrame,
    } as unknown as IpcMainInvokeEvent;

    return { event, webContents, browserWindow };
  };

  // =========================================================================
  // 1. app:ping Handler Tests
  // =========================================================================
  describe('A. app:ping Handler', () => {
    it('returns valid pong response with serverTimestamp when invoked without client timestamp', async () => {
      const fixedServerTime = 1762450000123;
      const { ipcMain } = createDispatcherWithHandlers({
        now: () => fixedServerTime,
      });
      const { event } = createAuthorizedEvent();

      const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_PING)!;
      const result = (await listener(event, {})) as IPCResult<AppPingResponse>;

      expect(result).toEqual({
        success: true,
        data: {
          pong: true,
          serverTimestamp: fixedServerTime,
        },
      });
      if (result.success) {
        expect('clientTimestamp' in result.data).toBe(false);
        expect(Object.keys(result.data).sort()).toEqual(['pong', 'serverTimestamp']);
      }
    });

    it('rejects non-object (undefined or null) payload for app:ping with safe IPCResult', async () => {
      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();

      const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_PING)!;
      const undefinedResult = (await listener(event, undefined)) as IPCResult<AppPingResponse>;
      expect(undefinedResult.success).toBe(false);
      if (!undefinedResult.success) {
        expect(undefinedResult.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
      }

      const nullResult = (await listener(event, null)) as IPCResult<AppPingResponse>;
      expect(nullResult.success).toBe(false);
      if (!nullResult.success) {
        expect(nullResult.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
      }
    });

    it('preserves validated clientTimestamp and generates accurate serverTimestamp in Main Process', async () => {
      const clientTime = 1762450000100;
      const serverTime = 1762450000250;
      const { ipcMain } = createDispatcherWithHandlers({
        now: () => serverTime,
      });
      const { event } = createAuthorizedEvent();

      const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_PING)!;
      const result = (await listener(event, {
        timestamp: clientTime,
      })) as IPCResult<AppPingResponse>;

      expect(result).toEqual({
        success: true,
        data: {
          pong: true,
          clientTimestamp: clientTime,
          serverTimestamp: serverTime,
        },
      });
    });

    it('rejects invalid timestamp types or negative numbers with safe IPCResult', async () => {
      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_PING)!;

      const negativeResult = (await listener(event, {
        timestamp: -50,
      })) as IPCResult<AppPingResponse>;
      expect(negativeResult.success).toBe(false);
      if (!negativeResult.success) {
        expect(negativeResult.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
        expect(negativeResult.error.message).toBe(
          SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED],
        );
      }

      const floatResult = (await listener(event, {
        timestamp: 123.456,
      })) as IPCResult<AppPingResponse>;
      expect(floatResult.success).toBe(false);

      const stringResult = (await listener(event, {
        timestamp: '1762450000100',
      })) as IPCResult<AppPingResponse>;
      expect(stringResult.success).toBe(false);
    });

    it('rejects additional unexpected properties in strict mode and returns safe IPCResult', async () => {
      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_PING)!;

      const result = (await listener(event, {
        timestamp: 1762450000100,
        extraField: 'unauthorized',
      })) as IPCResult<AppPingResponse>;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
        expect(result.error.message).toBe(
          SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED],
        );
      }
    });
  });

  // =========================================================================
  // 2. app:get-system-info Handler Tests
  // =========================================================================
  describe('B. app:get-system-info Handler', () => {
    const validSystemInfoDeps = {
      getAppVersion: () => '0.1.0',
      getVersions: () => ({
        electron: '44.10.2',
        chrome: '136.0.7103.49',
        node: '22.14.0',
      }),
      getPlatform: () => 'win32',
      getArch: () => 'x64',
    };

    it('returns strictly the six expected fields with accurate versions, platform, and arch', async () => {
      const { ipcMain } = createDispatcherWithHandlers({
        systemInfo: validSystemInfoDeps,
      });
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_GET_SYSTEM_INFO)!;

      const result = (await listener(event, {})) as IPCResult<AppSystemInfoResponse>;

      expect(result).toEqual({
        success: true,
        data: {
          appVersion: '0.1.0',
          electronVersion: '44.10.2',
          chromeVersion: '136.0.7103.49',
          nodeVersion: '22.14.0',
          platform: 'win32',
          arch: 'x64',
        },
      });

      if (result.success) {
        const keys = Object.keys(result.data);
        expect(keys).toHaveLength(6);
        expect(keys.sort()).toEqual([
          'appVersion',
          'arch',
          'chromeVersion',
          'electronVersion',
          'nodeVersion',
          'platform',
        ]);

        // Verify no undefined values and no sensitive OS/runtime fields
        for (const value of Object.values(result.data)) {
          expect(value).toBeDefined();
          expect(typeof value).toBe('string');
          expect(value.length).toBeGreaterThan(0);
        }
        expect('hostname' in result.data).toBe(false);
        expect('username' in result.data).toBe(false);
        expect('homedir' in result.data).toBe(false);
        expect('execPath' in result.data).toBe(false);
        expect('env' in result.data).toBe(false);
      }
    });

    it('reads appVersion from Electron app.getVersion() by default', async () => {
      mockApp.getVersion.mockReturnValue('1.4.2');
      const { ipcMain } = createDispatcherWithHandlers({
        systemInfo: {
          getVersions: () => ({
            electron: '44.10.2',
            chrome: '136.0.0.0',
            node: process.versions.node,
          }),
        },
      });
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_GET_SYSTEM_INFO)!;

      const result = (await listener(event, {})) as IPCResult<AppSystemInfoResponse>;
      expect(mockApp.getVersion).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.appVersion).toBe('1.4.2');
        expect(result.data.nodeVersion).toBe(process.versions.node);
      }
    });

    it('handles unsupported platform values safely by failing closed instead of inventing a platform', async () => {
      for (const unsupportedPlatform of ['freebsd', 'openbsd', 'aix', 'sunos', 'android', '']) {
        const { dispatcher, ipcMain } = createDispatcherWithHandlers({
          systemInfo: {
            ...validSystemInfoDeps,
            getPlatform: () => unsupportedPlatform,
          },
        });
        const { event } = createAuthorizedEvent();
        const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_GET_SYSTEM_INFO)!;

        const result = (await listener(event, {})) as IPCResult<AppSystemInfoResponse>;
        expect(result).toEqual({
          success: false,
          error: {
            code: IPC_ERROR_CODES.INTERNAL_ERROR,
            message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR],
          },
        });

        dispatcher.teardown();
      }
    });

    it('handles missing runtime version strings safely without returning undefined values', async () => {
      const { ipcMain } = createDispatcherWithHandlers({
        systemInfo: {
          ...validSystemInfoDeps,
          getVersions: () => ({
            electron: undefined,
            chrome: '136.0.0.0',
            node: '22.14.0',
          }),
        },
      });
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_GET_SYSTEM_INFO)!;

      const result = (await listener(event, {})) as IPCResult<AppSystemInfoResponse>;
      expect(result).toEqual({
        success: false,
        error: {
          code: IPC_ERROR_CODES.INTERNAL_ERROR,
          message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR],
        },
      });
    });

    it('rejects unexpected request properties on app:get-system-info', async () => {
      const { ipcMain } = createDispatcherWithHandlers({
        systemInfo: validSystemInfoDeps,
      });
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.APP_GET_SYSTEM_INFO)!;

      const result = (await listener(event, {
        includeEnv: true,
      })) as IPCResult<AppSystemInfoResponse>;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
      }
    });
  });

  // =========================================================================
  // 3. audit:validate-target Handler Tests
  // =========================================================================
  describe('C. audit:validate-target Handler', () => {
    it('separates URL validity from scope authorization when allowedScope is omitted (valid: true, inScope: false)', async () => {
      const validateSpy = vi.spyOn(sharedScopeGuard, 'validateScanTarget');
      const isUrlInScopeSpy = vi.spyOn(sharedScopeGuard, 'isUrlInScope');

      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)!;

      // Standard HTTPS port 443 with omitted allowedScope: valid URL, but inScope is false
      const httpsRes = (await listener(event, {
        targetUrl: '  https://example.com/wp-json/wp/v2  ',
      })) as IPCResult<AuditValidateTargetResponse>;

      expect(httpsRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'https://example.com/wp-json/wp/v2',
          inScope: false,
        },
      });
      expect(validateSpy).toHaveBeenCalledWith('https://example.com/wp-json/wp/v2');
      expect(isUrlInScopeSpy).toHaveBeenCalledTimes(1);

      // Standard HTTP port 80 with omitted allowedScope: valid URL, but inScope is false
      const httpRes = (await listener(event, {
        targetUrl: 'http://example.com/wp-login.php',
      })) as IPCResult<AuditValidateTargetResponse>;

      expect(httpRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'http://example.com/wp-login.php',
          inScope: false,
        },
      });

      validateSpy.mockRestore();
      isUrlInScopeSpy.mockRestore();
    });

    it('rejects empty allowedScope ([]) and explicit malformed allowedScope entries while preserving URL/port validity', async () => {
      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)!;

      // 1. Empty allowedScope: [] with valid URL and permitted standard port -> valid: true, inScope: false
      const emptyScopeValidPortRes = (await listener(event, {
        targetUrl: 'https://example.com/wp-admin',
        allowedScope: [],
      })) as IPCResult<AuditValidateTargetResponse>;

      expect(emptyScopeValidPortRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'https://example.com/wp-admin',
          inScope: false,
        },
      });

      // 2. Empty allowedScope: [] with prohibited non-standard port -> valid: false, inScope: false
      const emptyScopeBadPortRes = (await listener(event, {
        targetUrl: 'https://example.com:8443/wp-admin',
        allowedScope: [],
      })) as IPCResult<AuditValidateTargetResponse>;

      expect(emptyScopeBadPortRes).toEqual({
        success: true,
        data: {
          valid: false,
          inScope: false,
          error: 'Target URL is outside the permitted scope or port policy.',
        },
      });

      // 3. Explicit malformed allowedScope entries with valid URL and permitted standard port -> valid: true, inScope: false
      const malformedScopeValidPortRes = (await listener(event, {
        targetUrl: 'https://example.com/wp-admin',
        allowedScope: [':::invalid-ipv6:::', '[unclosed', 'example.com:99999', 'example.com:abc'],
      })) as IPCResult<AuditValidateTargetResponse>;

      expect(malformedScopeValidPortRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'https://example.com/wp-admin',
          inScope: false,
        },
      });

      // 4. Explicit malformed allowedScope entries with prohibited non-standard port -> valid: false, inScope: false
      const malformedScopeBadPortRes = (await listener(event, {
        targetUrl: 'https://example.com:8443/wp-admin',
        allowedScope: [':::invalid-ipv6:::', '[unclosed'],
      })) as IPCResult<AuditValidateTargetResponse>;

      expect(malformedScopeBadPortRes).toEqual({
        success: true,
        data: {
          valid: false,
          inScope: false,
          error: 'Target URL is outside the permitted scope or port policy.',
        },
      });
    });

    it('returns valid: false, inScope: false with error reason for invalid URLs or unsupported protocols', async () => {
      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)!;

      for (const badUrl of [
        'not-a-valid-url',
        'ftp://example.com/files',
        'javascript:alert(1)',
        'file:///C:/Windows/System32/drivers/etc/hosts',
      ]) {
        const result = (await listener(event, {
          targetUrl: badUrl,
        })) as IPCResult<AuditValidateTargetResponse>;

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.valid).toBe(false);
          expect(result.data.inScope).toBe(false);
          expect(typeof result.data.error).toBe('string');
          expect(result.data.error!.length).toBeGreaterThan(0);
          expect(result.data.normalizedUrl).toBeUndefined();
        }
      }
    });

    it('rejects target URLs containing embedded credentials', async () => {
      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)!;

      const result = (await listener(event, {
        targetUrl: 'https://admin:supersecret@example.com/wp-admin',
      })) as IPCResult<AuditValidateTargetResponse>;

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.valid).toBe(false);
        expect(result.data.inScope).toBe(false);
        expect(result.data.error).toContain('credentials');
        expect(result.data.normalizedUrl).toBeUndefined();
      }
    });

    it('enforces allowedScope host matching and reports valid: true, inScope: false for valid URLs on unauthorized hosts', async () => {
      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)!;

      // 1. Valid URL + permitted port + matching scope -> valid: true, inScope: true
      const inScopeRes = (await listener(event, {
        targetUrl: 'https://Sub.Example.com/blog',
        allowedScope: ['example.com'],
      })) as IPCResult<AuditValidateTargetResponse>;

      expect(inScopeRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'https://Sub.Example.com/blog',
          inScope: true,
        },
      });

      // 2. Valid URL + permitted port + nonmatching (unauthorized) scope -> valid: true, inScope: false
      const outOfScopeRes = (await listener(event, {
        targetUrl: 'https://other-domain.org/wp-admin',
        allowedScope: ['example.com', 'staging.example.com'],
      })) as IPCResult<AuditValidateTargetResponse>;

      expect(outOfScopeRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'https://other-domain.org/wp-admin',
          inScope: false,
        },
      });
    });

    it('enforces port restrictions and respects allowedPorts, allowAnyPort, and explicit host-port precedence per shared contract', async () => {
      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)!;

      // 1. Missing allowedScope + prohibited non-standard port 8443 -> valid: false, inScope: false
      const defaultPortRes = (await listener(event, {
        targetUrl: 'https://example.com:8443/wp-admin',
      })) as IPCResult<AuditValidateTargetResponse>;
      expect(defaultPortRes).toEqual({
        success: true,
        data: {
          valid: false,
          inScope: false,
          error: 'Target URL is outside the permitted scope or port policy.',
        },
      });

      // 2. Matching allowedScope + prohibited non-standard port 8443 -> valid: false, inScope: false
      const matchingScopeProhibitedPortRes = (await listener(event, {
        targetUrl: 'https://example.com:8443/wp-admin',
        allowedScope: ['example.com'],
      })) as IPCResult<AuditValidateTargetResponse>;
      expect(matchingScopeProhibitedPortRes).toEqual({
        success: true,
        data: {
          valid: false,
          inScope: false,
          error: 'Target URL is outside the permitted scope or port policy.',
        },
      });

      // 3. Matching allowedScope + permitted port in options.allowedPorts -> valid: true, inScope: true
      const allowedPortsRes = (await listener(event, {
        targetUrl: 'https://example.com:8443/wp-admin',
        allowedScope: ['example.com'],
        options: {
          allowedPorts: [443, 8443],
        },
      })) as IPCResult<AuditValidateTargetResponse>;
      expect(allowedPortsRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'https://example.com:8443/wp-admin',
          inScope: true,
        },
      });

      // 4. Nonmatching allowedScope + permitted port in options.allowedPorts -> valid: true, inScope: false
      const allowedPortsUnauthorizedHostRes = (await listener(event, {
        targetUrl: 'https://unauthorized.org:8443/wp-admin',
        allowedScope: ['example.com'],
        options: {
          allowedPorts: [443, 8443],
        },
      })) as IPCResult<AuditValidateTargetResponse>;
      expect(allowedPortsUnauthorizedHostRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'https://unauthorized.org:8443/wp-admin',
          inScope: false,
        },
      });

      // 5. Matching allowedScope + options.allowAnyPort: true -> valid: true, inScope: true
      const allowAnyPortRes = (await listener(event, {
        targetUrl: 'http://localhost:9000/wordpress',
        allowedScope: ['localhost'],
        options: {
          allowAnyPort: true,
        },
      })) as IPCResult<AuditValidateTargetResponse>;
      expect(allowAnyPortRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'http://localhost:9000/wordpress',
          inScope: true,
        },
      });

      // 6. Nonmatching allowedScope + options.allowAnyPort: true -> valid: true, inScope: false
      const allowAnyPortUnauthorizedHostRes = (await listener(event, {
        targetUrl: 'http://other-host.local:9000/wordpress',
        allowedScope: ['localhost'],
        options: {
          allowAnyPort: true,
        },
      })) as IPCResult<AuditValidateTargetResponse>;
      expect(allowAnyPortUnauthorizedHostRes).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'http://other-host.local:9000/wordpress',
          inScope: false,
        },
      });

      // 7. Explicit port in allowedScope ('example.com:8080') matching target port 8080 -> valid: true, inScope: true
      const explicitScopePortMatch = (await listener(event, {
        targetUrl: 'http://example.com:8080/wp',
        allowedScope: ['example.com:8080'],
        options: {
          allowedPorts: [9090],
        },
      })) as IPCResult<AuditValidateTargetResponse>;
      expect(explicitScopePortMatch).toEqual({
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'http://example.com:8080/wp',
          inScope: true,
        },
      });

      // 8. Explicit port in allowedScope ('example.com:8080') takes precedence over allowedPorts: [9090] -> valid: false, inScope: false
      const explicitScopePortMismatch = (await listener(event, {
        targetUrl: 'http://example.com:9090/wp',
        allowedScope: ['example.com:8080'],
        options: {
          allowedPorts: [9090],
        },
      })) as IPCResult<AuditValidateTargetResponse>;
      expect(explicitScopePortMismatch).toEqual({
        success: true,
        data: {
          valid: false,
          inScope: false,
          error: 'Target URL is outside the permitted scope or port policy.',
        },
      });
    });

    it('makes zero network requests during target validation', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const httpRequestSpy = vi.spyOn(http, 'request');
      const httpGetSpy = vi.spyOn(http, 'get');
      const httpsRequestSpy = vi.spyOn(https, 'request');
      const httpsGetSpy = vi.spyOn(https, 'get');

      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();
      const listener = ipcMain.handlers.get(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)!;

      await listener(event, {
        targetUrl: 'https://example.com/wp-login.php',
        allowedScope: ['example.com'],
      });
      await listener(event, {
        targetUrl: 'https://untrusted.example.org',
        allowedScope: ['example.com'],
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(httpRequestSpy).not.toHaveBeenCalled();
      expect(httpGetSpy).not.toHaveBeenCalled();
      expect(httpsRequestSpy).not.toHaveBeenCalled();
      expect(httpsGetSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
      httpRequestSpy.mockRestore();
      httpGetSpy.mockRestore();
      httpsRequestSpy.mockRestore();
      httpsGetSpy.mockRestore();
    });
  });

  // =========================================================================
  // 4. Dispatcher & Lifecycle Integration Tests
  // =========================================================================
  describe('D. SecureIpcDispatcher & Application Lifecycle Integration', () => {
    it('registers all three handlers exclusively through SecureIpcDispatcher and CentralIpcRegistrationManager', () => {
      const registerSpy = vi.spyOn(CentralIpcRegistrationManager, 'register');
      const { ipcMain } = createDispatcherWithHandlers();

      expect(ipcMain.handle).toHaveBeenCalledTimes(3);
      expect(ipcMain.handlers.has(IPC_CHANNELS.APP_PING)).toBe(true);
      expect(ipcMain.handlers.has(IPC_CHANNELS.APP_GET_SYSTEM_INFO)).toBe(true);
      expect(ipcMain.handlers.has(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)).toBe(true);

      expect(registerSpy).toHaveBeenCalledTimes(3);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(true);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(true);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toBe(true);

      // Verify handlers.ts source file contains zero direct calls to ipcMain.handle
      const handlersSource = fs.readFileSync(
        path.resolve(import.meta.dirname, '../../src/main/ipc/handlers.ts'),
        'utf8',
      );
      expect(handlersSource).not.toMatch(/\bipcMain\.handle\s*\(/);

      registerSpy.mockRestore();
    });

    it('rejects duplicate registration of the three handlers', () => {
      const { dispatcher } = createDispatcherWithHandlers();

      expect(() => registerCoreIpcHandlers(dispatcher)).toThrow(
        /Duplicate handler registration rejected for channel/i,
      );

      const secondDispatcher = new SecureIpcDispatcher({
        isDev: true,
        isPackaged: false,
        ipcMain: createLocalMockIpcMain(),
      });
      activeDispatchers.push(secondDispatcher);

      expect(() => registerCoreIpcHandlers(secondDispatcher)).toThrow(
        /Duplicate handler registration rejected for channel/i,
      );
    });

    it('enforces SenderGuard verification across all three handlers', async () => {
      const { ipcMain } = createDispatcherWithHandlers();

      // 1. Subframe / iframe sender rejected
      const { event: iframeEvent } = createAuthorizedEvent({
        webContentsId: 710,
        windowId: 71,
        isSubFrame: true,
      });

      for (const channel of [
        IPC_CHANNELS.APP_PING,
        IPC_CHANNELS.APP_GET_SYSTEM_INFO,
        IPC_CHANNELS.AUDIT_VALIDATE_TARGET,
      ]) {
        const res = (await ipcMain.handlers.get(channel)!(iframeEvent, {})) as IPCResult<unknown>;
        expect(res).toEqual({
          success: false,
          error: {
            code: IPC_ERROR_CODES.UNAUTHORIZED_SENDER,
            message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.UNAUTHORIZED_SENDER],
          },
        });
      }

      // 2. Unregistered window rejected
      const { event: unregWindowEvent } = createAuthorizedEvent({
        webContentsId: 711,
        windowId: 72,
        unregisteredWindow: true,
      });
      const unregRes = (await ipcMain.handlers.get(IPC_CHANNELS.APP_PING)!(
        unregWindowEvent,
        {},
      )) as IPCResult<unknown>;
      expect(unregRes.success).toBe(false);
      if (!unregRes.success) {
        expect(unregRes.error.code).toBe(IPC_ERROR_CODES.UNAUTHORIZED_SENDER);
      }
    });

    it('rejects malformed requests (prototype pollution & non-plain objects) and returns safe errors', async () => {
      const { ipcMain } = createDispatcherWithHandlers();
      const { event } = createAuthorizedEvent();

      const pingListener = ipcMain.handlers.get(IPC_CHANNELS.APP_PING)!;

      // Array payload instead of plain object rejected
      const arrayPayloadRes = (await pingListener(event, [1, 2, 3])) as IPCResult<unknown>;
      expect(arrayPayloadRes.success).toBe(false);
      if (!arrayPayloadRes.success) {
        expect(arrayPayloadRes.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
      }

      // Forbidden __proto__ own property rejected by PayloadInspector
      const pollutedPayload = JSON.parse('{"__proto__": {"polluted": true}}');
      const protoRes = (await pingListener(event, pollutedPayload)) as IPCResult<unknown>;
      expect(protoRes.success).toBe(false);
      if (!protoRes.success) {
        expect(protoRes.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
        expect(protoRes.error.message).toBe(
          SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED],
        );
      }
    });

    it('unregisters all three handlers cleanly on dispatcher teardown', () => {
      const { dispatcher, ipcMain } = createDispatcherWithHandlers();

      expect(ipcMain.handlers.size).toBe(3);
      dispatcher.teardown();

      expect(ipcMain.removeHandler).toHaveBeenCalledTimes(3);
      expect(ipcMain.handlers.size).toBe(0);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toBe(false);
    });

    it('respects AbortSignal cancellation for pre-aborted and in-flight requests', async () => {
      const { event } = createAuthorizedEvent();
      const abortController = new AbortController();
      abortController.abort();

      // Direct handler pre-aborted signal check
      const pingHandler = createAppPingHandler();
      await expect(
        pingHandler({}, { event, signal: abortController.signal }),
      ).rejects.toMatchObject({
        code: IPC_ERROR_CODES.INTERNAL_ERROR,
      });

      const sysInfoHandler = createGetSystemInfoHandler();
      await expect(
        sysInfoHandler({}, { event, signal: abortController.signal }),
      ).rejects.toMatchObject({
        code: IPC_ERROR_CODES.INTERNAL_ERROR,
      });

      const validateHandler = createValidateTargetHandler();
      await expect(
        validateHandler(
          { targetUrl: 'https://example.com' },
          { event, signal: abortController.signal },
        ),
      ).rejects.toMatchObject({
        code: IPC_ERROR_CODES.INTERNAL_ERROR,
      });

      // Dispatcher lifecycle abort when WebContents is destroyed mid-invocation
      const { event: liveEvent, webContents } = createAuthorizedEvent({
        webContentsId: 750,
        windowId: 75,
      });
      const { ipcMain } = createDispatcherWithHandlers({
        now: () => {
          webContents.triggerDestroy();
          return 1762450000000;
        },
      });

      const result = (await ipcMain.handlers.get(IPC_CHANNELS.APP_PING)!(
        liveEvent,
        {},
      )) as IPCResult<AppPingResponse>;

      expect(result).toEqual({
        success: false,
        error: {
          code: IPC_ERROR_CODES.INTERNAL_ERROR,
          message: SAFE_IPC_ERROR_MESSAGES[IPC_ERROR_CODES.INTERNAL_ERROR],
        },
      });
    });

    it('enforces exact startup order in initializeMainProcess: Session security -> Dispatcher -> Handlers -> BrowserWindow', () => {
      const callOrder: string[] = [];

      const sessionInitSpy = vi
        .spyOn(SecurityWebRequestManager, 'initialize')
        .mockImplementation(() => {
          callOrder.push('1:SecurityWebRequestManager.initialize');
        });

      const ipcHandleSpy = mockIpcMain.handle.mockImplementation((channel, listener) => {
        callOrder.push(`2:registerHandler(${channel})`);
        mockIpcMain.handlers.set(channel, listener);
      });

      mockBrowserWindowConstructor.mockImplementationOnce(function () {
        callOrder.push('3:createMainWindow');
        return {
          id: 90,
          isDestroyed: () => false,
          webContents: {
            id: 901,
            isDestroyed: () => false,
            once: vi.fn(),
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
            session: mockDefaultSession,
          },
          once: vi.fn(),
          show: vi.fn(),
          loadURL: vi.fn(),
          loadFile: vi.fn(),
        } as any;
      });

      const dispatcher1 = initializeMainProcess({ ipcMain: mockIpcMain });
      expect(dispatcher1).toBeInstanceOf(SecureIpcDispatcher);

      // Note: createMainWindow also calls SecurityWebRequestManager.initialize idempotently for win.webContents.session
      expect(callOrder.slice(0, 5)).toEqual([
        '1:SecurityWebRequestManager.initialize',
        `2:registerHandler(${IPC_CHANNELS.APP_PING})`,
        `2:registerHandler(${IPC_CHANNELS.APP_GET_SYSTEM_INFO})`,
        `2:registerHandler(${IPC_CHANNELS.AUDIT_VALIDATE_TARGET})`,
        '3:createMainWindow',
      ]);

      // Verify idempotency on duplicate initializeMainProcess call
      const countBeforeSecondCall = callOrder.length;
      const dispatcher2 = initializeMainProcess({ ipcMain: mockIpcMain });
      expect(dispatcher2).toBe(dispatcher1);
      expect(callOrder.length).toBe(countBeforeSecondCall);

      // Verify deterministic shutdown
      shutdownMainProcess();
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toBe(false);

      sessionInitSpy.mockRestore();
      ipcHandleSpy.mockRestore();
    });

    it('fails closed and tears down partial registrations without creating a BrowserWindow if handler registration fails', () => {
      mockBrowserWindowConstructor.mockClear();

      const failingIpcMain: IpcMainLike = {
        handle: vi.fn((channel: string) => {
          if (channel === IPC_CHANNELS.AUDIT_VALIDATE_TARGET) {
            throw new Error('Simulated native ipcMain registration failure');
          }
        }),
        removeHandler: vi.fn(),
      };

      expect(() => initializeMainProcess({ ipcMain: failingIpcMain })).toThrow();

      // Window must NEVER be created if handler registration fails
      expect(mockBrowserWindowConstructor).not.toHaveBeenCalled();

      // Partial registrations (app:ping, app:get-system-info) must be cleaned up immediately
      expect(failingIpcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.APP_PING);
      expect(failingIpcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.APP_GET_SYSTEM_INFO);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
    });

    it('Task 1: rejects synchronous re-entrant initializeMainProcess calls during BrowserWindow creation without leaving state stuck', () => {
      const localIpcMain = createLocalMockIpcMain();
      let reentrantError: unknown = null;

      // Case 1: Re-entrant call inside BrowserWindow creation is caught by caller; outer initialization completes cleanly
      mockBrowserWindowConstructor.mockImplementationOnce(function () {
        try {
          initializeMainProcess({ ipcMain: localIpcMain });
        } catch (err) {
          reentrantError = err;
        }
        return {
          id: 91,
          isDestroyed: () => false,
          webContents: {
            id: 911,
            isDestroyed: () => false,
            once: vi.fn(),
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
            session: mockDefaultSession,
          },
          once: vi.fn(),
          show: vi.fn(),
          loadURL: vi.fn(),
          loadFile: vi.fn(),
        } as any;
      });

      const dispatcher = initializeMainProcess({ ipcMain: localIpcMain });
      expect(dispatcher).toBeInstanceOf(SecureIpcDispatcher);
      expect(reentrantError).toBeInstanceOf(Error);
      expect((reentrantError as Error).message).toMatch(
        /Re-entrant Main Process initialization is not permitted/i,
      );

      // Verify handlers were registered only once and BrowserWindow was constructed only once
      expect(localIpcMain.handle).toHaveBeenCalledTimes(3);
      expect(mockBrowserWindowConstructor).toHaveBeenCalledTimes(1);

      // Sequential duplicate call after completion remains idempotent
      expect(initializeMainProcess({ ipcMain: localIpcMain })).toBe(dispatcher);

      shutdownMainProcess();

      // Case 2: Re-entrant call is NOT caught inside BrowserWindow creation -> outer initialization fails cleanly and resets isInitializing
      mockBrowserWindowConstructor.mockClear();
      const secondIpcMain = createLocalMockIpcMain();
      mockBrowserWindowConstructor.mockImplementationOnce(function () {
        // Throws re-entrancy error directly out of createMainWindow
        initializeMainProcess({ ipcMain: secondIpcMain });
        return {} as any;
      });

      expect(() => initializeMainProcess({ ipcMain: secondIpcMain })).toThrow(
        /Re-entrant Main Process initialization is not permitted/i,
      );

      // Handlers must be rolled back and state must not be stuck
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toBe(false);

      // Subsequent legitimate retry succeeds
      const recoveredDispatcher = initializeMainProcess({ ipcMain: secondIpcMain });
      expect(recoveredDispatcher).toBeInstanceOf(SecureIpcDispatcher);
    });

    it('Task 2a: preserves dispatcher ownership when partial handler registration rollback encounters a removeHandler failure, and succeeds on retry', () => {
      mockBrowserWindowConstructor.mockClear();
      let failPingRemoval = true;

      const flakyIpcMain: IpcMainLike = {
        handle: vi.fn((channel: string) => {
          if (channel === IPC_CHANNELS.AUDIT_VALIDATE_TARGET) {
            throw new Error('Simulated handle failure on 3rd channel');
          }
        }),
        removeHandler: vi.fn((channel: string) => {
          if (channel === IPC_CHANNELS.APP_PING && failPingRemoval) {
            throw new Error('Simulated native removeHandler failure on app:ping');
          }
        }),
      };

      // 1. Initial startup fails at 3rd channel; rollback removes app:get-system-info but fails to remove app:ping
      expect(() => initializeMainProcess({ ipcMain: flakyIpcMain })).toThrow();
      expect(mockBrowserWindowConstructor).not.toHaveBeenCalled();

      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(true);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);

      // 2. While removal continues to fail, another initializeMainProcess() attempt cannot replace the unresolved registration
      expect(() => initializeMainProcess({ ipcMain: flakyIpcMain })).toThrow(
        /Cannot initialize Main Process IPC while previous handler removals remain unresolved/i,
      );
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(true);

      // 3. Once native removeHandler recovers, shutdownMainProcess() retries removal using the preserved owner token and releases ownership
      failPingRemoval = false;
      shutdownMainProcess();

      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);

      // 4. Subsequent initialization now succeeds cleanly
      const cleanIpcMain = createLocalMockIpcMain();
      const dispatcher = initializeMainProcess({ ipcMain: cleanIpcMain });
      expect(dispatcher).toBeInstanceOf(SecureIpcDispatcher);
      expect(cleanIpcMain.handle).toHaveBeenCalledTimes(3);
    });

    it('Task 2b: preserves dispatcher ownership when BrowserWindow creation fails AND removeHandler fails, then recovers on retry', () => {
      let failValidateRemoval = true;

      const flakyIpcMain: IpcMainLike = {
        handle: vi.fn(),
        removeHandler: vi.fn((channel: string) => {
          if (channel === IPC_CHANNELS.AUDIT_VALIDATE_TARGET && failValidateRemoval) {
            throw new Error('Simulated native removeHandler failure on audit:validate-target');
          }
        }),
      };

      mockBrowserWindowConstructor.mockImplementationOnce(function () {
        throw new Error('Simulated BrowserWindow creation failure');
      });

      // 1. BrowserWindow creation fails; rollback removes first 2 channels but fails on audit:validate-target
      expect(() => initializeMainProcess({ ipcMain: flakyIpcMain })).toThrow(
        /Simulated BrowserWindow creation failure/i,
      );

      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
      expect(
        CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toBe(true);

      // 2. Now allow removeHandler to succeed; calling initializeMainProcess() retries cleanup first and then succeeds
      failValidateRemoval = false;
      const cleanIpcMain = createLocalMockIpcMain();
      const dispatcher = initializeMainProcess({ ipcMain: cleanIpcMain });

      expect(dispatcher).toBeInstanceOf(SecureIpcDispatcher);
      expect(
        CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toBe(false);
      expect(cleanIpcMain.handlers.size).toBe(3);
    });

    it('Task 4: aborts before creating SecureIpcDispatcher, registering handlers, or creating BrowserWindow when SecurityWebRequestManager.initialize throws', () => {
      mockBrowserWindowConstructor.mockClear();
      const localIpcMain = createLocalMockIpcMain();

      const sessionSpy = vi
        .spyOn(SecurityWebRequestManager, 'initialize')
        .mockImplementationOnce(() => {
          throw new Error('Simulated Session security initialization failure');
        });

      expect(() => initializeMainProcess({ ipcMain: localIpcMain })).toThrow(
        /Simulated Session security initialization failure/i,
      );

      // Zero handlers registered, zero windows created
      expect(localIpcMain.handle).not.toHaveBeenCalled();
      expect(mockBrowserWindowConstructor).not.toHaveBeenCalled();
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toBe(false);

      // Subsequent valid initialization succeeds because isInitializing was reset
      sessionSpy.mockRestore();
      const dispatcher = initializeMainProcess({ ipcMain: localIpcMain });
      expect(dispatcher).toBeInstanceOf(SecureIpcDispatcher);
      expect(localIpcMain.handle).toHaveBeenCalledTimes(3);
      expect(mockBrowserWindowConstructor).toHaveBeenCalledTimes(1);
    });

    it('Task 5: removes all registered IPC handlers when createMainWindow throws and allows a clean subsequent initialization', () => {
      const localIpcMain = createLocalMockIpcMain();

      mockBrowserWindowConstructor.mockImplementationOnce(function () {
        throw new Error('Simulated native BrowserWindow crash');
      });

      expect(() => initializeMainProcess({ ipcMain: localIpcMain })).toThrow(
        /Simulated native BrowserWindow crash/i,
      );

      // All 3 handlers were registered and then immediately unregistered during rollback
      expect(localIpcMain.handle).toHaveBeenCalledTimes(3);
      expect(localIpcMain.removeHandler).toHaveBeenCalledTimes(3);
      expect(localIpcMain.handlers.size).toBe(0);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toBe(false);

      // Subsequent initialization succeeds without duplicate registration errors
      const secondIpcMain = createLocalMockIpcMain();
      const dispatcher = initializeMainProcess({ ipcMain: secondIpcMain });
      expect(dispatcher).toBeInstanceOf(SecureIpcDispatcher);
      expect(secondIpcMain.handlers.size).toBe(3);
    });

    it('Task 6: retries failed handler removal on repeated shutdownMainProcess() without re-removing already unregistered channels', () => {
      let failSystemInfoRemoval = true;
      const removedChannelsLog: string[] = [];

      const customIpcMain: IpcMainLike = {
        handle: vi.fn(),
        removeHandler: vi.fn((channel: string) => {
          removedChannelsLog.push(channel);
          if (channel === IPC_CHANNELS.APP_GET_SYSTEM_INFO && failSystemInfoRemoval) {
            throw new Error('Simulated transient removeHandler failure on app:get-system-info');
          }
        }),
      };

      // 1. Successful startup
      const dispatcher1 = initializeMainProcess({ ipcMain: customIpcMain });
      expect(dispatcher1).toBeInstanceOf(SecureIpcDispatcher);

      // 2. First shutdown attempt: app:ping and audit:validate-target succeed, app:get-system-info throws
      shutdownMainProcess();

      expect(removedChannelsLog).toEqual([
        IPC_CHANNELS.APP_PING,
        IPC_CHANNELS.APP_GET_SYSTEM_INFO,
        IPC_CHANNELS.AUDIT_VALIDATE_TARGET,
      ]);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_GET_SYSTEM_INFO)).toBe(
        true,
      );
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.AUDIT_VALIDATE_TARGET),
      ).toBe(false);

      // 3. Second shutdown attempt: retries ONLY app:get-system-info (already removed channels are not removed again)
      removedChannelsLog.length = 0;
      failSystemInfoRemoval = false;
      shutdownMainProcess();

      expect(removedChannelsLog).toEqual([IPC_CHANNELS.APP_GET_SYSTEM_INFO]);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_GET_SYSTEM_INFO)).toBe(
        false,
      );
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);

      // 4. Subsequent initialization succeeds cleanly
      const nextIpcMain = createLocalMockIpcMain();
      const dispatcher2 = initializeMainProcess({ ipcMain: nextIpcMain });
      expect(dispatcher2).toBeInstanceOf(SecureIpcDispatcher);
      expect(dispatcher2).not.toBe(dispatcher1);
      expect(nextIpcMain.handlers.size).toBe(3);
    });
  });
});
