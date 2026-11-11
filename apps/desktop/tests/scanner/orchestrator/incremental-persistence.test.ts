import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import {
  FindingRepository,
  type CreateFindingInput,
} from '../../../src/main/db/repositories/finding.repository.js';
import { FindingService } from '../../../src/main/services/finding.service.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';
import {
  SCAN_ORCHESTRATOR_ERROR_CODES,
  ScanOrchestratorError,
} from '../../../src/main/scanner/orchestrator/errors.js';
import type { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import type { CrawlResult } from '../../../src/main/scanner/crawler/types.js';
import type { AnalyzerEngine } from '../../../src/main/scanner/analyzers/analyzer-engine.js';
import type {
  AnalyzerFinding,
  AnalyzerRunResult,
} from '../../../src/main/scanner/analyzers/types.js';
import type { BrowserManager } from '../../../src/main/browser/browser-manager.js';
import type { VisualAuditor } from '../../../src/main/browser/visual-types.js';
import { assembleReportData } from '../../../src/main/reports/assembler.js';
import { generateHtmlReport } from '../../../src/main/reports/html-generator.js';

describe('Incremental Checkpoint Persistence & Partial Audit Invariants Suite', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let findingService: FindingService;
  let siteId: string;

  const mockEntryUrl = 'https://incremental.example.com';

  const createDummyCrawlResult = (urls: string[] = [mockEntryUrl]): CrawlResult => ({
    summary: {
      entryUrl: mockEntryUrl,
      authorizedOrigin: mockEntryUrl,
      totalPagesAttempted: urls.length,
      successfulPages: urls.length,
      failedPages: 0,
      nonHtmlPages: 0,
      uniqueUrlsDiscovered: urls.length,
      urlsSkippedScope: 0,
      urlsSkippedLimits: 0,
      maxDepthReached: 1,
      durationMs: 50,
      cancelled: false,
    },
    pages: urls.map(u => ({
      requestedUrl: u,
      finalUrl: u,
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      byteLength: 500,
      timingMs: 10,
      depth: 0,
      isHtml: true,
      encoding: 'utf-8',
      error: null,
      title: 'Page Title',
      h1: 'Heading 1',
      metaDescription: 'Desc',
      canonicalUrl: null,
      robotsMeta: null,
      discoveredUrls: [],
    })),
    discoveredUrls: urls,
    errors: [],
  });

  const createDummyFindings = (count: number, prefix = 'STATIC'): AnalyzerFinding[] => {
    const list: AnalyzerFinding[] = [];
    for (let i = 1; i <= count; i++) {
      list.push({
        ruleId: `${prefix}_RULE_${i}`,
        category: 'security',
        title: `Test Finding ${prefix} ${i}`,
        description: `Description for ${prefix} ${i}`,
        severity: i === 1 ? 'critical' : 'medium',
        confidence: 'confirmed',
        targetUrl: `${mockEntryUrl}/page-${i}`,
        evidence: { key: `evidence-${i}`, selector: `#elem-${i}` },
      });
    }
    return list;
  };

  const createDummyAnalyzerResult = (findings: AnalyzerFinding[]): AnalyzerRunResult => ({
    findings,
    stats: {
      totalPagesAnalyzed: 1,
      totalFindings: findings.length,
      bySeverity: {
        critical: findings.filter(f => f.severity === 'critical').length,
        high: 0,
        medium: findings.filter(f => f.severity === 'medium').length,
        low: 0,
        info: 0,
      },
      byCategory: {
        security: findings.length,
      },
    },
  });

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);
    findingService = new FindingService(findingRepo, scanRunRepo);

    const project = projectRepo.create({ name: 'Incremental Persistence Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Incremental Site',
      baseUrl: mockEntryUrl,
    });
    siteId = site.id;
  });

  afterEach(() => {
    if (connection.isOpen()) {
      connection.close();
    }
  });

  it('1. Findings from a completed analyzer stage persist before later stages execute', async () => {
    const staticFindings = createDummyFindings(3, 'STATIC');
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(staticFindings),
    };

    let findingsCountWhenBrowserStarted = -1;

    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {
          // Inspect SQLite at the moment browser audit launches
          const inDb = findingRepo.getAllByScanRunId(scanRunId);
          findingsCountWhenBrowserStarted = inDb.length;
        },
        close: async () => {},
        acquirePage: async () => ({
          page: {
            goto: async () => {},
            isClosed: () => false,
          },
          release: async () => {},
        }),
      }) as unknown as BrowserManager;

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
      browserManagerFactory: mockBrowserManagerFactory,
    });

    const pending = orchestrator.createScan({
      siteId,
      scanType: 'full',
      config: { enableBrowserAudit: true },
    });
    const scanRunId = pending.id;

    const result = await orchestrator.executeScan(scanRunId);

    expect(result.status).toBe('completed');
    // Invariant: all 3 static findings were persisted in SQLite BEFORE browserManager launched!
    expect(findingsCountWhenBrowserStarted).toBe(3);

    orchestrator.dispose();
  });

  it('2. A subsequent browser timeout does not delete earlier HTTP/static findings', async () => {
    const staticFindings = createDummyFindings(4, 'STATIC');
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(staticFindings),
    };

    // Browser audit simulates a fatal timeout error
    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {
          throw new ScanOrchestratorError(
            SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT,
            'Scan exceeded maximum duration limit of 5000ms',
          );
        },
        close: async () => {},
      }) as unknown as BrowserManager;

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
      browserManagerFactory: mockBrowserManagerFactory,
    });

    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: { enableBrowserAudit: true },
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT);

    // Invariant: The 4 static findings committed at Checkpoint 1 were NOT deleted or lost!
    const persisted = findingRepo.listByScanRunId(result.id);
    expect(persisted.total).toBe(4);
    expect(persisted.items).toHaveLength(4);

    // Invariant: Error details indicate 4 partial findings were preserved
    const details = result.error?.details as Record<string, unknown>;
    expect(details?.partialFindingsPersisted).toBe(4);
    expect(details?.completedEngines).toEqual(['crawler', 'analyzers']);
    expect(details?.interruptedEngine).toBe('browser');

    orchestrator.dispose();
  });

  it('3. Findings persist when the global deadline expires', async () => {
    const staticFindings = createDummyFindings(2, 'STATIC');
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult([`${mockEntryUrl}/p1`, `${mockEntryUrl}/p2`]),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(staticFindings),
    };

    let visualAuditCount = 0;
    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {},
        close: async () => {},
      }) as unknown as BrowserManager;

    const mockVisualAuditorFactory = () =>
      ({
        auditUrl: async (url: string) => {
          visualAuditCount++;
          if (visualAuditCount >= 2) {
            throw new ScanOrchestratorError(
              SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT,
              'Scan exceeded maximum duration limit of 100ms',
            );
          }
          return {
            targetUrl: url,
            viewportResults: [],
            findings: [
              {
                scanRunId: 'tmp',
                ruleId: 'RESPONSIVE_OVERFLOW',
                category: 'responsive-design',
                title: 'Responsive Overflow',
                description: 'Element overflows viewport',
                severity: 'medium',
                confidence: 'confirmed',
                status: 'active',
                targetUrl: url,
                evidence: { selector: '#container' },
                remediation: 'Fix width',
                references: [],
              },
            ],
            totalScreenshots: 1,
            durationMs: 15,
          };
        },
      }) as unknown as VisualAuditor;

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
      browserManagerFactory: mockBrowserManagerFactory,
      visualAuditorFactory: mockVisualAuditorFactory,
    });

    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        maxBrowserPages: 2,
        auditModules: {
          responsiveLayout: true,
          accessibility: false,
          runtimeErrors: false,
          networkResources: false,
        },
      },
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT);

    // Invariant: 2 static findings + 1 page-1 browser finding = 3 persisted findings!
    const inDb = findingRepo.listByScanRunId(result.id);
    expect(inDb.total).toBe(3);

    const details = result.error?.details as Record<string, unknown>;
    expect(details?.partialFindingsPersisted).toBe(3);

    orchestrator.dispose();
  });

  it('4. A timeout during a persistence checkpoint does not corrupt SQLite', async () => {
    const rawDb = connection.getRawDb();

    // Verify initial database integrity
    const initialIntegrity = rawDb.prepare('PRAGMA integrity_check').get() as {
      integrity_check: string;
    };
    expect(initialIntegrity.integrity_check).toBe('ok');

    // Spy on batchCreate to throw once during a persistence checkpoint simulating an aborted write
    const batchCreateSpy = vi.spyOn(findingRepo, 'batchCreate').mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });

    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(createDummyFindings(2)),
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
    });

    const result = await orchestrator.startScan({ siteId, scanType: 'full' });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('SQLITE_BUSY');

    // Invariant: Database must maintain strict B-tree and WAL integrity without corruption
    const postIntegrity = rawDb.prepare('PRAGMA integrity_check').get() as {
      integrity_check: string;
    };
    expect(postIntegrity.integrity_check).toBe('ok');

    batchCreateSpy.mockRestore();
    orchestrator.dispose();
  });

  it('5. Repeated checkpoints do not create duplicate findings', async () => {
    const duplicateFindings: AnalyzerFinding[] = [
      {
        ruleId: 'SEC_HEADER_CSP',
        category: 'security',
        title: 'Missing Content Security Policy',
        description: 'No CSP header present',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: mockEntryUrl,
        evidence: { header: 'Content-Security-Policy', selector: 'head' },
      },
    ];

    // Simulate both static analyzer and browser auditor reporting the exact same finding on the same URL/selector
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(duplicateFindings),
    };

    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {},
        close: async () => {},
        acquirePage: async () => ({
          page: {
            goto: async () => {},
            isClosed: () => false,
          },
          release: async () => {},
        }),
      }) as unknown as BrowserManager;

    const mockVisualAuditorFactory = () =>
      ({
        auditUrl: async () => ({
          targetUrl: mockEntryUrl,
          viewportResults: [],
          findings: [
            {
              scanRunId: 'tmp',
              ruleId: 'SEC_HEADER_CSP',
              category: 'security',
              title: 'Missing Content Security Policy',
              description: 'No CSP header present',
              severity: 'high',
              confidence: 'confirmed',
              status: 'active',
              targetUrl: mockEntryUrl,
              evidence: { header: 'Content-Security-Policy', selector: 'head' },
              remediation: 'Add CSP',
              references: [],
            },
          ],
          totalScreenshots: 0,
          durationMs: 10,
        }),
      }) as unknown as VisualAuditor;

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
      browserManagerFactory: mockBrowserManagerFactory,
      visualAuditorFactory: mockVisualAuditorFactory,
    });

    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: { enableBrowserAudit: true },
    });

    expect(result.status).toBe('completed');

    // Invariant: Checkpoint 1 persisted SEC_HEADER_CSP, Checkpoint 2 and 7 deduplicated against persistedFindingKeys!
    const inDb = findingRepo.listByScanRunId(result.id);
    expect(inDb.total).toBe(1);
    expect(result.summary?.totalFindings).toBe(1);

    orchestrator.dispose();
  });

  it('6. User cancellation preserves already committed findings', async () => {
    const staticFindings = createDummyFindings(5, 'STATIC');
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(staticFindings),
    };

    let unblockBrowser: (() => void) | null = null;
    const browserGate = new Promise<void>(resolve => {
      unblockBrowser = resolve;
    });

    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {
          // Pause execution in browser audit stage to allow cancelScan to fire
          await browserGate;
        },
        close: async () => {},
      }) as unknown as BrowserManager;

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
      browserManagerFactory: mockBrowserManagerFactory,
    });

    const pending = orchestrator.createScan({
      siteId,
      scanType: 'full',
      config: { enableBrowserAudit: true },
    });
    const scanRunId = pending.id;
    const scanPromise = orchestrator.executeScan(scanRunId);

    // Wait until browser audit stage is entered
    await new Promise(r => setTimeout(r, 50));

    // Cancel active scan while browserManager is waiting
    const cancelRes = await orchestrator.cancelScan({ id: scanRunId }, 'User cancelled scan');
    expect(cancelRes.status).toBe('cancelled');

    unblockBrowser?.();
    const finalRun = await scanPromise;
    expect(finalRun.status).toBe('cancelled');

    // Invariant: The 5 findings committed at Checkpoint 1 are PRESERVED!
    const inDb = findingRepo.listByScanRunId(scanRunId);
    expect(inDb.total).toBe(5);
    expect(inDb.items).toHaveLength(5);

    orchestrator.dispose();
  });

  it('7. Failed checkpoints can be retried safely where appropriate', async () => {
    // Seed dummy scan run
    const run = scanRunRepo.create({
      siteId,
      scanType: 'full',
      status: 'pending',
      targetUrl: mockEntryUrl,
    });

    // Check that a batchCreate failure rolls back and when retried persists cleanly
    const items = [
      {
        scanRunId: run.id,
        ruleId: 'RETRY_TEST',
        category: 'security',
        title: 'Retry Test Finding',
        description: 'Test',
        severity: 'medium' as const,
        confidence: 'confirmed' as const,
        status: 'active' as const,
        targetUrl: mockEntryUrl,
      },
    ];

    // 1. Transactional rollback test
    const rawDb = connection.getRawDb();
    expect(() => {
      rawDb.transaction(() => {
        findingRepo.batchCreate(items as unknown as CreateFindingInput[]);
        throw new Error('Simulated crash inside transaction');
      })();
    }).toThrow('Simulated crash inside transaction');

    // 0 findings persisted after rollback
    expect(findingRepo.getAllByScanRunId(items[0].scanRunId)).toHaveLength(0);

    // 2. Retry succeeds without conflict
    const persisted = findingRepo.batchCreate(items as unknown as CreateFindingInput[]);
    expect(persisted).toHaveLength(1);
    expect(findingRepo.getAllByScanRunId(items[0].scanRunId)).toHaveLength(1);
  });

  it('8. Findings Inspector retrieves partial findings from failed scans', async () => {
    // Create a failed scan with partial findings persisted
    const scanRun = scanRunRepo.create({
      siteId,
      scanType: 'full',
      status: 'pending',
      targetUrl: mockEntryUrl,
    });

    // Persist 3 partial findings
    const findings = createDummyFindings(3, 'PARTIAL');
    findingRepo.batchCreate(
      findings.map(f => ({
        scanRunId: scanRun.id,
        ruleId: f.ruleId,
        category: f.category,
        title: f.title,
        description: f.description,
        severity: f.severity,
        confidence: f.confidence,
        status: 'active',
        targetUrl: f.targetUrl,
        evidence: f.evidence as Record<string, unknown>,
        remediation: null,
        references: null,
      })),
    );

    // Mark scan as failed with partialFindingsPersisted detail
    scanRunRepo.updateStatus(scanRun.id, {
      status: 'failed',
      durationMs: 30000,
      completedAt: new Date().toISOString(),
      error: {
        code: SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT,
        message: 'Scan timed out after 30000ms',
        details: { partialFindingsPersisted: 3 },
      },
    });

    // Findings Inspector queries via FindingService.listFindings
    const inspectorResult = findingService.listFindings({ scanRunId: scanRun.id });

    // Invariant: Findings Inspector successfully lists all 3 partial findings!
    expect(inspectorResult.total).toBe(3);
    expect(inspectorResult.items).toHaveLength(3);
    expect(inspectorResult.items[0].scanRunId).toBe(scanRun.id);
    expect(inspectorResult.items[0].ruleId).toBe('PARTIAL_RULE_1');
  });

  it('9. Reports distinguish partial and completed audits', async () => {
    // 1. Create a failed scan run with partial findings
    const failedRun = scanRunRepo.create({
      siteId,
      scanType: 'full',
      status: 'pending',
      targetUrl: mockEntryUrl,
    });

    findingRepo.batchCreate([
      {
        scanRunId: failedRun.id,
        ruleId: 'SEC_PARTIAL',
        category: 'security',
        title: 'Partial Static Finding',
        description: 'Found before timeout',
        severity: 'high',
        confidence: 'confirmed',
        status: 'active',
        targetUrl: mockEntryUrl,
      },
    ]);

    scanRunRepo.updateStatus(failedRun.id, {
      status: 'failed',
      durationMs: 60000,
      completedAt: new Date().toISOString(),
      error: {
        code: SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT,
        message: 'Scan exceeded deadline',
        details: {
          partialFindingsPersisted: 1,
          completedEngines: ['crawler', 'analyzers'],
          interruptedEngine: 'browser',
          urlsCrawled: 25,
          pagesScanned: 25,
        },
      },
    });

    // Assemble report for failed scan
    const partialReport = assembleReportData(failedRun.id, {
      siteRepo,
      scanRunRepo,
      findingRepo,
    });

    // Invariant: Report recognizes partial audit
    expect(partialReport.summary.isPartialAudit).toBe(true);
    expect(partialReport.summary.scanStatus).toBe('failed');
    expect(partialReport.summary.completedEngines).toEqual(['crawler', 'analyzers']);
    expect(partialReport.summary.interruptedEngine).toBe('browser');
    expect(partialReport.title).toContain('Partial Security & Audit Report (Interrupted)');

    const partialHtml = generateHtmlReport(partialReport);
    expect(partialHtml).toContain('Warning: Incomplete / FAILED Scan Run');
    expect(partialHtml).toContain('Audit Coverage:</strong> PARTIAL AUDIT (INTERRUPTED)');
    expect(partialHtml).toContain('Completed Engines:</strong> CRAWLER, ANALYZERS');
    expect(partialHtml).toContain('Interrupted Engine:</strong> BROWSER');

    // 2. Assemble report for a completed scan
    const completedRun = scanRunRepo.create({
      siteId,
      scanType: 'full',
      status: 'pending',
      targetUrl: mockEntryUrl,
    });

    scanRunRepo.updateStatus(completedRun.id, {
      status: 'running',
    });

    scanRunRepo.updateStatus(completedRun.id, {
      status: 'completed',
      durationMs: 15000,
      completedAt: new Date().toISOString(),
      summary: {
        totalFindings: 1,
        criticalCount: 0,
        highCount: 1,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
        pagesScanned: 5,
        urlsCrawled: 5,
      },
    });

    const completedReport = assembleReportData(completedRun.id, {
      siteRepo,
      scanRunRepo,
      findingRepo,
    });

    // Invariant: Report recognizes complete audit
    expect(completedReport.summary.isPartialAudit).toBe(false);
    expect(completedReport.summary.scanStatus).toBe('completed');
    expect(completedReport.title).not.toContain('Partial');

    const completedHtml = generateHtmlReport(completedReport);
    expect(completedHtml).not.toContain('Warning: Incomplete');
    expect(completedHtml).toContain('COMPLETE AUDIT');
  });

  it('10. Existing successful scans preserve their current behavior', async () => {
    const staticFindings = createDummyFindings(2, 'STATIC');
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(staticFindings),
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
    });

    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: { enableBrowserAudit: false },
    });

    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
    expect(result.completedAt).not.toBeNull();
    expect(result.summary?.totalFindings).toBe(2);
    expect(result.summary?.criticalCount).toBe(1);
    expect(result.summary?.mediumCount).toBe(1);

    const inDb = findingRepo.listByScanRunId(result.id);
    expect(inDb.total).toBe(2);

    orchestrator.dispose();
  });
});
