import type { IncomingHttpHeaders } from 'node:http';
import type { IanaSpecialAddressEntry } from '@auditor/shared';

export const SCANNER_CLIENT_ERROR_CODES = {
  ERR_SSRF_PROHIBITED_IP: 'ERR_SSRF_PROHIBITED_IP',
  ERR_DNS_RESOLUTION_FAILED: 'ERR_DNS_RESOLUTION_FAILED',
  ERR_DNS_EMPTY_RESULT: 'ERR_DNS_EMPTY_RESULT',
  ERR_CONNECTION_REFUSED: 'ERR_CONNECTION_REFUSED',
  ERR_CONNECTION_TIMEOUT: 'ERR_CONNECTION_TIMEOUT',
  ERR_TLS_CERT_INVALID: 'ERR_TLS_CERT_INVALID',
  ERR_HEADER_OVERFLOW: 'ERR_HEADER_OVERFLOW',
  ERR_ENCODED_BODY_SIZE_EXCEEDED: 'ERR_ENCODED_BODY_SIZE_EXCEEDED',
  ERR_DECOMPRESSED_BODY_SIZE_EXCEEDED: 'ERR_DECOMPRESSED_BODY_SIZE_EXCEEDED',
  ERR_COMPRESSION_BOMB_DETECTED: 'ERR_COMPRESSION_BOMB_DETECTED',
  ERR_UNSUPPORTED_CONTENT_ENCODING: 'ERR_UNSUPPORTED_CONTENT_ENCODING',
  ERR_NON_HTML_CONTENT_TYPE: 'ERR_NON_HTML_CONTENT_TYPE',
  ERR_REDIRECT_DISALLOWED: 'ERR_REDIRECT_DISALLOWED',
  ERR_REDIRECT_LIMIT_EXCEEDED: 'ERR_REDIRECT_LIMIT_EXCEEDED',
  ERR_REQUEST_ABORTED: 'ERR_REQUEST_ABORTED',
  ERR_REQUEST_TIMEOUT: 'ERR_REQUEST_TIMEOUT',
} as const;

export type ScannerClientErrorCode =
  (typeof SCANNER_CLIENT_ERROR_CODES)[keyof typeof SCANNER_CLIENT_ERROR_CODES];

export interface SafeHttpClientOptions {
  /**
   * Timeout in milliseconds for TCP connection and TLS handshake.
   * Default: 5,000 ms.
   */
  readonly connectTimeoutMs?: number;

  /**
   * Overall response timeout in milliseconds.
   * Default: 10,000 ms.
   */
  readonly responseTimeoutMs?: number;

  /**
   * Node.js HTTP parser maximum header size in bytes.
   * Default: 16,384 bytes (16 KB).
   */
  readonly maxHeaderSize?: number;

  /**
   * Maximum permitted encoded HTTP entity response body bytes delivered by IncomingMessage.
   * Default: 2,097,152 bytes (2 MB).
   */
  readonly maxEncodedBytes?: number;

  /**
   * Maximum permitted decompressed body bytes.
   * Default: 4,194,304 bytes (4 MB).
   */
  readonly maxDecompressedBytes?: number;

  /**
   * Maximum allowed ratio of decompressed bytes to encoded response body bytes.
   * Default: 10 (10:1 ratio).
   */
  readonly maxCompressionRatio?: number;

  /**
   * Minimum decompressed bytes threshold before applying ratio evaluation.
   * Default: 51,200 bytes (50 KB).
   */
  readonly minCompressionRatioBytes?: number;

  /**
   * Authorized hostnames for in-scope evaluation.
   */
  readonly allowedHosts?: readonly string[];

  /**
   * If true, allows external redirects from one external host to a different external host.
   * Default: false (strictly rejected to prevent scope expansion).
   */
  readonly allowCrossHostExternalRedirects?: boolean;

  /**
   * If true, allows HTTPS-to-HTTP downgrade redirects.
   * Default: false (strictly rejected to prevent SSL stripping).
   */
  readonly allowHttpsDowngrade?: boolean;

  /**
   * Maximum permitted redirect hops.
   * Default: 5 for in-scope targets, 2 for external targets.
   */
  readonly maxHops?: number;

  /**
   * User-Agent request header value.
   */
  readonly userAgent?: string;
}

/**
 * Isolated test-only hooks for dependency injection and deterministic local testing.
 * Strictly segregated from public production scanner configuration.
 * Production callers must NOT have access to these hooks.
 */
export interface SafeHttpClientTestHooks {
  /**
   * Custom DNS lookup function (for deterministic testing and DI).
   */
  readonly lookupFn?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<Array<{ address: string; family: number }>>;

  /**
   * Optional test override for the socket connection destination IP.
   * Allows routing TCP connections to a local test server while verifying DNS SSRF checks.
   */
  readonly pinnedIpOverride?: string;

  /**
   * Optional test-only trusted CA certificates for TLS verification (e.g. for testing against local HTTPS servers).
   * Strictly segregated from public production scanner configuration.
   */
  readonly ca?: string | Buffer | Array<string | Buffer>;
}

/**
 * Internal union of production scanner options and test hooks.
 */
export interface InternalSafeHttpClientOptions
  extends SafeHttpClientOptions, SafeHttpClientTestHooks {}

export interface SafeHttpRequest {
  readonly url: string;
  readonly method?: 'GET' | 'HEAD' | 'POST';
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly options?: Partial<SafeHttpClientOptions>;
  readonly testHooks?: SafeHttpClientTestHooks;
}

export interface TlsCertificateInfo {
  readonly validFrom: string;
  readonly validTo: string;
  readonly subject: Readonly<Record<string, string>>;
  readonly issuer: Readonly<Record<string, string>>;
  readonly subjectAltName?: string;
  readonly serialNumber?: string;
  readonly fingerprint256?: string;
  readonly daysUntilExpiration?: number;
}

export interface TlsConnectionMetadata {
  readonly protocol: string | null;
  readonly cipher: {
    readonly name: string;
    readonly version?: string;
    readonly standardName?: string;
  } | null;
  readonly authorized: boolean;
  readonly authorizationError?: string | null;
  readonly peerCertificate?: TlsCertificateInfo | null;
}

export interface SafeHttpResponse {
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly headers: IncomingHttpHeaders;
  readonly resolvedIp: string;
  readonly finalUrl: string;
  readonly redirectHops: number;
  readonly encodedBodyBytes: number;
  readonly decompressedBodyBytes: number;
  readonly body: ArrayBuffer;
  readonly tls?: TlsConnectionMetadata | null;
  text(): string;
}

export interface DnsResolutionResult {
  readonly hostname: string;
  readonly pinnedIp: string;
  readonly family: 4 | 6;
  readonly allIps: readonly string[];
  readonly matchedEntry?: IanaSpecialAddressEntry;
}
