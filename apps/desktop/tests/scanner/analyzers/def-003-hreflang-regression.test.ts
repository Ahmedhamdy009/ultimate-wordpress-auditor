import { describe, expect, it } from 'vitest';
import { HtmlParserEngine } from '../../../src/main/scanner/parser/html-parser.js';
import { SeoPerformanceAnalyzer } from '../../../src/main/scanner/analyzers/seo-performance-analyzer.js';
import { CrossPageAnalyzer } from '../../../src/main/scanner/analyzers/cross-page-analyzer.js';
import type { CrawledPageResult, CrawlResult } from '../../../src/main/scanner/crawler/types.js';
import type { AnalyzerContext } from '../../../src/main/scanner/analyzers/types.js';

describe('DEF-003 Hreflang Extraction and Validation Regression Suite', () => {
  const parser = new HtmlParserEngine();
  const pageAnalyzer = new SeoPerformanceAnalyzer();
  const crossPageAnalyzer = new CrossPageAnalyzer();

  const mockContext: AnalyzerContext = {
    scanId: 'scan-def003-test',
    targetUrl: 'https://example.com/',
    crawlStartedAt: Date.now(),
  };

  function createCrawledPage(
    url: string,
    html: string,
    options: {
      statusCode?: number;
      finalUrl?: string;
      error?: { code: string; message: string };
      authorizedOrigin?: string;
    } = {},
  ): CrawledPageResult {
    const authorizedOrigin = options.authorizedOrigin || 'https://example.com';
    const parsedDocument = parser.parse(html, url, authorizedOrigin);
    return {
      requestedUrl: url,
      finalUrl: options.finalUrl || url,
      statusCode: options.statusCode !== undefined ? options.statusCode : 200,
      statusMessage: options.statusCode === 404 ? 'Not Found' : 'OK',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      contentType: 'text/html',
      isHtml: true,
      durationMs: 150,
      depth: 1,
      parentUrl: null,
      encodedBodyBytes: Buffer.byteLength(html),
      decompressedBodyBytes: Buffer.byteLength(html),
      parsedDocument,
      error: options.error,
    };
  }

  // =========================================================================
  // PAGE-LEVEL TESTS
  // =========================================================================

  it('1. Flags invalid language tags with BCP 47 reason (SEO_HREFLANG_INVALID_TAG)', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Test Page</title>
        <meta name="description" content="A valid meta description for testing hreflang." />
        <link rel="canonical" href="https://example.com/en" />
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="en_US" href="https://example.com/en-us" />
        <link rel="alternate" hreflang="123" href="https://example.com/123" />
      </head>
      <body><h1>Valid H1</h1></body>
      </html>
    `;

    const page = createCrawledPage('https://example.com/en', html);
    const result = pageAnalyzer.analyzePage(page, mockContext);

    const invalidFindings = result.findings.filter(f => f.ruleId === 'SEO_HREFLANG_INVALID_TAG');
    expect(invalidFindings).toHaveLength(2);

    const underscoreFinding = invalidFindings.find(
      f => (f.evidence as { rawHreflang: string }).rawHreflang === 'en_US',
    );
    expect(underscoreFinding).toBeDefined();
    expect(underscoreFinding?.severity).toBe('medium');
    expect(underscoreFinding?.category).toBe('technical-seo');
    expect(underscoreFinding?.confidence).toBe('confirmed');
    expect((underscoreFinding?.evidence as { reason: string }).reason).toContain(
      'BCP 47 requires hyphens (-) instead of underscores (_)',
    );

    const numericFinding = invalidFindings.find(
      f => (f.evidence as { rawHreflang: string }).rawHreflang === '123',
    );
    expect(numericFinding).toBeDefined();
  });

  it('2. Flags invalid or missing x-default URL (SEO_HREFLANG_X_DEFAULT_INVALID)', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Test Page</title>
        <meta name="description" content="Valid description." />
        <link rel="canonical" href="https://example.com/en" />
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="x-default" href="" />
      </head>
      <body><h1>Title</h1></body>
      </html>
    `;

    const page = createCrawledPage('https://example.com/en', html);
    const result = pageAnalyzer.analyzePage(page, mockContext);

    const xDefFinding = result.findings.find(f => f.ruleId === 'SEO_HREFLANG_X_DEFAULT_INVALID');
    expect(xDefFinding).toBeDefined();
    expect(xDefFinding?.severity).toBe('medium');
    expect(xDefFinding?.category).toBe('technical-seo');
  });

  it('3. Flags conflicting URLs declared for the same language (SEO_HREFLANG_CONFLICTING_URLS)', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Test Page</title>
        <meta name="description" content="Valid description." />
        <link rel="canonical" href="https://example.com/en" />
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="es" href="https://example.com/es-page-1" />
        <link rel="alternate" hreflang="es" href="https://example.com/es-page-2" />
      </head>
      <body><h1>Title</h1></body>
      </html>
    `;

    const page = createCrawledPage('https://example.com/en', html);
    const result = pageAnalyzer.analyzePage(page, mockContext);

    const conflict = result.findings.find(f => f.ruleId === 'SEO_HREFLANG_CONFLICTING_URLS');
    expect(conflict).toBeDefined();
    expect(conflict?.severity).toBe('medium');
    expect((conflict?.evidence as { conflictingUrls: string[] }).conflictingUrls).toHaveLength(2);
  });

  it('4. Flags exact duplicate hreflang declarations (SEO_HREFLANG_DUPLICATE_DECLARATION)', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Test Page</title>
        <meta name="description" content="Valid description." />
        <link rel="canonical" href="https://example.com/en" />
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
      </head>
      <body><h1>Title</h1></body>
      </html>
    `;

    const page = createCrawledPage('https://example.com/en', html);
    const result = pageAnalyzer.analyzePage(page, mockContext);

    const dup = result.findings.find(f => f.ruleId === 'SEO_HREFLANG_DUPLICATE_DECLARATION');
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe('low');
    expect((dup?.evidence as { count: number }).count).toBe(2);
  });

  it('5. Flags missing self-reference when alternates are declared (SEO_HREFLANG_MISSING_SELF_REFERENCE)', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Test Page</title>
        <meta name="description" content="Valid description." />
        <link rel="canonical" href="https://example.com/en" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
        <link rel="alternate" hreflang="fr" href="https://example.com/fr" />
      </head>
      <body><h1>Title</h1></body>
      </html>
    `;

    const page = createCrawledPage('https://example.com/en', html);
    const result = pageAnalyzer.analyzePage(page, mockContext);

    const selfRefFinding = result.findings.find(
      f => f.ruleId === 'SEO_HREFLANG_MISSING_SELF_REFERENCE',
    );
    expect(selfRefFinding).toBeDefined();
    expect(selfRefFinding?.severity).toBe('low');
    expect(selfRefFinding?.confidence).toBe('confirmed');
  });

  // =========================================================================
  // CROSS-PAGE TESTS
  // =========================================================================

  it('6. Approves fully reciprocal multilingual cluster without false positives', () => {
    const htmlEn = `
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
        <link rel="alternate" hreflang="x-default" href="https://example.com/en" />
      </head>
    `;

    const htmlAr = `
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
        <link rel="alternate" hreflang="x-default" href="https://example.com/en" />
      </head>
    `;

    const pageEn = createCrawledPage('https://example.com/en', htmlEn);
    const pageAr = createCrawledPage('https://example.com/ar', htmlAr);

    const crawlResult: CrawlResult = {
      pages: [pageEn, pageAr],
      errors: [],
      summary: {
        entryUrl: 'https://example.com/en',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 2,
        successfulPages: 2,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 2,
        urlsSkippedScope: 0,
        durationMs: 500,
        reachedLimit: false,
      },
    };

    const siteResult = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
    const hreflangFindings = siteResult.findings.filter(f => f.ruleId.startsWith('SEO_HREFLANG_'));
    expect(hreflangFindings).toHaveLength(0);
    expect(siteResult.data.hreflangIssuesCount).toBe(0);
  });

  it('7. Detects missing reciprocal hreflang link (SEO_HREFLANG_MISSING_RECIPROCAL)', () => {
    // Page En declares Page Ar as alternate
    const htmlEn = `
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
      </head>
    `;

    // Page Ar was crawled but does NOT link back to Page En
    const htmlAr = `
      <head>
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
      </head>
    `;

    const pageEn = createCrawledPage('https://example.com/en', htmlEn);
    const pageAr = createCrawledPage('https://example.com/ar', htmlAr);

    const crawlResult: CrawlResult = {
      pages: [pageEn, pageAr],
      errors: [],
      summary: {
        entryUrl: 'https://example.com/en',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 2,
        successfulPages: 2,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 2,
        urlsSkippedScope: 0,
        durationMs: 500,
        reachedLimit: false,
      },
    };

    const siteResult = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
    const missingRecip = siteResult.findings.find(
      f => f.ruleId === 'SEO_HREFLANG_MISSING_RECIPROCAL',
    );

    expect(missingRecip).toBeDefined();
    expect(missingRecip?.severity).toBe('medium');
    expect(missingRecip?.confidence).toBe('confirmed');
    expect(missingRecip?.targetUrl).toBe('https://example.com/en');
    expect((missingRecip?.evidence as { targetUrl: string }).targetUrl).toBe(
      'https://example.com/ar',
    );
  });

  it('8. Detects inconsistent language mapping in reciprocal pairs (SEO_HREFLANG_INCONSISTENT_LANGUAGE)', () => {
    // Page En declares itself as 'en' and links to Page Es as 'es'
    const htmlEn = `
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="es" href="https://example.com/es" />
      </head>
    `;

    // Page Es links back to Page En, but erroneously claims Page En is French ('fr')!
    const htmlEs = `
      <head>
        <link rel="alternate" hreflang="es" href="https://example.com/es" />
        <link rel="alternate" hreflang="fr" href="https://example.com/en" />
      </head>
    `;

    const pageEn = createCrawledPage('https://example.com/en', htmlEn);
    const pageEs = createCrawledPage('https://example.com/es', htmlEs);

    const crawlResult: CrawlResult = {
      pages: [pageEn, pageEs],
      errors: [],
      summary: {
        entryUrl: 'https://example.com/en',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 2,
        successfulPages: 2,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 2,
        urlsSkippedScope: 0,
        durationMs: 500,
        reachedLimit: false,
      },
    };

    const siteResult = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
    const inconsistent = siteResult.findings.find(
      f => f.ruleId === 'SEO_HREFLANG_INCONSISTENT_LANGUAGE',
    );

    expect(inconsistent).toBeDefined();
    expect(inconsistent?.severity).toBe('medium');
    expect(inconsistent?.confidence).toBe('confirmed');
    expect((inconsistent?.evidence as { expectedLanguage: string }).expectedLanguage).toBe('en');
    expect((inconsistent?.evidence as { returnedLanguage: string }).returnedLanguage).toBe('fr');
  });

  it('9. Detects broken hreflang targets returning HTTP 404/500 (SEO_HREFLANG_TARGET_BROKEN)', () => {
    const htmlEn = `
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="de" href="https://example.com/de" />
      </head>
    `;

    const pageEn = createCrawledPage('https://example.com/en', htmlEn);
    const pageDeBroken = createCrawledPage(
      'https://example.com/de',
      '<html><body>Not Found</body></html>',
      {
        statusCode: 404,
      },
    );

    const crawlResult: CrawlResult = {
      pages: [pageEn, pageDeBroken],
      errors: [],
      summary: {
        entryUrl: 'https://example.com/en',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 2,
        successfulPages: 1,
        failedPages: 1,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 2,
        urlsSkippedScope: 0,
        durationMs: 500,
        reachedLimit: false,
      },
    };

    const siteResult = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
    const brokenTarget = siteResult.findings.find(f => f.ruleId === 'SEO_HREFLANG_TARGET_BROKEN');

    expect(brokenTarget).toBeDefined();
    expect(brokenTarget?.severity).toBe('medium');
    expect(brokenTarget?.confidence).toBe('confirmed');
    expect((brokenTarget?.evidence as { statusCode: number }).statusCode).toBe(404);
  });

  it('10. Distinguishes external out-of-scope targets as info/potential without claiming broken (SEO_HREFLANG_EXTERNAL_TARGET)', () => {
    const htmlEn = `
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="ja" href="https://external-partner.jp/ja" />
      </head>
    `;

    const pageEn = createCrawledPage('https://example.com/en', htmlEn);

    const crawlResult: CrawlResult = {
      pages: [pageEn],
      errors: [],
      summary: {
        entryUrl: 'https://example.com/en',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 1,
        successfulPages: 1,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 1,
        urlsSkippedScope: 0,
        durationMs: 300,
        reachedLimit: false,
      },
    };

    const siteResult = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
    const externalFinding = siteResult.findings.find(
      f => f.ruleId === 'SEO_HREFLANG_EXTERNAL_TARGET',
    );

    expect(externalFinding).toBeDefined();
    expect(externalFinding?.severity).toBe('info');
    expect(externalFinding?.confidence).toBe('potential');
    expect(externalFinding?.status).toBe('potential');
    expect(externalFinding?.description).toContain('Target is not verified as broken');

    // Must NOT claim broken target!
    expect(siteResult.findings.some(f => f.ruleId === 'SEO_HREFLANG_TARGET_BROKEN')).toBe(false);
  });

  it('11. Distinguishes in-scope uncrawled targets as info/potential without claiming broken (SEO_HREFLANG_UNCRAWLED_TARGET)', () => {
    const htmlEn = `
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="it" href="https://example.com/it" />
      </head>
    `;

    // Only /en was crawled (e.g. maxPages was 1)
    const pageEn = createCrawledPage('https://example.com/en', htmlEn);

    const crawlResult: CrawlResult = {
      pages: [pageEn],
      errors: [],
      summary: {
        entryUrl: 'https://example.com/en',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 1,
        successfulPages: 1,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 2,
        urlsSkippedScope: 0,
        durationMs: 300,
        reachedLimit: true,
      },
    };

    const siteResult = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
    const uncrawledFinding = siteResult.findings.find(
      f => f.ruleId === 'SEO_HREFLANG_UNCRAWLED_TARGET',
    );

    expect(uncrawledFinding).toBeDefined();
    expect(uncrawledFinding?.severity).toBe('info');
    expect(uncrawledFinding?.confidence).toBe('potential');
    expect(uncrawledFinding?.status).toBe('potential');
    expect(uncrawledFinding?.description).toContain('Target is not verified as broken');

    // Must NOT claim target is broken!
    expect(siteResult.findings.some(f => f.ruleId === 'SEO_HREFLANG_TARGET_BROKEN')).toBe(false);
  });

  it('12. Redacts sensitive query tokens in alternate URLs and evidence', () => {
    const htmlWithSecret = `
      <head>
        <link rel="alternate" hreflang="en" href="https://example.com/en?access_token=secret123&session_id=sess456" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar?api_key=priv789" />
      </head>
    `;

    const page = createCrawledPage(
      'https://example.com/en?access_token=secret123&session_id=sess456',
      htmlWithSecret,
    );

    // Page-level check
    const pageResult = pageAnalyzer.analyzePage(page, mockContext);
    for (const f of pageResult.findings) {
      expect(f.targetUrl).not.toContain('secret123');
      expect(f.targetUrl).not.toContain('sess456');
      const evStr = JSON.stringify(f.evidence);
      expect(evStr).not.toContain('secret123');
      expect(evStr).not.toContain('sess456');
      expect(evStr).not.toContain('priv789');
    }

    // Cross-page check
    const crawlResult: CrawlResult = {
      pages: [page],
      errors: [],
      summary: {
        entryUrl: 'https://example.com/en',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 1,
        successfulPages: 1,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 2,
        urlsSkippedScope: 0,
        durationMs: 300,
        reachedLimit: true,
      },
    };

    const siteResult = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
    for (const f of siteResult.findings) {
      expect(f.targetUrl).not.toContain('secret123');
      expect(f.targetUrl).not.toContain('priv789');
      const evStr = JSON.stringify(f.evidence);
      expect(evStr).not.toContain('secret123');
      expect(evStr).not.toContain('priv789');
    }
  });

  // =========================================================================
  // INTEGRATION TEST WITH BILINGUAL FIXTURES (Arabic, English, x-default)
  // =========================================================================

  it('13. Comprehensive integration check across multilingual fixtures', () => {
    // Page 1: Arabic homepage (/ar)
    const htmlAr = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <title>الصفحة الرئيسية</title>
        <meta name="description" content="وصف باللغة العربية سليم ومطابق للمعايير القياسية." />
        <link rel="canonical" href="https://example.com/ar" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="x-default" href="https://example.com/" />
        <link rel="alternate" hreflang="es_ES" href="https://example.com/es" />
      </head>
      <body><h1>العنوان الرئيسي</h1></body>
      </html>
    `;

    // Page 2: English homepage (/en)
    const htmlEn = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Home Page</title>
        <meta name="description" content="Valid English meta description for multilingual testing." />
        <link rel="canonical" href="https://example.com/en" />
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
        <link rel="alternate" hreflang="x-default" href="https://example.com/" />
        <link rel="alternate" hreflang="fr" href="https://example.com/fr" />
      </head>
      <body><h1>Main Heading</h1></body>
      </html>
    `;

    // Page 3: Global fallback root (/)
    const htmlRoot = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Global Gateway</title>
        <meta name="description" content="Global default portal for international traffic selection." />
        <link rel="canonical" href="https://example.com/" />
        <link rel="alternate" hreflang="x-default" href="https://example.com/" />
        <link rel="alternate" hreflang="ar" href="https://example.com/ar" />
        <link rel="alternate" hreflang="en" href="https://example.com/en" />
      </head>
      <body><h1>Select Region</h1></body>
      </html>
    `;

    // Page 4: French page (/fr) which forgot to link back to /en
    const htmlFr = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <title>Accueil</title>
        <meta name="description" content="Description en français pour le test d'intégration." />
        <link rel="canonical" href="https://example.com/fr" />
        <link rel="alternate" hreflang="fr" href="https://example.com/fr" />
      </head>
      <body><h1>Titre Français</h1></body>
      </html>
    `;

    const pageAr = createCrawledPage('https://example.com/ar', htmlAr);
    const pageEn = createCrawledPage('https://example.com/en', htmlEn);
    const pageRoot = createCrawledPage('https://example.com/', htmlRoot);
    const pageFr = createCrawledPage('https://example.com/fr', htmlFr);

    // Page-level checks on /ar
    const arPageFindings = pageAnalyzer.analyzePage(pageAr, mockContext).findings;
    const esUnderscoreFinding = arPageFindings.find(f => f.ruleId === 'SEO_HREFLANG_INVALID_TAG');
    expect(esUnderscoreFinding).toBeDefined();
    expect((esUnderscoreFinding?.evidence as { rawHreflang: string }).rawHreflang).toBe('es_ES');

    // Site-level cross-page checks across all 4 pages
    const crawlResult: CrawlResult = {
      pages: [pageAr, pageEn, pageRoot, pageFr],
      errors: [],
      summary: {
        entryUrl: 'https://example.com/',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 4,
        successfulPages: 4,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 4,
        urlsSkippedScope: 0,
        durationMs: 900,
        reachedLimit: false,
      },
    };

    const siteResult = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);

    // /en declared /fr as alternate, but /fr lacked reciprocal link back to /en
    const missingReciprocalFr = siteResult.findings.find(
      f =>
        f.ruleId === 'SEO_HREFLANG_MISSING_RECIPROCAL' &&
        f.targetUrl === 'https://example.com/en' &&
        (f.evidence as { targetUrl: string }).targetUrl === 'https://example.com/fr',
    );
    expect(missingReciprocalFr).toBeDefined();

    // /ar declared /es as alternate, but /es was not crawled (in-scope uncrawled)
    const uncrawledEs = siteResult.findings.find(
      f =>
        f.ruleId === 'SEO_HREFLANG_UNCRAWLED_TARGET' &&
        f.targetUrl === 'https://example.com/ar' &&
        (f.evidence as { targetUrl: string }).targetUrl === 'https://example.com/es',
    );
    expect(uncrawledEs).toBeDefined();
    expect(uncrawledEs?.severity).toBe('info');
    expect(uncrawledEs?.confidence).toBe('potential');

    // Reciprocal links between /ar, /en, and / (x-default) are all verified with zero missing reciprocal errors between them
    const spuriousReciprocal = siteResult.findings.find(
      f =>
        f.ruleId === 'SEO_HREFLANG_MISSING_RECIPROCAL' &&
        ((f.targetUrl === 'https://example.com/ar' &&
          (f.evidence as { targetUrl: string }).targetUrl === 'https://example.com/en') ||
          (f.targetUrl === 'https://example.com/en' &&
            (f.evidence as { targetUrl: string }).targetUrl === 'https://example.com/ar')),
    );
    expect(spuriousReciprocal).toBeUndefined();
  });
});
