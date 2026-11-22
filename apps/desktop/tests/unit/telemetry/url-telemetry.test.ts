import { describe, it, expect } from 'vitest';
import {
  serializeBoundedUrlTelemetry,
  sanitizeTelemetryUrl,
  MAX_URL_TELEMETRY_BYTES,
} from '@auditor/shared';

describe('Bounded URL Telemetry Serializer', () => {
  describe('sanitizeTelemetryUrl', () => {
    it('normalizes URLs and strips auth credentials', () => {
      const sanitized = sanitizeTelemetryUrl('https://user:pass@example.com/path?foo=bar#frag');
      expect(sanitized).toBe('https://example.com/path?foo=bar');
    });

    it('redacts sensitive query parameters', () => {
      const sanitized = sanitizeTelemetryUrl('https://example.com/api?token=abc123xyz&secret=sensitive&user=alice');
      expect(sanitized).toContain('token=%5BREDACTED%5D');
      expect(sanitized).toContain('secret=%5BREDACTED%5D');
      expect(sanitized).toContain('user=alice');
    });
  });

  describe('serializeBoundedUrlTelemetry', () => {
    it('bounds URL telemetry within 256 KB budget and tracks exact counters', () => {
      const crawled = ['https://example.com/p1', 'https://example.com/p2', 'https://example.com/p1'];
      const browser = ['https://example.com/p1'];

      const res = serializeBoundedUrlTelemetry(crawled, browser);

      expect(res.crawledUrls).toEqual(['https://example.com/p1', 'https://example.com/p2']);
      expect(res.browserAuditedUrls).toEqual(['https://example.com/p1']);
      expect(res.truncation.isTruncated).toBe(false);
      expect(res.truncation.crawledUrlsTotal).toBe(2);
      expect(res.truncation.crawledUrlsPersisted).toBe(2);
      expect(res.truncation.crawledUrlsOmitted).toBe(0);
      expect(res.truncation.budgetBytes).toBe(MAX_URL_TELEMETRY_BYTES);
      expect(res.truncation.serializedBytes).toBeLessThanOrEqual(MAX_URL_TELEMETRY_BYTES);
    });

    it('enforces truncation when URLs exceed the budget', () => {
      // Create many long URLs that exceed a tiny custom budget of 500 bytes
      const longUrls: string[] = [];
      for (let i = 0; i < 50; i++) {
        longUrls.push(`https://example.com/sub/deep/path/resource-${i}?query=parameter-value-${i}`);
      }

      const res = serializeBoundedUrlTelemetry(longUrls, [], 500);

      expect(res.truncation.isTruncated).toBe(true);
      expect(res.truncation.crawledUrlsOmitted).toBeGreaterThan(0);
      expect(res.truncation.crawledUrlsPersisted + res.truncation.crawledUrlsOmitted).toBe(50);
      expect(res.truncation.serializedBytes).toBeLessThanOrEqual(500);
    });

    it('handles exact budget boundary where serializedBytes === budgetBytes without truncation', () => {
      const crawled = ['https://example.com/p1', 'https://example.com/p2'];
      const browser = ['https://example.com/p1'];

      // First determine exact serialized bytes required for these URLs
      const unconstrained = serializeBoundedUrlTelemetry(crawled, browser);
      const exactBytes = unconstrained.truncation.serializedBytes;

      // Set budgetBytes to exactly serializedBytes
      const res = serializeBoundedUrlTelemetry(crawled, browser, exactBytes);

      expect(res.truncation.serializedBytes).toBe(exactBytes);
      expect(res.truncation.budgetBytes).toBe(exactBytes);
      expect(res.truncation.isTruncated).toBe(false);
      expect(res.truncation.crawledUrlsPersisted).toBe(2);
      expect(res.truncation.crawledUrlsOmitted).toBe(0);
      expect(res.truncation.browserAuditedUrlsPersisted).toBe(1);
      expect(res.truncation.browserAuditedUrlsOmitted).toBe(0);
      expect(res.crawledUrls).toEqual(['https://example.com/p1', 'https://example.com/p2']);
      expect(res.browserAuditedUrls).toEqual(['https://example.com/p1']);
    });

    it('handles one-byte overflow where candidates require budgetBytes + 1 bytes with immediate truncation', () => {
      const crawled = ['https://example.com/p1', 'https://example.com/p2'];
      const browser = ['https://example.com/p1'];

      // Candidates require exactBytes (115 bytes). Setting budget to exactBytes - 1 (114 bytes)
      // means the full candidate set requires budgetBytes + 1 bytes (1-byte overflow).
      const unconstrained = serializeBoundedUrlTelemetry(crawled, browser);
      const requiredBytes = unconstrained.truncation.serializedBytes;
      const budgetBytes = requiredBytes - 1;

      const res = serializeBoundedUrlTelemetry(crawled, browser, budgetBytes);

      // Verifies deterministic truncation and exact byte bound enforcement
      expect(requiredBytes).toBe(budgetBytes + 1);
      expect(res.truncation.isTruncated).toBe(true);
      expect(res.truncation.budgetBytes).toBe(budgetBytes);
      expect(res.truncation.serializedBytes).toBeLessThanOrEqual(budgetBytes);
      // Browser-audited URL is prioritized and retained
      expect(res.truncation.browserAuditedUrlsPersisted).toBe(1);
      expect(res.truncation.browserAuditedUrlsOmitted).toBe(0);
      // Second crawled URL is omitted due to overflow
      expect(res.truncation.crawledUrlsPersisted).toBe(1);
      expect(res.truncation.crawledUrlsOmitted).toBe(1);
      expect(res.truncation.crawledUrlsTotal).toBe(2);
      expect(res.crawledUrls).toEqual(['https://example.com/p1']);
      expect(res.browserAuditedUrls).toEqual(['https://example.com/p1']);
    });

    it('handles empty input arrays cleanly with exact base JSON overhead', () => {
      const res = serializeBoundedUrlTelemetry([], []);

      expect(res.crawledUrls).toEqual([]);
      expect(res.browserAuditedUrls).toEqual([]);
      expect(res.truncation.isTruncated).toBe(false);
      expect(res.truncation.crawledUrlsTotal).toBe(0);
      expect(res.truncation.crawledUrlsPersisted).toBe(0);
      expect(res.truncation.crawledUrlsOmitted).toBe(0);
      expect(res.truncation.browserAuditedUrlsTotal).toBe(0);
      expect(res.truncation.browserAuditedUrlsPersisted).toBe(0);
      expect(res.truncation.browserAuditedUrlsOmitted).toBe(0);
      expect(res.truncation.budgetBytes).toBe(MAX_URL_TELEMETRY_BYTES);
      // Base JSON overhead for '{"crawledUrls":[],"browserAuditedUrls":[]}' is 42 UTF-8 bytes
      expect(res.truncation.serializedBytes).toBe(42);
    });
  });
});
