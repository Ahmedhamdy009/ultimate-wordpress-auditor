import { describe, it, expect } from 'vitest';
import { HtmlParserEngine } from '../../../src/main/scanner/parser/html-parser.js';
import { CrossPageAnalyzer } from '../../../src/main/scanner/analyzers/cross-page-analyzer.js';
import type { CrawlResult, CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('CrossPageAnalyzer', () => {
  const analyzer = new CrossPageAnalyzer();
  const context = {
    authorizedOrigin: 'https://example.com',
    entryUrl: 'https://example.com/',
  };

  const createPage = (
    url: string,
    html: string,
    statusCode = 200,
    statusMessage = 'OK',
    error?: { code: string; message: string },
  ): CrawledPageResult => {
    const parsedDoc = html ? HtmlParserEngine.parseHtml(html, url, 'https://example.com') : null;
    return {
      requestedUrl: url,
      finalUrl: url,
      statusCode,
      statusMessage,
      headers: {},
      contentType: 'text/html; charset=utf-8',
      isHtml: Boolean(html),
      durationMs: 100,
      depth: 0,
      parentUrl: null,
      encodedBodyBytes: html.length,
      decompressedBodyBytes: html.length,
      parsedDocument: parsedDoc,
      error,
    };
  };

  it('detects duplicate page titles across distinct crawled URLs', () => {
    const page1 = createPage(
      'https://example.com/page1',
      '<html><head><title>Duplicate Title</title></head><body><h1>P1</h1></body></html>',
    );
    const page2 = createPage(
      'https://example.com/page2',
      '<html><head><title>Duplicate Title</title></head><body><h1>P2</h1></body></html>',
    );
    const page3 = createPage(
      'https://example.com/page3',
      '<html><head><title>Unique Title</title></head><body><h1>P3</h1></body></html>',
    );

    const crawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 3,
        successfulPages: 3,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 3,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 1,
        durationMs: 300,
        cancelled: false,
      },
      pages: [page1, page2, page3],
      discoveredUrls: [
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
      ],
      errors: [],
    };

    const res = analyzer.analyzeSite(crawlResult, context);

    const dupTitle = res.findings.find(f => f.ruleId === 'CONTENT_DUPLICATE_TITLE');
    expect(dupTitle).toBeDefined();
    expect(dupTitle?.evidence).toMatchObject({
      title: 'duplicate title',
      count: 2,
      affectedUrls: ['https://example.com/page1', 'https://example.com/page2'],
    });
    expect(res.data.duplicateTitlesCount).toBe(1);
  });

  it('detects duplicate meta descriptions across distinct URLs', () => {
    const page1 = createPage(
      'https://example.com/service-a',
      '<html><head><title>Service A</title><meta name="description" content="Best services in town" /></head><body><h1>A</h1></body></html>',
    );
    const page2 = createPage(
      'https://example.com/service-b',
      '<html><head><title>Service B</title><meta name="description" content="Best services in town" /></head><body><h1>B</h1></body></html>',
    );

    const crawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 2,
        successfulPages: 2,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 2,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 1,
        durationMs: 200,
        cancelled: false,
      },
      pages: [page1, page2],
      discoveredUrls: ['https://example.com/service-a', 'https://example.com/service-b'],
      errors: [],
    };

    const res = analyzer.analyzeSite(crawlResult, context);

    const dupDesc = res.findings.find(f => f.ruleId === 'CONTENT_DUPLICATE_DESCRIPTION');
    expect(dupDesc).toBeDefined();
    expect(dupDesc?.evidence).toMatchObject({
      count: 2,
      affectedUrls: ['https://example.com/service-a', 'https://example.com/service-b'],
    });
    expect(res.data.duplicateDescriptionsCount).toBe(1);
  });

  it('detects broken internal links referencing HTTP 404 and 500 error pages', () => {
    const sourcePage = createPage(
      'https://example.com/articles',
      `<html><head><title>Articles</title></head><body>
        <h1>Articles</h1>
        <a href="/missing-page">Read Missing Article</a>
        <a href="/crash-page">Server Error Article</a>
      </body></html>`,
    );

    const missingPage = createPage('https://example.com/missing-page', '', 404, 'Not Found');
    const crashPage = createPage(
      'https://example.com/crash-page',
      '',
      500,
      'Internal Server Error',
    );

    const crawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 3,
        successfulPages: 1,
        failedPages: 2,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 3,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 1,
        durationMs: 350,
        cancelled: false,
      },
      pages: [sourcePage, missingPage, crashPage],
      discoveredUrls: [
        'https://example.com/articles',
        'https://example.com/missing-page',
        'https://example.com/crash-page',
      ],
      errors: [],
    };

    const res = analyzer.analyzeSite(crawlResult, context);

    const broken404 = res.findings.find(
      f => f.ruleId === 'SEO_BROKEN_INTERNAL_LINK' && f.title.includes('404'),
    );
    expect(broken404).toBeDefined();
    expect(broken404?.severity).toBe('medium');
    expect(broken404?.evidence).toMatchObject({
      sourceUrl: 'https://example.com/articles',
      targetUrl: 'https://example.com/missing-page',
      statusCode: 404,
    });

    const broken500 = res.findings.find(
      f => f.ruleId === 'SEO_BROKEN_INTERNAL_LINK' && f.title.includes('500'),
    );
    expect(broken500).toBeDefined();
    expect(broken500?.severity).toBe('high');
    expect(res.data.brokenInternalLinksCount).toBe(2);
  });
});
