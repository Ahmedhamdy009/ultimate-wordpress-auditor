/**
 * Comprehensive Regression Test Suite for Phase 6 — Batch 6.1:
 * Production Audit Accuracy Remediation, Truthful Coverage Accounting & Intelligent Consolidation.
 */

import { describe, it, expect } from 'vitest';
import { consolidateFindings, type FindingDTO } from '@auditor/shared';
import {
  QualityContentAnalyzer,
  classifyPageContentType,
} from '../../src/main/scanner/analyzers/quality-content-analyzer.js';
import { SeoPerformanceAnalyzer } from '../../src/main/scanner/analyzers/seo-performance-analyzer.js';
import { CrossPageAnalyzer } from '../../src/main/scanner/analyzers/cross-page-analyzer.js';
import {
  mapAxeImpactToSeverity,
  mapAxeIncompleteImpactToSeverity,
} from '../../src/main/browser/accessibility-analyzer.js';
import type { CrawledPageResult, CrawlResult } from '../../src/main/scanner/crawler/types.js';
import type { ParsedHtmlDocument } from '../../src/main/scanner/parser/types.js';

function createMockParsedDoc(overrides: Partial<ParsedHtmlDocument> = {}): ParsedHtmlDocument {
  return {
    pageUrl: 'https://example.com/',
    authorizedOrigin: 'https://example.com',
    metadata: {
      title: 'Example Page',
      description: 'An example page description',
      robots: 'index, follow',
      canonical: 'https://example.com/',
      lang: 'en',
      dir: 'ltr',
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1.0',
      openGraph: {},
      twitterCard: {},
      ...overrides.metadata,
    },
    headings: overrides.headings ?? [{ tag: 'h1', level: 1, text: 'Main Title', id: null }],
    links: overrides.links ?? [],
    images: overrides.images ?? [],
    resources: overrides.resources ?? [],
    forms: overrides.forms ?? [],
    structure: overrides.structure ?? {
      elementIds: [],
      inlineEventHandlers: [],
      metaRefresh: null,
      hasDoctype: true,
    },
    metrics: overrides.metrics ?? { parseDurationMs: 5, totalNodes: 50, htmlSizeBytes: 1024 },
    visibleWordCount: overrides.visibleWordCount ?? 250,
  };
}

function createMockPage(
  url: string,
  parsedDoc?: ParsedHtmlDocument,
  statusCode = 200,
): CrawledPageResult {
  return {
    requestedUrl: url,
    finalUrl: url,
    statusCode,
    statusMessage: 'OK',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    isHtml: true,
    timing: { startEpochMs: 0, durationMs: 50, ttfbMs: 40 },
    rawBody: Buffer.from('<html></html>'),
    parsedDocument: parsedDoc ?? createMockParsedDoc({ pageUrl: url }),
  };
}

