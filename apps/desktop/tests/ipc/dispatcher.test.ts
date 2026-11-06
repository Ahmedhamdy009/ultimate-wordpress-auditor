/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { SecureIpcDispatcher, type IpcMainLike } from '../../src/main/ipc/dispatcher.js';
import { CentralIpcRegistrationManager } from '../../src/main/ipc/manager.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { SecurityWebRequestManager } from '../../src/main/security/csp.js';
import { IPC_CHANNELS, IPC_ERROR_CODES, IPCError, toSafeIPCError } from '@auditor/shared';

describe('Secure IPC Dispatcher (SecureIpcDispatcher)', () => {
  const activeDispatchers: SecureIpcDispatcher[] = [];

  afterEach(() => {
    while (activeDispatchers.length > 0) {
      const d = activeDispatchers.pop();
      try {
        d?.teardown();
      } catch {
        // Safe fail-through during teardown
      }
    }
  });

  const createDispatcher = (options?: {
    ipcMain?: IpcMainLike;
    isDev?: boolean;
  }): SecureIpcDispatcher => {
    const d = new SecureIpcDispatcher(options);
    activeDispatchers.push(d);
    return d;
  };

  const createMockIpcMain = (): IpcMainLike & {
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

  const createMockEvent = (options?: {
    webContentsId?: number;
    windowId?: number;
    url?: string;
    insecurePreferences?: boolean;
    session?: any;
    skipSessionRegistration?: boolean;
  }) => {
    const webContentsId = options?.webContentsId ?? 301;
    const windowId = options?.windowId ?? 20;
    const url = options?.url ?? 'http://localhost:5173';

    let isWcDestroyed = false;
    let isWinDestroyed = false;

    const listeners: Record<string, (() => void)[]> = {};

    const mockMainFrame = {
      url,
      parent: null,
    };

    const mockSession =
      options?.session !== undefined
        ? options.session
        : {
            webRequest: { onHeadersReceived: vi.fn() },
          };

    if (mockSession && !options?.skipSessionRegistration) {
      try {
        SecurityWebRequestManager.initialize({ isDev: true, targetSession: mockSession });
      } catch {
        // Safe if already initialized
      }
    }

    const mockWebContents: any = {
      id: webContentsId,
      isDestroyed: vi.fn(() => isWcDestroyed),
      mainFrame: mockMainFrame,
      session: mockSession,
      once: vi.fn((event: string, cb: () => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      }),
      removeListener: vi.fn((event: string, cb: () => void) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(l => l !== cb);
        }
      }),
    };

    const mockWindow: any = {
      id: windowId,
      isDestroyed: vi.fn(() => isWinDestroyed),
      webContents: mockWebContents,
      once: vi.fn(),
    };

    WindowSecurityRegistry.register(mockWindow, {
      contextIsolation: !options?.insecurePreferences,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });

    const mockEvent: IpcMainInvokeEvent = {
      sender: mockWebContents as WebContents,
      senderFrame: mockMainFrame as any,
      frameId: 1,
      processId: 1000,
    };

    return {
      mockEvent,
      mockWebContents,
      mockWindow,
      destroy: () => {
        isWcDestroyed = true;
        isWinDestroyed = true;
        const destroyedList = listeners['destroyed'] ?? [];
        for (const cb of destroyedList) {
          cb();
        }
      },
    };
  };

  describe('Channel Registration', () => {
    it('registers handlers for allowlisted channels', () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        timestamp: Date.now(),
      }));

      expect(mockIpcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.APP_PING, expect.any(Function));
      expect(mockIpcMain.handlers.has(IPC_CHANNELS.APP_PING)).toBe(true);
    });

    it('rejects registration of unknown channels', () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      expect(() => {
        dispatcher.registerHandler('evil:unknown-channel' as any, async () => ({}) as any);
      }).toThrowError();
    });

    it('rejects duplicate channel handler registrations and preserves original registration', () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 100,
      }));

      expect(() => {
        dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
          pong: true,
          serverTimestamp: 200,
        }));
      }).toThrowError(/Duplicate handler registration/);

      // Verify teardown removes it exactly once
      dispatcher.teardown();
      expect(mockIpcMain.removeHandler).toHaveBeenCalledTimes(1);
    });

    it('does not record handler ownership if ipcMain.handle throws', () => {
      const mockIpcMain = createMockIpcMain();
      // Simulate another component having already registered or ipcMain throwing
      mockIpcMain.handle = vi.fn(() => {
        throw new Error('Attempted to register a second handler for channel app:ping');
      });

      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      expect(() => {
        dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
          pong: true,
          serverTimestamp: 100,
        }));
      }).toThrowError(/Failed to register IPC handler on ipcMain/);

      // Verify dispatcher does NOT own this handler; teardown will not remove it
      dispatcher.teardown();
      expect(mockIpcMain.removeHandler).not.toHaveBeenCalled();
    });

    it('sanitizes handler registration errors and never leaks secrets or paths from ipcMain.handle', () => {
      const mockIpcMain = createMockIpcMain();
      // Simulate ipcMain.handle throwing an error with sensitive internal paths and credentials
      mockIpcMain.handle = vi.fn(() => {
        throw new Error(
          'Internal binding failure at C:\\Users\\Administrator\\.secret_token_12345: DB connection failed',
        );
      });

      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      try {
        dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
          pong: true,
          serverTimestamp: 100,
        }));
        expect.unreachable('Should have thrown IPCError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(IPCError);
        const ipcErr = err as IPCError;
        expect(ipcErr.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
        expect(ipcErr.message).toBe('Failed to register IPC handler on ipcMain');
        expect(ipcErr.message).not.toContain('secret_token_12345');
        expect(ipcErr.message).not.toContain('C:\\Users\\Administrator');

        // Verify defensive serialization via toSafeIPCError also strips all internal details
        const serialized = toSafeIPCError(ipcErr);
        expect(serialized.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
        expect(serialized.message).toBe(
          'An internal error occurred while processing the IPC request',
        );
        expect(JSON.stringify(serialized)).not.toContain('secret_token_12345');
        expect(JSON.stringify(serialized)).not.toContain('C:\\Users\\Administrator');
      }
    });

    it('rejects registration after dispatcher teardown', () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });
      dispatcher.teardown();

      expect(() => {
        dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
          pong: true,
          timestamp: Date.now(),
        }));
      }).toThrowError();
    });
  });

  describe('Request Processing Pipeline & Schema Validation', () => {
    it('successfully processes valid requests and returns sanitized IPCResult envelope', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async _req => ({
        pong: true,
        serverTimestamp: 123456789,
      }));

      const { mockEvent } = createMockEvent();
      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.APP_PING)!;

      const result = (await handler(mockEvent, {})) as any;
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        pong: true,
        serverTimestamp: 123456789,
      });
    });

    it('rejects unauthorized sender before handler execution', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      let handlerInvoked = false;
      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => {
        handlerInvoked = true;
        return { pong: true, serverTimestamp: 123 };
      });

      const { mockEvent } = createMockEvent({ url: 'https://evil.com' });
      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.APP_PING)!;

      const result = (await handler(mockEvent, {})) as any;
      expect(handlerInvoked).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error.code).toBe(IPC_ERROR_CODES.UNAUTHORIZED_SENDER);
    });

    it('rejects registered but insecure WebContents before handler execution', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      let handlerInvoked = false;
      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => {
        handlerInvoked = true;
        return { pong: true, serverTimestamp: 123 };
      });

      // Window registered with insecure contextIsolation=false
      const { mockEvent } = createMockEvent({
        webContentsId: 444,
        insecurePreferences: true,
      });
      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.APP_PING)!;

      const result = (await handler(mockEvent, {})) as any;
      expect(handlerInvoked).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error.code).toBe(IPC_ERROR_CODES.UNAUTHORIZED_SENDER);
    });

    it('rejects request failing request schema validation', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      let handlerInvoked = false;
      dispatcher.registerHandler(IPC_CHANNELS.AUDIT_VALIDATE_TARGET, async req => {
        handlerInvoked = true;
        return { valid: true, normalizedUrl: req.targetUrl };
      });

      const { mockEvent } = createMockEvent();
      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)!;

      // Passing invalid payload (number instead of string targetUrl)
      const result = (await handler(mockEvent, { targetUrl: 12345 })) as any;
      expect(handlerInvoked).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
    });

    it('rejects response failing response schema validation', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      // Handler returns malformed response missing required fields
      dispatcher.registerHandler(
        IPC_CHANNELS.APP_PING,
        async () =>
          ({
            wrongField: 'missing_pong_and_timestamp',
          }) as any,
      );

      const { mockEvent } = createMockEvent();
      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.APP_PING)!;

      const result = (await handler(mockEvent, {})) as any;
      expect(result.success).toBe(false);
      expect(result.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);
    });
  });

  describe('Rate Limiting & Concurrency Enforcement', () => {
    it('enforces rate limits per channel and returns ERR_RATE_LIMIT_EXCEEDED', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcher.registerHandler(IPC_CHANNELS.APP_GET_SYSTEM_INFO, async () => ({
        appVersion: '0.1.0',
        electronVersion: '35.0.0',
        chromeVersion: '134.0.0.0',
        nodeVersion: '22.0.0',
        platform: 'win32',
        arch: 'x64',
      }));

      const { mockEvent } = createMockEvent({ webContentsId: 501 });
      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.APP_GET_SYSTEM_INFO)!;

      // app:get-system-info allows 5 requests/sec
      for (let i = 0; i < 5; i++) {
        const res = (await handler(mockEvent, {})) as any;
        expect(res.success).toBe(true);
      }

      // 6th request within the same second is blocked
      const blockedRes = (await handler(mockEvent, {})) as any;
      expect(blockedRes.success).toBe(false);
      expect(blockedRes.error.code).toBe(IPC_ERROR_CODES.RATE_LIMIT_EXCEEDED);
    });

    it('enforces concurrency limits and guarantees exactly-once concurrency counter release', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      let resolveHandler: (() => void) | undefined;
      const pendingPromise = new Promise<void>(resolve => {
        resolveHandler = resolve;
      });

      // audit:validate-target has maxConcurrency = 3
      dispatcher.registerHandler(IPC_CHANNELS.AUDIT_VALIDATE_TARGET, async req => {
        await pendingPromise;
        return { valid: true, normalizedUrl: req.targetUrl };
      });

      const { mockEvent } = createMockEvent({ webContentsId: 601 });
      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.AUDIT_VALIDATE_TARGET)!;

      // Launch 3 simultaneous requests (concurrency = 3)
      const req1 = handler(mockEvent, { targetUrl: 'https://example.com/1' });
      const req2 = handler(mockEvent, { targetUrl: 'https://example.com/2' });
      const req3 = handler(mockEvent, { targetUrl: 'https://example.com/3' });

      // 4th concurrent request must be rejected immediately
      const req4 = await handler(mockEvent, { targetUrl: 'https://example.com/4' });
      expect((req4 as any).success).toBe(false);
      expect((req4 as any).error.code).toBe(IPC_ERROR_CODES.CONCURRENCY_LIMIT_EXCEEDED);

      // Resolve pending requests
      resolveHandler!();
      const results = await Promise.all([req1, req2, req3]);
      for (const res of results) {
        expect((res as any).success).toBe(true);
      }

      // Now concurrency is completely released (exactly-once); a new request succeeds
      const req5 = await handler(mockEvent, { targetUrl: 'https://example.com/5' });
      expect((req5 as any).success).toBe(true);
    });
  });

  describe('WebContents Destruction & Cooperative Cancellation', () => {
    it('aborts cooperative signal when WebContents is destroyed during active request', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      let signalObservedAborted = false;

      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async (_req, { signal }) => {
        return new Promise<any>((resolve, reject) => {
          signal.addEventListener('abort', () => {
            signalObservedAborted = true;
            reject(new Error('Operation aborted'));
          });
        });
      });

      const { mockEvent, destroy } = createMockEvent({ webContentsId: 701 });
      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.APP_PING)!;

      const activeReq = handler(mockEvent, {});

      // Destroy the WebContents while the request is in-flight
      destroy();

      const result = (await activeReq) as any;
      expect(signalObservedAborted).toBe(true);
      expect(result.success).toBe(false);
      expect(result.error.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
    });

    it('rejects in Step 8 (abort-state verification) if signal was aborted during handler execution', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      const { mockEvent, destroy } = createMockEvent({ webContentsId: 702 });

      // Handler completes without throwing, but window destruction occurs before it finishes
      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => {
        destroy(); // Trigger destruction mid-flight
        return { pong: true, serverTimestamp: 999 };
      });

      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.APP_PING)!;
      const result = (await handler(mockEvent, {})) as any;

      expect(result.success).toBe(false);
      expect(result.error.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
    });
  });

  describe('Teardown & Lifecycle Protection', () => {
    it('removes handlers from ipcMain on teardown and rejects new requests', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 123,
      }));

      dispatcher.teardown();
      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.APP_PING);
      expect(mockIpcMain.handlers.has(IPC_CHANNELS.APP_PING)).toBe(false);

      // Attempting teardown again is idempotent and does not throw
      expect(() => dispatcher.teardown()).not.toThrow();

      // Calling processRequest after teardown returns safe internal error
      const { mockEvent } = createMockEvent();
      const postTeardown = await dispatcher.processRequest(IPC_CHANNELS.APP_PING, mockEvent, {});
      expect(postTeardown.success).toBe(false);
      expect(postTeardown.error.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
    });

    it('removes only handlers owned by this dispatcher and preserves unowned handlers', () => {
      const mockIpcMain = createMockIpcMain();
      // Pre-register an unowned handler
      mockIpcMain.handlers.set('other:channel', vi.fn() as any);

      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });
      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 123,
      }));

      dispatcher.teardown();
      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.APP_PING);
      expect(mockIpcMain.handlers.has(IPC_CHANNELS.APP_PING)).toBe(false);
      // Unowned handler is completely preserved
      expect(mockIpcMain.handlers.has('other:channel')).toBe(true);
    });

    it('regression: rejects duplicate channel registration between two distinct Dispatcher instances', () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcherA = createDispatcher({ ipcMain: mockIpcMain, isDev: true });
      const dispatcherB = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcherA.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 100,
      }));

      expect(() => {
        dispatcherB.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
          pong: false,
          serverTimestamp: 200,
        }));
      }).toThrowError(/Duplicate handler registration rejected for channel 'app:ping'/);
    });

    it('regression: Dispatcher teardown never removes another component or Dispatcher channel', () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcherA = createDispatcher({ ipcMain: mockIpcMain, isDev: true });
      const dispatcherB = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcherA.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 100,
      }));

      // Direct unregister with foreign owner token is rejected
      const foreignToken = Symbol('foreign_token');
      const unregResult = CentralIpcRegistrationManager.unregister(
        IPC_CHANNELS.APP_PING,
        foreignToken,
      );
      expect(unregResult).toBe(false);
      expect(mockIpcMain.removeHandler).not.toHaveBeenCalledWith(IPC_CHANNELS.APP_PING);

      // Dispatcher B teardown must NOT remove Dispatcher A's handler
      dispatcherB.teardown();
      expect(mockIpcMain.removeHandler).not.toHaveBeenCalledWith(IPC_CHANNELS.APP_PING);
      expect(mockIpcMain.handlers.has(IPC_CHANNELS.APP_PING)).toBe(true);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(true);
    });

    it('regression: multiple consecutive teardowns are strictly idempotent and do not double-remove', () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 123,
      }));

      expect(mockIpcMain.handlers.has(IPC_CHANNELS.APP_PING)).toBe(true);

      // First teardown
      dispatcher.teardown();
      expect(mockIpcMain.removeHandler).toHaveBeenCalledTimes(1);
      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.APP_PING);
      expect(mockIpcMain.handlers.has(IPC_CHANNELS.APP_PING)).toBe(false);

      // Subsequent teardowns: strictly idempotent no-op
      expect(() => dispatcher.teardown()).not.toThrow();
      expect(() => dispatcher.teardown()).not.toThrow();
      expect(mockIpcMain.removeHandler).toHaveBeenCalledTimes(1);
    });

    it('regression: rejects handler registration after dispatcher teardown', () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcher.teardown();

      expect(() => {
        dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
          pong: true,
          serverTimestamp: 123,
        }));
      }).toThrowError(/Cannot register IPC handler after dispatcher teardown/);
    });

    it('regression: unauthorized replacement attempt is rejected and preserves existing handler', () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcherA = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcherA.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 100,
      }));

      // Rogue component attempts to replace channel handler directly via CentralIpcRegistrationManager
      const attackerToken = Symbol('attacker_token');
      expect(() => {
        CentralIpcRegistrationManager.register(
          IPC_CHANNELS.APP_PING,
          vi.fn() as any,
          attackerToken,
          mockIpcMain,
        );
      }).toThrowError(/Duplicate handler registration rejected for channel 'app:ping'/);

      // Assert existing registration was preserved and still owned by dispatcherA
      const registration = CentralIpcRegistrationManager.getRegistration(IPC_CHANNELS.APP_PING);
      expect(registration).toBeDefined();
      expect(registration?.ownerToken).not.toBe(attackerToken);
    });

    it('regression: removeHandler() throws - ownership record remains intact and marked removal_failed', () => {
      const mockIpcMain: IpcMainLike = {
        handle: vi.fn(),
        removeHandler: vi.fn(() => {
          throw new Error('Native Electron removeHandler failure');
        }),
      };

      const ownerA = Symbol('owner_a');
      const listener = vi.fn() as any;
      CentralIpcRegistrationManager.register(IPC_CHANNELS.APP_PING, listener, ownerA, mockIpcMain);

      const unregisterSuccess = CentralIpcRegistrationManager.unregister(
        IPC_CHANNELS.APP_PING,
        ownerA,
      );
      expect(unregisterSuccess).toBe(false);

      // Ownership record remains intact!
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(true);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(true);
      expect(CentralIpcRegistrationManager.isChannelOwnedBy(IPC_CHANNELS.APP_PING, ownerA)).toBe(
        true,
      );

      const record = CentralIpcRegistrationManager.getRegistration(IPC_CHANNELS.APP_PING);
      expect(record).toBeDefined();
      expect(record?.status).toBe('removal_failed');
      expect(record?.ownerToken).toBe(ownerA);

      // Clean up before test ends: retry removal successfully
      mockIpcMain.removeHandler = vi.fn();
      expect(CentralIpcRegistrationManager.unregister(IPC_CHANNELS.APP_PING, ownerA)).toBe(true);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
    });

    it('regression: a different owner cannot register or unregister the same channel after removal failure', () => {
      const mockIpcMain: IpcMainLike = {
        handle: vi.fn(),
        removeHandler: vi.fn(() => {
          throw new Error('Native Electron removeHandler failure');
        }),
      };

      const ownerA = Symbol('owner_a');
      const ownerB = Symbol('owner_b');
      CentralIpcRegistrationManager.register(
        IPC_CHANNELS.APP_PING,
        vi.fn() as any,
        ownerA,
        mockIpcMain,
      );

      // ownerA attempts unregister, which fails natively
      CentralIpcRegistrationManager.unregister(IPC_CHANNELS.APP_PING, ownerA);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(true);

      // ownerB attempts to register the channel while removal remains failed
      expect(() => {
        CentralIpcRegistrationManager.register(
          IPC_CHANNELS.APP_PING,
          vi.fn() as any,
          ownerB,
          mockIpcMain,
        );
      }).toThrowError(/Duplicate handler registration rejected for channel 'app:ping'/);

      // ownerB also cannot unregister the channel
      const unregB = CentralIpcRegistrationManager.unregister(IPC_CHANNELS.APP_PING, ownerB);
      expect(unregB).toBe(false);

      // Ownership remains with ownerA
      expect(CentralIpcRegistrationManager.isChannelOwnedBy(IPC_CHANNELS.APP_PING, ownerA)).toBe(
        true,
      );

      // Clean up before test ends: retry removal successfully with rightful owner
      mockIpcMain.removeHandler = vi.fn();
      expect(CentralIpcRegistrationManager.unregister(IPC_CHANNELS.APP_PING, ownerA)).toBe(true);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
    });

    it('regression: the original owner can retry removal successfully and release ownership only after successful removal', () => {
      let shouldThrow = true;
      const mockIpcMain: IpcMainLike = {
        handle: vi.fn(),
        removeHandler: vi.fn(() => {
          if (shouldThrow) {
            throw new Error('Temporary Electron failure');
          }
        }),
      };

      const ownerA = Symbol('owner_a');
      CentralIpcRegistrationManager.register(
        IPC_CHANNELS.APP_PING,
        vi.fn() as any,
        ownerA,
        mockIpcMain,
      );

      // First attempt fails
      expect(CentralIpcRegistrationManager.unregister(IPC_CHANNELS.APP_PING, ownerA)).toBe(false);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(true);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(true);

      // Fix failure condition and retry
      shouldThrow = false;
      expect(CentralIpcRegistrationManager.unregister(IPC_CHANNELS.APP_PING, ownerA)).toBe(true);

      // Ownership released strictly AFTER successful native removal
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(CentralIpcRegistrationManager.getRegistration(IPC_CHANNELS.APP_PING)).toBeUndefined();
    });

    it('regression: unregisterAllForOwner() preserves failed registrations and releases successful ones', () => {
      const mockIpcMain: IpcMainLike = {
        handle: vi.fn(),
        removeHandler: vi.fn((channel: string) => {
          if (channel === IPC_CHANNELS.APP_GET_SYSTEM_INFO) {
            throw new Error('Native removeHandler failed for system info');
          }
        }),
      };

      const ownerA = Symbol('owner_a');
      CentralIpcRegistrationManager.register(
        IPC_CHANNELS.APP_PING,
        vi.fn() as any,
        ownerA,
        mockIpcMain,
      );
      CentralIpcRegistrationManager.register(
        IPC_CHANNELS.APP_GET_SYSTEM_INFO,
        vi.fn() as any,
        ownerA,
        mockIpcMain,
      );

      const removed = CentralIpcRegistrationManager.unregisterAllForOwner(ownerA);
      expect(removed).toEqual([IPC_CHANNELS.APP_PING]);

      // APP_PING was successfully removed
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);

      // APP_GET_SYSTEM_INFO was preserved because native removal failed
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(true);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_GET_SYSTEM_INFO)).toBe(
        true,
      );
      expect(
        CentralIpcRegistrationManager.isChannelOwnedBy(IPC_CHANNELS.APP_GET_SYSTEM_INFO, ownerA),
      ).toBe(true);

      // Clean up before test ends: retry removal successfully for preserved channel
      mockIpcMain.removeHandler = vi.fn();
      const finalClean = CentralIpcRegistrationManager.unregisterAllForOwner(ownerA);
      expect(finalClean).toEqual([IPC_CHANNELS.APP_GET_SYSTEM_INFO]);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
    });

    it('regression: successful removals still clean up all ownership records completely', () => {
      const mockIpcMain = createMockIpcMain();
      const ownerA = Symbol('owner_a');

      CentralIpcRegistrationManager.register(
        IPC_CHANNELS.APP_PING,
        vi.fn() as any,
        ownerA,
        mockIpcMain,
      );
      CentralIpcRegistrationManager.register(
        IPC_CHANNELS.APP_GET_SYSTEM_INFO,
        vi.fn() as any,
        ownerA,
        mockIpcMain,
      );

      const removed = CentralIpcRegistrationManager.unregisterAllForOwner(ownerA);
      expect(removed).toHaveLength(2);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
      expect(CentralIpcRegistrationManager.getRegistration(IPC_CHANNELS.APP_PING)).toBeUndefined();
      expect(
        CentralIpcRegistrationManager.getRegistration(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBeUndefined();
    });

    it('regression: repeated teardown remains safe and retries after a partial removal failure', () => {
      let failPing = true;
      const mockIpcMain: IpcMainLike = {
        handle: vi.fn(),
        removeHandler: vi.fn((channel: string) => {
          if (channel === IPC_CHANNELS.APP_PING && failPing) {
            throw new Error('Transient failure during teardown');
          }
        }),
      };

      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });
      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 123,
      }));
      dispatcher.registerHandler(IPC_CHANNELS.APP_GET_SYSTEM_INFO, async () => ({
        appName: 'Test',
        appVersion: '1.0.0',
        environment: 'test',
        platform: 'win32',
        arch: 'x64',
        electronVersion: '35.0.0',
      }));

      // 1. First teardown: APP_GET_SYSTEM_INFO succeeds, APP_PING fails native removal
      expect(() => dispatcher.teardown()).not.toThrow();
      expect(
        CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_GET_SYSTEM_INFO),
      ).toBe(false);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(true);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(true);

      // Verify new handler registration remains prohibited after shutdown begins
      expect(() =>
        dispatcher.registerHandler(IPC_CHANNELS.AUDIT_VALIDATE_TARGET, async () => ({
          valid: true,
          normalizedUrl: 'https://example.com',
        })),
      ).toThrowError(/Cannot register IPC handler after dispatcher teardown/);

      // 2. Resolve native failure condition
      failPing = false;

      // 3. Repeated teardown: safely retries APP_PING and completes cleanup
      expect(() => dispatcher.teardown()).not.toThrow();
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(false);

      // 4. Verify that no successful removal was performed twice
      const getSystemInfoCalls = (mockIpcMain.removeHandler as any).mock.calls.filter(
        (c: unknown[]) => c[0] === IPC_CHANNELS.APP_GET_SYSTEM_INFO,
      );
      expect(getSystemInfoCalls).toHaveLength(1);

      const pingCalls = (mockIpcMain.removeHandler as any).mock.calls.filter(
        (c: unknown[]) => c[0] === IPC_CHANNELS.APP_PING,
      );
      expect(pingCalls).toHaveLength(2); // 1st attempt (threw) + 2nd attempt (succeeded)
    });

    it('regression: dispatcher and registration manager use only documented Electron APIs (handle and removeHandler)', () => {
      const accessedProps: string[] = [];
      const strictlyDocumentedIpcMain: IpcMainLike = {
        handle: vi.fn(),
        removeHandler: vi.fn(),
      };

      // Wrap in Proxy to intercept every property access
      const proxyIpcMain = new Proxy(strictlyDocumentedIpcMain, {
        get(target, prop, receiver) {
          if (typeof prop === 'string') {
            accessedProps.push(prop);
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      const dispatcher = createDispatcher({ ipcMain: proxyIpcMain, isDev: true });
      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 123,
      }));

      dispatcher.teardown();

      // Assert only documented 'handle' and 'removeHandler' were ever accessed
      const uniqueAccessed = Array.from(new Set(accessedProps));
      expect(uniqueAccessed).toEqual(expect.arrayContaining(['handle', 'removeHandler']));
      expect(uniqueAccessed).not.toContain('getHandler');
      expect(uniqueAccessed).not.toContain('_invokeHandlers');
      expect(uniqueAccessed).not.toContain('eventNames');
      expect(uniqueAccessed).not.toContain('listeners');
    });

    it('removes owned WebContents destroyed listener on teardown', async () => {
      const mockIpcMain = createMockIpcMain();
      const dispatcher = createDispatcher({ ipcMain: mockIpcMain, isDev: true });

      dispatcher.registerHandler(IPC_CHANNELS.APP_PING, async () => ({
        pong: true,
        serverTimestamp: 123,
      }));

      const { mockEvent } = createMockEvent({ webContentsId: 801 });
      const handler = mockIpcMain.handlers.get(IPC_CHANNELS.APP_PING)!;

      // Execute request to bind listener
      await handler(mockEvent, {});
      expect(mockEvent.sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function));

      // Teardown must remove the bound listener
      dispatcher.teardown();
      expect(mockEvent.sender.removeListener).toHaveBeenCalledWith(
        'destroyed',
        expect.any(Function),
      );
    });
  });

  describe('Central IPC Registration Manager Security & Production Invariants', () => {
    it('regression: resetForTesting and clearChannelRegistryForTesting are strictly absent from production APIs', () => {
      expect((CentralIpcRegistrationManager as any).resetForTesting).toBeUndefined();
      expect((CentralIpcRegistrationManager as any).clearForTesting).toBeUndefined();
      expect((CentralIpcRegistrationManager as any).resetRegistry).toBeUndefined();
      expect((SecureIpcDispatcher as any).clearChannelRegistryForTesting).toBeUndefined();

      const managerMethods = Object.getOwnPropertyNames(CentralIpcRegistrationManager);
      expect(managerMethods).not.toContain('resetForTesting');
      expect(managerMethods).not.toContain('clearChannelRegistryForTesting');

      const dispatcherMethods = Object.getOwnPropertyNames(SecureIpcDispatcher);
      expect(dispatcherMethods).not.toContain('clearChannelRegistryForTesting');
    });

    it('regression: ownership records cannot be cleared through a public reset method and require native removal', () => {
      // Invariant: no public API allows wiping activeRegistrations without native removal
      const publicProps = Object.keys(CentralIpcRegistrationManager);
      for (const prop of publicProps) {
        expect(prop.toLowerCase()).not.toContain('reset');
        expect(prop.toLowerCase()).not.toContain('clear');
      }
    });

    it('regression: failed removal followed by successful retry leaves no stale ownership record', () => {
      let throwError = true;
      const mockIpcMain: IpcMainLike = {
        handle: vi.fn(),
        removeHandler: vi.fn(() => {
          if (throwError) {
            throw new Error('Native removal failure');
          }
        }),
      };

      const owner = Symbol('retry_test_owner');
      CentralIpcRegistrationManager.register(
        IPC_CHANNELS.APP_PING,
        vi.fn() as any,
        owner,
        mockIpcMain,
      );

      // Attempt 1 fails natively: record retained
      expect(CentralIpcRegistrationManager.unregister(IPC_CHANNELS.APP_PING, owner)).toBe(false);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(true);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(true);

      // Attempt 2 succeeds: record released completely
      throwError = false;
      expect(CentralIpcRegistrationManager.unregister(IPC_CHANNELS.APP_PING, owner)).toBe(true);
      expect(CentralIpcRegistrationManager.isChannelRegistered(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(CentralIpcRegistrationManager.isRemovalFailed(IPC_CHANNELS.APP_PING)).toBe(false);
      expect(CentralIpcRegistrationManager.getRegistration(IPC_CHANNELS.APP_PING)).toBeUndefined();
    });
  });
});
