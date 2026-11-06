import { session, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WebRequestSecurityOptions {
  isDev: boolean;
  targetSession?: Electron.Session;
}

interface SessionSecurityConfig {
  isDev: boolean;
  registeredAt: number;
}

export class SecurityWebRequestManager {
  private static readonly sessionConfigs = new WeakMap<Electron.Session, SessionSecurityConfig>();

  /**
   * Initializes CSP enforcement on a given Electron Session.
   * Enforces Per-Session registration and detects conflicting isDev reconfigurations.
   */
  public static initialize(options: WebRequestSecurityOptions): void {
    const { isDev, targetSession = session.defaultSession } = options;

    const existingConfig = this.sessionConfigs.get(targetSession);
    if (existingConfig) {
      if (existingConfig.isDev !== isDev) {
        throw new Error(
          `ERR_SESSION_CONFIG_CONFLICT: Target session is already registered with isDev=${existingConfig.isDev}, conflicting with requested isDev=${isDev}`,
        );
      }
      return; // Idempotent call with identical configuration
    }

    this.registerHeadersListener(targetSession, isDev);
    this.sessionConfigs.set(targetSession, { isDev, registeredAt: Date.now() });
  }

  /**
   * Generates the authoritative Content-Security-Policy string.
   */
  public static buildCsp(isDev: boolean): string {
    if (isDev) {
      return [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'", // Permitted strictly in development for Vite HMR CSS injection
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self' ws://localhost:5173 ws://127.0.0.1:5173 http://localhost:5173 http://127.0.0.1:5173",
        "frame-ancestors 'none'",
        "form-action 'none'",
        "base-uri 'none'",
      ].join('; ');
    }

    return [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'", // Strict in production - No unsafe-inline or unsafe-eval
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; ');
  }

  /**
   * Strict validation of Renderer Origin checking protocol, hostname, port, and embedded credentials.
   */
  public static isAppRendererOrigin(
    urlStr: string,
    isDev: boolean,
    isPackaged = app?.isPackaged ?? false,
  ): boolean {
    try {
      const parsed = new URL(urlStr);

      // 1. Rejection of embedded credentials (e.g. http://localhost:5173@evil.com)
      if (parsed.username !== '' || parsed.password !== '') {
        return false;
      }

      if (isDev) {
        // 2. Development Origin Validation
        // Must be http: with exact host localhost or 127.0.0.1 and port 5173
        const isHttp = parsed.protocol === 'http:';
        const isAllowedHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        const isAllowedPort = parsed.port === '5173';

        return isHttp && isAllowedHost && isAllowedPort;
      } else {
        // 3. Production Origin Validation
        // Must be file: with empty hostname and port
        if (parsed.protocol !== 'file:' || parsed.hostname !== '' || parsed.port !== '') {
          return false;
        }

        const filePath = fileURLToPath(parsed);
        return validateProductionRendererPath(filePath, isPackaged);
      }
    } catch {
      return false; // Fail-closed on parse error
    }
  }

  private static registerHeadersListener(targetSession: Electron.Session, isDev: boolean): void {
    targetSession.webRequest.onHeadersReceived((details, callback) => {
      let callbackInvoked = false;
      const safeCallback = (response: Electron.HeadersReceivedResponse) => {
        if (!callbackInvoked) {
          callbackInvoked = true;
          callback(response);
        }
      };

      try {
        const isDocument =
          details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
        const isAppDoc = isDocument && this.isAppRendererOrigin(details.url, isDev);

        // If this is NOT an internal application document, pass response unchanged
        if (!isAppDoc) {
          safeCallback({ responseHeaders: details.responseHeaders });
          return;
        }

        // --- Application Document: Apply CSP ---
        let appPolicy: string;
        try {
          appPolicy = this.buildCsp(isDev);

          if (!appPolicy || typeof appPolicy !== 'string' || appPolicy.trim().length === 0) {
            throw new Error('ERR_INVALID_CSP_POLICY_OUTPUT');
          }
        } catch {
          // MANDATORY SECURITY RULE: FAIL-CLOSED
          // If building CSP fails on an application document, CANCEL request immediately.
          // Never allow the document to render without protection!
          console.error(
            '[Security] Failed to build CSP for application document. Cancelling request (Fail-Closed).',
            {
              errorCode: 'ERR_CSP_BUILD_FAILED',
            },
          );
          safeCallback({ cancel: true });
          return;
        }

        // Preserve existing upstream CSP headers (W3C cumulative multi-policy preservation, case-insensitive)
        const existingCsp: string[] = [];
        if (details.responseHeaders) {
          for (const [key, rawValue] of Object.entries(details.responseHeaders)) {
            if (key.toLowerCase() === 'content-security-policy') {
              const headerValues: unknown[] = Array.isArray(rawValue) ? rawValue : [rawValue];
              for (const item of headerValues) {
                if (typeof item === 'string' && item.trim().length > 0) {
                  existingCsp.push(item.trim());
                }
              }
            }
          }
        }

        const mergedHeaders: Record<string, string | string[]> = {};
        if (details.responseHeaders) {
          for (const [key, value] of Object.entries(details.responseHeaders)) {
            if (key.toLowerCase() !== 'content-security-policy') {
              mergedHeaders[key] = value;
            }
          }
        }

        // Inject merged policy array ensuring all policies apply cumulatively
        mergedHeaders['Content-Security-Policy'] = [...existingCsp, appPolicy];
        safeCallback({ responseHeaders: mergedHeaders });
      } catch {
        // Fail-Closed: If any unexpected exception occurs while processing an app document, cancel request
        console.error(
          '[Security] Unexpected error in onHeadersReceived. Cancelling request (Fail-Closed).',
          {
            errorCode: 'ERR_CSP_PROCESSING_FAILED',
          },
        );
        safeCallback({ cancel: true });
      }
    });
  }
}

/**
 * Validates whether a file path points strictly to the approved application renderer entry point.
 */
export function validateProductionRendererPath(
  candidateFilePath: string,
  isPackaged = app?.isPackaged ?? false,
  customRoots?: { resourcesPath?: string; appPath?: string },
): boolean {
  try {
    if (!candidateFilePath || typeof candidateFilePath !== 'string') {
      return false;
    }

    // Immediate rejection of any path referencing app.asar.unpacked as the renderer source
    if (candidateFilePath.toLowerCase().includes('app.asar.unpacked')) {
      return false;
    }

    if (isPackaged) {
      const resourcesPath = customRoots?.resourcesPath ?? process.resourcesPath;
      const rawAsarPath = path.resolve(resourcesPath, 'app.asar');

      // Check physical existence of the archive file
      if (!fs.existsSync(rawAsarPath)) {
        return false;
      }

      let physicalAsarPath: string;
      try {
        physicalAsarPath = fs.realpathSync.native(rawAsarPath);
      } catch {
        return false; // Physical path resolution failure -> reject
      }

      const normalizedCandidate = path.normalize(candidateFilePath);
      const asarPrefixWithSep = physicalAsarPath.toLowerCase() + path.sep.toLowerCase();

      // Enforce directory separator boundary to prevent prefix confusion (e.g. app.asar.evil)
      if (!normalizedCandidate.toLowerCase().startsWith(asarPrefixWithSep)) {
        return false;
      }

      // Extract virtual internal path without calling realpathSync.native on virtual ASAR path
      const internalSubPath = normalizedCandidate.slice(asarPrefixWithSep.length);
      const internalSegments = internalSubPath.split(/[\\/]/).filter(Boolean);

      const isOutRenderer =
        internalSegments.length === 3 &&
        internalSegments[0].toLowerCase() === 'out' &&
        internalSegments[1].toLowerCase() === 'renderer' &&
        internalSegments[2].toLowerCase() === 'index.html';

      const isDistRenderer =
        internalSegments.length === 3 &&
        internalSegments[0].toLowerCase() === 'dist' &&
        internalSegments[1].toLowerCase() === 'renderer' &&
        internalSegments[2].toLowerCase() === 'index.html';

      return isOutRenderer || isDistRenderer;
    } else {
      // Unpacked physical directory mode
      const appRoot = customRoots?.appPath ?? app?.getAppPath() ?? process.cwd();
      const rawRoot = path.resolve(appRoot);

      if (!fs.existsSync(candidateFilePath)) {
        return false;
      }

      let physicalCandidate: string;
      try {
        physicalCandidate = fs.realpathSync.native(candidateFilePath);
      } catch {
        return false;
      }

      // Check against both out/renderer/index.html and dist/renderer/index.html
      const outEntry = path.resolve(rawRoot, 'out', 'renderer', 'index.html');
      const distEntry = path.resolve(rawRoot, 'dist', 'renderer', 'index.html');

      let matchesOut = false;
      if (fs.existsSync(outEntry)) {
        try {
          const physicalOut = fs.realpathSync.native(outEntry);
          matchesOut = physicalCandidate.toLowerCase() === physicalOut.toLowerCase();
        } catch {
          matchesOut = false;
        }
      }

      let matchesDist = false;
      if (fs.existsSync(distEntry)) {
        try {
          const physicalDist = fs.realpathSync.native(distEntry);
          matchesDist = physicalCandidate.toLowerCase() === physicalDist.toLowerCase();
        } catch {
          matchesDist = false;
        }
      }

      return matchesOut || matchesDist;
    }
  } catch {
    return false;
  }
}