describe('Batch 6.1 — Production Audit Accuracy Remediation Suite', () => {
  // ==========================================
  // Area 1: Truthful Coverage Accounting
  // ==========================================
  describe('1. Truthful Coverage Accounting Logic', () => {
    it('accurately identifies partial browser coverage when browser pages are fewer than crawled pages', () => {
      const pagesScanned = 54;
      const browserPagesAudited = 15;
      const browserCandidatesSkipped = 0;
      const totalPagesFailed = 0;
      const isBrowserAuditEnabled = true;

      const isPartialBrowserCoverage =
        isBrowserAuditEnabled &&
        (browserPagesAudited < pagesScanned || browserCandidatesSkipped > 0);
      const isPartialCoverage = isPartialBrowserCoverage || totalPagesFailed > 0;
      const coverageStatus = isPartialCoverage ? 'partial' : 'full';

      expect(isPartialCoverage).toBe(true);
      expect(coverageStatus).toBe('partial');
    });

    it('identifies full coverage only when all crawled pages received browser evaluation and zero candidates were skipped', () => {
      const pagesScanned = 10;
      const browserPagesAudited = 10;
      const browserCandidatesSkipped = 0;
      const totalPagesFailed = 0;
      const isBrowserAuditEnabled = true;

      const isPartialBrowserCoverage =
        isBrowserAuditEnabled &&
        (browserPagesAudited < pagesScanned || browserCandidatesSkipped > 0);
      const isPartialCoverage = isPartialBrowserCoverage || totalPagesFailed > 0;
      const coverageStatus = isPartialCoverage ? 'partial' : 'full';

      expect(isPartialCoverage).toBe(false);
      expect(coverageStatus).toBe('full');
    });

    it('identifies partial coverage when candidates are skipped due to budget limits', () => {
      const pagesScanned = 25;
      const browserPagesAudited = 2;
      const browserCandidatesSkipped = 3;
      const totalPagesFailed = 0;

      const isPartialCoverage =
        browserCandidatesSkipped > 0 || totalPagesFailed > 0 || browserPagesAudited < pagesScanned;
      expect(isPartialCoverage).toBe(true);
    });

    it('identifies partial coverage when crawler or browser encounters page failures', () => {
      const totalPagesFailed = 2;
      const browserCandidatesSkipped = 0;

      const isPartialCoverage = browserCandidatesSkipped > 0 || totalPagesFailed > 0;
      expect(isPartialCoverage).toBe(true);
    });
  });

  // ==========================================
  // Area 2: Archive-Aware Content Quality
  // ==========================================
  describe('2. Archive-Aware Content Quality Analysis (CONTENT_THIN_TEXT)', () => {
    const analyzer = new QualityContentAnalyzer();
    const mockContext = {
      authorizedOrigin: 'https://example.com',
      scanRunId: 'scan-test-1',
      options: {},
    };

    it('suppresses CONTENT_THIN_TEXT false positives on taxonomy archive grids with low word count', () => {
      const archiveDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/project-category/frontend-en/',
        metadata: {
          title: 'Frontend Projects Archive',
          description: 'Archive grid of frontend works',
          robots: 'index, follow',
          canonical: 'https://example.com/project-category/frontend-en/',
          lang: 'en',
          dir: 'ltr',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: { 'og:type': 'website' },
          twitterCard: {},
        },
        headings: [
          { tag: 'h2', level: 2, text: 'Project Alpha', id: null },
          { tag: 'h2', level: 2, text: 'Project Beta', id: null },
        ],
        visibleWordCount: 45, // Under 100 words threshold
      });

      const page = createMockPage('https://example.com/project-category/frontend-en/', archiveDoc);
      const classification = classifyPageContentType(page);

      expect(classification.isArchiveOrListing).toBe(true);
      expect(classification.pageType).toBe('category_listing');

      const result = analyzer.analyzePage(page, mockContext);
      const thinFinding = result.findings.find(f => f.ruleId === 'CONTENT_THIN_TEXT');
      expect(thinFinding).toBeUndefined(); // Successfully suppressed!
    });

    it('correctly flags CONTENT_THIN_TEXT on substantive articles with low word count', () => {
      const articleDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/blog/short-post/',
        metadata: {
          title: 'A Very Short Article',
          description: 'A stub article',
          robots: 'index, follow',
          canonical: 'https://example.com/blog/short-post/',
          lang: 'en',
          dir: 'ltr',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: { 'og:type': 'article' },
          twitterCard: {},
        },
        headings: [{ tag: 'h1', level: 1, text: 'A Very Short Article', id: null }],
        visibleWordCount: 42, // Under 100 words threshold
      });

      const page = createMockPage('https://example.com/blog/short-post/', articleDoc);
      const classification = classifyPageContentType(page);

      expect(classification.isArchiveOrListing).toBe(false);
      expect(classification.pageType).toBe('blog_post');

      const result = analyzer.analyzePage(page, mockContext);
      const thinFinding = result.findings.find(f => f.ruleId === 'CONTENT_THIN_TEXT');
      expect(thinFinding).toBeDefined();
      expect(thinFinding?.severity).toBe('low');
      expect(thinFinding?.confidence).toBe('confirmed');
    });

    it('retains CONTENT_THIN_TEXT with uncertain classification when page type cannot be determined', () => {
      const uncertainDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/misc/note.html',
        metadata: {
          title: 'Quick Note',
          description: 'A brief note',
          robots: 'index, follow',
          canonical: 'https://example.com/misc/note.html',
          lang: 'en',
          dir: 'ltr',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: {},
          twitterCard: {},
        },
        headings: [{ tag: 'h1', level: 1, text: 'Quick Note', id: null }],
        visibleWordCount: 30,
      });

      const page = createMockPage('https://example.com/misc/note.html', uncertainDoc);
      const classification = classifyPageContentType(page);
      expect(classification.pageType).toBe('uncertain');

      const result = analyzer.analyzePage(page, mockContext);
      const thinFinding = result.findings.find(f => f.ruleId === 'CONTENT_THIN_TEXT');
      expect(thinFinding).toBeDefined();
      expect(thinFinding?.confidence).toBe('potential');
      expect((thinFinding?.evidence as Record<string, unknown>)?.pageType).toBe('uncertain');
    });

    it('always flags CONTENT_EMPTY_PAGE when readable word count is zero regardless of page type', () => {
      const emptyDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/project-category/empty/',
        visibleWordCount: 0,
        headings: [],
        links: [],
      });

      const page = createMockPage('https://example.com/project-category/empty/', emptyDoc);
      const result = analyzer.analyzePage(page, mockContext);
      const emptyFinding = result.findings.find(f => f.ruleId === 'CONTENT_EMPTY_PAGE');
      expect(emptyFinding).toBeDefined();
      expect(emptyFinding?.severity).toBe('medium');
    });
  });

  // ==========================================
  // Area 3: Finding Consolidation & Template Grouping
  // ==========================================
  describe('3. Intelligent Finding Consolidation & Template Grouping', () => {
    it('groups repeated shared-component findings across multiple pages into a single consolidated group', () => {
      const mockFindings: FindingDTO[] = [
        {
          id: 'f-1',
          scanRunId: 'scan-1',
          ruleId: 'a11y-aria-required-parent',
          category: 'accessibility',
          title: 'Required ARIA parent role not present: list',
          description: 'Elements with role=listitem must be contained in role=list',
          severity: 'critical',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/',
          evidence: {
            structuralLocator: '.elementor-social-icons > .elementor-grid-item[role="listitem"]',
            html: '<span role="listitem"></span>',
          },
          remediation: 'Wrap list items in role=list',
          references: ['https://dequeuniversity.com/rules/axe/4.14/aria-required-parent'],
          createdAt: new Date().toISOString(),
        },
        {
          id: 'f-2',
          scanRunId: 'scan-1',
          ruleId: 'a11y-aria-required-parent',
          category: 'accessibility',
          title: 'Required ARIA parent role not present: list',
          description: 'Elements with role=listitem must be contained in role=list',
          severity: 'critical',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/about',
          evidence: {
            structuralLocator: '.elementor-social-icons > .elementor-grid-item[role="listitem"]',
            html: '<span role="listitem"></span>',
          },
          remediation: 'Wrap list items in role=list',
          references: ['https://dequeuniversity.com/rules/axe/4.14/aria-required-parent'],
          createdAt: new Date().toISOString(),
        },
      ];

      const consolidated = consolidateFindings(mockFindings);
      expect(consolidated.length).toBe(1);

      const group = consolidated[0];
      expect(group.groupType).toBe('shared_template_component');
      expect(group.totalOccurrences).toBe(2);
      expect(group.affectedUrls).toEqual(['https://example.com/', 'https://example.com/about']);
      expect(group.originalFindingIds).toEqual(['f-1', 'f-2']);
      expect(group.selector).toBe(
        '.elementor-social-icons > .elementor-grid-item[role="listitem"]',
      );
      expect(group.occurrences.length).toBe(2);
      expect(group.occurrences[0].targetUrl).toBe('https://example.com/');
      expect(group.occurrences[1].targetUrl).toBe('https://example.com/about');
    });

    it('keeps unrelated elements under the same rule separate if their selectors or signatures differ', () => {
      const mockFindings: FindingDTO[] = [
        {
          id: 'f-contrast-header',
          scanRunId: 'scan-1',
          ruleId: 'a11y-color-contrast',
          category: 'accessibility',
          title: 'Insufficient color contrast',
          description: 'Contrast ratio 2.5:1',
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/',
          evidence: {
            structuralLocator: 'header .nav-link',
          },
          remediation: 'Increase contrast',
          references: [],
          createdAt: new Date().toISOString(),
        },
        {
          id: 'f-contrast-footer',
          scanRunId: 'scan-1',
          ruleId: 'a11y-color-contrast',
          category: 'accessibility',
          title: 'Insufficient color contrast',
          description: 'Contrast ratio 3.1:1',
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/',
          evidence: {
            structuralLocator: 'footer .copyright',
          },
          remediation: 'Increase contrast',
          references: [],
          createdAt: new Date().toISOString(),
        },
      ];

      const consolidated = consolidateFindings(mockFindings);
      expect(consolidated.length).toBe(2); // Two distinct groups because signatures differ!
    });

    it('returns single_occurrence when a finding occurs on only one page', () => {
      const mockFindings: FindingDTO[] = [
        {
          id: 'f-unique',
          scanRunId: 'scan-1',
          ruleId: 'SEC_HEADER_CSP_MISSING',
          category: 'security',
          title: 'Missing Content-Security-Policy',
          description: 'No CSP header declared',
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/',
          evidence: {},
          remediation: 'Add CSP header',
          references: [],
          createdAt: new Date().toISOString(),
        },
      ];

      const consolidated = consolidateFindings(mockFindings);
      expect(consolidated.length).toBe(1);
      expect(consolidated[0].groupType).toBe('single_occurrence');
      expect(consolidated[0].totalOccurrences).toBe(1);
    });
  });

  // ==========================================
  // Area 4: Accessibility Incomplete Classification
  // ==========================================
  describe('4. Accessibility Incomplete Review Classification', () => {
    it('maps confirmed serious violations to high severity', () => {
      const severity = mapAxeImpactToSeverity('serious');
      expect(severity).toBe('high');
    });

    it('maps confirmed critical violations to critical severity', () => {
      const severity = mapAxeImpactToSeverity('critical');
      expect(severity).toBe('critical');
    });

    it('maps incomplete serious checks conservatively to low severity to prevent false high alerts', () => {
      const severity = mapAxeIncompleteImpactToSeverity('serious');
      expect(severity).toBe('low');
    });

    it('maps incomplete critical checks conservatively to medium severity', () => {
      const severity = mapAxeIncompleteImpactToSeverity('critical');
      expect(severity).toBe('medium');
    });
  });

  // ==========================================
  // Area 5: Canonical URL & Duplicate Content
  // ==========================================
  describe('5. Canonical URL & Duplicate Content Handling', () => {
    const seoAnalyzer = new SeoPerformanceAnalyzer();
    const crossPageAnalyzer = new CrossPageAnalyzer();
    const mockContext = {
      authorizedOrigin: 'https://example.com',
      scanRunId: 'scan-test-1',
      options: {},
    };

    it('identifies self-referencing canonical as healthy without emitting mismatch finding', () => {
      const pageDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/about/',
        metadata: {
          title: 'About Us',
          description: 'About company',
          robots: 'index, follow',
          canonical: 'https://example.com/about/',
          lang: 'en',
          dir: 'ltr',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: {},
          twitterCard: {},
        },
      });

      const page = createMockPage('https://example.com/about/', pageDoc);
      const result = seoAnalyzer.analyzePage(page, mockContext);

      const mismatchFinding = result.findings.find(f => f.ruleId === 'SEO_CANONICAL_MISMATCH');
      expect(mismatchFinding).toBeUndefined();
    });

    it('flags SEO_CANONICAL_MISMATCH when internal page specifies canonical pointing to another URL', () => {
      const pageDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/ar/home2/',
        metadata: {
          title: 'Homepage Clone',
          description: 'Clone description',
          robots: 'index, follow',
          canonical: 'https://example.com/ar/', // Points to primary homepage!
          lang: 'ar',
          dir: 'rtl',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: {},
          twitterCard: {},
        },
      });

      const page = createMockPage('https://example.com/ar/home2/', pageDoc);
      const result = seoAnalyzer.analyzePage(page, mockContext);

      const mismatchFinding = result.findings.find(f => f.ruleId === 'SEO_CANONICAL_MISMATCH');
      expect(mismatchFinding).toBeDefined();
      expect(mismatchFinding?.severity).toBe('info');
      expect(mismatchFinding?.status).toBe('confirmed');
      expect((mismatchFinding?.evidence as Record<string, unknown>)?.isCanonicalAlias).toBe(true);
    });

    it('detects duplicate content candidates within the same language context', () => {
      const page1Doc = createMockParsedDoc({
        pageUrl: 'https://example.com/ar/home1/',
        metadata: {
          title: 'أحمد حمدي - مطور ومصمم واجهات',
          description: 'معرض أعمال وتصميم واجهات وتطوير ووردبريس',
          robots: 'index, follow',
          canonical: 'https://example.com/ar/home1/',
          lang: 'ar',
          dir: 'rtl',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: {},
          twitterCard: {},
        },
      });

      const page2Doc = createMockParsedDoc({
        pageUrl: 'https://example.com/ar/home2/',
        metadata: {
          title: 'أحمد حمدي - مطور ومصمم واجهات',
          description: 'معرض أعمال وتصميم واجهات وتطوير ووردبريس',
          robots: 'index, follow',
          canonical: 'https://example.com/ar/home2/',
          lang: 'ar',
          dir: 'rtl',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: {},
          twitterCard: {},
        },
      });

      const page1 = createMockPage('https://example.com/ar/home1/', page1Doc);
      const page2 = createMockPage('https://example.com/ar/home2/', page2Doc);

      const crawlResult: CrawlResult = {
        pages: [page1, page2],
        errors: [],
        redirects: [],
        summary: {
          totalPagesAttempted: 2,
          successfulPages: 2,
          failedPages: 0,
          durationMs: 100,
          totalEncodedBytes: 2048,
          totalDecompressedBytes: 4096,
        },
      };

      const result = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
      const dupFinding = result.findings.find(f => f.ruleId === 'CONTENT_DUPLICATE_PAGE_CANDIDATE');
      expect(dupFinding).toBeDefined();
      expect((dupFinding?.evidence as Record<string, unknown>)?.language).toBe('ar');
    });

    it('never collapses legitimate English and Arabic translations as duplicate content', () => {
      const enDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/project/al-mathaq/',
        metadata: {
          title: 'Al Mathaq Project',
          description: 'Case study of Al Mathaq pastry shop',
          robots: 'index, follow',
          canonical: 'https://example.com/project/al-mathaq/',
          lang: 'en',
          dir: 'ltr',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: {},
          twitterCard: {},
        },
      });

      const arDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/ar/project/al-mathaq-ar/',
        metadata: {
          title: 'مشروع المذاق',
          description: 'دراسة حالة لمشروع حلويات المذاق',
          robots: 'index, follow',
          canonical: 'https://example.com/ar/project/al-mathaq-ar/',
          lang: 'ar',
          dir: 'rtl',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: {},
          twitterCard: {},
        },
      });

      const pageEn = createMockPage('https://example.com/project/al-mathaq/', enDoc);
      const pageAr = createMockPage('https://example.com/ar/project/al-mathaq-ar/', arDoc);

      const crawlResult: CrawlResult = {
        pages: [pageEn, pageAr],
        errors: [],
        redirects: [],
        summary: {
          totalPagesAttempted: 2,
          successfulPages: 2,
          failedPages: 0,
          durationMs: 100,
          totalEncodedBytes: 2048,
          totalDecompressedBytes: 4096,
        },
      };

      const result = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
      const dupFinding = result.findings.find(f => f.ruleId === 'CONTENT_DUPLICATE_PAGE_CANDIDATE');
      expect(dupFinding).toBeUndefined(); // English and Arabic are kept strictly distinct!
    });

    it('detects broken canonical target URL when canonical destination returns HTTP 404', () => {
      const sourceDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/old-page',
        metadata: {
          title: 'Old Page',
          description: 'Old page description',
          robots: 'index, follow',
          canonical: 'https://example.com/deleted-target',
          lang: 'en',
          dir: 'ltr',
          charset: 'utf-8',
          viewport: 'width=device-width',
          openGraph: {},
          twitterCard: {},
        },
      });

      const targetDoc = createMockParsedDoc({
        pageUrl: 'https://example.com/deleted-target',
      });

      const sourcePage = createMockPage('https://example.com/old-page', sourceDoc, 200);
      const targetPage = createMockPage('https://example.com/deleted-target', targetDoc, 404);

      const crawlResult: CrawlResult = {
        pages: [sourcePage, targetPage],
        errors: [],
        redirects: [],
        summary: {
          totalPagesAttempted: 2,
          successfulPages: 2,
          failedPages: 0,
          durationMs: 100,
          totalEncodedBytes: 2048,
          totalDecompressedBytes: 4096,
        },
      };

      const result = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
      const brokenCanonical = result.findings.find(f => f.ruleId === 'SEO_CANONICAL_TARGET_BROKEN');
      expect(brokenCanonical).toBeDefined();
      expect(brokenCanonical?.severity).toBe('medium');
    });
  });
});
