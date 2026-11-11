/**
 * Centralized URL normalization and scope safety engine for web crawling.
 * Pure TypeScript isomorphic implementation: zero Node.js built-ins.
 * Safe for Node.js, Electron Main, Browser, and React Renderer environments.
 */

import { getEffectivePort, normalizeHost } from './guard.js';

export const MAX_CRAWL_URL_LENGTH = 2048;

export const ALLOWED_CRAWL_PROTOCOLS = new Set(['http:', 'https:']);

export const PROHIBITED_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'blob:',
  'about:',
  'mailto:',
  'tel:',
  'sms:',
  'callto:',
  'facetime:',
  'ftp:',
  'ftps:',
  'sftp:',
  'ssh:',
  'ws:',
  'wss:',
]);

export interface NormalizedUrlResult {
  readonly href: string;
  readonly origin: string;
  readonly protocol: 'http:' | 'https:';
  readonly hostname: string;
  readonly port: number;
  readonly pathname: string;
  readonly search: string;
}

export interface LinkClassificationResult {
  readonly originalValue: string;
  readonly resolvedUrl: string | null;
  readonly isInternal: boolean;
  readonly isEligibleForCrawl: boolean;
  readonly rejectionReason?: string;
}

/**
 * Normalizes a URL against an optional base URL for deterministic crawling and deduplication.
 *
 * Enforces:
 * 1. Protocol allowlist (strictly http: and https:).
 * 2. Strict credential rejection (no username or password embedded in URL).
 * 3. Stripping of fragment identifiers (#section).
 * 4. Removal of standard default ports (:80 for http, :443 for https).
 * 5. Dot-segment resolution (/a/b/../c -> /a/c) via WHATWG URL.
 * 6. Query string preservation: does NOT strip or re-sort query parameters.
 * 7. Hostname canonicalization (lowercase, bracketed canonical IPv6).
 * 8. Bounded URL length (MAX_CRAWL_URL_LENGTH = 2048).
 *
 * Returns null if the URL is invalid, uses an unpermitted scheme, contains credentials, or exceeds maximum length.
 */
export function normalizeCrawlUrl(
  candidateUrl: string,
  baseUrl?: string,
): NormalizedUrlResult | null {
  if (!candidateUrl || typeof candidateUrl !== 'string') {
    return null;
  }

  const trimmed = candidateUrl.trim();
  if (!trimmed || trimmed.length === 0) {
    return null;
  }

  // Fast check for prohibited URI schemes before full parsing
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase() + ':';
    if (PROHIBITED_SCHEMES.has(scheme) || !ALLOWED_CRAWL_PROTOCOLS.has(scheme)) {
      return null;
    }
  }

  let parsed: URL;
  try {
    if (baseUrl && baseUrl.trim().length > 0) {
      parsed = new URL(trimmed, baseUrl.trim());
    } else {
      parsed = new URL(trimmed);
    }
  } catch {
    return null;
  }

  // Strict protocol check on parsed URL
  if (!ALLOWED_CRAWL_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }

  // Strict credential rejection per SECURITY_POLICY.md
  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }

  // Remove fragment identifier (#section is client-side only; does not identify distinct server resources)
  parsed.hash = '';

  const protocol = parsed.protocol as 'http:' | 'https:';
  const effectivePort = getEffectivePort(parsed);

  // Normalize host (canonicalizes domain casing and IPv6 representations)
  let canonicalHost: string;
  try {
    canonicalHost = normalizeHost(parsed.hostname);
  } catch {
    return null;
  }

  // Remove standard default port from URL serialization
  if (
    (protocol === 'http:' && effectivePort === 80) ||
    (protocol === 'https:' && effectivePort === 443)
  ) {
    parsed.port = '';
  } else {
    parsed.port = String(effectivePort);
  }

  // Reconstruct origin
  const isDefaultPort =
    (protocol === 'http:' && effectivePort === 80) ||
    (protocol === 'https:' && effectivePort === 443);
  const origin = isDefaultPort
    ? `${protocol}//${canonicalHost}`
    : `${protocol}//${canonicalHost}:${effectivePort}`;

  const href = parsed.toString();

  // Enforce URL length upper bound
  if (href.length > MAX_CRAWL_URL_LENGTH) {
    return null;
  }

  return {
    href,
    origin,
    protocol,
    hostname: canonicalHost,
    port: effectivePort,
    pathname: parsed.pathname,
    search: parsed.search,
  };
}

/**
 * Checks whether two URLs belong to the exact same origin (protocol, host, and port).
 */
export function isSameOrigin(urlA: string, urlB: string): boolean {
  const normA = normalizeCrawlUrl(urlA);
  const normB = normalizeCrawlUrl(urlB);
  if (!normA || !normB) {
    return false;
  }
  return normA.origin === normB.origin;
}

/**
 * Resolves and classifies a candidate link extracted from an HTML element against the base/page URL.
 */
export function classifyDiscoveredLink(
  rawAttributeValue: string,
  sourcePageUrl: string,
  authorizedOrigin: string,
): LinkClassificationResult {
  const trimmed = rawAttributeValue.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return {
      originalValue: rawAttributeValue,
      resolvedUrl: null,
      isInternal: false,
      isEligibleForCrawl: false,
      rejectionReason: 'EMPTY_OR_FRAGMENT_ONLY',
    };
  }

  const normalized = normalizeCrawlUrl(trimmed, sourcePageUrl);
  if (!normalized) {
    return {
      originalValue: rawAttributeValue,
      resolvedUrl: null,
      isInternal: false,
      isEligibleForCrawl: false,
      rejectionReason: 'INVALID_OR_DISALLOWED_PROTOCOL',
    };
  }

  const isInternal = normalized.origin === authorizedOrigin;
  const isCdnCgiUtility = normalized.pathname.startsWith('/cdn-cgi/');
  const isEligible =
    isInternal && !isCdnCgiUtility && normalized.href.length <= MAX_CRAWL_URL_LENGTH;

  return {
    originalValue: rawAttributeValue,
    resolvedUrl: normalized.href,
    isInternal,
    isEligibleForCrawl: isEligible,
    rejectionReason: !isInternal
      ? 'EXTERNAL_ORIGIN'
      : isCdnCgiUtility
        ? 'UTILITY_PATH_EXCLUDED'
        : !isEligible
          ? 'EXCEEDS_MAX_LENGTH'
          : undefined,
  };
}
