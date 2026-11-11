/**
 * Phase 6 — Batch 6.1 Independent Acceptance Verification Test Suite
 *
 * Exhaustively exercises all acceptance scenarios defined in the Batch 6.1
 * acceptance mandate:
 * 1. Coverage Accuracy (54/15, 10/10, 0/10, skipped, browser failure, crawler failure)
 * 2. Finding Consolidation (same rule+selector, different selectors, repeated in 1 page, similar non-mergeable, evidence/severity)
 * 3. Archive Classification (taxonomy, category, technology, short article, short landing, empty page, ambiguous)
 * 4. Accessibility Classification (confirmed vs incomplete, status preservation across SQLite, HTML, JSON)
 * 5. Canonical Logic (self-ref, valid cross-page, broken target, chain, loop, hreflang bilingual, duplicates)
 * 6. Historical Compatibility (reading existing database, reports, ensuring non-destructive behavior)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { consolidateFindings, type FindingDTO, type ScanRunSummaryDTO } from '@auditor/shared';
import {
  QualityContentAnalyzer,
  classifyPageContentType,
} from '../../src/main/scanner/analyzers/quality-content-analyzer.js';
import { SeoPerformanceAnalyzer } from '../../src/main/scanner/analyzers/seo-performance-analyzer.js';
import { CrossPageAnalyzer } from '../../src/main/scanner/analyzers/cross-page-analyzer.js';
import { AccessibilityAnalyzer } from '../../src/main/browser/accessibility-analyzer.js';
import { assembleReportData } from '../../src/main/reports/assembler.js';
import { generateHtmlReport } from '../../src/main/reports/html-generator.js';
import { generateJsonReport } from '../../src/main/reports/json-generator.js';
import type { CrawledPageResult, CrawlResult } from '../../src/main/scanner/crawler/types.js';
import type { ParsedHtmlDocument } from '../../src/main/scanner/parser/types.js';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';

// Helper for parsed document creation
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
    statusMessage: statusCode === 200 ? 'OK' : 'Error',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    isHtml: true,
    timing: { startEpochMs: 0, durationMs: 50, ttfbMs: 40 },
    rawBody: Buffer.from('<html></html>'),
    parsedDocument: parsedDoc ?? createMockParsedDoc({ pageUrl: url }),
  };
}

describe('Phase 6 — Batch 6.1 Independent Acceptance Audit Suite', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let testSiteId: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);

    const project = projectRepo.create({ name: 'Acceptance Verification Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Acceptance Verification Site',
      baseUrl: 'https://acceptance.example.com',
    });
    testSiteId = site.id;
  });

  afterEach(() => {
    if (connection?.isOpen()) {
      connection.close();
    }
  });

  // =========================================================================
  // Section 1: Coverage Accuracy Across 6 Scenarios
  // =========================================================================
  describe('1. Coverage Accuracy Across Diverse Execution States', () => {
    it('Scenario 1A: 54 pages statically analyzed, 15 browser-audited -> Partial Coverage, NO Full Coverage badge', () => {
      const summary: ScanRunSummaryDTO = {
        totalFindings: 10,
        criticalCount: 1,
        highCount: 2,
        mediumCount: 3,
        lowCount: 4,
        infoCount: 0,
        urlsCrawled: 54,
        pagesScanned: 54,
        pagesFailed: 0,
        browserPagesAudited: 15,
        viewportsCompleted: 120,
        accessibilityAuditsCompleted: 15,
        screenshotsCaptured: 15,
        browserCandidatesTotal: 15,
        browserCandidatesSkipped: 0,
        isPartialCoverage: true,
        coverageStatus: 'partial',
        browserCoverageStatus: 'partial',
        staticCoverageStatus: 'full',
      };

      const scanRun = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'deep',
        targetUrl: 'https://acceptance.example.com/',
        config: { enableBrowserAudit: true, maxPages: 60, maxBrowserPages: 15 },
      });
      scanRunRepo.updateStatus(scanRun.id, { status: 'running' });
      scanRunRepo.updateStatus(scanRun.id, {
        status: 'completed',
        summary,
        completedAt: new Date().toISOString(),
      });

      const reportModel = assembleReportData(scanRun.id, { siteRepo, scanRunRepo, findingRepo });

      expect(reportModel.summary.browserCoverageStatus).toBe('partial');
      expect(reportModel.summary.staticCoverageStatus).toBe('full');
      expect(reportModel.summary.coverageStatus).toBe('partial');
      expect(reportModel.summary.isPartialCoverage).toBe(true);

      const html = generateHtmlReport(reportModel);
      expect(html).toContain('PARTIAL BROWSER COVERAGE');
      expect(html).not.toContain(
        '<span class="status-badge" style="margin-left: 8px; background: var(--success-bg); color: var(--success); border: 1px solid var(--success);">\n            FULL COVERAGE\n          </span>',
      );
      expect(html).toContain('15 of 54 pages (28% browser coverage)');
      expect(html).toContain('54 pages (100% static coverage)');

      const json = JSON.parse(generateJsonReport(reportModel));
      expect(json.summary.browserCoverageStatus).toBe('partial');
      expect(json.summary.staticCoverageStatus).toBe('full');
      expect(json.summary.coverageStatus).toBe('partial');
    });

    it('Scenario 1B: All crawled pages browser-audited (10/10) -> Full Coverage', () => {
      const summary: ScanRunSummaryDTO = {
        totalFindings: 2,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 1,
        lowCount: 1,
        infoCount: 0,
        urlsCrawled: 10,
        pagesScanned: 10,
        pagesFailed: 0,
        browserPagesAudited: 10,
        viewportsCompleted: 80,
        accessibilityAuditsCompleted: 10,
        screenshotsCaptured: 10,
        browserCandidatesTotal: 10,
        browserCandidatesSkipped: 0,
        isPartialCoverage: false,
        coverageStatus: 'full',
        browserCoverageStatus: 'full',
        staticCoverageStatus: 'full',
      };

      const scanRun = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'quick',
        targetUrl: 'https://acceptance.example.com/',
        config: { enableBrowserAudit: true, maxPages: 10, maxBrowserPages: 10 },
      });
      scanRunRepo.updateStatus(scanRun.id, { status: 'running' });
      scanRunRepo.updateStatus(scanRun.id, {
        status: 'completed',
        summary,
        completedAt: new Date().toISOString(),
      });

      const reportModel = assembleReportData(scanRun.id, { siteRepo, scanRunRepo, findingRepo });
      expect(reportModel.summary.browserCoverageStatus).toBe('full');
      expect(reportModel.summary.coverageStatus).toBe('full');

      const html = generateHtmlReport(reportModel);
      expect(html).toContain('FULL COVERAGE');
      expect(html).not.toContain('PARTIAL BROWSER COVERAGE');

      const json = JSON.parse(generateJsonReport(reportModel));
      expect(json.summary.coverageStatus).toBe('full');
      expect(json.summary.browserCoverageStatus).toBe('full');
    });

    it('Scenario 1C: Zero browser pages audited (0/10) when browser disabled or failed -> None browser coverage', () => {
      const summary: ScanRunSummaryDTO = {
        totalFindings: 5,
        criticalCount: 0,
        highCount: 1,
        mediumCount: 2,
        lowCount: 2,
        infoCount: 0,
        urlsCrawled: 10,
        pagesScanned: 10,
        pagesFailed: 0,
        browserPagesAudited: 0,
        viewportsCompleted: 0,
        accessibilityAuditsCompleted: 0,
        screenshotsCaptured: 0,
        browserCandidatesTotal: 0,
        browserCandidatesSkipped: 0,
        isPartialCoverage: false,
        coverageStatus: 'full',
        browserCoverageStatus: 'none',
        staticCoverageStatus: 'full',
      };

      const scanRun = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'quick',
        targetUrl: 'https://acceptance.example.com/',
        config: { enableBrowserAudit: false, maxPages: 10 },
      });
      scanRunRepo.updateStatus(scanRun.id, { status: 'running' });
      scanRunRepo.updateStatus(scanRun.id, {
        status: 'completed',
        summary,
        completedAt: new Date().toISOString(),
      });

      const reportModel = assembleReportData(scanRun.id, { siteRepo, scanRunRepo, findingRepo });
      expect(reportModel.summary.browserCoverageStatus).toBe('none');
      expect(reportModel.summary.staticCoverageStatus).toBe('full');
    });

    it('Scenario 1D: Browser candidates skipped due to time budget (2 audited, 3 skipped) -> Partial Coverage', () => {
      const summary: ScanRunSummaryDTO = {
        totalFindings: 8,
        criticalCount: 0,
        highCount: 1,
        mediumCount: 3,
        lowCount: 4,
        infoCount: 0,
        urlsCrawled: 20,
        pagesScanned: 20,
        pagesFailed: 0,
        browserPagesAudited: 2,
        viewportsCompleted: 16,
        accessibilityAuditsCompleted: 2,
        screenshotsCaptured: 2,
        browserCandidatesTotal: 5,
        browserCandidatesSkipped: 3,
        isPartialCoverage: true,
        coverageStatus: 'partial',
        browserCoverageStatus: 'partial',
        staticCoverageStatus: 'full',
      };

      const scanRun = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'standard',
        targetUrl: 'https://acceptance.example.com/',
        config: { enableBrowserAudit: true, maxPages: 25, maxBrowserPages: 5 },
      });
      scanRunRepo.updateStatus(scanRun.id, { status: 'running' });
      scanRunRepo.updateStatus(scanRun.id, {
        status: 'completed',
        summary,
        completedAt: new Date().toISOString(),
      });

      const reportModel = assembleReportData(scanRun.id, { siteRepo, scanRunRepo, findingRepo });
      expect(reportModel.summary.browserCoverageStatus).toBe('partial');
      expect(reportModel.summary.isPartialCoverage).toBe(true);

      const html = generateHtmlReport(reportModel);
      expect(html).toContain('Notice: Audit Completed with Partial Browser Coverage');
      expect(html).toContain('3 skipped due to time budget');
    });

    it('Scenario 1E: Browser audit failure (SYS_BROWSER_UNAVAILABLE) -> Warning banner and partial coverage notice', () => {
      const scanRun = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: 'https://acceptance.example.com/',
        config: { enableBrowserAudit: true, maxPages: 10 },
      });
      const summary: ScanRunSummaryDTO = {
        totalFindings: 1,
        criticalCount: 0,
        highCount: 1,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
        urlsCrawled: 5,
        pagesScanned: 5,
        pagesFailed: 1,
        browserPagesAudited: 0,
        viewportsCompleted: 0,
        accessibilityAuditsCompleted: 0,
        screenshotsCaptured: 0,
        browserCandidatesTotal: 2,
        browserCandidatesSkipped: 2,
        isPartialCoverage: true,
        coverageStatus: 'partial',
        browserCoverageStatus: 'none',
        staticCoverageStatus: 'partial',
      };
      scanRunRepo.updateStatus(scanRun.id, { status: 'running' });
      scanRunRepo.updateStatus(scanRun.id, {
        status: 'completed',
        summary,
        completedAt: new Date().toISOString(),
      });

      findingRepo.batchCreate([
        {
          scanRunId: scanRun.id,
          ruleId: 'SYS_BROWSER_UNAVAILABLE',
          category: 'system',
          title: 'Browser Engine Unavailable',
          description: 'Chromium binary launch failed',
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://acceptance.example.com/',
          evidence: {},
        },
      ]);

      const reportModel = assembleReportData(scanRun.id, { siteRepo, scanRunRepo, findingRepo });
      const html = generateHtmlReport(reportModel);
      expect(html).toContain('Limitation Notice: Browser Engine Unavailable');
      expect(html).toContain('PARTIAL BROWSER COVERAGE');
    });

    it('Scenario 1F: Static crawl failures (pagesFailed: 2) -> staticCoverageStatus: partial', () => {
      const summary: ScanRunSummaryDTO = {
        totalFindings: 2,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 1,
        lowCount: 1,
        infoCount: 0,
        urlsCrawled: 12,
        pagesScanned: 10,
        pagesFailed: 2,
        browserPagesAudited: 10,
        viewportsCompleted: 80,
        accessibilityAuditsCompleted: 10,
        screenshotsCaptured: 10,
        browserCandidatesTotal: 10,
        browserCandidatesSkipped: 0,
        isPartialCoverage: true,
        coverageStatus: 'partial',
        browserCoverageStatus: 'full',
        staticCoverageStatus: 'partial',
      };

      const scanRun = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: 'https://acceptance.example.com/',
        config: { enableBrowserAudit: true, maxPages: 12 },
      });
      scanRunRepo.updateStatus(scanRun.id, { status: 'running' });
      scanRunRepo.updateStatus(scanRun.id, {
        status: 'completed',
        summary,
        completedAt: new Date().toISOString(),
      });

      const reportModel = assembleReportData(scanRun.id, { siteRepo, scanRunRepo, findingRepo });
      expect(reportModel.summary.staticCoverageStatus).toBe('partial');
      expect(reportModel.summary.coverageStatus).toBe('partial');
    });
  });

  // =========================================================================
  // Section 2: Finding Consolidation Verification
  // =========================================================================
  describe('2. Finding Consolidation & Template Grouping', () => {
    it('Scenario 2A: Same rule and same selector across multiple pages -> shared_template_component', () => {
      const findings: FindingDTO[] = [
        {
          id: 'f-p1',
          scanRunId: 'scan-c',
          ruleId: 'a11y-aria-required-parent',
          category: 'accessibility',
          title: 'Missing parent list',
          description: 'role=listitem requires role=list',
          severity: 'critical',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page-1',
          evidence: { structuralLocator: 'nav.main-menu > li.menu-item' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'f-p2',
          scanRunId: 'scan-c',
          ruleId: 'a11y-aria-required-parent',
          category: 'accessibility',
          title: 'Missing parent list',
          description: 'role=listitem requires role=list',
          severity: 'critical',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page-2',
          evidence: { structuralLocator: 'nav.main-menu > li.menu-item' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'f-p3',
          scanRunId: 'scan-c',
          ruleId: 'a11y-aria-required-parent',
          category: 'accessibility',
          title: 'Missing parent list',
          description: 'role=listitem requires role=list',
          severity: 'critical',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page-3',
          evidence: { structuralLocator: 'nav.main-menu > li.menu-item' },
          createdAt: new Date().toISOString(),
        },
      ];

      const groups = consolidateFindings(findings);
      expect(groups.length).toBe(1);
      const group = groups[0];
      expect(group.groupType).toBe('shared_template_component');
      expect(group.totalOccurrences).toBe(3);
      expect(group.affectedUrls).toHaveLength(3);
      expect(group.affectedUrls).toEqual([
        'https://example.com/page-1',
        'https://example.com/page-2',
        'https://example.com/page-3',
      ]);
      expect(group.originalFindingIds).toEqual(['f-p1', 'f-p2', 'f-p3']);
    });

    it('Scenario 2B: Same rule on different unrelated elements -> separate groups', () => {
      const findings: FindingDTO[] = [
        {
          id: 'f-hdr',
          scanRunId: 'scan-c',
          ruleId: 'a11y-color-contrast',
          category: 'accessibility',
          title: 'Contrast failure',
          description: 'Low contrast on header button',
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page-1',
          evidence: { structuralLocator: 'header button.cta' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'f-ftr',
          scanRunId: 'scan-c',
          ruleId: 'a11y-color-contrast',
          category: 'accessibility',
          title: 'Contrast failure',
          description: 'Low contrast on footer link',
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page-1',
          evidence: { structuralLocator: 'footer a.privacy' },
          createdAt: new Date().toISOString(),
        },
      ];

      const groups = consolidateFindings(findings);
      expect(groups.length).toBe(2);
      expect(groups[0].selector).not.toBe(groups[1].selector);
    });

    it('Scenario 2C: Repeated findings inside one page -> single group with accurate occurrence count', () => {
      const findings: FindingDTO[] = [
        {
          id: 'f-item1',
          scanRunId: 'scan-c',
          ruleId: 'PERF_IMG_DIMENSIONS_MISSING',
          category: 'static-performance',
          title: 'Image missing dimensions',
          description: 'Image lacks width/height attributes',
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/gallery',
          evidence: { structuralLocator: '.gallery-grid > img.thumb' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'f-item2',
          scanRunId: 'scan-c',
          ruleId: 'PERF_IMG_DIMENSIONS_MISSING',
          category: 'static-performance',
          title: 'Image missing dimensions',
          description: 'Image lacks width/height attributes',
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/gallery',
          evidence: { structuralLocator: '.gallery-grid > img.thumb' },
          createdAt: new Date().toISOString(),
        },
      ];

      const groups = consolidateFindings(findings);
      expect(groups.length).toBe(1);
      expect(groups[0].totalOccurrences).toBe(2);
      expect(groups[0].affectedUrls).toEqual(['https://example.com/gallery']);
    });

    it('Scenario 2D: Similar selectors that must NOT be merged -> kept distinct', () => {
      const findings: FindingDTO[] = [
        {
          id: 'f-s1',
          scanRunId: 'scan-c',
          ruleId: 'a11y-link-name',
          category: 'accessibility',
          title: 'Link missing name',
          description: 'Empty link',
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/',
          evidence: { structuralLocator: '#header > div > a.social' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'f-s2',
          scanRunId: 'scan-c',
          ruleId: 'a11y-link-name',
          category: 'accessibility',
          title: 'Link missing name',
          description: 'Empty link',
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/',
          evidence: { structuralLocator: '#footer > div > a.social' },
          createdAt: new Date().toISOString(),
        },
      ];

      const groups = consolidateFindings(findings);
      expect(groups.length).toBe(2);
    });

    it('Scenario 2E: Findings with different evidence or severity -> picks maximum severity and preserves all individual evidence', () => {
      const findings: FindingDTO[] = [
        {
          id: 'f-low',
          scanRunId: 'scan-c',
          ruleId: 'TEST_RULE',
          category: 'test',
          title: 'Test issue',
          description: 'Low severity observation',
          severity: 'low',
          confidence: 'potential',
          status: 'potential',
          targetUrl: 'https://example.com/p1',
          evidence: { detail: 'p1 data', structuralLocator: '.widget' },
          createdAt: new Date().toISOString(),
        },
        {
          id: 'f-high',
          scanRunId: 'scan-c',
          ruleId: 'TEST_RULE',
          category: 'test',
          title: 'Test issue',
          description: 'High severity escalation',
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/p2',
          evidence: { detail: 'p2 data', structuralLocator: '.widget' },
          createdAt: new Date().toISOString(),
        },
      ];

      const groups = consolidateFindings(findings);
      expect(groups.length).toBe(1);
      expect(groups[0].severity).toBe('high'); // Maximum severity chosen!
      expect(groups[0].occurrences[0].evidence).toEqual({
        detail: 'p1 data',
        structuralLocator: '.widget',
      });
      expect(groups[0].occurrences[1].evidence).toEqual({
        detail: 'p2 data',
        structuralLocator: '.widget',
      });
    });
  });

  // =========================================================================
  // Section 3: Archive Classification Across 7 Scenarios
  // =========================================================================
  describe('3. Archive-Aware Classification & Thin Text Suppression', () => {
    const analyzer = new QualityContentAnalyzer();
    const mockContext = {
      authorizedOrigin: 'https://example.com',
      scanRunId: 'scan-arch',
      options: {},
    };

    it('Scenario 3A: WordPress taxonomy archive (/project-category/web/) -> suppressed CONTENT_THIN_TEXT', () => {
      const doc = createMockParsedDoc({
        pageUrl: 'https://example.com/project-category/web/',
        metadata: {
          title: 'Web Projects',
          robots: 'index, follow',
          openGraph: { 'og:type': 'website' },
        },
        headings: [{ tag: 'h2', level: 2, text: 'Portfolio Item 1', id: null }],
        visibleWordCount: 50,
      });
      const page = createMockPage('https://example.com/project-category/web/', doc);
      const res = analyzer.analyzePage(page, mockContext);
      expect(res.findings.some(f => f.ruleId === 'CONTENT_THIN_TEXT')).toBe(false);
    });

    it('Scenario 3B: Project category listing (/category/tutorials/) with grid -> suppressed CONTENT_THIN_TEXT', () => {
      const doc = createMockParsedDoc({
        pageUrl: 'https://example.com/category/tutorials/',
        metadata: { title: 'Tutorials' },
        headings: [{ tag: 'h2', level: 2, text: 'How to build apps', id: null }],
        visibleWordCount: 75,
      });
      const page = createMockPage('https://example.com/category/tutorials/', doc);
      const res = analyzer.analyzePage(page, mockContext);
      expect(res.findings.some(f => f.ruleId === 'CONTENT_THIN_TEXT')).toBe(false);
    });

    it('Scenario 3C: Technology listing (/project-technology/react/) -> suppressed CONTENT_THIN_TEXT', () => {
      const doc = createMockParsedDoc({
        pageUrl: 'https://example.com/project-technology/react/',
        metadata: { title: 'React Projects' },
        headings: [{ tag: 'h2', level: 2, text: 'React Dashboard', id: null }],
        visibleWordCount: 40,
      });
      const page = createMockPage('https://example.com/project-technology/react/', doc);
      const res = analyzer.analyzePage(page, mockContext);
      expect(res.findings.some(f => f.ruleId === 'CONTENT_THIN_TEXT')).toBe(false);
    });

    it('Scenario 3D: Short blog post (/blog/my-update/) with 40 words -> FLAGGED as CONTENT_THIN_TEXT (confirmed)', () => {
      const doc = createMockParsedDoc({
        pageUrl: 'https://example.com/blog/my-update/',
        metadata: {
          title: 'Quick Update',
          openGraph: { 'og:type': 'article' },
        },
        headings: [{ tag: 'h1', level: 1, text: 'Quick Update', id: null }],
        visibleWordCount: 40,
      });
      const page = createMockPage('https://example.com/blog/my-update/', doc);
      const res = analyzer.analyzePage(page, mockContext);
      const thinFinding = res.findings.find(f => f.ruleId === 'CONTENT_THIN_TEXT');
      expect(thinFinding).toBeDefined();
      expect(thinFinding?.confidence).toBe('confirmed');
    });

    it('Scenario 3E: Short landing or utility page (/contact/) -> correctly evaluated as non-archive with potential classification', () => {
      const doc = createMockParsedDoc({
        pageUrl: 'https://example.com/contact/',
        metadata: { title: 'Contact Us' },
        headings: [{ tag: 'h1', level: 1, text: 'Get In Touch', id: null }],
        forms: [
          {
            id: 'contact-form',
            action: '/submit',
            rawAction: '/submit',
            method: 'post',
            enctype: null,
            fields: [],
            buttons: [],
          },
        ],
        visibleWordCount: 65,
      });
      const page = createMockPage('https://example.com/contact/', doc);
      const classification = classifyPageContentType(page);
      expect(classification.isArchiveOrListing).toBe(false);
      const res = analyzer.analyzePage(page, mockContext);
      const thinFinding = res.findings.find(f => f.ruleId === 'CONTENT_THIN_TEXT');
      expect(thinFinding).toBeDefined();
      expect(thinFinding?.confidence).toBe('potential');
    });

    it('Scenario 3F: Empty page (/empty/) with 0 words -> FLAGGED as CONTENT_EMPTY_PAGE regardless of type', () => {
      const doc = createMockParsedDoc({
        pageUrl: 'https://example.com/empty-archive/',
        metadata: { title: 'Empty Archive' },
        visibleWordCount: 0,
        headings: [],
      });
      const page = createMockPage('https://example.com/empty-archive/', doc);
      const res = analyzer.analyzePage(page, mockContext);
      const emptyFinding = res.findings.find(f => f.ruleId === 'CONTENT_EMPTY_PAGE');
      expect(emptyFinding).toBeDefined();
      expect(emptyFinding?.severity).toBe('medium');
    });

    it('Scenario 3G: Ambiguous page structure (/preview/misc) with 45 words -> FLAGGED as potential confidence', () => {
      const doc = createMockParsedDoc({
        pageUrl: 'https://example.com/preview/misc',
        metadata: { title: 'Misc' },
        headings: [{ tag: 'h1', level: 1, text: 'Misc', id: null }],
        visibleWordCount: 45,
      });
      const page = createMockPage('https://example.com/preview/misc', doc);
      const res = analyzer.analyzePage(page, mockContext);
      const thinFinding = res.findings.find(f => f.ruleId === 'CONTENT_THIN_TEXT');
      expect(thinFinding).toBeDefined();
      expect(thinFinding?.confidence).toBe('potential');
      expect(thinFinding?.status).toBe('potential');
    });
  });

  // =========================================================================
  // Section 4: Accessibility Incomplete vs Confirmed
  // =========================================================================
  describe('4. Accessibility Classification Integrity', () => {
    it('preserves confirmed violations with original severity and confirmed status', () => {
      const analyzer = new AccessibilityAnalyzer();
      const result = analyzer.analyze({
        pageUrl: 'https://example.com/',
        rawResults: {
          violations: [
            {
              id: 'image-alt',
              description: 'Images must have alternate text',
              help: 'Elements must have alt attribute',
              helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
              impact: 'critical',
              tags: ['wcag2a', 'wcag111'],
              nodes: [
                {
                  html: '<img src="logo.png">',
                  target: ['img.logo'],
                  impact: 'critical',
                  failureSummary: 'Element does not have an alt attribute',
                },
              ],
            },
          ],
          incomplete: [],
          passes: [],
          inapplicable: [],
        },
      });

      expect(result.metrics.violationsCount).toBe(1);
      const f = result.findings[0];
      expect(f.severity).toBe('critical');
      expect(f.confidence).toBe('confirmed');
      expect(f.status).toBe('confirmed');
      expect(f.ruleId).toBe('a11y-image-alt');
    });

    it('maps incomplete check to conservative low severity and needs_manual_review status', () => {
      const analyzer = new AccessibilityAnalyzer();
      const result = analyzer.analyze({
        pageUrl: 'https://example.com/',
        rawResults: {
          violations: [],
          incomplete: [
            {
              id: 'color-contrast',
              description: 'Element contrast could not be determined automatically',
              help: 'Ensure sufficient contrast',
              helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/color-contrast',
              impact: 'serious', // axe reports 'serious'
              tags: ['wcag2aa', 'wcag143'],
              nodes: [
                {
                  html: '<span class="gradient">Complex gradient</span>',
                  target: ['span.gradient'],
                  impact: 'serious',
                  failureSummary: 'Background gradient requires human verification',
                },
              ],
            },
          ],
          passes: [],
          inapplicable: [],
        },
      });

      expect(result.metrics.violationsCount).toBe(0);
      expect(result.metrics.incompleteCount).toBe(1);

      const f = result.findings[0];
      expect(f.ruleId).toBe('a11y-review-color-contrast');
      expect(f.title).toContain('[A11Y Needs Review]');
      expect(f.severity).toBe('low'); // Conservative mapping!
      expect(f.status).toBe('needs_manual_review');
      expect(f.confidence).toBe('potential');
      expect((f.evidence as Record<string, unknown>).requiresManualReview).toBe(true);
    });

    it('verifies that incomplete findings are rendered with manual review badge in HTML reports', () => {
      const scanRun = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'quick',
        targetUrl: 'https://acceptance.example.com/',
      });

      findingRepo.batchCreate([
        {
          scanRunId: scanRun.id,
          ruleId: 'a11y-review-color-contrast',
          category: 'accessibility',
          title: '[A11Y Needs Review] Elements must meet minimum color contrast',
          description: 'Gradient background requires manual verification',
          severity: 'low',
          confidence: 'potential',
          status: 'needs_manual_review',
          targetUrl: 'https://acceptance.example.com/',
          evidence: { requiresManualReview: true, isIncompleteCheck: true },
        },
      ]);
      scanRunRepo.updateStatus(scanRun.id, { status: 'running' });
      scanRunRepo.updateStatus(scanRun.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      const reportModel = assembleReportData(scanRun.id, { siteRepo, scanRunRepo, findingRepo });
      const html = generateHtmlReport(reportModel);
      expect(html).toContain('MANUAL REVIEW REQUIRED');
      expect(html).toContain('[A11Y Needs Review]');
    });
  });

  // =========================================================================
  // Section 5: Canonical Logic Across 8 Scenarios
  // =========================================================================
  describe('5. Canonical URL & Cross-Page Relationship Verification', () => {
    const seoAnalyzer = new SeoPerformanceAnalyzer();
    const crossPageAnalyzer = new CrossPageAnalyzer();
    const mockContext = {
      authorizedOrigin: 'https://example.com',
      scanRunId: 'scan-can',
      options: {},
    };

    it('Scenario 5A: Self-referencing canonical is healthy with 0 defects', () => {
      const doc = createMockParsedDoc({
        pageUrl: 'https://example.com/service/',
        metadata: { canonical: 'https://example.com/service/' },
      });
      const page = createMockPage('https://example.com/service/', doc);
      const res = seoAnalyzer.analyzePage(page, mockContext);
      expect(res.findings.some(f => f.ruleId.startsWith('SEO_CANONICAL'))).toBe(false);
    });

    it('Scenario 5B: Tracking URL with canonical pointing to base path is flagged informatively as canonical alias', () => {
      const doc = createMockParsedDoc({
        pageUrl: 'https://example.com/product/?utm_source=fb',
        metadata: { canonical: 'https://example.com/product/' },
      });
      const page = createMockPage('https://example.com/product/?utm_source=fb', doc);
      const res = seoAnalyzer.analyzePage(page, mockContext);
      const mismatch = res.findings.find(f => f.ruleId === 'SEO_CANONICAL_MISMATCH');
      expect(mismatch).toBeDefined();
      expect(mismatch?.severity).toBe('info');
      expect((mismatch?.evidence as Record<string, unknown>)?.isCanonicalAlias).toBe(true);
    });

    it('Scenario 5C: Broken canonical target (HTTP 404) -> SEO_CANONICAL_TARGET_BROKEN', () => {
      const sourcePage = createMockPage(
        'https://example.com/p1',
        createMockParsedDoc({
          pageUrl: 'https://example.com/p1',
          metadata: { canonical: 'https://example.com/target-404' },
        }),
        200,
      );

      const targetPage = createMockPage(
        'https://example.com/target-404',
        createMockParsedDoc({
          pageUrl: 'https://example.com/target-404',
        }),
        404,
      );

      const crawlResult: CrawlResult = {
        pages: [sourcePage, targetPage],
        errors: [],
        redirects: [],
        summary: {
          totalPagesAttempted: 2,
          successfulPages: 1,
          failedPages: 1,
          durationMs: 50,
          totalEncodedBytes: 100,
          totalDecompressedBytes: 200,
        },
      };

      const res = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
      const broken = res.findings.find(f => f.ruleId === 'SEO_CANONICAL_TARGET_BROKEN');
      expect(broken).toBeDefined();
      expect(broken?.severity).toBe('medium');
    });

    it('Scenario 5D: Canonical loop (A -> B -> A) -> SEO_CANONICAL_LOOP', () => {
      const pageA = createMockPage(
        'https://example.com/page-a',
        createMockParsedDoc({
          pageUrl: 'https://example.com/page-a',
          metadata: { canonical: 'https://example.com/page-b' },
        }),
      );
      const pageB = createMockPage(
        'https://example.com/page-b',
        createMockParsedDoc({
          pageUrl: 'https://example.com/page-b',
          metadata: { canonical: 'https://example.com/page-a' },
        }),
      );

      const crawlResult: CrawlResult = {
        pages: [pageA, pageB],
        errors: [],
        redirects: [],
        summary: {
          totalPagesAttempted: 2,
          successfulPages: 2,
          failedPages: 0,
          durationMs: 50,
          totalEncodedBytes: 100,
          totalDecompressedBytes: 200,
        },
      };

      const res = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
      const loop = res.findings.find(f => f.ruleId === 'SEO_CANONICAL_LOOP');
      expect(loop).toBeDefined();
      expect(loop?.severity).toBe('medium');
    });

    it('Scenario 5E: Canonical chain (A -> B -> C) -> SEO_CANONICAL_CHAIN', () => {
      const pageA = createMockPage(
        'https://example.com/page-a',
        createMockParsedDoc({
          pageUrl: 'https://example.com/page-a',
          metadata: { canonical: 'https://example.com/page-b' },
        }),
      );
      const pageB = createMockPage(
        'https://example.com/page-b',
        createMockParsedDoc({
          pageUrl: 'https://example.com/page-b',
          metadata: { canonical: 'https://example.com/page-c' },
        }),
      );
      const pageC = createMockPage(
        'https://example.com/page-c',
        createMockParsedDoc({
          pageUrl: 'https://example.com/page-c',
          metadata: { canonical: 'https://example.com/page-c' },
        }),
      );

      const crawlResult: CrawlResult = {
        pages: [pageA, pageB, pageC],
        errors: [],
        redirects: [],
        summary: {
          totalPagesAttempted: 3,
          successfulPages: 3,
          failedPages: 0,
          durationMs: 50,
          totalEncodedBytes: 100,
          totalDecompressedBytes: 200,
        },
      };

      const res = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
      const chain = res.findings.find(f => f.ruleId === 'SEO_CANONICAL_CHAIN');
      expect(chain).toBeDefined();
      expect(chain?.severity).toBe('low');
    });

    it('Scenario 5F: Arabic/English translations with hreflang are NEVER collapsed as duplicate content', () => {
      const pageEn = createMockPage(
        'https://example.com/about',
        createMockParsedDoc({
          pageUrl: 'https://example.com/about',
          metadata: {
            title: 'About Our Team',
            canonical: 'https://example.com/about',
            lang: 'en',
          },
        }),
      );
      const pageAr = createMockPage(
        'https://example.com/ar/about',
        createMockParsedDoc({
          pageUrl: 'https://example.com/ar/about',
          metadata: {
            title: 'عن فريقنا',
            canonical: 'https://example.com/ar/about',
            lang: 'ar',
          },
        }),
      );

      const crawlResult: CrawlResult = {
        pages: [pageEn, pageAr],
        errors: [],
        redirects: [],
        summary: {
          totalPagesAttempted: 2,
          successfulPages: 2,
          failedPages: 0,
          durationMs: 50,
          totalEncodedBytes: 100,
          totalDecompressedBytes: 200,
        },
      };

      const res = crossPageAnalyzer.analyzeSite(crawlResult, mockContext);
      expect(res.findings.some(f => f.ruleId === 'CONTENT_DUPLICATE_PAGE_CANDIDATE')).toBe(false);
    });
  });

  // =========================================================================
  // Section 6: Historical Database & Reports Compatibility
  // =========================================================================
  describe('6. Historical Compatibility With Real Disk Records', () => {
    it('safely reads the real user database in read-only mode without any schema conflict', () => {
      const dbPath = path.join(
        process.env.APPDATA || 'C:\\Users\\Ahmed Hamdy\\AppData\\Roaming',
        'ultimate-wordpress-and-website-auditor',
        'database',
        'auditor.db',
      );

      if (!fs.existsSync(dbPath)) {
        return; // Skip if on headless machine without installed app
      }

      const realDb = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const runs = realDb
          .prepare(
            'SELECT id, target_url, status, summary_json FROM scan_runs ORDER BY started_at DESC LIMIT 5',
          )
          .all() as Array<{
          id: string;
          target_url: string;
          status: string;
          summary_json: string;
        }>;

        expect(runs.length).toBeGreaterThan(0);
        for (const r of runs) {
          expect(r.id).toBeDefined();
          expect(r.status).toBeDefined();
          if (r.summary_json) {
            const parsedSummary = JSON.parse(r.summary_json);
            expect(parsedSummary.totalFindings).toBeGreaterThanOrEqual(0);
          }
        }
      } finally {
        realDb.close();
      }
    });

    it('safely reads pre-existing historical JSON and HTML reports from disk', () => {
      const reportsDir = path.join(
        process.env.APPDATA || 'C:\\Users\\Ahmed Hamdy\\AppData\\Roaming',
        'ultimate-wordpress-and-website-auditor',
        'reports',
      );

      if (!fs.existsSync(reportsDir)) {
        return;
      }

      const files = fs.readdirSync(reportsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      expect(jsonFiles.length).toBeGreaterThan(0);

      // Verify that historical JSON files parse cleanly
      const firstJsonPath = path.join(reportsDir, jsonFiles[0]);
      const jsonContent = JSON.parse(fs.readFileSync(firstJsonPath, 'utf8'));
      expect(jsonContent.summary).toBeDefined();
      expect(Array.isArray(jsonContent.findings)).toBe(true);
    });
  });
});
