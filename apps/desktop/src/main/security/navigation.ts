import { shell, type BrowserWindow } from 'electron';

/**
 * Strict allowlist of domains permitted to be opened in external system browser.
 * Only official WordPress documentation, plugin directory, and application documentation domains.
 */
export const ALLOWED_EXTERNAL_HOSTS = new Set([
  'wordpress.org',
  'developer.wordpress.org',
  'make.wordpress.org',
  'learn.wordpress.org',
  'github.com',
]);

export interface ExternalUrlValidationResult {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
}

/**
 * Validates an external URL before dispatching to the OS default browser.
 */
export function validateExternalUrl(urlStr: string): ExternalUrlValidationResult {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, reason: 'ERR_EMPTY_URL' };
  }

  // Reject control characters or unprintable characters
  for (let i = 0; i < urlStr.length; i++) {
    const code = urlStr.charCodeAt(i);
    if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159)) {
      return { valid: false, reason: 'ERR_CONTROL_CHARS' };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: 'ERR_INVALID_URL_SYNTAX' };
  }

  // 1. Protocol: HTTPS only. Reject http, javascript, data, file, etc.
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'ERR_NON_HTTPS_PROTOCOL' };
  }

  // 2. Reject embedded credentials (user:pass@host)
  if (parsed.username !== '' || parsed.password !== '') {
    return { valid: false, reason: 'ERR_EMBEDDED_CREDENTIALS' };
  }

  // 3. Port: Must be empty or default HTTPS port 443
  if (parsed.port !== '' && parsed.port !== '443') {
    return { valid: false, reason: 'ERR_NON_STANDARD_PORT' };
  }

  // 4. Hostname validation against strict exact allowlist
  const hostname = parsed.hostname.toLowerCase();
  const isAllowedHost = ALLOWED_EXTERNAL_HOSTS.has(hostname);

  if (!isAllowedHost) {
    return { valid: false, reason: 'ERR_HOST_NOT_ALLOWED' };
  }

  return { valid: true, normalizedUrl: parsed.href };
}

export interface NavigationGuardOptions {
  isDev: boolean;
  onExternalOpen?: (url: string) => Promise<void>; // Injected hook or default shell.openExternal
}

/**
 * Extracts safe URL metadata for structured logging without leaking query parameters, tokens, or private paths.
 */
function extractSafeUrlMetadata(urlStr: string): {
  protocol?: string;
  hostname?: string;
  port?: string;
} {
  try {
    const parsed = new URL(urlStr);
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
    };
  } catch {
    return {
      protocol: 'unparseable',
    };
  }
}

/**
 * Attaches navigation guards to a BrowserWindow instance:
 * 1. will-navigate: blocks top-level document navigation away from approved application shell.
 * 2. setWindowOpenHandler: blocks unauthorized BrowserWindow creation and safely delegates allowlisted HTTPS links to OS browser.
 */
export function attachNavigationGuards(win: BrowserWindow, options: NavigationGuardOptions): void {
  const contents = win.webContents;
  if (!contents || contents.isDestroyed()) {
    throw new Error('ERR_CANNOT_ATTACH_GUARDS_TO_DESTROYED_CONTENTS');
  }

  // Block unauthorized document navigation
  contents.on('will-navigate', (event, navigationUrl) => {
    // Top-level document navigation away from the entry point is permanently prohibited
    event.preventDefault();
    const meta = extractSafeUrlMetadata(navigationUrl);
    console.warn('[NavigationGuard] Blocked unauthorized will-navigate attempt:', {
      windowId: win.id,
      protocol: meta.protocol,
      hostname: meta.hostname,
      port: meta.port,
      reason: 'UNAUTHORIZED_DOCUMENT_NAVIGATION',
    });
  });

  // Intercept window.open / target="_blank"
  contents.setWindowOpenHandler(({ url }) => {
    // 1. Always deny opening any new Electron BrowserWindow
    const validation = validateExternalUrl(url);

    if (validation.valid && validation.normalizedUrl) {
      const openFn =
        options.onExternalOpen ?? ((targetUrl: string) => shell.openExternal(targetUrl));
      try {
        const openResult = openFn(validation.normalizedUrl);
        if (openResult && typeof (openResult as Promise<void>).catch === 'function') {
          (openResult as Promise<void>).catch(err => {
            const errorType = err instanceof Error ? err.name : 'ASYNC_EXTERNAL_OPEN_FAILED';
            console.error('[NavigationGuard] Failed to open external URL in system browser:', {
              windowId: win.id,
              errorCode: errorType,
            });
          });
        }
      } catch (syncErr) {
        const errorType = syncErr instanceof Error ? syncErr.name : 'SYNC_EXTERNAL_OPEN_FAILED';
        console.error('[NavigationGuard] Synchronous exception while opening external URL:', {
          windowId: win.id,
          errorCode: errorType,
        });
      }
    } else {
      const meta = extractSafeUrlMetadata(url);
      console.warn('[NavigationGuard] Blocked untrusted external window opening:', {
        windowId: win.id,
        protocol: meta.protocol,
        hostname: meta.hostname,
        port: meta.port,
        reason: validation.reason,
      });
    }

    return { action: 'deny' };
  });
}
