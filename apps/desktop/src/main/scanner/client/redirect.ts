import type { IncomingMessage } from 'node:http';
import { evaluateRedirectPolicy } from '@auditor/shared';
import { SCANNER_CLIENT_ERROR_CODES, type SafeHttpClientOptions } from './types.js';
import { ScannerClientError } from './errors.js';

export interface RedirectEvaluation {
  readonly shouldRedirect: boolean;
  readonly targetUrl?: string;
  readonly nextHopCount?: number;
  readonly isExternal?: boolean;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Evaluates whether an HTTP response is a redirect and applies multi-dimensional redirect policies.
 */
export function handleResponseRedirect(
  currentUrl: string,
  res: IncomingMessage,
  options?: SafeHttpClientOptions & { hopCount?: number },
): RedirectEvaluation {
  const statusCode = res.statusCode ?? 0;
  if (!REDIRECT_STATUS_CODES.has(statusCode)) {
    return { shouldRedirect: false };
  }

  const location = res.headers['location'];
  if (!location || typeof location !== 'string' || location.trim().length === 0) {
    // 3xx without valid Location header is treated as terminal response
    return { shouldRedirect: false };
  }

  const allowedHosts = options?.allowedHosts ?? [];
  const hopCount = options?.hopCount ?? 1;

  const decision = evaluateRedirectPolicy(currentUrl, location, allowedHosts, {
    hopCount,
    maxHops: options?.maxHops,
    allowCrossHostExternalRedirects: options?.allowCrossHostExternalRedirects,
    allowHttpsDowngrade: options?.allowHttpsDowngrade,
  });

  if (!decision.allowed) {
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_REDIRECT_DISALLOWED,
      `Redirect rejected by security policy: ${decision.reason}`,
      {
        currentUrl,
        location,
        targetUrl: decision.targetUrl,
        hopCount,
        isExternal: decision.isExternal,
        isCrossHost: decision.isCrossHost,
        isHttpsDowngrade: decision.isHttpsDowngrade,
      },
    );
  }

  return {
    shouldRedirect: true,
    targetUrl: decision.targetUrl,
    nextHopCount: decision.nextHopCount,
    isExternal: decision.isExternal,
  };
}
