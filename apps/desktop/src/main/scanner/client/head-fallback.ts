import type { SafeHttpResponse, TlsConnectionMetadata } from './types.js';

export const HEAD_FALLBACK_STATUS_CODES = new Set([405, 501]);

export function shouldFallbackToGetRange(statusCode: number): boolean {
  return HEAD_FALLBACK_STATUS_CODES.has(statusCode);
}

/**
 * Creates a SafeHttpResponse representing the headers-only result of a HEAD fallback probe.
 */
export function createHeadFallbackResponse(
  statusCode: number,
  statusMessage: string,
  headers: SafeHttpResponse['headers'],
  resolvedIp: string,
  finalUrl: string,
  redirectHops: number,
  tls?: TlsConnectionMetadata | null,
): SafeHttpResponse {
  const emptyBuffer = new ArrayBuffer(0);
  return {
    statusCode,
    statusMessage,
    headers,
    resolvedIp,
    finalUrl,
    redirectHops,
    encodedBodyBytes: 0,
    decompressedBodyBytes: 0,
    body: emptyBuffer,
    tls: tls ?? null,
    text: () => '',
  };
}
