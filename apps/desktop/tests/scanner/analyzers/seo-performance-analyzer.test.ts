import { describe, it, expect } from 'vitest';
import { HtmlParserEngine } from '../../../src/main/scanner/parser/html-parser.js';
import { SeoPerformanceAnalyzer } from '../../../src/main/scanner/analyzers/seo-performance-analyzer.js';
import type { CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('SeoPerformanceAnalyzer', () => {
  const analyzer = new SeoPerformanceAnalyzer();
  const context = {
    authorizedOrigin: 'https://example.com',
    entryUrl: 'https://example.com/',
  };

  const createPage = (
    html: string,
    overrides: Partial<CrawledPageResult> = {},
  ): CrawledPageResult => {
    const url = overrides.requestedUrl ?? 'https://example.com/blog/article';
    const parsedDoc = HtmlParserEngine.parseHtml(html, url, 'https://example.com');
    return {
      requestedUrl: url,
      finalUrl: url,
      statusCode: 200,
      statusMessage: 'OK',
      headers: {},
      contentType: 'text/html; charset=utf-8',
      isHtml: true,
      durationMs: 150,
      depth: 1,
      parentUrl: 'https://example.com/',
      encodedBodyBytes: html.length,
      decompressedBodyBytes: html.length,
      parsedDocument: parsedDoc,
      ...overrides,
    };
  };

  it('detects missing, short, and long titles', () => {
    // 1. Missing title
    const resMissing = analyzer.analyzePage(
      createPage('<html><head></head><body><h1>Hi</h1></body></html>'),
      context,
    );
    expect(resMissing.findings.some(f => f.ruleId === 'SEO_TITLE_MISSING')).toBe(true);

    // 2. Short title (< 10 chars)
    const resShort = analyzer.analyzePage(
      createPage('<html><head><title>Short</title></head><body><h1>Hi</h1></body></html>'),
      context,
    );
    const shortFinding = resShort.findings.find(
      f => f.ruleId === 'SEO_TITLE_LENGTH' && f.title.includes('Too Short'),
    );
    expect(shortFinding).toBeDefined();

    // 3. Long title (> 65 chars)
    const longTitle = 'A'.repeat(80);
    const resLong = analyzer.analyzePage(
      createPage(`<html><head><title>${longTitle}</title></head><body><h1>Hi</h1></body></html>`),
      context,
    );
    const longFinding = resLong.findings.find(
      f => f.ruleId === 'SEO_TITLE_LENGTH' && f.title.includes('Too Long'),
    );
    expect(longFinding).toBeDefined();
  });

  it('detects missing, short, and long descriptions', () => {
    // 1. Missing description
    const resMissing = analyzer.analyzePage(
      createPage(
        '<html><head><title>Valid Page Title Here</title></head><body><h1>Hi</h1></body></html>',
      ),
      context,
    );
    expect(resMissing.findings.some(f => f.ruleId === 'SEO_DESCRIPTION_MISSING')).toBe(true);

    // 2. Short description (< 50 chars)
    const resShort = analyzer.analyzePage(
      createPage(
        '<html><head><title>Valid Page Title Here</title><meta name="description" content="Too brief." /></head><body><h1>Hi</h1></body></html>',
      ),
      context,
    );
    expect(
      resShort.findings.some(
        f => f.ruleId === 'SEO_DESCRIPTION_LENGTH' && f.title.includes('Too Short'),
      ),
    ).toBe(true);

    // 3. Long description (> 160 chars)
    const longDesc = 'A'.repeat(180);
    const resLong = analyzer.analyzePage(
      createPage(
        `<html><head><title>Valid Page Title Here</title><meta name="description" content="${longDesc}" /></head><body><h1>Hi</h1></body></html>`,
      ),
      context,
    );
    expect(
      resLong.findings.some(
        f => f.ruleId === 'SEO_DESCRIPTION_LENGTH' && f.title.includes('Too Long'),
      ),
    ).toBe(true);
  });

  it('evaluates H1 presence and multiplicity', () => {
    // 1. Missing H1
    const resMissing = analyzer.analyzePage(
      createPage('<html><head><title>Page</title></head><body><p>No headings</p></body></html>'),
      context,
    );
    expect(resMissing.findings.some(f => f.ruleId === 'SEO_H1_MISSING')).toBe(true);

    // 2. Multiple H1s
    const resMultiple = analyzer.analyzePage(
      createPage(
        '<html><head><title>Page</title></head><body><h1>First H1</h1><h1>Second H1</h1></body></html>',
      ),
      context,
    );
    expect(resMultiple.findings.some(f => f.ruleId === 'SEO_H1_MULTIPLE')).toBe(true);
  });

  it('detects heading hierarchy gaps (e.g. H1 jumping to H3)', () => {
    const html = `
      <html>
      <head><title>Hierarchy Test</title></head>
      <body>
        <h1>Main Topic</h1>
        <h3>Skipped H2 Subtopic</h3>
      </body>
      </html>
    `;
    const res = analyzer.analyzePage(createPage(html), context);
    const gapFinding = res.findings.find(f => f.ruleId === 'SEO_HEADING_HIERARCHY_GAP');
    expect(gapFinding).toBeDefined();
    expect(gapFinding?.evidence).toMatchObject({ previousLevel: 1, currentLevel: 3 });
  });

  it('validates canonical URL presence, validity, and scope boundaries', () => {
    // 1. Missing canonical
    const resMissing = analyzer.analyzePage(
      createPage('<html><head><title>Title</title></head><body><h1>Hi</h1></body></html>'),
      context,
    );
    expect(resMissing.findings.some(f => f.ruleId === 'SEO_CANONICAL_MISSING')).toBe(true);

    // 2. Out-of-scope / Cross-domain canonical
    const htmlExternal = `
      <html>
      <head>
        <title>Canonical Test</title>
        <link rel="canonical" href="https://external-competitor.com/article" />
      </head>
      <body><h1>Hi</h1></body>
      </html>
    `;
    const resExternal = analyzer.analyzePage(createPage(htmlExternal), context);
    expect(resExternal.findings.some(f => f.ruleId === 'SEO_CANONICAL_OUT_OF_SCOPE')).toBe(true);

    // 3. Valid in-scope canonical
    const htmlValid = `
      <html>
      <head>
        <title>Canonical Test</title>
        <link rel="canonical" href="https://example.com/blog/article" />
      </head>
      <body><h1>Hi</h1></body>
      </html>
    `;
    const resValid = analyzer.analyzePage(createPage(htmlValid), context);
    expect(resValid.findings.some(f => f.ruleId === 'SEO_CANONICAL_MISSING')).toBe(false);
    expect(resValid.findings.some(f => f.ruleId === 'SEO_CANONICAL_OUT_OF_SCOPE')).toBe(false);
  });

  it('evaluates robots meta noindex, viewport, and html lang tags', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Robots Test</title>
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body><h1>Secret Page</h1></body>
      </html>
    `;
    const res = analyzer.analyzePage(createPage(html), context);

    expect(res.findings.some(f => f.ruleId === 'SEO_ROBOTS_NOINDEX')).toBe(true);
    expect(res.findings.some(f => f.ruleId === 'SEO_VIEWPORT_MISSING')).toBe(true);
    expect(res.findings.some(f => f.ruleId === 'SEO_LANG_MISSING')).toBe(true);
  });

  it('detects missing image alt tags', () => {
    const html = `
      <html>
      <head><title>Images Test</title></head>
      <body>
        <h1>Gallery</h1>
        <img src="/photo1.jpg" alt="A lovely mountain" />
        <img src="/photo2.jpg" />
        <img src="/photo3.jpg" alt="" />
      </body>
      </html>
    `;
    const res = analyzer.analyzePage(createPage(html), context);
    const altFinding = res.findings.find(f => f.ruleId === 'SEO_IMG_ALT_MISSING');
    expect(altFinding).toBeDefined();
    expect(altFinding?.evidence).toMatchObject({ missingAltCount: 2, totalImages: 3 });
  });

  it('detects static performance indicators (slow TTFB, large document, excessive assets)', () => {
    const scripts = Array.from(
      { length: 30 },
      (_, i) => `<script src="/js/script-${i}.js"></script>`,
    ).join('\n');
    const html = `
      <html>
      <head><title>Heavy Page</title>${scripts}</head>
      <body><h1>Heavy</h1><img src="/logo.png" /></body>
      </html>
    `;

    const res = analyzer.analyzePage(
      createPage(html, {
        durationMs: 1450, // > 1000ms
        decompressedBodyBytes: 1500000, // > 1MB
      }),
      context,
    );

    expect(res.findings.some(f => f.ruleId === 'PERF_SLOW_SERVER_RESPONSE')).toBe(true);
    expect(res.findings.some(f => f.ruleId === 'PERF_LARGE_HTML_DOCUMENT')).toBe(true);
    expect(res.findings.some(f => f.ruleId === 'PERF_EXCESSIVE_SCRIPTS')).toBe(true);
    expect(res.findings.some(f => f.ruleId === 'PERF_IMG_DIMENSIONS_MISSING')).toBe(true);
  });
});
