/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { SenderGuard } from '../../src/main/ipc/guard.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { SecurityWebRequestManager } from '../../src/main/security/csp.js';

describe('Hardened Sender Guard (SenderGuard.validateSender)', () => {
  const createMockSenderEnvironment = (options?: {
    webContentsId?: number;
    windowId?: number;
    url?: string;
    isMainFrame?: boolean;
    hasParent?: boolean;
    isWebContentsDestroyed?: boolean;
    isWindowDestroyed?: boolean;
    windowMismatch?: boolean;
    insecureOptions?: boolean;
    customWebPreferences?: Electron.WebPreferences;
    skipRegistration?: boolean;
    session?: any;
    skipSessionRegistration?: boolean;
    isDevSession?: boolean;
  }) => {
    const webContentsId = options?.webContentsId ?? 201;
    const windowId = options?.windowId ?? 10;
    const url = options?.url ?? 'http://localhost:5173';

    let isWcDestroyed = false;
    let isWinDestroyed = false;

    const mockMainFrame = {
      url,
      parent: options?.hasParent ? ({} as any) : null,
    };

    const mockSenderFrame = options?.isMainFrame === false ? { url, parent: null } : mockMainFrame;

    const mockSession =
      options?.session !== undefined
        ? options.session
        : {
            webRequest: { onHeadersReceived: vi.fn() },
          };

    if (mockSession && !options?.skipSessionRegistration) {
      const isDev = options?.isDevSession ?? true;
      try {
        SecurityWebRequestManager.initialize({ isDev, targetSession: mockSession });
      } catch {
        // Safe if already initialized
      }
    }

    const mockWebContents: any = {
      id: webContentsId,
      isDestroyed: vi.fn(() => isWcDestroyed),
      mainFrame: mockMainFrame,
      once: vi.fn(),
      session: mockSession,
    };

    const mockWindow: any = {
      id: windowId,
      isDestroyed: vi.fn(() => isWinDestroyed),
      webContents: mockWebContents,
      once: vi.fn(),
    };

    if (!options?.skipRegistration) {
      const prefs = options?.customWebPreferences ?? {
        contextIsolation: !options?.insecureOptions,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      };
      WindowSecurityRegistry.register(mockWindow, prefs);
    }

    if (options?.isWebContentsDestroyed) {
      isWcDestroyed = true;
    }
    if (options?.isWindowDestroyed) {
      isWinDestroyed = true;
    }
    if (options?.windowMismatch) {
      mockWindow.webContents = {
        id: 9999,
        isDestroyed: vi.fn(() => false),
      };
    }

    const mockEvent: IpcMainInvokeEvent = {
      sender: mockWebContents as WebContents,
      senderFrame: mockSenderFrame as any,
      frameId: 1,
      processId: 1000,
    };

    return {
      mockEvent,
      mockWebContents,
      mockWindow,
      destroyWebContents: () => {
        isWcDestroyed = true;
      },
      destroyWindow: () => {
        isWinDestroyed = true;
      },
    };
  };

  describe('Sender Identity & Frame Verification', () => {
    it('rejects invocation when event or sender is missing', () => {
      const resNull = SenderGuard.validateSender(null as any);
      expect(resNull.isValid).toBe(false);
      expect(resNull.error.code).toBe('ERR_UNAUTHORIZED_SENDER');

      const resNoSender = SenderGuard.validateSender({ sender: null } as any);
      expect(resNoSender.isValid).toBe(false);
      expect(resNoSender.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when sender WebContents is destroyed', () => {
      const { mockEvent, destroyWebContents } = createMockSenderEnvironment({
        isWebContentsDestroyed: true,
      });
      destroyWebContents();
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when senderFrame is missing', () => {
      const { mockEvent } = createMockSenderEnvironment();
      (mockEvent as any).senderFrame = null;
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects subframe invocation where senderFrame !== sender.mainFrame', () => {
      const { mockEvent } = createMockSenderEnvironment({ isMainFrame: false });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when senderFrame has a parent frame (nested frame)', () => {
      const { mockEvent } = createMockSenderEnvironment({ hasParent: true });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });
  });

  describe('Window Security Registry Verification', () => {
    it('rejects invocation from unregistered WebContents', () => {
      const { mockEvent } = createMockSenderEnvironment({ skipRegistration: true });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when registered BrowserWindow was destroyed', () => {
      const { mockEvent, destroyWindow } = createMockSenderEnvironment();
      destroyWindow();
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when BrowserWindow webContents does not match sender', () => {
      const { mockEvent } = createMockSenderEnvironment({ windowMismatch: true });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when window security snapshot is insecure (contextIsolation false)', () => {
      const { mockEvent } = createMockSenderEnvironment({ insecureOptions: true });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when nodeIntegration is true', () => {
      const { mockEvent } = createMockSenderEnvironment({
        customWebPreferences: {
          contextIsolation: true,
          nodeIntegration: true as any,
          nodeIntegrationInWorker: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when nodeIntegrationInWorker is true', () => {
      const { mockEvent } = createMockSenderEnvironment({
        customWebPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: true as any,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when sandbox is false', () => {
      const { mockEvent } = createMockSenderEnvironment({
        customWebPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          sandbox: false as any,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when webSecurity is false', () => {
      const { mockEvent } = createMockSenderEnvironment({
        customWebPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          sandbox: true,
          webSecurity: false as any,
          allowRunningInsecureContent: false,
        },
      });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when allowRunningInsecureContent is true', () => {
      const { mockEvent } = createMockSenderEnvironment({
        customWebPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: true as any,
        },
      });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invocation when any security setting is missing/unverifiable (undefined)', () => {
      const { mockEvent } = createMockSenderEnvironment({
        customWebPreferences: {
          contextIsolation: true,
          // nodeIntegration missing -> UNVERIFIABLE
          nodeIntegrationInWorker: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        } as any,
      });
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });
  });

  describe('Trusted Development/Production Session State Verification', () => {
    it('rejects invocation when WebContents session is not registered (Fail-Closed)', () => {
      const { mockEvent } = createMockSenderEnvironment({
        skipSessionRegistration: true,
      });

      // Production path: no allowUnregisteredSessionForTesting
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('regression: production validateSender rejects unregistered session even if an unsafe configuration attempts to enable test bypass', () => {
      const { mockEvent } = createMockSenderEnvironment({
        skipSessionRegistration: true,
      });

      // Production entry point called with attempt to pass bypass flags in options
      const unsafeOptions = {
        allowUnregisteredSessionForTesting: true,
        bypassSessionCheck: true,
        isDev: true,
      } as any;

      const res = SenderGuard.validateSender(mockEvent, unsafeOptions);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
      expect(res.error.message).toContain('not registered');
    });

    it('regression: no production-exported API or token exists to bypass Session registration', () => {
      expect((SenderGuard as any).validateSenderForTesting).toBeUndefined();
      expect((SenderGuard as any).TEST_FIXTURE_BYPASS_TOKEN).toBeUndefined();
      expect((SenderGuard as any).allowUnregisteredSessionForTesting).toBeUndefined();

      // Only validateSender exists as an own method
      const ownProps = Object.getOwnPropertyNames(SenderGuard);
      expect(ownProps).toContain('validateSender');
      expect(ownProps).not.toContain('validateSenderForTesting');
    });

    it('dev/prod Sessions are accepted only with corresponding trusted origins', () => {
      // 1. Development Session with Dev origin: approved
      const devSession: any = { webRequest: { onHeadersReceived: vi.fn() } };
      SecurityWebRequestManager.initialize({ isDev: true, targetSession: devSession });
      const devEnv = createMockSenderEnvironment({
        url: 'http://localhost:5173',
        session: devSession,
      });
      const devRes = SenderGuard.validateSender(devEnv.mockEvent);
      expect(devRes.isValid).toBe(true);

      // 2. Development Session with external origin: rejected
      const devUntrustedEnv = createMockSenderEnvironment({
        url: 'https://attacker.com',
        session: devSession,
      });
      const devUntrustedRes = SenderGuard.validateSender(devUntrustedEnv.mockEvent);
      expect(devUntrustedRes.isValid).toBe(false);
      expect(devUntrustedRes.error.code).toBe('ERR_UNAUTHORIZED_SENDER');

      // 3. Production Session with Dev origin: rejected
      const prodSession: any = { webRequest: { onHeadersReceived: vi.fn() } };
      SecurityWebRequestManager.initialize({ isDev: false, targetSession: prodSession });
      const prodWithDevUrlEnv = createMockSenderEnvironment({
        url: 'http://localhost:5173',
        session: prodSession,
      });
      const prodDevRes = SenderGuard.validateSender(prodWithDevUrlEnv.mockEvent);
      expect(prodDevRes.isValid).toBe(false);
      expect(prodDevRes.error.code).toBe('ERR_UNAUTHORIZED_SENDER');

      // 4. Production Session with approved production origin: approved
      const prodEnv = createMockSenderEnvironment({
        url: 'file:///D:/ahmed/out/renderer/index.html',
        session: prodSession,
      });
      // Mock origin validator for production file path to simulate matching build artifact
      const originSpy = vi
        .spyOn(SecurityWebRequestManager, 'isAppRendererOrigin')
        .mockReturnValueOnce(true);
      const prodRes = SenderGuard.validateSender(prodEnv.mockEvent);
      expect(prodRes.isValid).toBe(true);
      originSpy.mockRestore();
    });

    it('uses trusted isDev from registered session when present', () => {
      const mockSession: any = {
        webRequest: { onHeadersReceived: vi.fn() },
      };
      SecurityWebRequestManager.initialize({ isDev: true, targetSession: mockSession });

      const { mockEvent } = createMockSenderEnvironment({
        url: 'http://localhost:5173',
        session: mockSession,
      });

      // No options passed -> automatically picks isDev=true from sessionConfig
      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(true);
    });

    it('accepts registered production Session and rejects development HTTP origin in production mode', () => {
      const mockSession: any = {
        webRequest: { onHeadersReceived: vi.fn() },
      };
      SecurityWebRequestManager.initialize({ isDev: false, targetSession: mockSession });

      const { mockEvent } = createMockSenderEnvironment({
        url: 'http://localhost:5173',
        session: mockSession,
      });

      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects production file URL when session is registered in development mode', () => {
      const mockSession: any = {
        webRequest: { onHeadersReceived: vi.fn() },
      };
      SecurityWebRequestManager.initialize({ isDev: true, targetSession: mockSession });

      const { mockEvent } = createMockSenderEnvironment({
        url: 'file:///D:/ahmed/out/renderer/index.html',
        session: mockSession,
      });

      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects conflicting environment trust between session and dispatcher options', () => {
      const mockSession: any = {
        webRequest: { onHeadersReceived: vi.fn() },
      };
      SecurityWebRequestManager.initialize({ isDev: true, targetSession: mockSession });

      const { mockEvent } = createMockSenderEnvironment({
        url: 'http://localhost:5173',
        session: mockSession,
      });

      // Conflict: session is isDev=true, but options specifies isDev=false
      const res = SenderGuard.validateSender(mockEvent, { isDev: false });
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('ensures Renderer cannot override environment trust via event properties', () => {
      const mockSession: any = {
        webRequest: { onHeadersReceived: vi.fn() },
      };
      SecurityWebRequestManager.initialize({ isDev: false, targetSession: mockSession });

      const { mockEvent } = createMockSenderEnvironment({
        url: 'http://localhost:5173',
        session: mockSession,
      });

      // Malicious renderer attempts to spoof isDev on the event object
      (mockEvent as any).isDev = true;
      (mockEvent as any).environment = 'development';

      const res = SenderGuard.validateSender(mockEvent);
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });
  });

  describe('Renderer Origin Validation', () => {
    it('approves trusted development origin (http://localhost:5173)', () => {
      const { mockEvent } = createMockSenderEnvironment({
        url: 'http://localhost:5173',
      });
      const res = SenderGuard.validateSender(mockEvent, { isDev: true });
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.webContents).toBe(mockEvent.sender);
        expect(res.frame).toBe(mockEvent.senderFrame);
      }
    });

    it('approves trusted development origin with 127.0.0.1 (http://127.0.0.1:5173)', () => {
      const { mockEvent } = createMockSenderEnvironment({
        url: 'http://127.0.0.1:5173',
      });
      const res = SenderGuard.validateSender(mockEvent, { isDev: true });
      expect(res.isValid).toBe(true);
    });

    it('rejects development origin with wrong port (e.g. 3000)', () => {
      const { mockEvent } = createMockSenderEnvironment({
        url: 'http://localhost:3000',
      });
      const res = SenderGuard.validateSender(mockEvent, { isDev: true });
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects development origin with HTTPS or non-HTTP protocol', () => {
      const { mockEvent } = createMockSenderEnvironment({
        url: 'https://localhost:5173',
      });
      const res = SenderGuard.validateSender(mockEvent, { isDev: true });
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects development origin with embedded user credentials', () => {
      const { mockEvent } = createMockSenderEnvironment({
        url: 'http://admin:secret@localhost:5173',
      });
      const res = SenderGuard.validateSender(mockEvent, { isDev: true });
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects untrusted external web origins', () => {
      const { mockEvent } = createMockSenderEnvironment({
        url: 'https://evil-attacker.com/malicious.html',
      });
      const res = SenderGuard.validateSender(mockEvent, { isDev: true });
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });

    it('rejects invalid or unparseable URLs safely without crashing', () => {
      const { mockEvent } = createMockSenderEnvironment({
        url: 'not-a-valid-url:::###',
      });
      const res = SenderGuard.validateSender(mockEvent, { isDev: true });
      expect(res.isValid).toBe(false);
      expect(res.error.code).toBe('ERR_UNAUTHORIZED_SENDER');
    });
  });
});
