/**
 * Bounded URL Telemetry Serializer.
 * Enforces the 256 KB URL telemetry budget, normalizes and redacts URLs,
 * and maintains accurate admission vs. omission counters.
 */

import { normalizeCrawlUrl } from '../scope/url-normalizer.js';
import type { BoundedUrlTelemetryResult } from './types.js';

export const MAX_URL_TELEMETRY_BYTES = 262144; // 256 KB

/**
 * Sanitizes and normalizes a candidate URL for telemetry persistence.
 * Redacts query secrets and basic auth credentials.
 */
export function sanitizeTelemetryUrl(rawUrl: string): string {
  const normalized = normalizeCrawlUrl(rawUrl);
  const candidate = normalized ? normalized.href : rawUrl.trim();

  try {
    const u = new URL(candidate);
    u.username = '';
    u.password = '';
    u.hash = '';
    // Redact sensitive query parameters
    const sensitiveKeys = ['token', 'secret', 'key', 'auth', 'password', 'api_key', 'apikey', 'signature', 'sig'];
    for (const k of Array.from(u.searchParams.keys())) {
      if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk))) {
        u.searchParams.set(k, '[REDACTED]');
      }
    }
    return u.href;
  } catch {
    return candidate;
  }
}

/**
 * Serializes and bounds crawled and browser-audited URLs within the 256 KB budget.
 */
export function serializeBoundedUrlTelemetry(
  rawCrawledUrls: readonly string[],
  rawBrowserAuditedUrls: readonly string[],
  budgetBytes: number = MAX_URL_TELEMETRY_BYTES,
): BoundedUrlTelemetryResult {
  // 1. Sanitize, normalize, and deduplicate
  const cleanCrawled: string[] = [];
  const crawledSet = new Set<string>();
  for (const raw of rawCrawledUrls) {
    const clean = sanitizeTelemetryUrl(raw);
    if (!crawledSet.has(clean)) {
      crawledSet.add(clean);
      cleanCrawled.push(clean);
    }
  }

  const cleanBrowser: string[] = [];
  const browserSet = new Set<string>();
  for (const raw of rawBrowserAuditedUrls) {
    const clean = sanitizeTelemetryUrl(raw);
    if (!browserSet.has(clean)) {
      browserSet.add(clean);
      cleanBrowser.push(clean);
    }
  }

  // 2. Budget enforcement
  // Pair browser-audited URLs with crawled URLs to preserve execution correlation
  const persistedCrawled: string[] = [];
  const persistedBrowser: string[] = [];

  // Initial serialization overhead for both arrays in JSON: '{"crawledUrls":[],"browserAuditedUrls":[]}'
  let currentBytes = Buffer.byteLength(
    JSON.stringify({ crawledUrls: [], browserAuditedUrls: [] }),
    'utf8',
  );

  const browserAuditedSet = new Set(cleanBrowser);

  // Prioritize URLs that received browser audits (higher evidence value)
  for (const url of cleanCrawled) {
    const hasBrowser = browserAuditedSet.has(url);
    const cComma = persistedCrawled.length > 0 ? 1 : 0;
    const urlJsonBytes = Buffer.byteLength(JSON.stringify(url), 'utf8') + cComma;
    const bComma = hasBrowser ? (persistedBrowser.length > 0 ? 1 : 0) : 0;
    const extraBrowserBytes = hasBrowser
      ? Buffer.byteLength(JSON.stringify(url), 'utf8') + bComma
      : 0;

    if (currentBytes + urlJsonBytes + extraBrowserBytes > budgetBytes) {
      break; // Byte budget exhausted
    }

    persistedCrawled.push(url);
    currentBytes += urlJsonBytes;

    if (hasBrowser) {
      persistedBrowser.push(url);
      currentBytes += extraBrowserBytes;
    }
  }

  // If any browser URLs were not in crawledUrls, admit them if budget allows
  for (const bUrl of cleanBrowser) {
    if (persistedBrowser.includes(bUrl)) continue;
    const bComma = persistedBrowser.length > 0 ? 1 : 0;
    const bJsonBytes = Buffer.byteLength(JSON.stringify(bUrl), 'utf8') + bComma;
    if (currentBytes + bJsonBytes > budgetBytes) {
      break;
    }
    persistedBrowser.push(bUrl);
    currentBytes += bJsonBytes;
  }

  const crawledOmitted = cleanCrawled.length - persistedCrawled.length;
  const browserOmitted = cleanBrowser.length - persistedBrowser.length;
  const isTruncated = crawledOmitted > 0 || browserOmitted > 0;

  const actualSerializedBytes = Buffer.byteLength(
    JSON.stringify({ crawledUrls: persistedCrawled, browserAuditedUrls: persistedBrowser }),
    'utf8',
  );

  return {
    crawledUrls: Object.freeze(persistedCrawled),
    browserAuditedUrls: Object.freeze(persistedBrowser),
    truncation: {
      isTruncated,
      crawledUrlsTotal: cleanCrawled.length,
      crawledUrlsPersisted: persistedCrawled.length,
      crawledUrlsOmitted: crawledOmitted,
      browserAuditedUrlsTotal: cleanBrowser.length,
      browserAuditedUrlsPersisted: persistedBrowser.length,
      browserAuditedUrlsOmitted: browserOmitted,
      serializedBytes: actualSerializedBytes,
      budgetBytes,
    },
  };
}
