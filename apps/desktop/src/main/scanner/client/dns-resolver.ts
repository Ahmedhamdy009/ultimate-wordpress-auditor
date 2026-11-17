import dns from 'node:dns';
import { isIpAllowedForScan } from '@auditor/shared';
import { SCANNER_CLIENT_ERROR_CODES, type DnsResolutionResult } from './types.js';
import { ScannerClientError } from './errors.js';

export interface ResolveDnsOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly lookupFn?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<Array<{ address: string; family: number }>>;
  readonly allowPrivateLoopback?: boolean;
}

/**
 * Authoritatively resolves all A/AAAA records for a hostname and validates EVERY resolved IP.
 * Enforces:
 * - Fail-closed rejection: If ANY resolved IP is prohibited (e.g. mixed public + loopback/metadata),
 *   the entire hostname is rejected immediately with ERR_SSRF_PROHIBITED_IP.
 * - Empty result rejection (ERR_DNS_EMPTY_RESULT).
 * - System DNS error classification (ERR_DNS_RESOLUTION_FAILED).
 * - Socket IP Pinning target selection: first validated public IP is pinned.
 */
export async function resolveAndValidateDns(
  hostname: string,
  options?: ResolveDnsOptions,
): Promise<DnsResolutionResult> {
  const trimmedHost = hostname.trim();
  if (!trimmedHost) {
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_DNS_RESOLUTION_FAILED,
      'Hostname cannot be empty.',
    );
  }

  // If the hostname is already an IP address literal, validate it directly
  const directIpValidation = isIpAllowedForScan(trimmedHost);
  if (directIpValidation.allowed || options?.allowPrivateLoopback) {
    const family = directIpValidation.family ?? (trimmedHost.includes(':') ? 6 : 4);
    const cleanIp = directIpValidation.ip ?? trimmedHost;
    return {
      hostname: trimmedHost,
      pinnedIp: cleanIp,
      family,
      allIps: [cleanIp],
    };
  } else if (
    directIpValidation.matchedEntry ||
    directIpValidation.reason?.includes('prohibited') ||
    directIpValidation.reason?.includes('special')
  ) {
    // Prohibited IP literal directly supplied
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
      `Target address "${trimmedHost}" is a prohibited destination: ${directIpValidation.reason}`,
      {
        hostname: trimmedHost,
        prohibitedIp: trimmedHost,
        matchedEntry: directIpValidation.matchedEntry,
      },
    );
  }

  if (options?.signal?.aborted) {
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
      'DNS resolution was aborted by caller signal.',
    );
  }

  const lookupFn =
    options?.lookupFn ?? (dns.promises.lookup as NonNullable<ResolveDnsOptions['lookupFn']>);

  let addresses: Array<{ address: string; family: number }>;
  let timer: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;
  try {
    const promises: Promise<Array<{ address: string; family: number }>>[] = [
      lookupFn(trimmedHost, { all: true, verbatim: true }),
    ];

    if (options?.timeoutMs && options.timeoutMs > 0) {
      const timeoutMs = options.timeoutMs;
      promises.push(
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new ScannerClientError(
                SCANNER_CLIENT_ERROR_CODES.ERR_DNS_RESOLUTION_FAILED,
                `DNS lookup timed out after ${timeoutMs}ms for hostname "${trimmedHost}".`,
                { hostname: trimmedHost, causeCode: 'ETIMEDOUT' },
              ),
            );
          }, timeoutMs);
        }),
      );
    }

    if (options?.signal) {
      const signal = options.signal;
      promises.push(
        new Promise<never>((_, reject) => {
          abortListener = () => {
            reject(
              new ScannerClientError(
                SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
                'DNS resolution was aborted by caller signal.',
              ),
            );
          };
          signal.addEventListener('abort', abortListener, { once: true });
        }),
      );
    }

    addresses = await Promise.race(promises);
  } catch (err: unknown) {
    if (err instanceof ScannerClientError) {
      throw err;
    }
    if (options?.signal?.aborted) {
      throw new ScannerClientError(
        SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
        'DNS resolution was aborted by caller signal.',
      );
    }
    const sysErr = err as { code?: string; message?: string };
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_DNS_RESOLUTION_FAILED,
      `DNS lookup failed for hostname "${trimmedHost}": ${sysErr.message || String(err)}`,
      { hostname: trimmedHost, causeCode: sysErr.code },
    );
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (abortListener && options?.signal) {
      options.signal.removeEventListener('abort', abortListener);
    }
  }

  if (!addresses || addresses.length === 0) {
    throw new ScannerClientError(
      SCANNER_CLIENT_ERROR_CODES.ERR_DNS_EMPTY_RESULT,
      `DNS lookup returned zero IP addresses for hostname "${trimmedHost}".`,
      { hostname: trimmedHost },
    );
  }

  const allIpStrings = addresses.map(a => a.address);

  // Validate EVERY resolved address against IANA special registries & SSRF rules
  for (const entry of addresses) {
    const validation = isIpAllowedForScan(entry.address);
    if (!validation.allowed && !options?.allowPrivateLoopback) {
      throw new ScannerClientError(
        SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
        `Hostname "${trimmedHost}" resolved to prohibited address "${entry.address}": ${validation.reason}`,
        {
          hostname: trimmedHost,
          prohibitedIp: entry.address,
          allResolvedIps: allIpStrings,
          matchedEntry: validation.matchedEntry,
        },
      );
    }
  }

  // All resolved IPs are verified public unicast. Pin the first one.
  const pinned = addresses[0];
  const family = pinned.family === 6 ? 6 : 4;

  return {
    hostname: trimmedHost,
    pinnedIp: pinned.address,
    family,
    allIps: allIpStrings,
  };
}
