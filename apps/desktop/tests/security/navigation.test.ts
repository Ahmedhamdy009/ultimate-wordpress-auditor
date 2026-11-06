import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

import { validateExternalUrl, attachNavigationGuards } from '../../src/main/security/navigation.js';
import type { BrowserWindow, WebContents } from 'electron';

describe('NavigationGuard & External URL Validation', () => {
  describe('External URL Validation (validateExternalUrl)', () => {
    it('accepts strictly allowlisted HTTPS domains', () => {
      expect(validateExternalUrl('https://wordpress.org').valid).toBe(true);
      expect(
        validateExternalUrl('https://developer.wordpress.org/reference/functions/').valid,
      ).toBe(true);
      expect(validateExternalUrl('https://make.wordpress.org/core/').valid).toBe(true);
      expect(validateExternalUrl('https://github.com/WordPress/WordPress').valid).toBe(true);
    });

    it('rejects non-HTTPS protocols (http, javascript, data, file, blob)', () => {
      expect(validateExternalUrl('http://wordpress.org').valid).toBe(false);
      expect(validateExternalUrl('http://wordpress.org').reason).toBe('ERR_NON_HTTPS_PROTOCOL');

      expect(validateExternalUrl('javascript:alert(document.cookie)').valid).toBe(false);
      expect(validateExternalUrl('javascript:alert(document.cookie)').reason).toBe(
        'ERR_NON_HTTPS_PROTOCOL',
      );

      expect(validateExternalUrl('data:text/html,<h1>Malicious</h1>').valid).toBe(false);
      expect(validateExternalUrl('file:///C:/Windows/System32/cmd.exe').valid).toBe(false);
      expect(validateExternalUrl('blob:https://wordpress.org/uuid').valid).toBe(false);
    });

    it('rejects embedded credentials (user:pass@host)', () => {
      const res = validateExternalUrl('https://admin:secret123@wordpress.org/wp-login.php');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('ERR_EMBEDDED_CREDENTIALS');
    });

    it('rejects non-standard ports (must be empty or 443)', () => {
      const res = validateExternalUrl('https://wordpress.org:8443/test');
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('ERR_NON_STANDARD_PORT');

      // Explicit 443 is valid standard port
      expect(validateExternalUrl('https://wordpress.org:443/test').valid).toBe(true);
    });

    it('rejects unauthorized external hosts outside the allowlist', () => {
      expect(validateExternalUrl('https://evil.com').valid).toBe(false);
      expect(validateExternalUrl('https://evil.com').reason).toBe('ERR_HOST_NOT_ALLOWED');

      expect(validateExternalUrl('https://google.com').valid).toBe(false);
      expect(validateExternalUrl('https://wordpress.org.evil.com').valid).toBe(false);
    });

    it('rejects control characters or invalid URLs', () => {
      expect(validateExternalUrl('https://wordpress.org/\u0000admin').valid).toBe(false);
      expect(validateExternalUrl('').valid).toBe(false);
      expect(validateExternalUrl('not-a-valid-url').valid).toBe(false);
    });
  });

  describe('Navigation Guards Attachment (attachNavigationGuards)', () => {
    it('blocks unauthorized document navigation via will-navigate (preventDefault)', () => {
      let willNavigateHandler:
        ((event: { preventDefault: () => void }, url: string) => void) | undefined;

      const mockWebContents = {
        isDestroyed: vi.fn().mockReturnValue(false),
        on: vi.fn((event, cb) => {
          if (event === 'will-navigate') willNavigateHandler = cb;
        }),
        setWindowOpenHandler: vi.fn(),
      } as unknown as WebContents;

      const mockWindow = {
        id: 1,
        webContents: mockWebContents,
      } as unknown as BrowserWindow;

      attachNavigationGuards(mockWindow, { isDev: true });

      expect(willNavigateHandler).toBeDefined();

      const preventDefaultSpy = vi.fn();
      willNavigateHandler!(
        { preventDefault: preventDefaultSpy },
        'https://unauthorized-navigation.com',
      );

      expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    });

    it('intercepts window.open attempts: always returns action: deny, and safely dispatches allowlisted URLs', async () => {
      let windowOpenHandler: (({ url }: { url: string }) => { action: string }) | undefined;

      const mockWebContents = {
        isDestroyed: vi.fn().mockReturnValue(false),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(cb => {
          windowOpenHandler = cb;
        }),
      } as unknown as WebContents;

      const mockWindow = {
        id: 2,
        webContents: mockWebContents,
      } as unknown as BrowserWindow;

      const externalOpenSpy = vi.fn().mockResolvedValue(undefined);

      attachNavigationGuards(mockWindow, {
        isDev: true,
        onExternalOpen: externalOpenSpy,
      });

      expect(windowOpenHandler).toBeDefined();

      // Case 1: Allowlisted URL -> returns { action: 'deny' } and dispatches to external browser
      const allowlistedResult = windowOpenHandler!({ url: 'https://developer.wordpress.org' });
      expect(allowlistedResult).toEqual({ action: 'deny' });
      expect(externalOpenSpy).toHaveBeenCalledWith('https://developer.wordpress.org/');

      // Case 2: Untrusted URL -> returns { action: 'deny' } and DOES NOT dispatch
      externalOpenSpy.mockClear();
      const untrustedResult = windowOpenHandler!({ url: 'https://evil.com/phishing' });
      expect(untrustedResult).toEqual({ action: 'deny' });
      expect(externalOpenSpy).not.toHaveBeenCalled();
    });

    it('safely handles synchronous exceptions in onExternalOpen without crashing', () => {
      let windowOpenHandler: (({ url }: { url: string }) => { action: string }) | undefined;

      const mockWebContents = {
        isDestroyed: vi.fn().mockReturnValue(false),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(cb => {
          windowOpenHandler = cb;
        }),
      } as unknown as WebContents;

      const mockWindow = {
        id: 3,
        webContents: mockWebContents,
      } as unknown as BrowserWindow;

      const throwingOpenFn = vi.fn(() => {
        throw new Error('SIMULATED_SYNC_ERROR');
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      attachNavigationGuards(mockWindow, {
        isDev: true,
        onExternalOpen: throwingOpenFn as unknown as (url: string) => Promise<void>,
      });

      expect(() => {
        const result = windowOpenHandler!({ url: 'https://developer.wordpress.org' });
        expect(result).toEqual({ action: 'deny' });
      }).not.toThrow();

      expect(throwingOpenFn).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[NavigationGuard] Synchronous exception while opening external URL:',
        expect.objectContaining({
          windowId: 3,
          errorCode: 'Error',
        }),
      );

      consoleErrorSpy.mockRestore();
    });

    it('logs structured metadata without raw URL query parameters on navigation blockage', () => {
      let willNavigateHandler:
        ((event: { preventDefault: () => void }, url: string) => void) | undefined;
      let windowOpenHandler: (({ url }: { url: string }) => { action: string }) | undefined;

      const mockWebContents = {
        isDestroyed: vi.fn().mockReturnValue(false),
        on: vi.fn((event, cb) => {
          if (event === 'will-navigate') willNavigateHandler = cb;
        }),
        setWindowOpenHandler: vi.fn(cb => {
          windowOpenHandler = cb;
        }),
      } as unknown as WebContents;

      const mockWindow = {
        id: 4,
        webContents: mockWebContents,
      } as unknown as BrowserWindow;

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      attachNavigationGuards(mockWindow, { isDev: true });

      // 1. Check will-navigate safe structured logging
      willNavigateHandler!(
        { preventDefault: vi.fn() },
        'https://attacker.org:8443/steal?token=secret123&session=priv',
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[NavigationGuard] Blocked unauthorized will-navigate attempt:',
        {
          windowId: 4,
          protocol: 'https:',
          hostname: 'attacker.org',
          port: '8443',
          reason: 'UNAUTHORIZED_DOCUMENT_NAVIGATION',
        },
      );

      // Verify no sensitive token or private query leaked in logging arguments
      const willNavigateLogCall = consoleWarnSpy.mock.calls[0][1];
      expect(JSON.stringify(willNavigateLogCall)).not.toContain('secret123');
      expect(JSON.stringify(willNavigateLogCall)).not.toContain('/steal');

      // 2. Check windowOpen safe structured logging
      consoleWarnSpy.mockClear();
      windowOpenHandler!({ url: 'https://unauthorized-domain.com/secret-path?auth=token999' });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[NavigationGuard] Blocked untrusted external window opening:',
        {
          windowId: 4,
          protocol: 'https:',
          hostname: 'unauthorized-domain.com',
          port: undefined,
          reason: 'ERR_HOST_NOT_ALLOWED',
        },
      );

      const windowOpenLogCall = consoleWarnSpy.mock.calls[0][1];
      expect(JSON.stringify(windowOpenLogCall)).not.toContain('token999');
      expect(JSON.stringify(windowOpenLogCall)).not.toContain('/secret-path');

      consoleWarnSpy.mockRestore();
    });
  });
});
