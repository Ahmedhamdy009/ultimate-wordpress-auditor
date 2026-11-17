import {
  IPCError,
  IPC_ERROR_CODES,
  isValidIPv4,
  isValidIPv6,
  isIpAllowedForScan,
} from '@auditor/shared';
import { resolveAndValidateDns } from '../client/dns-resolver.js';
import { SCANNER_CLIENT_ERROR_CODES } from '../client/types.js';
import { ScannerClientError } from '../client/errors.js';

export interface ValidateTargetOptions {
  /**
   * If true, allows private and loopback addresses (only for internal test fixtures with pinnedIpOverride).
   * Default: false (strictly forbidden per SECURITY_POLICY.md).
   */
  readonly allowPrivateLoopback?: boolean;

  /**
   * DNS resolution timeout in milliseconds.
   * Default: 5,000 ms.
   */
  readonly timeoutMs?: number;

  /**
   * Optional AbortSignal for cancellation.
   */
  readonly signal?: AbortSignal;

  /**
   * Optional DNS lookup function (for dependency injection and mock testing).
   */
  readonly lookupFn?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<Array<{ address: string; family: number }>>;
}

export interface SyncTargetValidationResult {
  readonly valid: true;
  readonly parsedUrl: URL;
  readonly normalizedUrl: string;
  readonly hostname: string;
  readonly isIpLiteral: boolean;
  readonly ipAddress?: string;
}

export interface AsyncTargetValidationResult extends SyncTargetValidationResult {
  readonly resolvedIps?: readonly string[];
  readonly pinnedIp?: string;
}

/**
 * Checks whether a hostname or IP string represents an RFC 6761 localhost
 * or private/loopback/special IP address according to IANA and RFC 6890.
 */
export function isProhibitedHost(hostname: string, options?: ValidateTargetOptions): boolean {
  const trimmed = hostname.trim().toLowerCase();
  if (!trimmed) return true;

  if (trimmed === 'localhost' || trimmed.endsWith('.localhost')) {
    return !options?.allowPrivateLoopback;
  }

  const rawIp = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  if (isValidIPv4(rawIp) || isValidIPv6(rawIp)) {
    const ipCheck = isIpAllowedForScan(rawIp);
    if (!ipCheck.allowed && !options?.allowPrivateLoopback) {
      return true;
    }
  }

  return false;
}

/**
 * Synchronous pre-flight validation of target URLs.
 * Rejects:
 * - Empty, non-string, or oversized inputs (>2048 characters).
 * - Malformed URLs or non-HTTP/HTTPS schemes (ftp:, file:, javascript:, ws:, etc.).
 * - Embedded credentials (username:password).
 * - Missing or empty hostnames.
 * - RFC 6761 localhost and *.localhost domains.
 * - Alternative numeric/octal/hex IP representations canonicalized to private/loopback space by WHATWG URL.
 * - Explicit IPv4/IPv6 literals matching IANA special or private ranges (RFC 6890).
 *
 * Runs BEFORE creating any site record, scan record, or database entry.
 */
