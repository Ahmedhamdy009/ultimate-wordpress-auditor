import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyFindingConfidenceBucket,
  FINDING_CATEGORY_FILTER_ORDER,
  getFindingCategoryLabel,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
} from '@auditor/shared';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { ReportService } from '../../src/main/services/report.service.js';
import { ScanOrchestrator } from '../../src/main/scanner/orchestrator/orchestrator.js';
import type { BoundedCrawler } from '../../src/main/scanner/crawler/crawler.js';
import type { AnalyzerEngine } from '../../src/main/scanner/analyzers/analyzer-engine.js';
import type { AnalyzerFinding } from '../../src/main/scanner/analyzers/types.js';
import {
  getFindingConfidenceBadgeProps,
  getFindingStatusBadgeProps,
} from '../../src/renderer/src/components/views/ScansView.js';

describe('Phase 6 Cross-Layer Reconciliation (D3/D4/D5/D6): SQLite <-> Inspector <-> JSON <-> HTML', () => {
  let connection: DatabaseConnection;
  let scanRunRepo: ScanRunRepository;
  let siteRepo: SiteRepository;
  let findingRepo: FindingRepository;
  let reportRepo: ReportRepository;
  let reportService: ReportService;
  let siteId: string;
  let tmpReportsDir: string;
  let tmpScreenshotsDir: string;

  beforeEach(async () => {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const projectRoot = path.resolve(import.meta.dirname, '../../../../');
    tmpReportsDir = path.resolve(projectRoot, '.tmp/reconcile-reports', token);
    tmpScreenshotsDir = path.join(tmpReportsDir, 'screenshots');
    fs.mkdirSync(tmpScreenshotsDir, { recursive: true });

    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    await new MigrationRunner(connection).migrate();

    const projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);
    reportRepo = new ReportRepository(connection);

    reportService = new ReportService(reportRepo, scanRunRepo, {
      siteRepo,
      findingRepo,
      reportsDir: tmpReportsDir,
      screenshotsDir: tmpScreenshotsDir,
    });

    const project = projectRepo.create({ name: 'Reconciliation Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Reconciliation Site',
      baseUrl: 'https://reconcile.example.com',
      platformType: 'wordpress',
    });
    siteId = site.id;
  });

  afterEach(() => {
    connection.close();
    fs.rmSync(tmpReportsDir, { recursive: true, force: true });
  });

  it('reconciles confidence buckets, non-active statuses, 13 canonical categories, and HTML embedded screenshots 1:1', async () => {
    const validPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const shotName = 'reconcile-mobile-320.png';
    fs.writeFileSync(path.join(tmpScreenshotsDir, shotName), validPng);

    const syntheticFindings: AnalyzerFinding[] = [
      {
        ruleId: 'WP_VERSION_DISCLOSED',
        category: 'wordpress',
        title: 'WordPress Version Disclosed',
        description: 'Meta generator discloses WordPress 6.7',
        severity: 'low',
        confidence: 'firm',
        targetUrl: 'https://reconcile.example.com/',
        evidence: { generator: 'WordPress 6.7' },
      },
      {
        ruleId: 'SEC_HEADER_HSTS_MISSING',
        category: 'security',
        title: 'Missing HSTS Header',
        description: 'HSTS not configured',
        severity: 'medium',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://reconcile.example.com/',
      },
      {
        ruleId: 'A11Y_COLOR_CONTRAST',
        category: 'accessibility',
        title: 'Low Contrast Text',
        description: 'Insufficient foreground contrast',
        severity: 'high',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://reconcile.example.com/',
      },
      {
        ruleId: 'A11Y-BP-LANDMARK',
        category: 'accessibility-best-practice',
        title: 'Main Landmark Missing',
        description: 'Best-practice landmark missing',
        severity: 'info',
        confidence: 'potential',
        status: 'needs_manual_review',
        targetUrl: 'https://reconcile.example.com/',
      },
      {
        ruleId: 'CONTENT_THIN_TEXT',
        category: 'content-quality',
        title: 'Thin Text Content',
        description: 'Only 20 words',
        severity: 'low',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://reconcile.example.com/',
      },
      {
        ruleId: 'CONTENT_DOM_BLOAT',
        category: 'dom-quality',
        title: 'Excessive DOM Nodes',
        description: '3200 DOM nodes',
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://reconcile.example.com/',
      },
      {
        ruleId: 'CONTENT_HIGH_LINK_DENSITY',
        category: 'content-structure',
        title: 'High Link Density',
        description: '58% link ratio',
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://reconcile.example.com/',
      },
      {
        ruleId: 'SEO_TITLE_MISSING',
        category: 'technical-seo',
        title: 'Missing Title Tag',
        description: 'Document title missing',
        severity: 'high',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://reconcile.example.com/',
      },
      {
        ruleId: 'PERF_LARGE_HTML',
        category: 'static-performance',
        title: 'Large HTML Payload',
        description: 'HTML exceeds budget',
        severity: 'low',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://reconcile.example.com/',
      },
      {
        ruleId: 'RESPONSIVE_ELEMENT_CLIPPED',
        category: 'responsive-design',
        title: 'Element Clipped Under Clipped Root',
        description: 'Overflow hidden clips child at root',
        severity: 'low',
        confidence: 'potential',
        status: 'potential',
        targetUrl: 'https://reconcile.example.com/',
        evidence: {
          screenshot: {
            fileName: shotName,
            viewportProfile: 'mobile-320',
            width: 320,
            height: 568,
            fileSizeBytes: validPng.length,
          },
        },
      },
    ];

    const mockCrawler = {
      crawl: async () => ({
        summary: {
          entryUrl: 'https://reconcile.example.com/',
          authorizedOrigin: 'https://reconcile.example.com',
          totalPagesAttempted: 1,
          successfulPages: 1,
          failedPages: 0,
          nonHtmlPages: 0,
          uniqueUrlsDiscovered: 1,
          urlsSkippedScope: 0,
          urlsSkippedLimits: 0,
          maxDepthReached: 0,
          durationMs: 12,
          cancelled: false,
        },
        pages: [],
        discoveredUrls: ['https://reconcile.example.com/'],
        errors: [],
      }),
    };

    const mockAnalyzer = {
      runAnalysis: async () => ({
        findings: syntheticFindings,
        stats: {
          totalPagesAnalyzed: 1,
          totalFindings: syntheticFindings.length,
          bySeverity: { critical: 0, high: 2, medium: 1, low: 4, info: 3 },
          byCategory: {},
        },
      }),
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
    });

    const scanRun = await orchestrator.startScan({
      siteId,
      scanType: 'quick',
      config: { enableBrowserAudit: false },
    });
    orchestrator.dispose();

    const persisted = findingRepo.getAllByScanRunId(scanRun.id);
    expect(persisted).toHaveLength(10);

    // 1. D3: Zero 'active' rows anywhere in SQLite
    expect(persisted.some(f => f.status === 'active')).toBe(false);

    // 2. D4: Confirmed (7), Firm (1), Potential (2) strictly separated across SQLite & Inspector helpers
    let uiConfirmed = 0;
    let uiFirm = 0;
    let uiPotential = 0;
    for (const f of persisted) {
      const b = classifyFindingConfidenceBucket(f.confidence);
      const badge = getFindingConfidenceBadgeProps(f.confidence);
      const statusBadge = getFindingStatusBadgeProps(f.status, f.confidence);
      expect(statusBadge.label).not.toContain('Active');
      if (b === 'confirmed') {
        uiConfirmed++;
        expect(badge).toEqual({ variant: 'success', label: 'Confirmed' });
      } else if (b === 'firm') {
        uiFirm++;
        expect(badge).toEqual({ variant: 'info', label: 'Firm' });
      } else {
        uiPotential++;
        expect(badge).toEqual({ variant: 'neutral', label: 'Potential' });
      }
      expect(normalizeFindingLifecycleStatus(f.status, f.confidence)).not.toBe('active');
    }
    expect(uiConfirmed).toBe(7);
    expect(uiFirm).toBe(1);
    expect(uiPotential).toBe(2);

    // 3. D5: Non-overlapping canonical categories sum exactly to totalFindings (10)
    const uiCategoryCounts = Object.fromEntries(
      FINDING_CATEGORY_FILTER_ORDER.map(def => [
        def.id,
        persisted.filter(f => normalizeFindingCategoryId(f) === def.id).length,
      ]),
    );
    const tabSum = Object.values(uiCategoryCounts).reduce((a, b) => a + b, 0);
    expect(tabSum).toBe(persisted.length);
    expect(uiCategoryCounts.wordpress).toBe(1);
    expect(uiCategoryCounts.security).toBe(1);
    expect(uiCategoryCounts.accessibility).toBe(1);
    expect(uiCategoryCounts['accessibility-best-practice']).toBe(1);
    expect(uiCategoryCounts['content-quality']).toBe(1);
    expect(uiCategoryCounts['dom-quality']).toBe(1);
    expect(uiCategoryCounts['content-structure']).toBe(1);
    expect(uiCategoryCounts['technical-seo']).toBe(1);
    expect(uiCategoryCounts['static-performance']).toBe(1);
    expect(uiCategoryCounts['responsive-design']).toBe(1);

    // 4. Reconcile JSON & HTML reports
    const jsonMeta = reportService.createReport({
      scanRunId: scanRun.id,
      title: 'Reconciliation JSON',
      format: 'json',
    });
    const jsonContent = JSON.parse(reportService.getReportContent({ id: jsonMeta.id }).content);
    expect(jsonContent.summary.totalFindings).toBe(10);
    expect(jsonContent.summary.confirmedCount).toBe(7);
    expect(jsonContent.summary.firmCount).toBe(1);
    expect(jsonContent.summary.potentialCount).toBe(2);
    expect(jsonContent.summary.byCategory).toEqual(
      Object.fromEntries(Object.entries(uiCategoryCounts).filter(([, c]) => c > 0)),
    );
    expect(jsonContent.findings.some((f: { status: string }) => f.status === 'active')).toBe(false);

    const htmlMeta = reportService.createReport({
      scanRunId: scanRun.id,
      title: 'Reconciliation HTML',
      format: 'html',
    });
    const htmlContent = reportService.getReportContent({ id: htmlMeta.id }).content;
    expect(htmlContent).toContain('7 Confirmed');
    expect(htmlContent).toContain('1 Firm');
    expect(htmlContent).toContain('2 Potential');
    expect(htmlContent).toContain('conf-firm');
    expect(htmlContent).toContain('NEEDS MANUAL REVIEW');
    expect(htmlContent).toContain('<img class="visual-evidence-img" src="data:image/png;base64,');
    for (const def of FINDING_CATEGORY_FILTER_ORDER) {
      if (uiCategoryCounts[def.id] > 0) {
        expect(htmlContent).toContain(getFindingCategoryLabel(def.id));
      }
    }
  });
});
