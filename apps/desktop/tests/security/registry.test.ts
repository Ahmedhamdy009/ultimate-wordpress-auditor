import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({}));

import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import type { BrowserWindow, WebContents } from 'electron';

describe('WindowSecurityRegistry', () => {
  describe('Three-State Classification (evaluateOption)', () => {
    it('returns CONFIRMED_ACTIVE when value strictly matches required secure value', () => {
      expect(WindowSecurityRegistry.evaluateOption(true, true)).toBe('CONFIRMED_ACTIVE');
      expect(WindowSecurityRegistry.evaluateOption(false, false)).toBe('CONFIRMED_ACTIVE');
    });

    it('returns CONFIRMED_INACTIVE when value strictly contradicts required secure value', () => {
      expect(WindowSecurityRegistry.evaluateOption(false, true)).toBe('CONFIRMED_INACTIVE');
      expect(WindowSecurityRegistry.evaluateOption(true, false)).toBe('CONFIRMED_INACTIVE');
    });

    it('returns UNVERIFIABLE when value is undefined or null (never assumes safe by default)', () => {
      expect(WindowSecurityRegistry.evaluateOption(undefined, true)).toBe('UNVERIFIABLE');
      expect(WindowSecurityRegistry.evaluateOption(null, true)).toBe('UNVERIFIABLE');
      expect(WindowSecurityRegistry.evaluateOption(undefined, false)).toBe('UNVERIFIABLE');
    });
  });

  describe('Window Registration & Snapshot Creation', () => {
    it('records windowId, webContentsId, registrationToken, and exact security snapshot options', () => {
      const mockWebContents = {
        id: 101,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow = {
        id: 1,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents,
        once: vi.fn(),
      } as unknown as BrowserWindow;

      const snapshot = WindowSecurityRegistry.register(mockWindow, {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      expect(snapshot.windowId).toBe(1);
      expect(snapshot.webContentsId).toBe(101);
      expect(snapshot.createdAt).toBeGreaterThan(0);
      expect((snapshot as unknown as Record<string, unknown>)['registrationToken']).toBeUndefined();
      expect(snapshot.options.contextIsolation).toBe('CONFIRMED_ACTIVE');
      expect(snapshot.options.nodeIntegration).toBe('CONFIRMED_ACTIVE');
      expect(snapshot.options.nodeIntegrationInWorker).toBe('CONFIRMED_ACTIVE');
      expect(snapshot.options.sandbox).toBe('CONFIRMED_ACTIVE');
      expect(snapshot.options.webSecurity).toBe('CONFIRMED_ACTIVE');
      expect(snapshot.options.allowRunningInsecureContent).toBe('CONFIRMED_ACTIVE');

      expect(WindowSecurityRegistry.isSnapshotSecure(snapshot)).toBe(true);
    });

    it('enforces deep immutability on snapshot and returns defensive copies', () => {
      const mockWebContents = {
        id: 108,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow = {
        id: 8,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents,
        once: vi.fn(),
      } as unknown as BrowserWindow;

      const snapshot = WindowSecurityRegistry.register(mockWindow, {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      // Outer and inner objects must be frozen
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.options)).toBe(true);

      // Attempt to mutate options must throw TypeError in strict mode
      expect(() => {
        // @ts-expect-error mutating frozen property
        snapshot.options.nodeIntegration = 'CONFIRMED_ACTIVE';
      }).toThrow(TypeError);

      // Verify defensive copy behavior: getSnapshot returns independent frozen copies
      const copy1 = WindowSecurityRegistry.getSnapshot(108);
      const copy2 = WindowSecurityRegistry.getSnapshot(108);
      expect(copy1).toBeDefined();
      expect(copy2).toBeDefined();
      expect(copy1).not.toBe(copy2); // Different object references
      expect(copy1).toEqual(copy2); // Identical values
      expect(Object.isFrozen(copy1)).toBe(true);
      expect(Object.isFrozen(copy1!.options)).toBe(true);

      // Verify internal state cannot be modified via returned reference
      expect(() => {
        // @ts-expect-error mutating frozen top-level property
        copy1!.windowId = 999;
      }).toThrow(TypeError);
      expect(WindowSecurityRegistry.getSnapshot(108)?.windowId).toBe(8);
    });

    it('safely replaces existing registration when duplicate webContentsId is registered', () => {
      const mockWebContents = {
        id: 109,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow1 = {
        id: 91,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents,
        once: vi.fn(),
      } as unknown as BrowserWindow;

      const mockWindow2 = {
        id: 92,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents,
        once: vi.fn(),
      } as unknown as BrowserWindow;

      const snap1 = WindowSecurityRegistry.register(mockWindow1, {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      expect(snap1.windowId).toBe(91);

      // Re-register with duplicate webContentsId (109)
      const snap2 = WindowSecurityRegistry.register(mockWindow2, {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      expect(snap2.windowId).toBe(92);

      const current = WindowSecurityRegistry.getSnapshot(109);
      expect(current?.windowId).toBe(92);
    });

    it('marks snapshot as insecure if any single option is CONFIRMED_INACTIVE or UNVERIFIABLE', () => {
      const mockWebContents = {
        id: 102,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow = {
        id: 2,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents,
        once: vi.fn(),
      } as unknown as BrowserWindow;

      // Insecure configuration: nodeIntegration enabled
      const insecureSnapshot = WindowSecurityRegistry.register(mockWindow, {
        contextIsolation: true,
        nodeIntegration: true, // INSECURE
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      expect(insecureSnapshot.options.nodeIntegration).toBe('CONFIRMED_INACTIVE');
      expect(WindowSecurityRegistry.isSnapshotSecure(insecureSnapshot)).toBe(false);
    });

    it('marks snapshot as insecure if an option was omitted (UNVERIFIABLE)', () => {
      const mockWebContents = {
        id: 103,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow = {
        id: 3,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents,
        once: vi.fn(),
      } as unknown as BrowserWindow;

      // Missing sandbox and webSecurity
      const incompleteSnapshot = WindowSecurityRegistry.register(mockWindow, {
        contextIsolation: true,
        nodeIntegration: false,
      });

      expect(incompleteSnapshot.options.sandbox).toBe('UNVERIFIABLE');
      expect(WindowSecurityRegistry.isSnapshotSecure(incompleteSnapshot)).toBe(false);
    });
  });

  describe('Window Destruction & Liveness Verification', () => {
    it('automatically unregisters window when closed or webContents is destroyed', () => {
      let windowCloseCallback: () => void = () => {};
      let webContentsDestroyCallback: () => void = () => {};

      const mockWebContents = {
        id: 104,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn((event, cb) => {
          if (event === 'destroyed') webContentsDestroyCallback = cb;
        }),
      } as unknown as WebContents;

      const mockWindow = {
        id: 4,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents,
        once: vi.fn((event, cb) => {
          if (event === 'closed') windowCloseCallback = cb;
        }),
      } as unknown as BrowserWindow;

      WindowSecurityRegistry.register(mockWindow, {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      expect(WindowSecurityRegistry.getSnapshot(104)).toBeDefined();

      // Trigger window close event
      windowCloseCallback();

      expect(WindowSecurityRegistry.getSnapshot(104)).toBeUndefined();

      // Trigger webContents destroy event to verify dual-hook cleanup
      webContentsDestroyCallback();
      expect(WindowSecurityRegistry.getSnapshot(104)).toBeUndefined();
    });

    it('rejects stale records if window.isDestroyed() becomes true', () => {
      let isDestroyed = false;
      const mockWebContents = {
        id: 105,
        isDestroyed: () => isDestroyed,
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow = {
        id: 5,
        isDestroyed: () => isDestroyed,
        webContents: mockWebContents,
        once: vi.fn(),
      } as unknown as BrowserWindow;

      WindowSecurityRegistry.register(mockWindow, {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      // Window is destroyed without firing event
      isDestroyed = true;

      const verification = WindowSecurityRegistry.verifyLivenessAndSecurity(mockWebContents);
      expect(verification.isValid).toBe(false);
      expect(verification.errorCode).toBe('ERR_WEBCONTENTS_DESTROYED');
    });

    it('detects and rejects webContents to BrowserWindow mismatch', () => {
      const mockWebContents = {
        id: 106,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const differentWebContents = {
        id: 999,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow = {
        id: 6,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents, // Registered with mockWebContents (106)
        once: vi.fn(),
      } as unknown as BrowserWindow;

      WindowSecurityRegistry.register(mockWindow, {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      // Swap webContents on the window to simulate mismatch/detachment
      mockWindow.webContents = differentWebContents;

      const verification = WindowSecurityRegistry.verifyLivenessAndSecurity(mockWebContents);
      expect(verification.isValid).toBe(false);
      expect(verification.errorCode).toBe('ERR_WEBCONTENTS_WINDOW_MISMATCH');
    });

    it('prevents delayed cleanup callbacks of previous window from unregistering a newer recycled webContentsId', () => {
      let window1CloseCallback: () => void = () => {};

      const mockWebContents1 = {
        id: 301,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow1 = {
        id: 71,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents1,
        once: vi.fn((event, cb) => {
          if (event === 'closed') window1CloseCallback = cb;
        }),
      } as unknown as BrowserWindow;

      // Register first window with webContentsId 301
      WindowSecurityRegistry.register(mockWindow1, {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      // Now simulate window recycling: Window 2 is created with same recycled webContentsId 301
      const mockWebContents2 = {
        id: 301,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow2 = {
        id: 72,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents2,
        once: vi.fn(),
      } as unknown as BrowserWindow;

      WindowSecurityRegistry.register(mockWindow2, {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      // Window 2 is active
      expect(WindowSecurityRegistry.getSnapshot(301)?.windowId).toBe(72);

      // Delayed close callback from Window 1 arrives now
      window1CloseCallback();

      // Window 2 registration MUST NOT be deleted because token does not match Window 1's token
      const snapshotAfterStaleCleanup = WindowSecurityRegistry.getSnapshot(301);
      expect(snapshotAfterStaleCleanup).toBeDefined();
      expect(snapshotAfterStaleCleanup?.windowId).toBe(72);
    });
  });

  describe('Production API Integrity & Encapsulation', () => {
    it('proves that unregister and clear are NOT exposed on public WindowSecurityRegistry interface', () => {
      const reg = WindowSecurityRegistry as unknown as Record<string, unknown>;
      expect(reg['unregister']).toBeUndefined();
      expect(reg['clear']).toBeUndefined();
    });

    it('proves that WindowSecuritySnapshot does not expose internal registrationToken to callers', () => {
      const mockWebContents = {
        id: 110,
        isDestroyed: vi.fn().mockReturnValue(false),
        once: vi.fn(),
      } as unknown as WebContents;

      const mockWindow = {
        id: 10,
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: mockWebContents,
        once: vi.fn(),
      } as unknown as BrowserWindow;

      const snapshot = WindowSecurityRegistry.register(mockWindow, {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });

      const retrievedSnapshot = WindowSecurityRegistry.getSnapshot(110);
      expect((snapshot as unknown as Record<string, unknown>)['registrationToken']).toBeUndefined();
      expect(
        (retrievedSnapshot as unknown as Record<string, unknown>)['registrationToken'],
      ).toBeUndefined();
    });
  });
});
