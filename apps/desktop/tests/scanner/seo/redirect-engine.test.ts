import { describe, it, expect } from 'vitest';
import { RedirectEngine } from '../../../src/main/scanner/seo/redirect-engine.js';
import type { CrawlResult, CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('Redirect Mapping & Diagnostics Engine', () => {
  const engine = new RedirectEngine();

  const createCrawlResult = (pages: CrawledPageResult[]): CrawlResult => ({
    pages,
    summary: {
      scanId: 'test-scan',
      entryUrl: 'https://example.com/',
      authorizedOrigin: 'https://example.com',
      startedAt: '2026-05-10T00:00:00Z',
      completedAt: '2026-05-10T00:00:10Z',
      durationMs: 10000,
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

  const createPage = (args: {
    requestedUrl: string;
    finalUrl?: string;
    statusCode?: number;
    redirectChain?: CrawledPageResult['redirectChain'];
    discoveredLinks?: string[];
  }): CrawledPageResult => ({
    requestedUrl: args.requestedUrl,
    finalUrl: args.finalUrl ?? args.requestedUrl,
    statusCode: args.statusCode ?? 200,
    statusMessage: 'OK',
    headers: null,
    contentType: 'text/html; charset=utf-8',
    depth: 1,
    parentUrl: null,
    encodedBodyBytes: 100,
    decompressedBodyBytes: 100,
    durationMs: 20,
    isHtml: true,
    redirectChain: args.redirectChain,
    parsedDocument: {
      title: 'Redirect Test',
      metaDescription: 'Desc',
      canonicalUrl: args.finalUrl ?? args.requestedUrl,
      robotsMeta: {
        noindex: false,
        nofollow: false,
        rawDirectives: [],
        isIndexable: true,
        isFollowable: true,
      },
      openGraph: {},
      twitterCard: {},
      headings: { h1: ['Title'], h2: [], h3: [] },
      links: (args.discoveredLinks ?? []).map(href => ({
        href,
        resolvedUrl: href,
        text: 'Link',
        isInternal: true,
        rel: [],
      })),
      images: [],
      jsonLdScripts: [],
    },
  });

  it('detects multi-hop redirect chains (> 1 hop)', () => {
    const pageWithChain = createPage({
      requestedUrl: 'https://example.com/start',
      finalUrl: 'https://example.com/destination',
      redirectChain: [
        {
          fromUrl: 'https://example.com/start',
          toUrl: 'https://example.com/step-1',
          statusCode: 301,
          hopIndex: 0,
        },
        {
          fromUrl: 'https://example.com/step-1',
          toUrl: 'https://example.com/destination',
          statusCode: 301,
          hopIndex: 1,
        },
      ],
    });

    const crawlResult = createCrawlResult([pageWithChain]);
    const result = engine.analyzeSite(crawlResult);

    expect(result.redirectChainsCount).toBe(1);
    expect(result.chainsDetected).toBe(1);
    const chainFinding = result.findings.find(f => f.ruleId === 'SEO_REDIRECT_CHAIN');
    expect(chainFinding).toBeDefined();
    expect(chainFinding?.severity).toBe('low');
    expect(chainFinding?.targetUrl).toBe('https://example.com/start');
  });

  it('detects redirect loops (A -> B -> A)', () => {
    const pageWithLoop = createPage({
      requestedUrl: 'https://example.com/loop-a',
      finalUrl: 'https://example.com/loop-a',
      redirectChain: [
        {
          fromUrl: 'https://example.com/loop-a',
          toUrl: 'https://example.com/loop-b',
          statusCode: 302,
          hopIndex: 0,
        },
        {
          fromUrl: 'https://example.com/loop-b',
          toUrl: 'https://example.com/loop-a',
          statusCode: 302,
          hopIndex: 1,
        },
      ],
    });

    const crawlResult = createCrawlResult([pageWithLoop]);
    const result = engine.analyzeSite(crawlResult);

    expect(result.redirectLoopsCount).toBe(1);
    expect(result.loopsDetected).toBe(1);
    const loopFinding = result.findings.find(f => f.ruleId === 'SEO_REDIRECT_LOOP');
    expect(loopFinding).toBeDefined();
    expect(loopFinding?.severity).toBe('high');
  });

  it('detects excessive hops (>= 4 hops)', () => {
    const pageExcessive = createPage({
      requestedUrl: 'https://example.com/hop-0',
      finalUrl: 'https://example.com/hop-4',
      redirectChain: [
        {
          fromUrl: 'https://example.com/hop-0',
          toUrl: 'https://example.com/hop-1',
          statusCode: 301,
          hopIndex: 0,
        },
        {
          fromUrl: 'https://example.com/hop-1',
          toUrl: 'https://example.com/hop-2',
          statusCode: 301,
          hopIndex: 1,
        },
        {
          fromUrl: 'https://example.com/hop-2',
          toUrl: 'https://example.com/hop-3',
          statusCode: 301,
          hopIndex: 2,
        },
        {
          fromUrl: 'https://example.com/hop-3',
          toUrl: 'https://example.com/hop-4',
          statusCode: 301,
          hopIndex: 3,
        },
      ],
    });

    const crawlResult = createCrawlResult([pageExcessive]);
    const result = engine.analyzeSite(crawlResult);

    const excessiveFinding = result.findings.find(f => f.ruleId === 'SEO_REDIRECT_EXCESSIVE_HOPS');
    expect(excessiveFinding).toBeDefined();
    expect(excessiveFinding?.severity).toBe('medium');
  });

  it('detects temporary 302/307 redirects used for permanent URL structures', () => {
    const pageTemp = createPage({
      requestedUrl: 'https://example.com/old-url',
      finalUrl: 'https://example.com/new-url',
      redirectChain: [
        {
          fromUrl: 'https://example.com/old-url',
          toUrl: 'https://example.com/new-url',
          statusCode: 302,
          hopIndex: 0,
        },
      ],
    });

    const crawlResult = createCrawlResult([pageTemp]);
    const result = engine.analyzeSite(crawlResult);

    const tempFinding = result.findings.find(
      f => f.ruleId === 'SEO_REDIRECT_TEMPORARY_FOR_PERMANENT',
    );
    expect(tempFinding).toBeDefined();
    expect(tempFinding?.severity).toBe('info');
  });

  it('detects trailing slash normalization redirects', () => {
    const pageTrailingSlash = createPage({
      requestedUrl: 'https://example.com/products',
      finalUrl: 'https://example.com/products/',
      redirectChain: [
        {
          fromUrl: 'https://example.com/products',
          toUrl: 'https://example.com/products/',
          statusCode: 301,
          hopIndex: 0,
        },
      ],
    });

    const crawlResult = createCrawlResult([pageTrailingSlash]);
    const result = engine.analyzeSite(crawlResult);

    const slashFinding = result.findings.find(f => f.ruleId === 'SEO_REDIRECT_TRAILING_SLASH');
    expect(slashFinding).toBeDefined();
    expect(slashFinding?.severity).toBe('info');
  });

  it('detects HTTP to HTTPS redirects', () => {
    const pageProtocol = createPage({
      requestedUrl: 'http://example.com/page',
      finalUrl: 'https://example.com/page',
      redirectChain: [
        {
          fromUrl: 'http://example.com/page',
          toUrl: 'https://example.com/page',
          statusCode: 301,
          hopIndex: 0,
        },
      ],
    });

    const crawlResult = createCrawlResult([pageProtocol]);
    const result = engine.analyzeSite(crawlResult);

    const protocolFinding = result.findings.find(f => f.ruleId === 'SEO_REDIRECT_HTTP_TO_HTTPS');
    expect(protocolFinding).toBeDefined();
    expect(protocolFinding?.severity).toBe('info');
  });

  it('detects broken destination when final response is 404 or 500', () => {
    const pageBroken = createPage({
      requestedUrl: 'https://example.com/broken-redirect',
      finalUrl: 'https://example.com/missing-destination',
      statusCode: 404,
      redirectChain: [
        {
          fromUrl: 'https://example.com/broken-redirect',
          toUrl: 'https://example.com/missing-destination',
          statusCode: 301,
          hopIndex: 0,
        },
      ],
    });

    const crawlResult = createCrawlResult([pageBroken]);
    const result = engine.analyzeSite(crawlResult);

    const brokenFinding = result.findings.find(f => f.ruleId === 'SEO_REDIRECT_BROKEN_DESTINATION');
    expect(brokenFinding).toBeDefined();
    expect(brokenFinding?.severity).toBe('medium');
  });

  it('detects internal links pointing directly to redirecting endpoints', () => {
    const sourcePage = createPage({
      requestedUrl: 'https://example.com/',
      discoveredLinks: ['https://example.com/legacy-link'],
    });

    const redirectingPage = createPage({
      requestedUrl: 'https://example.com/legacy-link',
      finalUrl: 'https://example.com/modern-link',
      redirectChain: [
        {
          fromUrl: 'https://example.com/legacy-link',
          toUrl: 'https://example.com/modern-link',
          statusCode: 301,
          hopIndex: 0,
        },
      ],
    });

    const crawlResult = createCrawlResult([sourcePage, redirectingPage]);
    const result = engine.analyzeSite(crawlResult);

    const internalFinding = result.findings.find(
      f => f.ruleId === 'SEO_REDIRECT_INTERNAL_LINK_TO_REDIRECT',
    );
    expect(internalFinding).toBeDefined();
    expect(internalFinding?.severity).toBe('low');
    expect(internalFinding?.evidence?.samples?.[0]?.linkTarget).toBe(
      'https://example.com/legacy-link',
    );
  });
});
