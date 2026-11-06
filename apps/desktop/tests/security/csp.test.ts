import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'D:\\ahmed\\apps\\desktop',
  },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: vi.fn(),
      },
    },
  },
}));

import {
  SecurityWebRequestManager,
  validateProductionRendererPath,
} from '../../src/main/security/csp.js';
import type { Session, OnHeadersReceivedListenerDetails, HeadersReceivedResponse } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

describe('SecurityWebRequestManager & CSP Enforcement', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('CSP Directives Generation', () => {
    it('generates hardened Production CSP without unsafe-eval or unsafe-inline', () => {
      const prodCsp = SecurityWebRequestManager.buildCsp(false);

      expect(prodCsp).toContain("default-src 'none'");
      expect(prodCsp).toContain("script-src 'self'");
      expect(prodCsp).toContain("style-src 'self'");
      expect(prodCsp).toContain("connect-src 'self'");
      expect(prodCsp).toContain("frame-ancestors 'none'");
      expect(prodCsp).toContain("base-uri 'none'");
      expect(prodCsp).toContain("form-action 'none'");

      // Strict prohibitions in production
      expect(prodCsp).not.toContain("'unsafe-eval'");
      expect(prodCsp).not.toContain("'unsafe-inline'");
      expect(prodCsp).not.toContain('http://');
      expect(prodCsp).not.toContain('https://');
    });

    it('generates Development CSP allowing local HMR WebSockets and dev inline styles, but prohibiting unsafe-eval', () => {
      const devCsp = SecurityWebRequestManager.buildCsp(true);

      expect(devCsp).toContain("default-src 'none'");
      expect(devCsp).toContain("script-src 'self'");
      expect(devCsp).toContain("style-src 'self' 'unsafe-inline'");
      expect(devCsp).toContain('ws://localhost:5173');
      expect(devCsp).toContain('ws://127.0.0.1:5173');
      expect(devCsp).toContain("frame-ancestors 'none'");

      // Prohibited even in development
      expect(devCsp).not.toContain("'unsafe-eval'");
    });
  });

  describe('Session Registry & Configuration Conflict', () => {
    it('allows idempotent re-initialization with identical isDev setting', () => {
      const mockSession = {
        webRequest: {
          onHeadersReceived: vi.fn(),
        },
      } as unknown as Session;

      expect(() => {
        SecurityWebRequestManager.initialize({ isDev: false, targetSession: mockSession });
        SecurityWebRequestManager.initialize({ isDev: false, targetSession: mockSession });
      }).not.toThrow();

      // Listener should be registered only once
      expect(mockSession.webRequest.onHeadersReceived).toHaveBeenCalledTimes(1);
    });

    it('throws ERR_SESSION_CONFIG_CONFLICT when re-initialized with conflicting isDev', () => {
      const mockSession = {
        webRequest: {
          onHeadersReceived: vi.fn(),
        },
      } as unknown as Session;

      SecurityWebRequestManager.initialize({ isDev: false, targetSession: mockSession });

      expect(() => {
        SecurityWebRequestManager.initialize({ isDev: true, targetSession: mockSession });
      }).toThrow(/ERR_SESSION_CONFIG_CONFLICT/);
    });
  });

  describe('Strict Renderer Origin Validation (isAppRendererOrigin)', () => {
    it('accepts strictly authorized development origins', () => {
      expect(SecurityWebRequestManager.isAppRendererOrigin('http://localhost:5173', true)).toBe(
        true,
      );
      expect(SecurityWebRequestManager.isAppRendererOrigin('http://localhost:5173/', true)).toBe(
        true,
      );
      expect(
        SecurityWebRequestManager.isAppRendererOrigin('http://localhost:5173/index.html', true),
      ).toBe(true);
      expect(SecurityWebRequestManager.isAppRendererOrigin('http://127.0.0.1:5173', true)).toBe(
        true,
      );
      expect(
        SecurityWebRequestManager.isAppRendererOrigin('http://127.0.0.1:5173/assets/main.js', true),
      ).toBe(true);
    });

    it('rejects malicious or spoofed development URLs', () => {
      // Suffix spoofing: localhost:5173.evil.com
      expect(
        SecurityWebRequestManager.isAppRendererOrigin('http://localhost:5173.evil.com', true),
      ).toBe(false);

      // Credential injection: localhost:5173@evil.com
      expect(
        SecurityWebRequestManager.isAppRendererOrigin('http://localhost:5173@evil.com', true),
      ).toBe(false);
      expect(
        SecurityWebRequestManager.isAppRendererOrigin('http://user:pass@localhost:5173', true),
      ).toBe(false);

      // Port mismatch
      expect(SecurityWebRequestManager.isAppRendererOrigin('http://localhost:3000', true)).toBe(
        false,
      );
      expect(SecurityWebRequestManager.isAppRendererOrigin('http://localhost:8080', true)).toBe(
        false,
      );

      // Protocol mismatch
      expect(SecurityWebRequestManager.isAppRendererOrigin('https://localhost:5173', true)).toBe(
        false,
      );
      expect(SecurityWebRequestManager.isAppRendererOrigin('ws://localhost:5173', true)).toBe(
        false,
      );

      // Malformed / Non-HTTP
      expect(SecurityWebRequestManager.isAppRendererOrigin('javascript:alert(1)', true)).toBe(
        false,
      );
      expect(SecurityWebRequestManager.isAppRendererOrigin('not-a-valid-url', true)).toBe(false);
    });

    it('rejects production file: URLs that do not match the expected entry point', () => {
      // Generic file URL outside application
      expect(
        SecurityWebRequestManager.isAppRendererOrigin(
          'file:///C:/Windows/notepad.exe',
          false,
          false,
        ),
      ).toBe(false);
      expect(
        SecurityWebRequestManager.isAppRendererOrigin('file:///D:/secret.json', false, false),
      ).toBe(false);

      // File URL with remote host
      expect(
        SecurityWebRequestManager.isAppRendererOrigin(
          'file://evil-host/share/index.html',
          false,
          false,
        ),
      ).toBe(false);
    });
  });

  describe('onHeadersReceived & Header Preservation', () => {
    it('preserves existing upstream CSP headers and appends application CSP', () => {
      let registeredCallback: (
        details: OnHeadersReceivedListenerDetails,
        callback: (response: HeadersReceivedResponse) => void,
      ) => void = () => {};

      const mockSession = {
        webRequest: {
          onHeadersReceived: vi.fn(cb => {
            registeredCallback = cb;
          }),
        },
      } as unknown as Session;

      SecurityWebRequestManager.initialize({ isDev: true, targetSession: mockSession });

      const details = {
        url: 'http://localhost:5173/index.html',
        resourceType: 'mainFrame',
        responseHeaders: {
          'content-security-policy': ['report-uri /csp-reports'],
          'X-Custom-Header': ['test-val'],
        },
      } as unknown as OnHeadersReceivedListenerDetails;

      let resultResponse: HeadersReceivedResponse | undefined;
      registeredCallback(details, res => {
        resultResponse = res;
      });

      expect(resultResponse).toBeDefined();
      expect(resultResponse?.cancel).toBeUndefined();

      const cspList = resultResponse?.responseHeaders?.['Content-Security-Policy'];
      expect(Array.isArray(cspList)).toBe(true);
      expect(cspList).toContain('report-uri /csp-reports'); // Upstream preserved
      expect((cspList as string[])[1]).toContain("default-src 'none'"); // App CSP appended

      expect(resultResponse?.responseHeaders?.['X-Custom-Header']).toEqual(['test-val']);
    });

    it('handles uppercase and mixed-case CSP header variations case-insensitively and accumulates multiple headers', () => {
      let registeredCallback: (
        details: OnHeadersReceivedListenerDetails,
        callback: (response: HeadersReceivedResponse) => void,
      ) => void = () => {};

      const mockSession = {
        webRequest: {
          onHeadersReceived: vi.fn(cb => {
            registeredCallback = cb;
          }),
        },
      } as unknown as Session;

      SecurityWebRequestManager.initialize({ isDev: false, targetSession: mockSession });

      // Incoming headers containing multiple case variations of CSP
      const details = {
        url: 'http://localhost:5173/index.html', // App document
        resourceType: 'mainFrame',
        responseHeaders: {
          'CONTENT-SECURITY-POLICY': ['frame-ancestors https://trusted.org'],
          'Content-Security-Policy': ['upgrade-insecure-requests', 'sandbox allow-scripts'],
          'x-frame-options': ['DENY'],
        },
      } as unknown as OnHeadersReceivedListenerDetails;

      // Mock isAppRendererOrigin to return true for this test path
      vi.spyOn(SecurityWebRequestManager, 'isAppRendererOrigin').mockReturnValueOnce(true);

      let resultResponse: HeadersReceivedResponse | undefined;
      registeredCallback(details, res => {
        resultResponse = res;
      });

      expect(resultResponse).toBeDefined();
      expect(resultResponse?.cancel).toBeUndefined();

      const responseHeaders = resultResponse?.responseHeaders;
      expect(responseHeaders).toBeDefined();

      // Only canonical 'Content-Security-Policy' should exist in merged output
      expect(responseHeaders?.['CONTENT-SECURITY-POLICY']).toBeUndefined();
      expect(responseHeaders?.['content-security-policy']).toBeUndefined();
      expect(responseHeaders?.['x-frame-options']).toEqual(['DENY']);

      const cspList = responseHeaders?.['Content-Security-Policy'] as string[];
      expect(Array.isArray(cspList)).toBe(true);
      expect(cspList).toHaveLength(4); // 1 from uppercase, 2 from mixed-case, 1 from app policy
      expect(cspList[0]).toBe('frame-ancestors https://trusted.org');
      expect(cspList[1]).toBe('upgrade-insecure-requests');
      expect(cspList[2]).toBe('sandbox allow-scripts');
      expect(cspList[3]).toContain("default-src 'none'");
    });

    it('passes non-application documents through with responseHeaders untouched', () => {
      let registeredCallback: (
        details: OnHeadersReceivedListenerDetails,
        callback: (response: HeadersReceivedResponse) => void,
      ) => void = () => {};

      const mockSession = {
        webRequest: {
          onHeadersReceived: vi.fn(cb => {
            registeredCallback = cb;
          }),
        },
      } as unknown as Session;

      SecurityWebRequestManager.initialize({ isDev: true, targetSession: mockSession });

      // Request to external website (e.g. audit target)
      const details = {
        url: 'https://wordpress.org/test',
        resourceType: 'mainFrame',
        responseHeaders: {
          'Content-Type': ['text/html'],
        },
      } as unknown as OnHeadersReceivedListenerDetails;

      let resultResponse: HeadersReceivedResponse | undefined;
      registeredCallback(details, res => {
        resultResponse = res;
      });

      expect(resultResponse?.cancel).toBeUndefined();
      expect(resultResponse?.responseHeaders).toEqual({ 'Content-Type': ['text/html'] });
    });
  });

  describe('MANDATORY FAIL-CLOSED POLICY & Production API Integrity', () => {
    it('cancels application document request (cancel: true) if CSP generation fails', () => {
      let registeredCallback: (
        details: OnHeadersReceivedListenerDetails,
        callback: (response: HeadersReceivedResponse) => void,
      ) => void = () => {};

      const mockSession = {
        webRequest: {
          onHeadersReceived: vi.fn(cb => {
            registeredCallback = cb;
          }),
        },
      } as unknown as Session;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate failure in CSP generation via standard Vitest spy
      const buildCspSpy = vi
        .spyOn(SecurityWebRequestManager, 'buildCsp')
        .mockImplementationOnce(() => {
          throw new Error('SIMULATED_CSP_COMPILATION_ERROR');
        });

      SecurityWebRequestManager.initialize({
        isDev: true,
        targetSession: mockSession,
      });

      const details = {
        url: 'http://localhost:5173/index.html',
        resourceType: 'mainFrame',
        responseHeaders: {
          'Content-Type': ['text/html'],
        },
      } as unknown as OnHeadersReceivedListenerDetails;

      let resultResponse: HeadersReceivedResponse | undefined;
      registeredCallback(details, res => {
        resultResponse = res;
      });

      // MUST CANCEL THE REQUEST - NEVER ALLOW UNPROTECTED LOAD!
      expect(resultResponse).toBeDefined();
      expect(resultResponse?.cancel).toBe(true);
      buildCspSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('cancels application document request if buildCsp returns empty or whitespace string (Fail-Closed)', () => {
      let registeredCallback: (
        details: OnHeadersReceivedListenerDetails,
        callback: (response: HeadersReceivedResponse) => void,
      ) => void = () => {};

      const mockSession = {
        webRequest: {
          onHeadersReceived: vi.fn(cb => {
            registeredCallback = cb;
          }),
        },
      } as unknown as Session;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const buildCspSpy = vi
        .spyOn(SecurityWebRequestManager, 'buildCsp')
        .mockReturnValueOnce('   ');

      SecurityWebRequestManager.initialize({
        isDev: true,
        targetSession: mockSession,
      });

      const details = {
        url: 'http://localhost:5173/index.html',
        resourceType: 'mainFrame',
        responseHeaders: {
          'Content-Type': ['text/html'],
        },
      } as unknown as OnHeadersReceivedListenerDetails;

      let resultResponse: HeadersReceivedResponse | undefined;
      registeredCallback(details, res => {
        resultResponse = res;
      });

      expect(resultResponse).toBeDefined();
      expect(resultResponse?.cancel).toBe(true);
      buildCspSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('uses static Structured Safe Logging without leaking URLs, query tokens, or raw error messages on failure', () => {
      let registeredCallback: (
        details: OnHeadersReceivedListenerDetails,
        callback: (response: HeadersReceivedResponse) => void,
      ) => void = () => {};

      const mockSession = {
        webRequest: {
          onHeadersReceived: vi.fn(cb => {
            registeredCallback = cb;
          }),
        },
      } as unknown as Session;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate failure via buildCsp throwing an error with sensitive internal details
      const buildCspSpy = vi
        .spyOn(SecurityWebRequestManager, 'buildCsp')
        .mockImplementationOnce(() => {
          throw new Error('SENSITIVE_STACK_TRACE_AND_INTERNAL_PATH_C:\\internal\\secret.ts');
        });

      SecurityWebRequestManager.initialize({
        isDev: true,
        targetSession: mockSession,
      });

      const details = {
        url: 'http://localhost:5173/index.html?secretToken=SECRET987654321&auth=priv',
        resourceType: 'mainFrame',
        responseHeaders: {
          'Content-Type': ['text/html'],
        },
      } as unknown as OnHeadersReceivedListenerDetails;

      let resultResponse: HeadersReceivedResponse | undefined;
      registeredCallback(details, res => {
        resultResponse = res;
      });

      expect(resultResponse?.cancel).toBe(true);

      // Verify exact safe structure with static token
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Security] Failed to build CSP for application document. Cancelling request (Fail-Closed).',
        {
          errorCode: 'ERR_CSP_BUILD_FAILED',
        },
      );

      // Assert that NO url, token, query parameter, or raw error message leaked into console logs
      const allLogs = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(allLogs).not.toContain('SECRET987654321');
      expect(allLogs).not.toContain('secretToken');
      expect(allLogs).not.toContain('auth=priv');
      expect(allLogs).not.toContain('SENSITIVE_STACK_TRACE');
      expect(allLogs).not.toContain('C:\\internal\\secret.ts');
      expect(allLogs).not.toContain('http://localhost:5173');

      consoleErrorSpy.mockRestore();
      buildCspSpy.mockRestore();
    });

    it('proves that SecurityWebRequestManager does NOT expose any test hooks or reset methods on production API', () => {
      const mgr = SecurityWebRequestManager as unknown as Record<string, unknown>;
      expect(mgr['_setTestCspBuilderForTesting']).toBeUndefined();
      expect(mgr['resetForTesting']).toBeUndefined();
      expect(mgr['testCspBuilderOverride']).toBeUndefined();
      expect(mgr['cspBuilderOverride']).toBeUndefined();
    });
  });

  describe('ASAR & Production Path Validation (validateProductionRendererPath)', () => {
    it('rejects paths containing app.asar.unpacked immediately', () => {
      const unpackedAsarPath = 'D:\\app\\resources\\app.asar.unpacked\\dist\\renderer\\index.html';
      expect(validateProductionRendererPath(unpackedAsarPath, true)).toBe(false);
      expect(validateProductionRendererPath(unpackedAsarPath, false)).toBe(false);
    });

    it('rejects candidate paths when physical ASAR does not exist', () => {
      const nonExistentAsarCandidate = 'C:\\fake\\resources\\app.asar\\out\\renderer\\index.html';
      expect(
        validateProductionRendererPath(nonExistentAsarCandidate, true, {
          resourcesPath: 'C:\\non-existent-directory-12345',
        }),
      ).toBe(false);
    });

    it('validates candidate against real unpacked root', () => {
      // In current workspace D:\ahmed, out/renderer/index.html was built in Phase 1.2.1
      const realBuiltRenderer = path.resolve('D:\\ahmed\\apps\\desktop\\out\\renderer\\index.html');
      if (fs.existsSync(realBuiltRenderer)) {
        const result = validateProductionRendererPath(realBuiltRenderer, false, {
          appPath: 'D:\\ahmed\\apps\\desktop',
        });
        expect(result).toBe(true);
      }
    });
  });
});
