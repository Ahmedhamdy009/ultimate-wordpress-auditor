import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import type { CreateFindingRequest, UnifiedPerformanceEvidence } from '@auditor/shared';
import { extractPerformanceSummary } from '@auditor/shared';
import type {
  AccessibilityAuditor,
  BrowserManager,
  RuntimeResourceAuditor,
  VisualAuditor,
} from '../../src/main/browser/index.js';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { FindingService } from '../../src/main/services/finding.service.js';
import { ReportService } from '../../src/main/services/report.service.js';
import { ScanOrchestrator } from '../../src/main/scanner/orchestrator/orchestrator.js';
import { BottleneckClassifier } from '../../src/main/scanner/performance/bottleneck-classifier.js';
import type { PerformanceAuditor } from '../../src/main/scanner/performance/performance-analyzer.js';
import type { BoundedCrawler } from '../../src/main/scanner/crawler/crawler.js';
import type { CrawlResult } from '../../src/main/scanner/crawler/types.js';
import type { AnalyzerEngine } from '../../src/main/scanner/analyzers/analyzer-engine.js';
import type { AnalyzerEngineResult } from '../../src/main/scanner/analyzers/types.js';

describe('E2E Defects DEF-01, DEF-02, DEF-03 Regression Suite', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let reportRepo: ReportRepository;
  let validSiteId: string;
  let orchestrator: ScanOrchestrator | null = null;
  let tempReportsDir: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);
    reportRepo = new ReportRepository(connection);

    const project = projectRepo.create({ name: 'DEF Regression Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'DEF Regression Site',
      baseUrl: 'https://example.com/',
    });
    validSiteId = site.id;

    tempReportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auditor-def-reg-'));
  });

  afterEach(() => {
    if (orchestrator) {
      orchestrator.dispose();
      orchestrator = null;
    }
    if (connection && connection.isOpen()) {
      connection.close();
    }
    if (tempReportsDir && fs.existsSync(tempReportsDir)) {
      fs.rmSync(tempReportsDir, { recursive: true, force: true });
    }
  });

  const makePageMock = () =>
    ({
      goto: vi.fn().mockResolvedValue(undefined),
      isClosed: () => false,
      on: vi.fn(),
      off: vi.fn(),
      removeListener: vi.fn(),
    }) as unknown as Page;

  const makeCrawlResult = (urls: readonly string[]): CrawlResult => ({
    summary: {
      entryUrl: urls[0],
      authorizedOrigin: 'https://example.com',
      totalPagesAttempted: urls.length,
      successfulPages: urls.length,
      failedPages: 0,
      nonHtmlPages: 0,
      uniqueUrlsDiscovered: urls.length,
      urlsSkippedScope: 0,
      urlsSkippedLimits: 0,
      maxDepthReached: 1,
      durationMs: 35,
      cancelled: false,
    },
    pages: urls.map((u, idx) => ({
      requestedUrl: u,
      finalUrl: u,
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': 'text/html' },
      contentType: 'text/html',
      isHtml: true,
      durationMs: 25,
      depth: idx === 0 ? 0 : 1,
      parentUrl: idx === 0 ? null : urls[0],
      encodedBodyBytes: 800,
      decompressedBodyBytes: 1500,
      parsedDocument: null,
    })),
    discoveredUrls: [...urls],
    errors: [],
  });

  it('DEF-01: preserves all distinct bottleneck classifications on the same page and consolidates exact duplicates', async () => {
    const pageUrl = 'https://example.com/';
    const classifier = new BottleneckClassifier();

    const evidence: UnifiedPerformanceEvidence = {
      pageUrl,
      labMetrics: {
        pageUrl,
        navigationTiming: {
          redirectDurationMs: 0,
          dnsLookupMs: 5,
          tcpConnectMs: 10,
          tlsHandshakeMs: 15,
          ttfbMs: 180,
          contentDownloadMs: 40,
          domInteractiveMs: 1900,
          domContentLoadedMs: 2000,
          loadEventMs: 2400,
          transferSizeBytes: 12000,
          encodedBodySizeBytes: 11800,
          decodedBodySizeBytes: 24000,
          serverProcessingMs: null,
          hasServerTiming: false,
        },
        paintTiming: { firstPaintMs: 1950, firstContentfulPaintMs: 2100 },
        ttfbMs: 180,
        fcpMs: 2100,
        lcpMs: 2300,
        cls: 0.02,
        tbtMs: 360,
        lcpDetails: {
          elementSelector: 'h1',
          elementTagName: 'H1',
          elementUrl: null,
          renderTimeMs: 2300,
          loadTimeMs: 0,
          size: 20000,
          boundingBox: { x: 0, y: 0, width: 400, height: 80 },
          completenessState: 'complete',
          isCapped: false,
          limitationNotice: null,
        },
        clsDetails: {
          clsScore: 0.02,
          shiftCount: 0,
          significantShiftCount: 0,
          windowDurationMs: 1000,
          shifts: [],
        },
        tbtDetails: {
          totalBlockingTimeMs: 360,
          longTasksCount: 2,
          maxLongTaskDurationMs: 260,
          fcpTimeMs: 2100,
          observationWindowMs: 2800,
          topLongTasks: [
            {
              startTimeMs: 2200,
              durationMs: 260,
              blockingTimeMs: 210,
              containerType: 'window',
              containerName: null,
            },
          ],
        },
      },
      resources: [
        {
          url: 'https://example.com/a.css',
          resourceType: 'stylesheet',
          initiatorType: 'link',
          mimeType: 'text/css',
          contentEncoding: null,
          transferSizeBytes: 150000,
          encodedBodySizeBytes: 149500,
          decodedBodySizeBytes: 149500,
          durationMs: 650,
          isRenderBlocking: true,
          isCompressed: false,
          isLargeAsset: true,
          isOversizedImage: false,
          blockingImpactLevel: 'high',
        },
        {
          url: 'https://example.com/bundle.js',
          resourceType: 'script',
          initiatorType: 'script',
          mimeType: 'application/javascript',
          contentEncoding: null,
          transferSizeBytes: 1250000,
          encodedBodySizeBytes: 1249500,
          decodedBodySizeBytes: 1249500,
          durationMs: 620,
          isRenderBlocking: true,
          isCompressed: false,
          isLargeAsset: true,
          isOversizedImage: false,
          blockingImpactLevel: 'high',
        },
      ],
      images: [
        {
          currentSrc: 'https://example.com/hero.png',
          renderedWidth: 160,
          renderedHeight: 120,
          dpr: 1,
          effectiveWidthPixels: 160,
          effectiveHeightPixels: 120,
          sourcePhysicalWidth: 1600,
          sourcePhysicalHeight: 1200,
          oversizedFactor: 10,
          isOversized: true,
          isSvg: false,
          elementSelector: 'img.hero',
        },
      ],
      renderBlockingResources: [],
      largeAssets: [],
      uncompressedAssets: [],
      oversizedImages: [],
      resourceSummary: {
        totalResources: 3,
        totalTransferSizeBytes: 1500000,
        totalEncodedSizeBytes: 1499000,
        totalDecodedSizeBytes: 1499000,
        scriptsCount: 1,
        stylesheetsCount: 1,
        imagesCount: 1,
        renderBlockingCssCount: 1,
        renderBlockingJsCount: 1,
        largeAssetsCount: 2,
        uncompressedAssetsCount: 2,
        oversizedImagesCount: 1,
      },
      findingsCount: 0,
      collectedAt: new Date().toISOString(),
    };

    const diagnoses = classifier.classify(evidence);
    const findingRequests = classifier.toFindings(diagnoses, 'placeholder');
    // Deliberately emit a duplicate instance of UNCOMPRESSED_ASSETS to test consolidation
    const duplicateUncompressed = findingRequests.find(
      f => (f.evidence as { classification?: string })?.classification === 'UNCOMPRESSED_ASSETS',
    );
    expect(duplicateUncompressed).toBeDefined();

    const emittedFindings: CreateFindingRequest[] = [
      ...findingRequests,
      { ...duplicateUncompressed!, evidence: { ...duplicateUncompressed!.evidence } },
    ];

    const managedPage = { page: makePageMock(), release: vi.fn().mockResolvedValue(undefined) };

    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () =>
        ({ crawl: async () => makeCrawlResult([pageUrl]) }) as unknown as BoundedCrawler,
      analyzerEngineFactory: () =>
        ({
          runAnalysis: async () =>
            ({ findings: [], pagesAnalyzed: 1, analyzerErrors: [] }) as AnalyzerEngineResult,
        }) as unknown as AnalyzerEngine,
      browserManagerFactory: () =>
        ({
          launch: async () => {},
          close: async () => {},
          acquirePage: async () => managedPage,
        }) as unknown as BrowserManager,
      accessibilityAuditorFactory: () =>
        ({
          auditPage: vi.fn().mockResolvedValue({ findings: [] }),
        }) as unknown as AccessibilityAuditor,
      runtimeAuditorFactory: () =>
        ({
          attach: vi.fn(),
          detach: vi.fn(),
          audit: vi.fn().mockReturnValue({ findings: [], summary: {} }),
          getCapturedNetworkResources: vi.fn().mockReturnValue([]),
        }) as unknown as RuntimeResourceAuditor,
      visualAuditorFactory: () =>
        ({
          auditPage: vi
            .fn()
            .mockResolvedValue({ findings: [], screenshots: [], viewportsCompleted: 0 }),
        }) as unknown as VisualAuditor,
      performanceAuditorFactory: () =>
        ({
          install: vi.fn().mockResolvedValue(undefined),
          audit: vi.fn().mockResolvedValue({
            findings: emittedFindings,
            labMetrics: evidence.labMetrics,
            resourceSummary: evidence.resourceSummary,
            diagnoses,
            metricsCollected: true,
          }),
        }) as unknown as PerformanceAuditor,
    });

    const completedRun = await orchestrator.startScan({
      siteId: validSiteId,
      scanType: 'full',
      config: { enableBrowserAudit: true, maxBrowserPages: 1 },
    });

    expect(completedRun.status).toBe('completed');

    const persisted = findingRepo.listByScanRunId(completedRun.id, { limit: 50 });
    const bottleneckFindings = persisted.items.filter(
      f => f.ruleId === 'PERF_BOTTLENECK_DIAGNOSIS',
    );
    const classifications = bottleneckFindings.map(
      f => (f.evidence as Record<string, unknown>)?.classification,
    );

    expect(classifications).toContain('MAIN_THREAD_EXECUTION');
    expect(classifications).toContain('UNCOMPRESSED_ASSETS');
    expect(classifications).toContain('HEAVY_ASSET_PAYLOAD');
    expect(classifications).toContain('OVERSIZED_IMAGES');
    expect(classifications).toContain('RENDER_BLOCKING_RESOURCES');
    expect(bottleneckFindings).toHaveLength(5);

    const uncompressedFinding = bottleneckFindings.find(
      f => (f.evidence as Record<string, unknown>)?.classification === 'UNCOMPRESSED_ASSETS',
    );
    expect((uncompressedFinding?.evidence as Record<string, unknown>)?.occurrenceCount).toBe(2);

    const perfSummary = extractPerformanceSummary(
      completedRun.summary?.performanceMetrics as Record<string, unknown>,
      persisted.items,
    );
    expect(perfSummary?.bottleneckDiagnosesCount).toBe(5);
  });

  it('DEF-02: preserves entry-URL metrics and per-page telemetry without subpage overwrite', async () => {
    const entryUrl = 'https://example.com/';
    const subUrl = 'https://example.com/about';
    const partialUrl = 'https://example.com/partial';

    const makeMetricsForUrl = (url: string) => {
      if (url === entryUrl) {
        return {
          findings: [],
          labMetrics: {
            pageUrl: entryUrl,
            navigationTiming: null,
            paintTiming: null,
            ttfbMs: 420,
            fcpMs: 1450,
            lcpMs: 2900,
            cls: 0.04,
            tbtMs: 310,
            lcpDetails: {
              elementSelector: 'img.hero',
              elementTagName: 'IMG',
              elementUrl: 'https://example.com/hero.jpg',
              renderTimeMs: 2900,
              loadTimeMs: 1100,
              size: 40000,
              boundingBox: null,
              completenessState: 'complete',
              isCapped: false,
              limitationNotice: null,
            },
            clsDetails: null,
            tbtDetails: null,
          },
          resourceSummary: {
            totalResources: 12,
            totalTransferSizeBytes: 512000,
            totalEncodedSizeBytes: 490000,
            totalDecodedSizeBytes: 980000,
            scriptsCount: 5,
            stylesheetsCount: 3,
            imagesCount: 4,
            renderBlockingCssCount: 2,
            renderBlockingJsCount: 1,
            largeAssetsCount: 1,
            uncompressedAssetsCount: 2,
            oversizedImagesCount: 1,
          },
        };
      }
      if (url === subUrl) {
        return {
          findings: [],
          labMetrics: {
            pageUrl: subUrl,
            navigationTiming: null,
            paintTiming: null,
            ttfbMs: 12,
            fcpMs: 65,
            lcpMs: 80,
            cls: 0,
            tbtMs: 0,
            lcpDetails: {
              elementSelector: 'h1',
              elementTagName: 'H1',
              elementUrl: null,
              renderTimeMs: 80,
              loadTimeMs: 0,
              size: 5000,
              boundingBox: null,
              completenessState: 'complete',
              isCapped: false,
              limitationNotice: null,
            },
            clsDetails: null,
            tbtDetails: null,
          },
          resourceSummary: {
            totalResources: 1,
            totalTransferSizeBytes: 1200,
            totalEncodedSizeBytes: 1000,
            totalDecodedSizeBytes: 2400,
            scriptsCount: 0,
            stylesheetsCount: 0,
            imagesCount: 0,
            renderBlockingCssCount: 0,
            renderBlockingJsCount: 0,
            largeAssetsCount: 0,
            uncompressedAssetsCount: 0,
            oversizedImagesCount: 0,
          },
        };
      }
      return {
        findings: [],
        labMetrics: {
          pageUrl: partialUrl,
          navigationTiming: null,
          paintTiming: null,
          ttfbMs: null,
          fcpMs: null,
          lcpMs: null,
          cls: null,
          tbtMs: null,
          lcpDetails: null,
          clsDetails: null,
          tbtDetails: null,
        },
        resourceSummary: {
          totalResources: 0,
          totalTransferSizeBytes: null,
          totalEncodedSizeBytes: null,
          totalDecodedSizeBytes: null,
          scriptsCount: 0,
          stylesheetsCount: 0,
          imagesCount: 0,
          renderBlockingCssCount: 0,
          renderBlockingJsCount: 0,
          largeAssetsCount: 0,
          uncompressedAssetsCount: 0,
          oversizedImagesCount: 0,
        },
      };
    };

    const managedPage = { page: makePageMock(), release: vi.fn().mockResolvedValue(undefined) };

    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () =>
        ({
          crawl: async () => makeCrawlResult([entryUrl, subUrl, partialUrl]),
        }) as unknown as BoundedCrawler,
      analyzerEngineFactory: () =>
        ({
          runAnalysis: async () =>
            ({ findings: [], pagesAnalyzed: 3, analyzerErrors: [] }) as AnalyzerEngineResult,
        }) as unknown as AnalyzerEngine,
      browserManagerFactory: () =>
        ({
          launch: async () => {},
          close: async () => {},
          acquirePage: async () => managedPage,
        }) as unknown as BrowserManager,
      accessibilityAuditorFactory: () =>
        ({
          auditPage: vi.fn().mockResolvedValue({ findings: [] }),
        }) as unknown as AccessibilityAuditor,
      runtimeAuditorFactory: () =>
        ({
          attach: vi.fn(),
          detach: vi.fn(),
          audit: vi.fn().mockReturnValue({ findings: [], summary: {} }),
          getCapturedNetworkResources: vi.fn().mockReturnValue([]),
        }) as unknown as RuntimeResourceAuditor,
      visualAuditorFactory: () =>
        ({
          auditPage: vi
            .fn()
            .mockResolvedValue({ findings: [], screenshots: [], viewportsCompleted: 0 }),
        }) as unknown as VisualAuditor,
      performanceAuditorFactory: () =>
        ({
          install: vi.fn().mockResolvedValue(undefined),
          audit: vi.fn().mockImplementation(async (_page, url: string) => makeMetricsForUrl(url)),
        }) as unknown as PerformanceAuditor,
    });

    const completedRun = await orchestrator.startScan({
      siteId: validSiteId,
      scanType: 'full',
      config: { enableBrowserAudit: true, maxBrowserPages: 3 },
    });

    expect(completedRun.status).toBe('completed');
    const pm = completedRun.summary?.performanceMetrics as Record<string, unknown>;
    expect(pm.selectionPolicy).toBe('entry_url_preferred');
    expect(pm.selectedPageUrl).toBe(entryUrl);
    expect((pm.labMetrics as Record<string, unknown>).tbtMs).toBe(310);
    expect((pm.labMetrics as Record<string, unknown>).ttfbMs).toBe(420);
    expect((pm.resourceSummary as Record<string, unknown>).scriptsCount).toBe(5);
    expect((pm.resourceSummary as Record<string, unknown>).totalResources).toBe(12);

    const pages = pm.pages as Array<Record<string, unknown>>;
    expect(pages).toHaveLength(3);
    expect(pages[0].pageUrl).toBe(entryUrl);
    expect(pages[1].pageUrl).toBe(subUrl);
    expect((pages[1].labMetrics as Record<string, unknown>).ttfbMs).toBe(12);
    expect(pages[2].pageUrl).toBe(partialUrl);
    expect((pages[2].labMetrics as Record<string, unknown>).ttfbMs).toBeNull();
  });

  it('DEF-02 (fallback & partial): deterministically falls back to first measured subpage or explicit null partial summary', async () => {
    const entryUrl = 'https://example.com/';
    const subUrl = 'https://example.com/sub';
    const managedPage = { page: makePageMock(), release: vi.fn().mockResolvedValue(undefined) };

    // Case A: Entry URL has only null vitals/0 resources; subpage has measured vitals
    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () =>
        ({ crawl: async () => makeCrawlResult([entryUrl, subUrl]) }) as unknown as BoundedCrawler,
      analyzerEngineFactory: () =>
        ({
          runAnalysis: async () =>
            ({ findings: [], pagesAnalyzed: 2, analyzerErrors: [] }) as AnalyzerEngineResult,
        }) as unknown as AnalyzerEngine,
      browserManagerFactory: () =>
        ({
          launch: async () => {},
          close: async () => {},
          acquirePage: async () => managedPage,
        }) as unknown as BrowserManager,
      accessibilityAuditorFactory: () =>
        ({
          auditPage: vi.fn().mockResolvedValue({ findings: [] }),
        }) as unknown as AccessibilityAuditor,
      runtimeAuditorFactory: () =>
        ({
          attach: vi.fn(),
          detach: vi.fn(),
          audit: vi.fn().mockReturnValue({ findings: [], summary: {} }),
          getCapturedNetworkResources: vi.fn().mockReturnValue([]),
        }) as unknown as RuntimeResourceAuditor,
      visualAuditorFactory: () =>
        ({
          auditPage: vi
            .fn()
            .mockResolvedValue({ findings: [], screenshots: [], viewportsCompleted: 0 }),
        }) as unknown as VisualAuditor,
      performanceAuditorFactory: () =>
        ({
          install: vi.fn().mockResolvedValue(undefined),
          audit: vi.fn().mockImplementation(async (_page, url: string) =>
            url === entryUrl
              ? {
                  findings: [],
                  labMetrics: {
                    pageUrl: entryUrl,
                    navigationTiming: null,
                    paintTiming: null,
                    ttfbMs: null,
                    fcpMs: null,
                    lcpMs: null,
                    cls: null,
                    tbtMs: null,
                    lcpDetails: null,
                    clsDetails: null,
                    tbtDetails: null,
                  },
                  resourceSummary: {
                    totalResources: 0,
                    totalTransferSizeBytes: null,
                    totalEncodedSizeBytes: null,
                    totalDecodedSizeBytes: null,
                    scriptsCount: 0,
                    stylesheetsCount: 0,
                    imagesCount: 0,
                    renderBlockingCssCount: 0,
                    renderBlockingJsCount: 0,
                    largeAssetsCount: 0,
                    uncompressedAssetsCount: 0,
                    oversizedImagesCount: 0,
                  },
                }
              : {
                  findings: [],
                  labMetrics: {
                    pageUrl: subUrl,
                    navigationTiming: null,
                    paintTiming: null,
                    ttfbMs: 300,
                    fcpMs: 900,
                    lcpMs: 1400,
                    cls: 0.01,
                    tbtMs: 50,
                    lcpDetails: null,
                    clsDetails: null,
                    tbtDetails: null,
                  },
                  resourceSummary: {
                    totalResources: 4,
                    totalTransferSizeBytes: 24000,
                    totalEncodedSizeBytes: 22000,
                    totalDecodedSizeBytes: 40000,
                    scriptsCount: 2,
                    stylesheetsCount: 1,
                    imagesCount: 1,
                    renderBlockingCssCount: 0,
                    renderBlockingJsCount: 0,
                    largeAssetsCount: 0,
                    uncompressedAssetsCount: 0,
                    oversizedImagesCount: 0,
                  },
                },
          ),
        }) as unknown as PerformanceAuditor,
    });

    const fallbackRun = await orchestrator.startScan({
      siteId: validSiteId,
      scanType: 'full',
      config: { enableBrowserAudit: true, maxBrowserPages: 2 },
    });
    const pmFallback = fallbackRun.summary?.performanceMetrics as Record<string, unknown>;
    expect(pmFallback.selectionPolicy).toBe('first_measured_fallback');
    expect(pmFallback.selectedPageUrl).toBe(subUrl);
    expect((pmFallback.labMetrics as Record<string, unknown>).ttfbMs).toBe(300);

    // Case B: All pages have unavailable vitals -> 'unavailable_partial', explicit nulls
    orchestrator.dispose();
    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () =>
        ({ crawl: async () => makeCrawlResult([entryUrl]) }) as unknown as BoundedCrawler,
      analyzerEngineFactory: () =>
        ({
          runAnalysis: async () =>
            ({ findings: [], pagesAnalyzed: 1, analyzerErrors: [] }) as AnalyzerEngineResult,
        }) as unknown as AnalyzerEngine,
      browserManagerFactory: () =>
        ({
          launch: async () => {},
          close: async () => {},
          acquirePage: async () => managedPage,
        }) as unknown as BrowserManager,
      accessibilityAuditorFactory: () =>
        ({
          auditPage: vi.fn().mockResolvedValue({ findings: [] }),
        }) as unknown as AccessibilityAuditor,
      runtimeAuditorFactory: () =>
        ({
          attach: vi.fn(),
          detach: vi.fn(),
          audit: vi.fn().mockReturnValue({ findings: [], summary: {} }),
          getCapturedNetworkResources: vi.fn().mockReturnValue([]),
        }) as unknown as RuntimeResourceAuditor,
      visualAuditorFactory: () =>
        ({
          auditPage: vi
            .fn()
            .mockResolvedValue({ findings: [], screenshots: [], viewportsCompleted: 0 }),
        }) as unknown as VisualAuditor,
      performanceAuditorFactory: () =>
        ({
          install: vi.fn().mockResolvedValue(undefined),
          audit: vi.fn().mockResolvedValue({
            findings: [],
            labMetrics: {
              pageUrl: entryUrl,
              navigationTiming: null,
              paintTiming: null,
              ttfbMs: null,
              fcpMs: null,
              lcpMs: null,
              cls: null,
              tbtMs: null,
              lcpDetails: null,
              clsDetails: null,
              tbtDetails: null,
            },
            resourceSummary: null,
          }),
        }) as unknown as PerformanceAuditor,
    });

    const unavailableRun = await orchestrator.startScan({
      siteId: validSiteId,
      scanType: 'full',
      config: { enableBrowserAudit: true, maxBrowserPages: 1 },
    });
    const pmUnavail = unavailableRun.summary?.performanceMetrics as Record<string, unknown>;
    expect(pmUnavail.selectionPolicy).toBe('unavailable_partial');
    expect((pmUnavail.labMetrics as Record<string, unknown>).ttfbMs).toBeNull();
  });

  it('DEF-03: redacts sensitive query tokens before SQLite persistence and across HTML/JSON/CSV while preserving legacy reads', async () => {
    const tokenVal = 'supersecrettoken99';
    const apiKeyVal = 'sk_test_regression9876543210';
    const sensitiveUrl = `https://example.com/subpage.html?token=${tokenVal}&page=2`;
    const sensitiveApiUrl = `https://example.com/feed?api_key=${apiKeyVal}&sort=desc`;

    const analyzerFindings: AnalyzerEngineResult = {
      findings: [
        {
          ruleId: 'SEC_HEADER_CSP_MISSING',
          category: 'security',
          title: 'Missing Content-Security-Policy',
          description: `Observed missing header on ${sensitiveUrl}`,
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: sensitiveUrl,
          evidence: {
            url: sensitiveUrl,
            affectedUrls: [sensitiveUrl, sensitiveApiUrl],
            redirectChain: [sensitiveUrl, 'https://example.com/final?sort=asc'],
          },
          remediation: 'Configure CSP header.',
          references: [],
        },
      ],
      pagesAnalyzed: 1,
      analyzerErrors: [],
    };

    const managedPage = { page: makePageMock(), release: vi.fn().mockResolvedValue(undefined) };

    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () =>
        ({ crawl: async () => makeCrawlResult([sensitiveUrl]) }) as unknown as BoundedCrawler,
      analyzerEngineFactory: () =>
        ({ runAnalysis: async () => analyzerFindings }) as unknown as AnalyzerEngine,
      browserManagerFactory: () =>
        ({
          launch: async () => {},
          close: async () => {},
          acquirePage: async () => managedPage,
        }) as unknown as BrowserManager,
      accessibilityAuditorFactory: () =>
        ({
          auditPage: vi.fn().mockResolvedValue({ findings: [] }),
        }) as unknown as AccessibilityAuditor,
      runtimeAuditorFactory: () =>
        ({
          attach: vi.fn(),
          detach: vi.fn(),
          audit: vi.fn().mockReturnValue({ findings: [], summary: {} }),
          getCapturedNetworkResources: vi.fn().mockReturnValue([]),
        }) as unknown as RuntimeResourceAuditor,
      visualAuditorFactory: () =>
        ({
          auditPage: vi
            .fn()
            .mockResolvedValue({ findings: [], screenshots: [], viewportsCompleted: 0 }),
        }) as unknown as VisualAuditor,
      performanceAuditorFactory: () =>
        ({
          install: vi.fn().mockResolvedValue(undefined),
          audit: vi
            .fn()
            .mockResolvedValue({ findings: [], labMetrics: null, resourceSummary: null }),
        }) as unknown as PerformanceAuditor,
    });

    const completedRun = await orchestrator.startScan({
      siteId: validSiteId,
      scanType: 'full',
      config: { enableBrowserAudit: false },
    });

    // 1. Check raw SQLite rows directly to ensure secrets never hit database columns
    const rawRows = connection
      .getRawDb()
      .prepare('SELECT target_url, description, evidence_json FROM findings WHERE scan_run_id = ?')
      .all(completedRun.id) as Array<{
      target_url: string;
      description: string;
      evidence_json: string;
    }>;

    expect(rawRows.length).toBeGreaterThan(0);
    for (const row of rawRows) {
      expect(row.target_url).not.toContain(tokenVal);
      expect(row.target_url).not.toContain(apiKeyVal);
      expect(row.description).not.toContain(tokenVal);
      expect(row.evidence_json).not.toContain(tokenVal);
      expect(row.evidence_json).not.toContain(apiKeyVal);
    }

    // Safe query params & paths are preserved
    expect(rawRows[0].target_url).toContain('https://example.com/subpage.html');
    expect(rawRows[0].target_url).toContain('page=2');
    expect(rawRows[0].evidence_json).toContain('sort=desc');

    // 2. Also test FindingService.createFinding directly
    const findingService = new FindingService(findingRepo, scanRunRepo);
    const directCreated = findingService.createFinding({
      scanRunId: completedRun.id,
      ruleId: 'CUSTOM_SECRET_CHECK',
      category: 'security',
      title: 'Direct IPC finding',
      description: `Captured at ${sensitiveUrl}`,
      severity: 'low',
      confidence: 'firm',
      targetUrl: sensitiveUrl,
      evidence: { affectedUrls: [sensitiveUrl] },
    });
    expect(directCreated.targetUrl).not.toContain(tokenVal);
    expect(directCreated.targetUrl).toContain('page=2');
    expect(JSON.stringify(directCreated.evidence)).not.toContain(tokenVal);

    // 3. Export HTML, JSON, CSV reports and confirm consistent redaction
    const reportService = new ReportService(reportRepo, scanRunRepo, {
      siteRepo,
      findingRepo,
      reportsDir: tempReportsDir,
    });
    for (const format of ['html', 'json', 'csv'] as const) {
      const rep = reportService.createReport({
        scanRunId: completedRun.id,
        title: `Redaction Check ${format.toUpperCase()}`,
        format,
      });
      const content = reportService.getReportContent({ id: rep.id }).content;
      expect(content).not.toContain(tokenVal);
      expect(content).not.toContain(apiKeyVal);
    }

    // 4. Verify historical unredacted rows remain readable without migration breakage
    const legacyId = 'dddddddd-1111-4222-8333-444444444444';
    const now = new Date().toISOString();
    connection
      .getRawDb()
      .prepare(
        `INSERT INTO findings (id, scan_run_id, rule_id, category, title, description, severity, confidence, status, target_url, evidence_json, created_at)
         VALUES (?, ?, 'LEGACY_RULE', 'technical-seo', 'Legacy Title', 'Legacy Desc', 'low', 'firm', 'active', 'https://example.com/old?token=legacy_old_val', '{}', ?)`,
      )
      .run(legacyId, completedRun.id, now);
    const legacyRead = findingRepo.getById(legacyId);
    expect(legacyRead).not.toBeNull();
    expect(legacyRead?.ruleId).toBe('LEGACY_RULE');
  });
});
