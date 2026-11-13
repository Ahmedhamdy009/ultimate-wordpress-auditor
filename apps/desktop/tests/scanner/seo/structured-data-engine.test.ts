import { describe, it, expect } from 'vitest';
import { StructuredDataEngine } from '../../../src/main/scanner/seo/structured-data-engine.js';
import type { CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('Structured Data / JSON-LD Analysis Engine', () => {
  const engine = new StructuredDataEngine();

  const createMockPage = (url: string, jsonLdScripts: readonly string[]): CrawledPageResult => ({
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
    durationMs: 40,
    isHtml: true,
    parsedDocument: {
      title: 'Structured Data Test Page',
      metaDescription: 'Description',
      canonicalUrl: url,
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
      jsonLdScripts,
    },
  });

  describe('Syntax & Structure Validation', () => {
    it('detects and localizes JSON syntax errors in <script type="application/ld+json">', () => {
      const page = createMockPage('https://example.com/bad-json', [
        `{
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "Broken Article",,
        }`,
      ]);

      const result = engine.analyzePage(page);
      expect(result.scriptBlocksCount).toBe(1);
      expect(result.syntaxErrorsCount).toBe(1);
      expect(result.findings.some(f => f.ruleId === 'SEO_SCHEMA_SYNTAX_ERROR')).toBe(true);

      const finding = result.findings.find(f => f.ruleId === 'SEO_SCHEMA_SYNTAX_ERROR');
      expect(finding?.severity).toBe('medium');
      expect(finding?.targetUrl).toBe('https://example.com/bad-json');
    });

    it('flags objects missing @context or using invalid context formats', () => {
      const page = createMockPage('https://example.com/no-context', [
        JSON.stringify({
          '@type': 'Article',
          headline: 'Article without context',
        }),
      ]);

      const result = engine.analyzePage(page);
      expect(result.findings.some(f => f.ruleId === 'SEO_SCHEMA_MISSING_CONTEXT')).toBe(true);
    });

    it('flags objects missing @type definition', () => {
      const page = createMockPage('https://example.com/no-type', [
        JSON.stringify({
          '@context': 'https://schema.org',
          name: 'Anonymous Entity',
        }),
      ]);

      const result = engine.analyzePage(page);
      expect(result.findings.some(f => f.ruleId === 'SEO_SCHEMA_MISSING_TYPE')).toBe(true);
    });
  });

  describe('Profile v1 Type-Specific Diagnostics', () => {
    it('validates Article / BlogPosting required properties (headline, author, datePublished)', () => {
      // Incomplete Article
      const pageIncomplete = createMockPage('https://example.com/article-incomplete', [
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
        }),
      ]);

      const resultIncomplete = engine.analyzePage(pageIncomplete);
      const articleFindings = resultIncomplete.findings.filter(
        f => f.ruleId === 'SEO_SCHEMA_ARTICLE_MISSING_REQUIRED',
      );
      expect(articleFindings.length).toBeGreaterThanOrEqual(1);

      // Complete Article
      const pageComplete = createMockPage('https://example.com/article-complete', [
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Complete Technical SEO Guide',
          author: { '@type': 'Person', name: 'Auditor Team' },
          datePublished: '2026-05-10T08:00:00Z',
        }),
      ]);

      const resultComplete = engine.analyzePage(pageComplete);
      expect(
        resultComplete.findings.some(f => f.ruleId === 'SEO_SCHEMA_ARTICLE_MISSING_REQUIRED'),
      ).toBe(false);
    });

    it('validates Product required properties (name, offers/review)', () => {
      const pageProductIncomplete = createMockPage('https://example.com/product', [
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Product',
          description: 'A great product without name or offers',
        }),
      ]);

      const result = engine.analyzePage(pageProductIncomplete);
      const productFinding = result.findings.find(
        f => f.ruleId === 'SEO_SCHEMA_PRODUCT_MISSING_REQUIRED',
      );
      expect(productFinding).toBeDefined();
      expect(productFinding?.evidence?.missingProperties).toContain('name');
    });

    it('validates BreadcrumbList itemListElement requirements', () => {
      const pageBreadcrumbsBad = createMockPage('https://example.com/crumbs', [
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: 'not-an-array',
        }),
      ]);

      const result = engine.analyzePage(pageBreadcrumbsBad);
      const breadcrumbFinding = result.findings.find(
        f => f.ruleId === 'SEO_SCHEMA_BREADCRUMB_INVALID',
      );
      expect(breadcrumbFinding).toBeDefined();
    });

    it('unwraps and validates @graph arrays correctly', () => {
      const pageWithGraph = createMockPage('https://example.com/graph-page', [
        JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Organization',
              name: 'Example Corp',
              url: 'https://example.com',
            },
            {
              '@type': 'WebSite',
              name: 'Example Site',
              url: 'https://example.com',
            },
          ],
        }),
      ]);

      const result = engine.analyzePage(pageWithGraph);
      expect(result.entitiesParsed).toBe(2);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('StructuredDataEngine.summarizeSite', () => {
    it('aggregates statistics and summaries across all crawled pages', () => {
      const page1 = createMockPage('https://example.com/p1', [
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: 'Valid Title',
          author: 'Author',
          datePublished: '2026-01-01',
        }),
      ]);

      const page2 = createMockPage('https://example.com/p2', [`{ invalid json }`]);

      const summary = engine.summarizeSite([page1, page2]);
      expect(summary.totalPagesAudited).toBe(2);
      expect(summary.pagesWithStructuredData).toBe(2);
      expect(summary.totalScriptsFound).toBe(2);
      expect(summary.totalSyntaxErrors).toBe(1);
      expect(summary.entityCountsByType['Article']).toBe(1);
    });
  });
});
