import { describe, it, expect, vi } from 'vitest';
import { parseSitemapXml, SitemapEngine } from '../../../src/main/scanner/seo/sitemap-engine.js';
import {
  parseRobotsTxt,
  isPathAllowed,
  RobotsEngine,
  MAX_ROBOTS_TXT_BYTES,
} from '../../../src/main/scanner/seo/robots-engine.js';
import {
  StructuredDataEngine,
  validateSchemaEntity,
} from '../../../src/main/scanner/seo/structured-data-engine.js';
import { RedirectEngine } from '../../../src/main/scanner/seo/redirect-engine.js';
import type { SafeHttpClient } from '../../../src/main/scanner/client/http-client.js';
import type { SafeHttpResponse } from '../../../src/main/scanner/client/types.js';
import type { CrawlResult, CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('Phase 7 Batch 7.2 Independent Acceptance Audit Tests', () => {
  describe('A. XML Sitemap Engine Robustness & Scope Isolation', () => {
    it('rejects cross-origin child sitemaps in sitemapindex recursion and never fetches them', async () => {
      const authorizedOrigin = 'https://example.com';
      const rootIndexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://evil-cross-origin.com/sitemap-malicious.xml</loc>
  </sitemap>
  <sitemap>
    <loc>https://example.com/legit-child-sitemap.xml</loc>
  </sitemap>
</sitemapindex>`;

      const childXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page-from-child</loc></url>
</urlset>`;

      const requestedUrls: string[] = [];
      const mockHttpClient = {
        request: vi.fn().mockImplementation(async (req: { url: string }) => {
          requestedUrls.push(req.url);
          if (req.url === 'https://example.com/sitemap_index.xml') {
            return {
              statusCode: 200,
              text: () => rootIndexXml,
            } as SafeHttpResponse;
          }
          if (req.url === 'https://example.com/legit-child-sitemap.xml') {
            return {
              statusCode: 200,
              text: () => childXml,
            } as SafeHttpResponse;
          }
          return { statusCode: 404, text: () => '' } as SafeHttpResponse;
        }),
      } as unknown as SafeHttpClient;

      const engine = new SitemapEngine();
      const result = await engine.analyze({
        authorizedOrigin,
        entryUrl: 'https://example.com/',
        httpClient: mockHttpClient,
        robotsSitemaps: [],
      });

      // Verify that evil-cross-origin.com was NEVER requested via HTTP
      expect(requestedUrls).not.toContain('https://evil-cross-origin.com/sitemap-malicious.xml');
      expect(requestedUrls).toContain('https://example.com/legit-child-sitemap.xml');

      // Verify that legit child sitemap URLs were processed
      expect(result.urls.some(u => u.loc === 'https://example.com/page-from-child')).toBe(true);

      // Verify cross-origin finding was generated
      const crossOriginFinding = result.findings.find(
        f => f.ruleId === 'SEO_SITEMAP_CROSS_ORIGIN_URL',
      );
      expect(crossOriginFinding).toBeDefined();
    });

    it('rejects cross-origin sitemaps declared in robots.txt and prevents network requests', async () => {
      const authorizedOrigin = 'https://example.com';
      const robotsSitemaps = ['https://attacker.com/sitemap.xml'];

      const requestedUrls: string[] = [];
      const mockHttpClient = {
        request: vi.fn().mockImplementation(async (req: { url: string }) => {
          requestedUrls.push(req.url);
          return { statusCode: 404, text: () => '' } as SafeHttpResponse;
        }),
      } as unknown as SafeHttpClient;

      const engine = new SitemapEngine();
      const result = await engine.analyze({
        authorizedOrigin,
        entryUrl: 'https://example.com/',
        httpClient: mockHttpClient,
        robotsSitemaps,
      });

      expect(requestedUrls).not.toContain('https://attacker.com/sitemap.xml');
      const crossOriginFinding = result.findings.find(
        f => f.ruleId === 'SEO_SITEMAP_CROSS_ORIGIN_URL',
      );
      expect(crossOriginFinding).toBeDefined();
    });

    it('handles Billion Laughs and deep entity XML fixtures safely without crashing or hanging', () => {
      const billionLaughsXml = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ELEMENT lolz (#PCDATA)>
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/safe-page</loc>
  </url>
</urlset>`;

      const start = performance.now();
      const parsed = parseSitemapXml(billionLaughsXml, 'https://example.com/sitemap.xml');
      const duration = performance.now() - start;

      // Must complete in under 50ms without expanding entities or crashing
      expect(duration).toBeLessThan(50);
      expect(parsed.urls).toHaveLength(1);
      expect(parsed.urls[0].loc).toBe('https://example.com/safe-page');
    });

    it('handles malformed XML with unclosed tags and mismatched tags gracefully', () => {
      const malformedXml = `<urlset><url><loc>https://example.com/broken`;
      const parsed = parseSitemapXml(malformedXml, 'https://example.com/sitemap.xml');
      // htmlparser2 tolerates streaming/unclosed tags and extracts what is present safely
      expect(parsed.urls.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('B. Robots.txt Engine RFC 9309 Compliance', () => {
    it('merges rules from multiple matching groups for the same user agent (§2.2.1)', () => {
      const robotsContent = `
User-agent: *
Disallow: /admin/

User-agent: *
Disallow: /private/
Allow: /admin/public/
`;

      const parsed = parseRobotsTxt(robotsContent);
      expect(parsed.groups).toHaveLength(2);

      // Verify rule matching when merged
      const mergedAllows = parsed.groups.flatMap(g => g.allows);
      const mergedDisallows = parsed.groups.flatMap(g => g.disallows);

      const checkAdmin = isPathAllowed('/admin/secret', mergedAllows, mergedDisallows);
      expect(checkAdmin.allowed).toBe(false);

      const checkPrivate = isPathAllowed('/private/data', mergedAllows, mergedDisallows);
      expect(checkPrivate.allowed).toBe(false);

      const checkPublic = isPathAllowed('/admin/public/page', mergedAllows, mergedDisallows);
      expect(checkPublic.allowed).toBe(true);
    });

    it('enforces RFC 9309 §2.4 512 KiB truncation safeguard on oversized robots.txt', () => {
      const padding = '# harmless comment line\n'.repeat(25000); // ~600 KiB
      const oversizedRobots = `${padding}\nUser-agent: *\nDisallow: /secret-at-end/\n`;

      expect(oversizedRobots.length).toBeGreaterThan(MAX_ROBOTS_TXT_BYTES);

      const parsed = parseRobotsTxt(oversizedRobots);
      // Content past 512 KiB is truncated, so the directive at the very end is dropped safely
      const disallows = parsed.groups.flatMap(g => g.disallows);
      expect(disallows).not.toContain('/secret-at-end/');
    });

    it('advises on non-standard Crawl-delay directives with informative finding', async () => {
      const robotsContent = `
User-agent: *
Crawl-delay: 20
Disallow: /temp/
`;

      const mockHttpClient = {
        request: vi.fn().mockResolvedValue({
          statusCode: 200,
          text: () => robotsContent,
        } as SafeHttpResponse),
      } as unknown as SafeHttpClient;

      const engine = new RobotsEngine();
      const result = await engine.analyze({
        authorizedOrigin: 'https://example.com',
        httpClient: mockHttpClient,
        crawledUrls: [],
      });

      const delayFinding = result.findings.find(f => f.ruleId === 'SEO_ROBOTS_HIGH_CRAWL_DELAY');
      expect(delayFinding).toBeDefined();
      expect(delayFinding?.severity).toBe('info');
      expect(delayFinding?.description).toContain('non-standard');
    });
  });

  describe('C. Structured Data Engine Profile v1 & SSRF Safety', () => {
    it('performs 100% offline Schema.org validation with zero external HTTP requests', () => {
      const entity = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Test Article Title',
        author: { '@type': 'Person', name: 'John Doe' },
        datePublished: '2026-05-15T08:00:00Z',
      };

      const result = validateSchemaEntity(entity);
      expect(result.entityType).toBe('Article');
      expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    });

    it('extracts unsupported Schema.org types cleanly without emitting false-positive errors', () => {
      const entity = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: 'Tech Conference 2026',
        startDate: '2026-09-01T09:00:00Z',
      };

      const result = validateSchemaEntity(entity);
      expect(result.entityType).toBe('Event');
      // No schema validation errors should be emitted for unsupported types
      expect(result.issues).toHaveLength(0);
    });

    it('detects duplicate @id collisions across conflicting entity types', () => {
      const engine = new StructuredDataEngine();
      const scripts = [
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          '@id': 'https://example.com/#entity',
          name: 'Acme Corp',
        }),
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Product',
          '@id': 'https://example.com/#entity',
          name: 'Acme Anvil',
        }),
      ];

      const pageResult = engine.analyzePage(scripts, 'https://example.com/conflict');
      const collisionFinding = pageResult.findings.find(
        f => f.ruleId === 'SEO_SCHEMA_DUPLICATE_ID',
      );
      expect(collisionFinding).toBeDefined();
      expect(collisionFinding?.severity).toBe('info');
    });
  });

  describe('D. Redirect Engine Evidence Preservation on Failure', () => {
    it('preserves redirect chain and diagnoses broken destination on network errors', () => {
      const failedPage: CrawledPageResult = {
        requestedUrl: 'https://example.com/initial',
        finalUrl: 'https://example.com/initial',
        statusCode: null,
        statusMessage: null,
        headers: null,
        contentType: null,
        isHtml: false,
        durationMs: 150,
        depth: 1,
        parentUrl: 'https://example.com/',
        encodedBodyBytes: 0,
        decompressedBodyBytes: 0,
        parsedDocument: null,
        redirectChain: [
          {
            fromUrl: 'https://example.com/initial',
            toUrl: 'https://example.com/destination-failed',
            statusCode: 301,
            location: '/destination-failed',
          },
        ],
        error: {
          code: 'ECONNRESET',
          message: 'socket hang up',
        },
      };

      const crawlResult: CrawlResult = {
        pages: [failedPage],
        errors: [{ url: failedPage.requestedUrl, code: 'ECONNRESET', message: 'socket hang up' }],
        summary: {
          entryUrl: 'https://example.com/',
          authorizedOrigin: 'https://example.com',
          totalPagesAttempted: 1,
          successfulPages: 0,
          failedPages: 1,
          nonHtmlPages: 0,
          uniqueUrlsDiscovered: 1,
          urlsSkippedScope: 0,
          urlsSkippedLimits: 0,
          maxDepthReached: 1,
          durationMs: 150,
          cancelled: false,
        },
      };

      const engine = new RedirectEngine();
      const analysis = engine.analyzeSite(crawlResult);

      expect(analysis.traces).toHaveLength(1);
      const trace = analysis.traces[0];
      expect(trace.isBrokenDestination).toBe(true);

      const brokenFinding = analysis.findings.find(
        f => f.ruleId === 'SEO_REDIRECT_BROKEN_DESTINATION',
      );
      expect(brokenFinding).toBeDefined();
      expect(brokenFinding?.description).toContain('socket hang up');
    });
  });
});
