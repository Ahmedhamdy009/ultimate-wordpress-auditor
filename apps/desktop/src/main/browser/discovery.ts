import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import {
  BROWSER_ERROR_CODES,
  type BrowserCandidate,
  type BrowserDiscoveryOptions,
  type BrowserType,
  type DiscoveredBrowserInfo,
} from './types.js';
import { BrowserError } from './errors.js';

let cachedBrowserInfo: DiscoveredBrowserInfo | null = null;

/**
 * Returns standard platform-specific executable locations for Edge and Chrome.
 */
export function getStandardBrowserPaths(): Record<BrowserType, string[]> {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  if (isWindows) {
    return {
      msedge: [
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ],
      chrome: [
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
      custom: [],
      auto: [],
    };
  }

  if (isMac) {
    return {
      msedge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      custom: [],
      auto: [],
    };
  }

  if (isLinux) {
    return {
      msedge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
      chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
      custom: [],
      auto: [],
    };
  }

  return { msedge: [], chrome: [], custom: [], auto: [] };
}

/**
 * Finds the first existing filesystem executable path for a given browser type.
 */
export function findExecutableForType(type: BrowserType): string | undefined {
  const standardPaths = getStandardBrowserPaths();
  const candidates = standardPaths[type] || [];
  for (const candidatePath of candidates) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return undefined;
}

/**
 * Verifies that a browser candidate can be launched headlessly, extracts its version,
 * and ensures it shuts down cleanly within the timeout window.
 */
export async function verifyBrowserLaunch(
  candidate: BrowserCandidate,
  timeoutMs = 5000,
): Promise<DiscoveredBrowserInfo> {
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    timeout: timeoutMs,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  if (candidate.executablePath) {
    launchOptions.executablePath = candidate.executablePath;
  } else if (candidate.channel) {
    launchOptions.channel = candidate.channel;
  }

  let browser;
  try {
    browser = await chromium.launch(launchOptions);
    const version = browser.version();
    await browser.close();

    return {
      type: candidate.type,
      name: candidate.name,
      displayName: candidate.displayName,
      version,
      executablePath: candidate.executablePath || candidate.channel || 'unknown',
      channel: candidate.channel,
    };
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors during recovery
      }
    }
    throw new BrowserError(
      BROWSER_ERROR_CODES.ERR_BROWSER_LAUNCH_FAILED,
      `Failed to launch browser candidate '${candidate.displayName}': ${err instanceof Error ? err.message : String(err)}`,
      { candidate, originalError: String(err) },
    );
  }
}

/**
 * Discovers and validates an available system browser following the preferred order.
 * Priority 1: Microsoft Edge.
 * Priority 2: Google Chrome.
 */
export async function discoverBrowser(
  options: BrowserDiscoveryOptions = {},
): Promise<DiscoveredBrowserInfo> {
  if (!options.bypassCache && cachedBrowserInfo) {
    return cachedBrowserInfo;
  }

  // 1. Custom executable path specified
  if (options.customExecutablePath) {
    if (!fs.existsSync(options.customExecutablePath)) {
      throw new BrowserError(
        BROWSER_ERROR_CODES.ERR_NO_SUPPORTED_BROWSER_FOUND,
        `Custom browser executable not found at path: ${options.customExecutablePath}`,
        { path: options.customExecutablePath },
      );
    }
    const customCandidate: BrowserCandidate = {
      type: 'custom',
      name: 'custom',
      displayName: `Custom Browser (${path.basename(options.customExecutablePath)})`,
      executablePath: options.customExecutablePath,
    };
    const verified = await verifyBrowserLaunch(customCandidate, options.timeoutMs);
    cachedBrowserInfo = verified;
    return verified;
  }

  // 2. Custom candidate list specified (e.g. for testing)
  if (options.customCandidates && options.customCandidates.length > 0) {
    const errors: Record<string, string> = {};
    for (const candidate of options.customCandidates) {
      try {
        const verified = await verifyBrowserLaunch(candidate, options.timeoutMs);
        cachedBrowserInfo = verified;
        return verified;
      } catch (err) {
        errors[candidate.name] = err instanceof Error ? err.message : String(err);
      }
    }
    throw new BrowserError(
      BROWSER_ERROR_CODES.ERR_NO_SUPPORTED_BROWSER_FOUND,
      'No supported browser could be launched from the provided custom candidate list.',
      { errors },
    );
  }

  // 3. Default priority order: Microsoft Edge, then Google Chrome
  const order: readonly BrowserType[] = options.preferredOrder ?? ['msedge', 'chrome'];
  const candidates: BrowserCandidate[] = [];

  for (const type of order) {
    if (type === 'msedge') {
      const execPath = findExecutableForType('msedge');
      candidates.push({
        type: 'msedge',
        name: 'msedge',
        displayName: 'Microsoft Edge',
        executablePath: execPath,
        channel: 'msedge',
      });
    } else if (type === 'chrome') {
      const execPath = findExecutableForType('chrome');
      candidates.push({
        type: 'chrome',
        name: 'chrome',
        displayName: 'Google Chrome',
        executablePath: execPath,
        channel: 'chrome',
      });
    }
  }

  const errors: Record<string, string> = {};
  for (const candidate of candidates) {
    try {
      const verified = await verifyBrowserLaunch(candidate, options.timeoutMs);
      cachedBrowserInfo = verified;
      return verified;
    } catch (err) {
      errors[candidate.displayName] = err instanceof Error ? err.message : String(err);
    }
  }

  throw new BrowserError(
    BROWSER_ERROR_CODES.ERR_NO_SUPPORTED_BROWSER_FOUND,
    'No supported system browser (Microsoft Edge or Google Chrome) was found on this system.',
    { checkedCandidates: candidates.map(c => c.displayName), errors },
  );
}

/**
 * Resets the in-memory browser discovery cache (useful for testing).
 */
export function clearBrowserDiscoveryCache(): void {
  cachedBrowserInfo = null;
}
