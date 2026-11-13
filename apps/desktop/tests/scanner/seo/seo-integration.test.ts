import { describe, it, expect, vi } from 'vitest';
import { AnalyzerEngine } from '../../../src/main/scanner/analyzers/analyzer-engine.js';
import { AdvancedSeoEngine } from '../../../src/main/scanner/seo/index.js';
import type { SafeHttpClient } from '../../../src/main/scanner/client/http-client.js';
import type { SafeHttpResponse } from '../../../src/main/scanner/client/types.js';
import type { CrawlResult, CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('Advanced Technical SEO Engine - End-to-End Integration', () => {
  const createMockPage = (args: {
    url: string;
    finalUrl?: string;
    statusCode?: number;
    jsonLd?: string[];
    redirectChain?: CrawledPageResult['redirectChain'];
  }): CrawledPageResult => ({
    requestedUrl: args.url,
    finalUrl: args.finalUrl ?? args.url,
    statusCode: args.statusCode ?? 200,
    statusMessage: 'OK',
    headers: null,
    contentType: 'text/html; charset=utf-8',
    depth: 1,
    parentUrl: null,
    encodedBodyBytes: 100,
    decompressedBodyBytes: 100,
    durationMs: 40,
    isHtml: true,
    redirectChain: args.redirectChain,
    parsedDocument: {
      title: 'Integration Test Page',
      metaDescription: 'Description',
      canonicalUrl: args.finalUrl ?? args.url,
      robotsMeta: {
        noindex: false,
        nofollow: false,
        rawDirectives: [],
        isIndexable: true,
        isFollowable: true,
      },
      openGraph: {},
      twitterCard: {},
      headings: { h1: ['Page Title'], h2: [], h3: [] },
      links: [],
      images: [],
      jsonLdScripts: args.jsonLd ?? [],
    },
  });

  const createCrawlResult = (pages: CrawledPageResult[]): CrawlResult => ({
    pages,
    summary: {
      scanId: 'seo-integration-scan-001',
      entryUrl: 'https://example.com/',
      authorizedOrigin: 'https://example.com',
      startedAt: '2026-05-10T10:00:00Z',
      completedAt: '2026-05-10T10:00:05Z',
      durationMs: 5000,
      totalPagesCrawled: pages.length,
      maxDepthReached: 1,
      urlsDiscovered: pages.length,
      urlsSkippedOrigin: 0,
      urlsSkippedLimits: 0,
      urlsSkippedPattern: 0,
      urlsSkippedCanonical: 0,
      urlsSkippedRobots: 0,
      errorsCount: 0,
    },
  });

  it('runs all 4 engines end-to-end via AdvancedSeoEngine orchestrator', async () => {
    const mockResponses: Record<string, string> = {
      'https://example.com/robots.txt': `
        User-agent: *
        Disallow: /admin/
        Sitemap: https://example.com/sitemap.xml
      `,
      'https://example.com/sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/</loc></url>
          <url><loc>https://example.com/orphan</loc></url>
        </urlset>
      `,
    };

    const client = {
      request: vi.fn().mockImplementation(async ({ url }: { url: string }) => {
        if (mockResponses[url]) {
          return {
            statusCode: 200,
            headers: { 'content-type': 'text/plain' },
            text: () => mockResponses[url],
          } as unknown as SafeHttpResponse;
        }
        return {
          statusCode: 404,
          headers: {},
          text: () => 'Not Found',
        } as unknown as SafeHttpResponse;
      }),
    } as unknown as SafeHttpClient;

    const page1 = createMockPage({
      url: 'https://example.com/',
      jsonLd: [
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Valid Article',
          author: { '@type': 'Person', name: 'Tester' },
          datePublished: '2026-01-01',
        }),
      ],
    });

    const page2 = createMockPage({
      url: 'https://example.com/redirect-source',
      finalUrl: 'https://example.com/redirect-dest',
      redirectChain: [
        {
          fromUrl: 'https://example.com/redirect-source',
          toUrl: 'https://example.com/redirect-dest',
          statusCode: 302,
          hopIndex: 0,
        },
      ],
    });

    const crawlResult = createCrawlResult([page1, page2]);
    const advancedSeoEngine = new AdvancedSeoEngine();

    const result = await advancedSeoEngine.runAll({
      crawlResult,
      authorizedOrigin: 'https://example.com',
      entryUrl: 'https://example.com/',
      httpClient: client,
    });

    // 1. Robots engine executed
    expect(result.robots.exists).toBe(true);
    expect(result.robots.sitemapDirectives).toContain('https://example.com/sitemap.xml');

    // 2. Sitemap engine executed
    expect(result.sitemap.discoveredSitemaps).toContain('https://example.com/sitemap.xml');
    expect(result.sitemap.totalUrlsDiscovered).toBe(2);

    // 3. Structured Data engine executed
    expect(result.structuredData.pagesWithStructuredData).toBe(1);

    // 4. Redirect engine executed
    expect(result.redirects.totalTraces).toBe(1);

    // 5. Findings aggregated
    expect(result.allFindings.length).toBeGreaterThan(0);
    for (const f of result.allFindings) {
      expect(f.category).toBe('technical-seo');
    }
  });

  it('runs seamlessly within the main AnalyzerEngine pipeline', async () => {
    const mockResponses: Record<string, string> = {
      'https://example.com/robots.txt': `
        User-agent: *
        Disallow: /
      `,
    };

    const client = {
      request: vi.fn().mockImplementation(async ({ url }: { url: string }) => {
        if (mockResponses[url]) {
          return {
            statusCode: 200,
            headers: { 'content-type': 'text/plain' },
            text: () => mockResponses[url],
          } as unknown as SafeHttpResponse;
        }
        return {
          statusCode: 404,
          headers: {},
          text: () => 'Not Found',
        } as unknown as SafeHttpResponse;
      }),
    } as unknown as SafeHttpClient;

    const pageWithBrokenSchema = createMockPage({
      url: 'https://example.com/bad-schema',
      jsonLd: [`{ invalid json here }`],
    });

    const crawlResult = createCrawlResult([pageWithBrokenSchema]);
    const analyzerEngine = new AnalyzerEngine();

    const result = await analyzerEngine.runAnalysis(crawlResult, {
      authorizedOrigin: 'https://example.com',
      entryUrl: 'https://example.com/',
      httpClient: client,
    });

    // Verify findings include both structured data finding and robots disallow all finding
    const brokenSchemaFinding = result.findings.find(f => f.ruleId === 'SEO_SCHEMA_SYNTAX_ERROR');
    expect(brokenSchemaFinding).toBeDefined();
    expect(brokenSchemaFinding?.category).toBe('technical-seo');

    const disallowAllFinding = result.findings.find(f => f.ruleId === 'SEO_ROBOTS_DISALLOW_ALL');
    expect(disallowAllFinding).toBeDefined();
    expect(disallowAllFinding?.category).toBe('technical-seo');
    expect(disallowAllFinding?.severity).toBe('high');

    // Verify stats
    expect(result.stats.byCategory['technical-seo']).toBeGreaterThanOrEqual(2);
  });
});