export function validateTargetUrlSync(
  targetUrl: string,
  options?: ValidateTargetOptions,
): SyncTargetValidationResult {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new IPCError('Target URL must be a non-empty string', IPC_ERROR_CODES.INVALID_TARGET_URL);
  }

  const trimmed = targetUrl.trim();
  if (trimmed.length === 0) {
    throw new IPCError('Target URL cannot be empty', IPC_ERROR_CODES.INVALID_TARGET_URL);
  }

  if (trimmed.length > 2048) {
    throw new IPCError(
      'Target URL exceeds maximum permitted length of 2048 characters',
      IPC_ERROR_CODES.INVALID_TARGET_URL,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new IPCError(`Invalid URL format: '${trimmed}'`, IPC_ERROR_CODES.INVALID_TARGET_URL);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new IPCError(
      `Unsupported protocol '${parsed.protocol}'. Only http: and https: are permitted.`,
      IPC_ERROR_CODES.INVALID_TARGET_URL,
    );
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new IPCError(
      'Target URL contains embedded credentials (username/password), which is strictly forbidden.',
      IPC_ERROR_CODES.INVALID_TARGET_URL,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname.length === 0) {
    throw new IPCError('Target URL has no valid hostname', IPC_ERROR_CODES.INVALID_TARGET_URL);
  }

  // Reject RFC 6761 localhost
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    if (!options?.allowPrivateLoopback) {
      throw new IPCError(
        'Target destination or resolved address is prohibited by security policy',
        IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET,
      );
    }
  }

  // Check IPv4 or IPv6 literals (WHATWG URL automatically canonicalizes alternative formats e.g. 2130706433 -> 127.0.0.1)
  const rawIp =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const isIpv4 = isValidIPv4(rawIp);
  const isIpv6 = isValidIPv6(rawIp);
  const isIpLiteral = isIpv4 || isIpv6;

  if (isIpLiteral) {
    const ipCheck = isIpAllowedForScan(rawIp);
    if (!ipCheck.allowed && !options?.allowPrivateLoopback) {
      throw new IPCError(
        `Target destination or resolved address is prohibited by security policy: ${ipCheck.reason ?? 'private or reserved IP'}`,
        IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET,
      );
    }
  }

  return {
    valid: true,
    parsedUrl: parsed,
    normalizedUrl: parsed.toString(),
    hostname,
    isIpLiteral,
    ipAddress: isIpLiteral ? rawIp : undefined,
  };
}

/**
 * Asynchronous pre-flight target validation.
 * Performs synchronous checks first. If the target is a domain name, performs
 * bounded, authoritatively validated DNS resolution:
 * - Fails-closed if ANY resolved IP address is in a prohibited or private range.
 * - Rejects empty DNS answers.
 * - Enforces bounded resolution timeout (default 5,000ms).
 * - Propagates cancellation signals.
 */
export async function validateTargetUrlAsync(
  targetUrl: string,
  options?: ValidateTargetOptions,
): Promise<AsyncTargetValidationResult> {
  const syncResult = validateTargetUrlSync(targetUrl, options);

  if (syncResult.isIpLiteral) {
    return {
      ...syncResult,
      resolvedIps: syncResult.ipAddress ? [syncResult.ipAddress] : undefined,
      pinnedIp: syncResult.ipAddress,
    };
  }

  try {
    const dnsResult = await resolveAndValidateDns(syncResult.hostname, {
      timeoutMs: options?.timeoutMs ?? 5_000,
      signal: options?.signal,
      lookupFn: options?.lookupFn,
      allowPrivateLoopback: options?.allowPrivateLoopback,
    });

    return {
      ...syncResult,
      resolvedIps: dnsResult.allIps,
      pinnedIp: dnsResult.pinnedIp,
    };
  } catch (err: unknown) {
    if (err instanceof ScannerClientError) {
      if (err.code === SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP) {
        throw new IPCError(
          `Target destination or resolved address is prohibited by security policy: ${err.message}`,
          IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET,
        );
      }
      if (
        err.code === SCANNER_CLIENT_ERROR_CODES.ERR_DNS_RESOLUTION_FAILED ||
        err.code === SCANNER_CLIENT_ERROR_CODES.ERR_DNS_EMPTY_RESULT
      ) {
        throw new IPCError(
          `DNS resolution failed for the target hostname "${syncResult.hostname}": ${err.message}`,
          IPC_ERROR_CODES.DNS_RESOLUTION_FAILED,
        );
      }
      if (err.code === SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED) {
        throw new IPCError(
          'Request was aborted during DNS resolution',
          IPC_ERROR_CODES.INTERNAL_ERROR,
        );
      }
    }

    if (err instanceof IPCError) {
      throw err;
    }

    throw new IPCError(
      `DNS resolution failed for target hostname "${syncResult.hostname}": ${err instanceof Error ? err.message : String(err)}`,
      IPC_ERROR_CODES.DNS_RESOLUTION_FAILED,
    );
  }
}
