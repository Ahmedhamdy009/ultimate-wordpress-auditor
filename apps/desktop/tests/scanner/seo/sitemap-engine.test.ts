import { describe, it, expect, vi } from 'vitest';
import { parseSitemapXml, SitemapEngine } from '../../../src/main/scanner/seo/sitemap-engine.js';
import type { SafeHttpClient } from '../../../src/main/scanner/client/http-client.js';
import type { SafeHttpResponse } from '../../../src/main/scanner/client/types.js';
import type { CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('XML Sitemap Analysis Engine', () => {
  describe('parseSitemapXml', () => {
    it('parses standard <urlset> with loc, lastmod, changefreq, priority', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page1</loc>
    <lastmod>2026-05-10T12:00:00Z</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://example.com/page2</loc>
  </url>
</urlset>`;

      const parsed = parseSitemapXml(xml, 'https://example.com/sitemap.xml');
      expect(parsed.isIndex).toBe(false);
      expect(parsed.urls).toHaveLength(2);
      expect(parsed.urls[0].loc).toBe('https://example.com/page1');
      expect(parsed.urls[0].lastmod).toBe('2026-05-10T12:00:00Z');
      expect(parsed.urls[0].changefreq).toBe('daily');
      expect(parsed.urls[0].priority).toBe(0.8);
      expect(parsed.urls[1].loc).toBe('https://example.com/page2');
      expect(parsed.errors).toHaveLength(0);
    });

    it('parses <sitemapindex> containing child sitemaps', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/post-sitemap.xml</loc>
    <lastmod>2026-05-01</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://example.com/page-sitemap.xml</loc>
  </sitemap>
</sitemapindex>`;

      const parsed = parseSitemapXml(xml, 'https://example.com/sitemap_index.xml');
      expect(parsed.isIndex).toBe(true);
      expect(parsed.sitemapIndexes).toHaveLength(2);
      expect(parsed.sitemapIndexes[0].loc).toBe('https://example.com/post-sitemap.xml');
      expect(parsed.urls).toHaveLength(0);
      expect(parsed.errors).toHaveLength(0);
    });

    it('neutralizes DTD and external entity injection attempts safely', () => {
      const maliciousXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [  
  <!ELEMENT foo ANY>
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/test</loc>
  </url>
</urlset>`;

      const parsed = parseSitemapXml(maliciousXml, 'https://example.com/sitemap.xml');
      expect(parsed.urls).toHaveLength(1);
      expect(parsed.urls[0].loc).toBe('https://example.com/test');
    });

    it('reports errors for non-sitemap XML or malformed structures', () => {
      const garbageXml = `<html><body>Not a sitemap</body></html>`;
      const parsed = parseSitemapXml(garbageXml, 'https://example.com/sitemap.xml');
      expect(parsed.errors.length).toBeGreaterThan(0);
      expect(parsed.errors[0]).toContain('Root element is neither <urlset> nor <sitemapindex>');
    });
  });

  describe('SitemapEngine.analyze', () => {
    const createPage = (url: string, indexable = true): CrawledPageResult => ({
      requestedUrl: url,
      finalUrl: url,
      statusCode: 200,
      statusMessage: 'OK',
      headers: null,
      contentType: 'text/html; charset=utf-8',
      depth: 1,
      parentUrl: null,
      encodedBodyBytes: 100,
      decompressedBodyBytes: 100,
      durationMs: 100,
      isHtml: true,
      parsedDocument: {
        title: 'Test',
        metaDescription: 'Desc',
        canonicalUrl: url,
        robotsMeta: {
          noindex: !indexable,
          nofollow: false,
          rawDirectives: [],
          isIndexable: indexable,
          isFollowable: true,
        },
        openGraph: {},
        twitterCard: {},
        headings: { h1: ['Title'], h2: [], h3: [] },
        links: [],
        images: [],
        jsonLdScripts: [],
      },
    });

    it('discovers sitemaps, expands indexes, and flags duplicate and cross-origin entries', async () => {
      const engine = new SitemapEngine();

      const mockResponses: Record<string, string> = {
        'https://example.com/sitemap_index.xml': `
          <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <sitemap><loc>https://example.com/child-sitemap.xml</loc></sitemap>
          </sitemapindex>`,
        'https://example.com/child-sitemap.xml': `
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/home</loc><lastmod>2026-05-11</lastmod></url>
            <url><loc>https://example.com/home</loc></url>
            <url><loc>https://attacker.com/malicious</loc></url>
            <url><loc>https://example.com/blog</loc><lastmod>invalid-date-string</lastmod></url>
          </urlset>`,
      };

      const client = {
        request: vi.fn().mockImplementation(async ({ url }: { url: string }) => {
          if (mockResponses[url]) {
            return {
              statusCode: 200,
              text: () => mockResponses[url],
            } as unknown as SafeHttpResponse;
          }
          return {
            statusCode: 404,
            text: () => 'Not found',
          } as unknown as SafeHttpResponse;
        }),
      } as unknown as SafeHttpClient;

      const result = await engine.analyze({
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        httpClient: client,
        crawledPages: [createPage('https://example.com/home')],
      });

      expect(result.discoveredSitemaps).toContain('https://example.com/sitemap_index.xml');
      expect(result.discoveredSitemaps).toContain('https://example.com/child-sitemap.xml');
      expect(result.totalUrlsDiscovered).toBe(4);

      // Verify findings
      const duplicateFinding = result.findings.find(f => f.ruleId === 'SEO_SITEMAP_DUPLICATE_URL');
      expect(duplicateFinding).toBeDefined();

      const crossOriginFinding = result.findings.find(
        f => f.ruleId === 'SEO_SITEMAP_CROSS_ORIGIN_URL',
      );
      expect(crossOriginFinding).toBeDefined();

      const invalidDateFinding = result.findings.find(f => f.ruleId === 'SEO_SITEMAP_INVALID_DATE');
      expect(invalidDateFinding).toBeDefined();
    });

    it('cross-references crawled pages and flags missing pages and uncrawled sitemap URLs', async () => {
      const engine = new SitemapEngine();

      const sitemapXml = `
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/sitemap-only-page</loc></url>
        </urlset>`;

      const client = {
        request: vi.fn().mockImplementation(async ({ url }: { url: string }) => {
          if (url === 'https://example.com/sitemap.xml') {
            return {
              statusCode: 200,
              text: () => sitemapXml,
            } as unknown as SafeHttpResponse;
          }
          return { statusCode: 404, text: () => '' } as unknown as SafeHttpResponse;
        }),
      } as unknown as SafeHttpClient;

      const crawledPages = [createPage('https://example.com/crawled-content-page', true)];

      const result = await engine.analyze({
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        httpClient: client,
        crawledPages,
        isCrawlPartial: false,
      });

      // 1. Crawled content page missing from sitemap
      const missingFinding = result.findings.find(
        f => f.ruleId === 'SEO_SITEMAP_PAGE_NOT_IN_SITEMAP',
      );
      expect(missingFinding).toBeDefined();
      expect(result.discrepancies.some(d => d.type === 'missing_from_sitemap')).toBe(true);

      // 2. Sitemap URL not crawled (potential orphan)
      const uncrawledFinding = result.findings.find(
        f => f.ruleId === 'SEO_SITEMAP_URL_NOT_CRAWLED',
      );
      expect(uncrawledFinding).toBeDefined();
      expect(uncrawledFinding?.confidence).toBe('confirmed');
    });

    it('classifies uncrawled sitemap URLs as potential when crawl was partial', async () => {
      const engine = new SitemapEngine();

      const sitemapXml = `
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/deep-page</loc></url>
        </urlset>`;

      const client = {
        request: vi.fn().mockImplementation(async ({ url }: { url: string }) => {
          if (url === 'https://example.com/sitemap.xml') {
            return {
              statusCode: 200,
              text: () => sitemapXml,
            } as unknown as SafeHttpResponse;
          }
          return { statusCode: 404, text: () => '' } as unknown as SafeHttpResponse;
        }),
      } as unknown as SafeHttpClient;

      const result = await engine.analyze({
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        httpClient: client,
        crawledPages: [createPage('https://example.com/', true)],
        isCrawlPartial: true,
      });

      const uncrawledFinding = result.findings.find(
        f => f.ruleId === 'SEO_SITEMAP_URL_NOT_CRAWLED',
      );
      expect(uncrawledFinding).toBeDefined();
      expect(uncrawledFinding?.confidence).toBe('potential');
      expect(uncrawledFinding?.status).toBe('needs_manual_review');
    });

    it('reports missing sitemap finding when no candidate sitemaps return 200', async () => {
      const engine = new SitemapEngine();
      const client = {
        request: vi.fn().mockResolvedValue({
          statusCode: 404,
          text: () => 'Not found',
        } as unknown as SafeHttpResponse),
      } as unknown as SafeHttpClient;

      const result = await engine.analyze({
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        httpClient: client,
      });

      expect(result.discoveredSitemaps).toHaveLength(0);
      expect(result.findings.some(f => f.ruleId === 'SEO_SITEMAP_MISSING')).toBe(true);
    });
  });
});
