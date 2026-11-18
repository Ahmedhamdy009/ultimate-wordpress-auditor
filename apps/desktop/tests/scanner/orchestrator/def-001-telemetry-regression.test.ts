import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import {
  evaluateD1CrawlCoverage,
  evaluateAuditCoverage,
  type ScanRunSummaryDTO,
  type PageScreenshotRecord,
} from '@auditor/shared';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';
import {
  installLocalFixtureNetwork,
  type LocalFixtureNetworkHandle,
} from '../../support/fixture-network.js';
import type { BrowserManager, ManagedPage } from '../../../src/main/browser/browser-manager.js';
import type { AccessibilityAuditor } from '../../../src/main/browser/accessibility-types.js';
import type { VisualAuditor } from '../../../src/main/browser/visual-types.js';
import type { RuntimeResourceAuditor } from '../../../src/main/browser/runtime-types.js';
import type { PerformanceAuditor } from '../../../src/main/scanner/performance/index.js';
import type { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import type { AnalyzerEngine } from '../../../src/main/scanner/analyzers/analyzer-engine.js';
import {
  adaptScanRunForViewModel,
  extractDimensionTelemetryCounts,
} from '../../../src/renderer/src/utils/reportViewModelAdapter.js';

describe('DEF-001 Live Coverage Telemetry Regression Suite', () => {
  let server: http.Server;
  let serverPort: number;
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let findingRepo: FindingRepository;
  let scanRunRepo: ScanRunRepository;
  let siteId: string;
  let projectId: string;
  let fixtureNet: LocalFixtureNetworkHandle | null = null;

  beforeAll(async () => {
    fixtureNet = installLocalFixtureNetwork();
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Home</title></head>
          <body>
            <h1>Home</h1>
            <a href="/page-a">Page A</a>
            <a href="/missing">Missing</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/page-a') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>Page A Content</body></html>');
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    fixtureNet?.restore();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    findingRepo = new FindingRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);

    const project = projectRepo.create({ name: 'Telemetry Project' });
    projectId = project.id;

    const site = siteRepo.create({
      projectId,
      name: 'Telemetry Site',
      baseUrl: `http://telemetry.local:${serverPort}`,
      platformType: 'generic_web',
      environmentType: 'staging',
    });
    siteId = site.id;
  });

  afterEach(() => {
    if (connection && connection.isOpen) {
      connection.close();
    }
  });

  it('1. Persists all 7 execution counters in scan_runs.summary_json upon successful scan completion', async () => {
    const entryUrl = `http://telemetry.local:${serverPort}/`;
    const pageAUrl = `http://telemetry.local:${serverPort}/page-a`;
    const missingUrl = `http://telemetry.local:${serverPort}/missing`;

    // 1. Mock Crawler: 3 attempted, 2 succeeded, 1 failed
    const mockCrawler = {
      crawl: async () => ({
        summary: {
          entryUrl,
          authorizedOrigin: `http://telemetry.local:${serverPort}`,
          totalPagesAttempted: 3,
          successfulPages: 2,
          failedPages: 1,
          nonHtmlPages: 0,
          uniqueUrlsDiscovered: 3,
          urlsSkippedScope: 0,
          urlsSkippedLimits: 0,
          maxDepthReached: 1,
          durationMs: 50,
          cancelled: false,
        },
        pages: [
          {
            requestedUrl: entryUrl,
            finalUrl: entryUrl,
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            body: '<html>Home</html>',
            contentType: 'text/html',
            isHtml: true,
            depth: 0,
            discoveredUrls: [pageAUrl, missingUrl],
            timing: { startedAt: '', durationMs: 10 },
          },
          {
            requestedUrl: pageAUrl,
            finalUrl: pageAUrl,
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            body: '<html>Page A</html>',
            contentType: 'text/html',
            isHtml: true,
            depth: 1,
            discoveredUrls: [],
            timing: { startedAt: '', durationMs: 10 },
          },
        ],
        discoveredUrls: [entryUrl, pageAUrl, missingUrl],
        errors: [
          {
            url: missingUrl,
            error: 'HTTP 404',
            depth: 1,
            timing: { startedAt: '', durationMs: 5 },
          },
        ],
      }),
    };

    // 2. Mock AnalyzerEngine: 2 pages analyzed, 5 static modules executed
    const mockAnalyzer = {
      runAnalysis: async () => ({
        findings: [
          {
            scanRunId: 'placeholder',
            ruleId: 'SEC_HEADER_CSP_MISSING',
            category: 'Security',
            title: 'Content Security Policy Missing',
            description: 'CSP header not found',
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: entryUrl,
            evidence: {},
            remediation: 'Add CSP header',
            references: [],
          },
        ],
        stats: {
          totalFindings: 1,
          bySeverity: { medium: 1 },
          byCategory: { Security: 1 },
          byConfidence: { confirmed: 1 },
          byRule: { SEC_HEADER_CSP_MISSING: 1 },
          pagesAnalyzed: 2,
          durationMs: 25,
          findingsTruncatedCount: 0,
          evidenceTruncatedCount: 0,
          duplicatesFilteredCount: 0,
        },
      }),
    };

    // 3. Mock BrowserManager & Auditors
    const mockPage = {
      goto: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    };

    const mockBrowserManager = {
      launch: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      acquirePage: vi.fn().mockResolvedValue({
        page: mockPage,
        release: vi.fn().mockResolvedValue(undefined),
      } as unknown as ManagedPage),
    } as unknown as BrowserManager;

    const mockA11yAuditor = {
      auditPage: vi.fn().mockResolvedValue({ findings: [] }),
    } as unknown as AccessibilityAuditor;

    const mockRuntimeAuditor = {
      attach: vi.fn(),
      detach: vi.fn(),
      audit: vi.fn().mockReturnValue({ findings: [] }),
      getCapturedNetworkResources: vi.fn().mockReturnValue([]),
    } as unknown as RuntimeResourceAuditor;

    const mockPerformanceAuditor = {
      install: vi.fn().mockResolvedValue(undefined),
      audit: vi.fn().mockResolvedValue({
        findings: [],
        labMetrics: { ttfbMs: 50, fcpMs: 120, lcpMs: 200, cls: 0.02, tbtMs: 10 },
        resourceSummary: { totalResources: 5, totalTransferSizeBytes: 12000 },
      }),
    } as unknown as PerformanceAuditor;

    const mockVisualAuditor = {
      auditUrl: vi.fn().mockResolvedValue({
        targetUrl: entryUrl,
        findings: [],
        totalScreenshots: 1,
        viewportResults: [
          {
            viewport: {
              id: 'desktop',
              name: 'Desktop Standard',
              width: 1280,
              height: 800,
              deviceScaleFactor: 1,
              isMobile: false,
              hasTouch: false,
              isLandscape: true,
            },
            targetUrl: entryUrl,
            responsiveMetrics: {},
            layoutStabilityMetrics: {
              isSupported: true,
              totalShiftsRecorded: 0,
              rawCumulativeLayoutShift: 0,
              sessionWindowCLS: 0,
            },
            layoutShiftEvents: [],
            overflowingElements: [],
            screenshots: [
              {
                id: 'sc-1234',
                targetUrl: entryUrl,
                viewport: {
                  id: 'desktop',
                  name: 'Desktop Standard',
                  width: 1280,
                  height: 800,
                },
                captureType: 'viewport',
                format: 'webp',
                filePath: 'C:/tmp/sc.webp',
                relativePath: 'screenshots/sc.webp',
                width: 1280,
                height: 800,
                fileSizeBytes: 24500,
                sha256: 'abcdef',
                capturedAt: new Date().toISOString(),
              },
            ],
            findings: [],
            durationMs: 100,
          },
        ],
      }),
    } as unknown as VisualAuditor;

    const orchestrator = new ScanOrchestrator(connection, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
      browserManagerFactory: () => mockBrowserManager,
      accessibilityAuditorFactory: () => mockA11yAuditor,
      runtimeAuditorFactory: () => mockRuntimeAuditor,
      performanceAuditorFactory: () => mockPerformanceAuditor,
      visualAuditorFactory: () => mockVisualAuditor,
    });

    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 10,
        enableBrowserAudit: true,
        captureScreenshots: true,
        auditModules: {
          http: true,
          wordpress: true,
          securityHeaders: true,
          cookies: true,
          seo: true,
          runtimeErrors: true,
          accessibility: true,
          layoutStability: true,
          screenshots: true,
          networkResources: true,
          responsiveLayout: true,
        },
      },
    });

    expect(result.status).toBe('completed');

    // Inspect SQLite raw persistence directly to verify database integrity
    const rawDb = connection.getRawDb();
    const row = rawDb.prepare('SELECT summary_json FROM scan_runs WHERE id = ?').get(result.id) as {
      summary_json: string;
    };
    expect(row).toBeDefined();
    expect(row.summary_json).toBeTypeOf('string');

    const summary = JSON.parse(row.summary_json) as ScanRunSummaryDTO;

    // Verify all 7 required counters and telemetry fields
    expect(summary.crawlFailedPages).toBe(1);
    expect(summary.browserFailedPages).toBe(0);
    expect(summary.staticModulesExecuted).toBe(5);
    expect(summary.staticModulesTotal).toBe(5);
    expect(summary.staticPagesAnalyzed).toBe(2);
    expect(summary.runtimeAuditsCompleted).toBe(2);
    expect(summary.layoutStabilityPagesCompleted).toBe(2);
    expect(summary.accessibilityCandidatesTotal).toBe(2);
    expect(summary.accessibilityAuditsCompleted).toBe(2);
    expect(summary.completedEngines).toEqual(['crawler', 'analyzers', 'browser']);

    // Verify pageScreenshots structure and properties
    expect(Array.isArray(summary.pageScreenshots)).toBe(true);
    expect(summary.pageScreenshots!.length).toBeGreaterThan(0);
    const screenshot = summary.pageScreenshots![0];
    expect(screenshot.id).toBe('sc-1234');
    expect(screenshot.viewportId).toBe('desktop');
    expect(screenshot.viewportCategory).toBe('desktop');
    expect(screenshot.width).toBe(1280);
    expect(screenshot.height).toBe(800);
    expect(screenshot.captureType).toBe('viewport');
    expect(screenshot.status).toBe('captured');
    expect(screenshot.format).toBe('webp');

    orchestrator.dispose();
  });

  it('2. Evaluates D1 Crawl Coverage as exact via Path 1 Triple using persisted crawlFailedPages', () => {
    const summary: Partial<ScanRunSummaryDTO> = {
      urlsCrawled: 3,
      pagesScanned: 2,
      crawlFailedPages: 1,
    };

    const d1 = evaluateD1CrawlCoverage({ summary });
    expect(d1.pathUsed).toBe('path1_exact_triple');
    expect(d1.status).toBe('exact');
    expect(d1.coverageApproximated).toBe(false);
    expect(d1.reasonCodes).toHaveLength(0);
    expect(d1.ratio).toBeCloseTo(2 / 3);
  });

  it('3. Evaluates D2 Static Analysis as exact (100%) instead of unavailable using staticModulesExecuted/Total', () => {
    const summary: Partial<ScanRunSummaryDTO> = {
      urlsCrawled: 3,
      pagesScanned: 2,
      crawlFailedPages: 1,
      staticModulesExecuted: 5,
      staticModulesTotal: 5,
      staticPagesAnalyzed: 2,
      completedEngines: ['crawler', 'analyzers', 'browser'],
    };

    const coverage = evaluateAuditCoverage({
      summary,
      config: {
        enableBrowserAudit: false,
        auditModules: {
          http: true,
          wordpress: true,
          securityHeaders: true,
          cookies: true,
          seo: true,
        },
      },
      findings: [],
    });

    expect(coverage.d2Status).toBe('exact');
    const d2 = coverage.dimensions.find(d => d.dimension === 'd2');
    expect(d2?.status).toBe('exact');
    expect(d2?.ratio).toBe(1.0);
    expect(d2?.reasonCodes).toHaveLength(0);
  });

  it('4. Evaluates D3 Runtime & Accessibility as exact without historical approximations', () => {
    const summary: Partial<ScanRunSummaryDTO> = {
      urlsCrawled: 2,
      pagesScanned: 2,
      crawlFailedPages: 0,
      browserPagesAudited: 2,
      browserCandidatesTotal: 2,
      runtimeAuditsCompleted: 2,
      accessibilityCandidatesTotal: 2,
      accessibilityAuditsCompleted: 2,
      completedEngines: ['crawler', 'analyzers', 'browser'],
    };

    const coverage = evaluateAuditCoverage({
      summary,
      config: {
        enableBrowserAudit: true,
        auditModules: {
          runtimeErrors: true,
          accessibility: true,
        },
      },
      findings: [],
    });

    expect(coverage.d3Status).toBe('exact');
    const d3 = coverage.dimensions.find(d => d.dimension === 'd3');
    expect(d3?.status).toBe('exact');
    expect(d3?.ratio).toBe(1.0);
    expect(coverage.coverageApproximationReasons).not.toContain(
      'd3_historical_runtime_from_browser_pages',
    );
    expect(coverage.coverageApproximationReasons).not.toContain(
      'd3_historical_a11y_candidates_from_browser_candidates',
    );
    expect(coverage.coverageApproximationReasons).not.toContain(
      'd3_historical_missing_a11y_completed_count',
    );
  });

  it('5. Evaluates D4 Lab Perf, Responsive & Visual as exact with layoutStabilityPagesCompleted and pageScreenshots', () => {
    const pageScreenshots: PageScreenshotRecord[] = [
      {
        id: 'sc-1',
        pageUrl: 'http://example.com/p1',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        width: 1280,
        height: 800,
        captureType: 'viewport',
        status: 'captured',
      },
      {
        id: 'sc-2',
        pageUrl: 'http://example.com/p2',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        width: 1280,
        height: 800,
        captureType: 'viewport',
        status: 'captured',
      },
    ];

    const summary: Partial<ScanRunSummaryDTO> = {
      urlsCrawled: 2,
      pagesScanned: 2,
      crawlFailedPages: 0,
      browserPagesAudited: 2,
      browserCandidatesTotal: 2,
      viewportsCompleted: 16,
      layoutStabilityPagesCompleted: 2,
      screenshotsCaptured: 2,
      pageScreenshots,
      completedEngines: ['crawler', 'analyzers', 'browser'],
      performanceMetrics: {
        pages: [
          { labMetrics: { cls: 0.01 }, resourceSummary: { totalResources: 3 } },
          { labMetrics: { cls: 0.02 }, resourceSummary: { totalResources: 4 } },
        ],
      },
    };

    const coverage = evaluateAuditCoverage({
      summary,
      config: {
        enableBrowserAudit: true,
        captureScreenshots: true,
        viewportProfiles: ['desktop', 'mobile'],
        auditModules: {
          networkResources: true,
          responsiveLayout: true,
          layoutStability: true,
          screenshots: true,
        },
      },
      findings: [],
    });

    expect(coverage.d4Status).toBe('exact');
    const d4 = coverage.dimensions.find(d => d.dimension === 'd4');
    expect(d4?.status).toBe('exact');
    expect(d4?.ratio).toBe(1.0);
    expect(coverage.coverageApproximationReasons).not.toContain('d4_historical_cls_from_summary');
    expect(coverage.coverageApproximationReasons).not.toContain('d4_historical_cls_from_findings');
    expect(coverage.coverageApproximationReasons).not.toContain('d4_historical_screenshots_count');
  });

  it('6. Does NOT count browser as completed engine when browser launch fails with SYS_BROWSER_UNAVAILABLE', async () => {
    const entryUrl = `http://telemetry.local:${serverPort}/`;

    const mockCrawler = {
      crawl: async () => ({
        summary: {
          entryUrl,
          authorizedOrigin: `http://telemetry.local:${serverPort}`,
          totalPagesAttempted: 1,
          successfulPages: 1,
          failedPages: 0,
          nonHtmlPages: 0,
          uniqueUrlsDiscovered: 1,
          urlsSkippedScope: 0,
          urlsSkippedLimits: 0,
          maxDepthReached: 0,
          durationMs: 10,
          cancelled: false,
        },
        pages: [
          {
            requestedUrl: entryUrl,
            finalUrl: entryUrl,
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            body: '<html>Home</html>',
            contentType: 'text/html',
            isHtml: true,
            depth: 0,
            discoveredUrls: [],
            timing: { startedAt: '', durationMs: 10 },
          },
        ],
        discoveredUrls: [entryUrl],
        errors: [],
      }),
    };

    const mockAnalyzer = {
      runAnalysis: async () => ({
        findings: [],
        stats: {
          totalFindings: 0,
          bySeverity: {},
          byCategory: {},
          byConfidence: {},
          byRule: {},
          pagesAnalyzed: 1,
          durationMs: 10,
          findingsTruncatedCount: 0,
          evidenceTruncatedCount: 0,
          duplicatesFilteredCount: 0,
        },
      }),
    };

    const failingBrowserManager = {
      launch: vi.fn().mockRejectedValue(new Error('Browser binary executable missing')),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserManager;

    const orchestrator = new ScanOrchestrator(connection, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
      browserManagerFactory: () => failingBrowserManager,
    });

    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
      },
    });

    expect(result.status).toBe('completed');
    const summary = result.summary!;

    // completedEngines must strictly omit 'browser'
    expect(summary.completedEngines).toEqual(['crawler', 'analyzers']);
    expect(summary.completedEngines).not.toContain('browser');
    expect(summary.browserPagesAudited).toBe(0);
    expect(summary.runtimeAuditsCompleted).toBe(0);
    expect(summary.layoutStabilityPagesCompleted).toBe(0);
    expect(summary.browserCoverageStatus).toBe('none');

    // A SYS_BROWSER_UNAVAILABLE finding must be persisted
    const findings = findingRepo.getAllByScanRunId(result.id);
    expect(findings.some(f => f.ruleId === 'SYS_BROWSER_UNAVAILABLE')).toBe(true);

    orchestrator.dispose();
  });

  it('7. Preserves partial telemetry in errorDetails when scan execution times out', async () => {
    const entryUrl = `http://telemetry.local:${serverPort}/`;

    const mockCrawler = {
      crawl: async () => ({
        summary: {
          entryUrl,
          authorizedOrigin: `http://telemetry.local:${serverPort}`,
          totalPagesAttempted: 2,
          successfulPages: 1,
          failedPages: 1,
          nonHtmlPages: 0,
          uniqueUrlsDiscovered: 2,
          urlsSkippedScope: 0,
          urlsSkippedLimits: 0,
          maxDepthReached: 1,
          durationMs: 10,
          cancelled: false,
        },
        pages: [
          {
            requestedUrl: entryUrl,
            finalUrl: entryUrl,
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            body: '<html>Home</html>',
            contentType: 'text/html',
            isHtml: true,
            depth: 0,
            discoveredUrls: [],
            timing: { startedAt: '', durationMs: 10 },
          },
        ],
        discoveredUrls: [entryUrl],
        errors: [
          {
            url: `${entryUrl}broken`,
            error: '500 Internal',
            depth: 1,
            timing: { startedAt: '', durationMs: 5 },
          },
        ],
      }),
    };

    const mockAnalyzer = {
      runAnalysis: async () => ({
        findings: [
          {
            scanRunId: 'placeholder',
            ruleId: 'SEC_HEADER_CSP_MISSING',
            category: 'Security',
            title: 'CSP Missing',
            description: 'CSP header missing',
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: entryUrl,
            evidence: {},
            remediation: 'Add CSP header',
            references: [],
          },
        ],
        stats: {
          totalFindings: 1,
          bySeverity: { medium: 1 },
          byCategory: { Security: 1 },
          byConfidence: { confirmed: 1 },
          byRule: { SEC_HEADER_CSP_MISSING: 1 },
          pagesAnalyzed: 1,
          durationMs: 10,
          findingsTruncatedCount: 0,
          evidenceTruncatedCount: 0,
          duplicatesFilteredCount: 0,
        },
      }),
    };

    // Slow browser manager that triggers timeout
    const slowBrowserManager = {
      launch: vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 400));
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserManager;

    const orchestrator = new ScanOrchestrator(connection, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
      browserManagerFactory: () => slowBrowserManager,
    });

    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxDurationMs: 150, // Short timeout
        enableBrowserAudit: true,
      },
    });

    expect(result.status).toBe('failed');
    const details = result.error?.details as Record<string, unknown>;
    expect(details).toBeDefined();
    expect(details.crawlFailedPages).toBe(1);
    expect(details.pagesScanned).toBe(1);
    expect(details.urlsCrawled).toBe(2);
    expect(details.completedEngines).toEqual(['crawler', 'analyzers']);
    expect(details.interruptedEngine).toBe('browser');

    orchestrator.dispose();
  });

  it('8. Historical scans without new telemetry fields remain readable without crashes', () => {
    // Pre-7.5 summary missing crawlFailedPages, staticModulesExecuted, etc.
    const historicalSummary = {
      totalFindings: 2,
      criticalCount: 0,
      highCount: 1,
      mediumCount: 1,
      lowCount: 0,
      infoCount: 0,
      urlsCrawled: 5,
      pagesScanned: 5,
      pagesFailed: 0,
    };

    const d1 = evaluateD1CrawlCoverage({ summary: historicalSummary });
    expect(d1.status).toBe('exact'); // Evaluates via Path 2 exact

    const coverage = evaluateAuditCoverage({
      summary: historicalSummary,
      config: { enableBrowserAudit: false },
      findings: [],
    });

    expect(coverage.d1Status).toBe('exact');
    expect(coverage.auditCoverage).toBeGreaterThan(0);
  });

  it('9. Desktop reportViewModelAdapter accurately extracts dimension telemetry from persisted summary', () => {
    const pageScreenshots: PageScreenshotRecord[] = [
      {
        id: 'sc-1',
        pageUrl: 'http://telemetry.local/p1',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        width: 1280,
        height: 800,
        captureType: 'viewport',
        status: 'captured',
      },
    ];

    const scanRun = scanRunRepo.create({
      siteId,
      scanType: 'full',
      targetUrl: 'http://telemetry.local',
      config: { enableBrowserAudit: true },
    });

    scanRunRepo.updateStatus(scanRun.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    const completed = scanRunRepo.updateStatus(scanRun.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      durationMs: 500,
      summary: {
        totalFindings: 0,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
        urlsCrawled: 3,
        pagesScanned: 2,
        crawlFailedPages: 1,
        browserFailedPages: 0,
        staticModulesExecuted: 5,
        staticModulesTotal: 5,
        staticPagesAnalyzed: 2,
        browserPagesAudited: 2,
        runtimeAuditsCompleted: 2,
        viewportsCompleted: 16,
        accessibilityCandidatesTotal: 2,
        accessibilityAuditsCompleted: 2,
        layoutStabilityPagesCompleted: 2,
        screenshotsCaptured: 1,
        pageScreenshots,
        completedEngines: ['crawler', 'analyzers', 'browser'],
        browserCandidatesTotal: 2,
        browserCandidatesSkipped: 0,
      },
    });

    const viewModel = adaptScanRunForViewModel({
      scanRun: completed,
      findings: [],
      locale: 'en',
      viewMode: 'executive',
    });

    expect(viewModel).toBeDefined();

    // Verify D1 telemetry extraction
    const d1Dim = viewModel.healthOverview.dimensions.find(d => d.id === 'd1')!;
    const d1Telemetry = extractDimensionTelemetryCounts(completed, d1Dim);
    expect(d1Telemetry.executed).toBe(2);
    expect(d1Telemetry.eligible).toBe(3);
    expect(d1Telemetry.unitKind).toBe('pages');

    // Verify D2 telemetry extraction
    const d2Dim = viewModel.healthOverview.dimensions.find(d => d.id === 'd2')!;
    const d2Telemetry = extractDimensionTelemetryCounts(completed, d2Dim);
    expect(d2Telemetry.executed).toBe(5);
    expect(d2Telemetry.eligible).toBe(5);
    expect(d2Telemetry.unitKind).toBe('modules');

    // Verify D3 telemetry extraction
    const d3Dim = viewModel.healthOverview.dimensions.find(d => d.id === 'd3')!;
    const d3Telemetry = extractDimensionTelemetryCounts(completed, d3Dim);
    expect(d3Telemetry.executed).toBe(2);
    expect(d3Telemetry.eligible).toBe(2);
    expect(d3Telemetry.unitKind).toBe('pages');

    // Verify D4 telemetry extraction
    const d4Dim = viewModel.healthOverview.dimensions.find(d => d.id === 'd4')!;
    const d4Telemetry = extractDimensionTelemetryCounts(completed, d4Dim);
    expect(d4Telemetry.executed).toBe(2);
    expect(d4Telemetry.eligible).toBe(2);
    expect(d4Telemetry.unitKind).toBe('pages');
  });
});
