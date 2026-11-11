import { describe, it, expect, beforeEach } from 'vitest';
import {
  discoverBrowser,
  clearBrowserDiscoveryCache,
  findExecutableForType,
  getStandardBrowserPaths,
} from '../../src/main/browser/discovery.js';
import { BROWSER_ERROR_CODES } from '../../src/main/browser/types.js';
import { BrowserError } from '../../src/main/browser/errors.js';

describe('Browser Discovery & Compatibility Suite', () => {
  beforeEach(() => {
    clearBrowserDiscoveryCache();
  });

  it('provides platform-specific standard paths for Edge and Chrome', () => {
    const paths = getStandardBrowserPaths();
    expect(paths).toBeDefined();
    expect(Array.isArray(paths.msedge)).toBe(true);
    expect(Array.isArray(paths.chrome)).toBe(true);

    const edgeExecutable = findExecutableForType('msedge');
    expect(typeof edgeExecutable === 'string' || edgeExecutable === undefined).toBe(true);
  });

  it('successfully discovers and validates an installed system browser', async () => {
    const browser = await discoverBrowser({ timeoutMs: 8000 });

    expect(browser).toBeDefined();
    expect(['msedge', 'chrome', 'custom']).toContain(browser.type);
    expect(browser.version).toBeTruthy();
    expect(browser.displayName).toBeTruthy();
  }, 15000);

  it('respects in-memory discovery caching unless bypassCache is requested', async () => {
    const first = await discoverBrowser({ timeoutMs: 8000 });
    const second = await discoverBrowser({ timeoutMs: 8000 });

    // Exact reference equality due to cache
    expect(second).toBe(first);

    // Bypass cache returns fresh discovery
    const third = await discoverBrowser({ bypassCache: true, timeoutMs: 8000 });
    expect(third.version).toBe(first.version);
    expect(third).not.toBe(first);
  }, 15000);

  it('respects preferredOrder priority (msedge first, then chrome)', async () => {
    const edge = await discoverBrowser({
      preferredOrder: ['msedge'],
      timeoutMs: 8000,
      bypassCache: true,
    });
    expect(edge.type).toBe('msedge');
    expect(edge.displayName).toBe('Microsoft Edge');

    const chrome = await discoverBrowser({
      preferredOrder: ['chrome'],
      timeoutMs: 8000,
      bypassCache: true,
    });
    expect(chrome.type).toBe('chrome');
    expect(chrome.displayName).toBe('Google Chrome');
  }, 20000);

  it('rejects custom executable path if file does not exist', async () => {
    const nonExistentPath = 'D:\\non_existent_folder\\fake_browser.exe';

    await expect(discoverBrowser({ customExecutablePath: nonExistentPath })).rejects.toThrowError(
      BrowserError,
    );

    try {
      await discoverBrowser({ customExecutablePath: nonExistentPath });
    } catch (err) {
      const bErr = err as BrowserError;
      expect(bErr.code).toBe(BROWSER_ERROR_CODES.ERR_NO_SUPPORTED_BROWSER_FOUND);
      expect(bErr.message).toContain('Custom browser executable not found');
    }
  });

  it('fails closed when candidate list contains only invalid items', async () => {
    const invalidCandidates = [
      {
        type: 'custom' as const,
        name: 'ghost1',
        displayName: 'Ghost Browser 1',
        executablePath: 'C:\\fake_path_123.exe',
      },
      {
        type: 'custom' as const,
        name: 'ghost2',
        displayName: 'Ghost Browser 2',
        executablePath: 'C:\\fake_path_456.exe',
      },
    ];

    await expect(
      discoverBrowser({
        customCandidates: invalidCandidates,
        bypassCache: true,
      }),
    ).rejects.toThrowError(BrowserError);

    try {
      await discoverBrowser({
        customCandidates: invalidCandidates,
        bypassCache: true,
      });
    } catch (err) {
      const bErr = err as BrowserError;
      expect(bErr.code).toBe(BROWSER_ERROR_CODES.ERR_NO_SUPPORTED_BROWSER_FOUND);
    }
  });
});
