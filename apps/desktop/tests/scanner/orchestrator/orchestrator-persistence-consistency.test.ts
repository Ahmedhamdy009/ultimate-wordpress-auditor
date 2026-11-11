import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../../src/main/db/repositories/report.repository.js';
import { ReportService } from '../../../src/main/services/report.service.js';
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

describe('ScanOrchestrator Persistence vs. Completion Consistency', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let reportRepo: ReportRepository;
  let reportService: ReportService;
  let findingService: FindingService;
  let siteId: string;

  const mockEntryUrl = 'https://persistence-test.example.com';

  const createDummyCrawlResult = (): CrawlResult => ({
    summary: {
      entryUrl: mockEntryUrl,
      authorizedOrigin: mockEntryUrl,
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
    pages: [],
    discoveredUrls: [mockEntryUrl],
    errors: [],
  });

  const createDummyFindings = (count: number): AnalyzerFinding[] => {
    const list: AnalyzerFinding[] = [];
    for (let i = 1; i <= count; i++) {
      list.push({
        ruleId: `RULE-${i}`,
        category: 'security',
        title: `Test Finding ${i}`,
        description: `Description for finding ${i}`,
        severity: i === 1 ? 'critical' : 'medium',
        confidence: 'confirmed',
        targetUrl: `${mockEntryUrl}/page-${i}`,
        evidence: { key: `evidence-${i}` },
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
    reportRepo = new ReportRepository(connection);
    reportService = new ReportService(reportRepo, scanRunRepo);
    findingService = new FindingService(findingRepo, scanRunRepo);

    const project = projectRepo.create({ name: 'Persistence Consistency Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Persistence Site',
      baseUrl: mockEntryUrl,
    });
    siteId = site.id;
  });

  afterEach(() => {
    if (connection.isOpen()) {
      connection.close();
    }
  });

  it('1. executes successful finding persistence followed by successful scan completion', async () => {
    const findings = createDummyFindings(3);
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(findings),
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
    });

    const result = await orchestrator.startScan({ siteId, scanType: 'full' });

    expect(result.status).toBe('completed');
    expect(result.completedAt).not.toBeNull();
    expect(result.error).toBeNull();
    expect(result.summary).not.toBeNull();
    expect(result.summary?.totalFindings).toBe(3);
    expect(result.summary?.criticalCount).toBe(1);
    expect(result.summary?.mediumCount).toBe(2);

    // Verify persisted findings in SQLite
    const persisted = findingRepo.listByScanRunId(result.id);
    expect(persisted.total).toBe(3);
    expect(persisted.items).toHaveLength(3);
    for (const item of persisted.items) {
      expect(item.scanRunId).toBe(result.id);
      expect(item.status).toBe('confirmed');
      expect(item.status).not.toBe('active');
    }

    orchestrator.dispose();
  });

  it('2. handles finding persistence failure safely without corrupting status', async () => {
    const findings = createDummyFindings(2);
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(findings),
    };

    // Spy on findingRepo.batchCreate to throw simulating database write error
    const batchCreateSpy = vi.spyOn(findingRepo, 'batchCreate').mockImplementationOnce(() => {
      throw new Error('SQLite disk I/O failure during batchCreate');
    });

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
    });

    const result = await orchestrator.startScan({ siteId, scanType: 'full' });

    expect(result.status).toBe('failed');
    expect(result.completedAt).not.toBeNull();
    expect(result.summary).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INTERNAL_SCAN_ERROR);
    expect(result.error?.message).toContain('SQLite disk I/O failure');

    // Zero findings persisted in SQLite due to atomic rollback
    const inDb = findingRepo.listByScanRunId(result.id);
    expect(inDb.total).toBe(0);
    expect(inDb.items).toHaveLength(0);

    batchCreateSpy.mockRestore();
    orchestrator.dispose();
  });

  it('3. marks scan failed and preserves diagnostic details when final status update to completed fails', async () => {
    const findings = createDummyFindings(3);
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(findings),
    };

    // Intercept scanRunRepo.updateStatus to simulate failure specifically when updating to 'completed'
    const originalUpdateStatus = scanRunRepo.updateStatus.bind(scanRunRepo);
    let completedTransitionAttempted = false;

    const updateStatusSpy = vi
      .spyOn(scanRunRepo, 'updateStatus')
      .mockImplementation((id, update) => {
        if (update.status === 'completed') {
          completedTransitionAttempted = true;
          throw new Error('Database locked during completed status transition');
        }
        return originalUpdateStatus(id, update);
      });

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
    });

    const result = await orchestrator.startScan({ siteId, scanType: 'full' });

    expect(completedTransitionAttempted).toBe(true);

    // Scan run is marked 'failed'
    expect(result.status).toBe('failed');
    expect(result.completedAt).not.toBeNull();
    expect(result.summary).toBeNull(); // Summary is null for failed scans
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INTERNAL_SCAN_ERROR);
    expect(result.error?.message).toContain('Database locked during completed status transition');

    // Diagnostic details indicate partial findings were preserved
    expect(result.error?.details).toEqual({ partialFindingsPersisted: 3 });

    updateStatusSpy.mockRestore();
    orchestrator.dispose();
  });

  it('4. retains persisted findings in SQLite correctly associated with their scan run ID after final status failure', async () => {
    const findings = createDummyFindings(4);
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(findings),
    };

    const originalUpdateStatus = scanRunRepo.updateStatus.bind(scanRunRepo);
    const updateStatusSpy = vi
      .spyOn(scanRunRepo, 'updateStatus')
      .mockImplementation((id, update) => {
        if (update.status === 'completed') {
          throw new Error('Disk error during status commit');
        }
        return originalUpdateStatus(id, update);
      });

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
    });

    const result = await orchestrator.startScan({ siteId, scanType: 'full' });
    expect(result.status).toBe('failed');

    // All 4 findings remain in SQLite strictly associated with the failed scan run ID
    const storedFindings = findingRepo.listByScanRunId(result.id);
    expect(storedFindings.total).toBe(4);
    expect(storedFindings.items).toHaveLength(4);
    for (const f of storedFindings.items) {
      expect(f.scanRunId).toBe(result.id);
      expect(f.status).toBe('confirmed');
      expect(f.status).not.toBe('active');
      expect(f.targetUrl).toContain(mockEntryUrl);
    }

    updateStatusSpy.mockRestore();
    orchestrator.dispose();
  });

  it('5. verifies report and query behavior for failed scans with persisted findings', async () => {
    // Manually simulate a failed scan run that has persisted findings
    const run = scanRunRepo.create({
      siteId,
      scanType: 'full',
      targetUrl: mockEntryUrl,
    });

    // Seed 2 findings associated with this scan run
    findingRepo.batchCreate([
      {
        scanRunId: run.id,
        ruleId: 'SEC-01',
        category: 'security',
        title: 'Exposed Endpoint',
        description: 'Endpoint exposed',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: `${mockEntryUrl}/secret`,
      },
      {
        scanRunId: run.id,
        ruleId: 'SEC-02',
        category: 'security',
        title: 'Weak TLS',
        description: 'TLS 1.0 supported',
        severity: 'medium',
        confidence: 'confirmed',
        targetUrl: `${mockEntryUrl}/tls`,
      },
    ]);

    // Mark scan run as failed
    const failedRun = scanRunRepo.updateStatus(run.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      durationMs: 1200,
      error: {
        code: 'ERR_SCAN_INTERRUPTED_BY_SHUTDOWN',
        message: 'Application terminated abruptly',
        details: { partialFindingsPersisted: 2 },
      },
    });

    // Verify scan query returns failed status
    const queriedRun = scanRunRepo.getById(run.id);
    expect(queriedRun?.status).toBe('failed');
    expect(queriedRun?.summary).toBeNull();
    expect(queriedRun?.error?.code).toBe('ERR_SCAN_INTERRUPTED_BY_SHUTDOWN');

    // Query findings via FindingService
    const findingsResponse = findingService.listFindings({ scanRunId: run.id });
    expect(findingsResponse.total).toBe(2);
    expect(findingsResponse.items[0].title).toBe('Exposed Endpoint');
    expect(findingsResponse.items[1].title).toBe('Weak TLS');

    // Creating report referencing this scan run preserves association and records report
    const report = reportService.createReport({
      scanRunId: run.id,
      title: 'Partial Audit Report for Failed Scan',
      format: 'json',
      summary: {
        scanStatus: failedRun.status,
        findingsCount: 2,
        interrupted: true,
      },
    });

    expect(report.scanRunId).toBe(run.id);
    expect(report.summary).toEqual({
      scanStatus: 'failed',
      findingsCount: 2,
      interrupted: true,
    });

    // Direct list query reflects the exact scanRunId filter
    const reportsForRun = reportService.listReports({ scanRunId: run.id });
    expect(reportsForRun.total).toBe(1);
    expect(reportsForRun.items[0].id).toBe(report.id);
  });

  it('6. verifies retry creates a separate scan run without duplicating or reassigning findings', async () => {
    // 1. First scan fails after persisting findings
    const firstRun = scanRunRepo.create({
      siteId,
      scanType: 'full',
      targetUrl: mockEntryUrl,
    });
    scanRunRepo.updateStatus(firstRun.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    findingRepo.batchCreate([
      {
        scanRunId: firstRun.id,
        ruleId: 'INITIAL-1',
        category: 'security',
        title: 'Initial Finding',
        description: 'Discovered in first run',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: `${mockEntryUrl}/page-1`,
      },
    ]);

    scanRunRepo.updateStatus(firstRun.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      durationMs: 500,
      error: {
        code: SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INTERNAL_SCAN_ERROR,
        message: 'Status update failure',
        details: { partialFindingsPersisted: 1 },
      },
    });

    // 2. Retry scan on the same site using orchestrator
    const retryFindings = createDummyFindings(2);
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(retryFindings),
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
    });

    const retryRun = await orchestrator.startScan({ siteId, scanType: 'full' });

    // Verify retry created a brand new scan run ID
    expect(retryRun.id).not.toBe(firstRun.id);
    expect(retryRun.status).toBe('completed');
    expect(retryRun.summary?.totalFindings).toBe(2);

    // 3. Verify finding isolation: First run still has only its 1 finding
    const firstRunFindings = findingRepo.listByScanRunId(firstRun.id);
    expect(firstRunFindings.total).toBe(1);
    expect(firstRunFindings.items[0].title).toBe('Initial Finding');
    expect(firstRunFindings.items[0].scanRunId).toBe(firstRun.id);

    // 4. Verify retry run has exclusively its 2 findings
    const retryRunFindings = findingRepo.listByScanRunId(retryRun.id);
    expect(retryRunFindings.total).toBe(2);
    expect(retryRunFindings.items[0].scanRunId).toBe(retryRun.id);
    expect(retryRunFindings.items[1].scanRunId).toBe(retryRun.id);
    expect(retryRunFindings.items.some(f => f.title === 'Initial Finding')).toBe(false);

    // Total findings across the entire database is 1 + 2 = 3
    const totalCountSite =
      findingRepo.countByScanRunId(firstRun.id) + findingRepo.countByScanRunId(retryRun.id);
    expect(totalCountSite).toBe(3);

    orchestrator.dispose();
  });

  it('7. handles double database failure (both completed and failed status updates fail), preserving both errors and allowing clean recovery', async () => {
    const findings = createDummyFindings(3);
    const mockCrawler = {
      crawl: async () => createDummyCrawlResult(),
    };
    const mockAnalyzer = {
      runAnalysis: async () => createDummyAnalyzerResult(findings),
    };

    const originalUpdateStatus = scanRunRepo.updateStatus.bind(scanRunRepo);
    let attemptedCompleted = false;
    let attemptedFailed = false;

    // Simulate double DB failure: updating to completed throws SQLITE_FULL,
    // and subsequent update to failed throws SQLITE_BUSY
    const updateStatusSpy = vi
      .spyOn(scanRunRepo, 'updateStatus')
      .mockImplementation((id, update) => {
        if (update.status === 'completed') {
          attemptedCompleted = true;
          throw new Error('SQLITE_FULL: database or disk is full');
        }
        if (update.status === 'failed') {
          attemptedFailed = true;
          throw new Error('SQLITE_BUSY: database is locked');
        }
        return originalUpdateStatus(id, update);
      });

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      maxConcurrentScans: 1,
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
      analyzerEngineFactory: () => mockAnalyzer as unknown as AnalyzerEngine,
    });

    const pendingRun = orchestrator.createScan({ siteId, scanType: 'full' });

    // Execution must reject with compound ScanOrchestratorError
    let thrownError: unknown = null;
    try {
      await orchestrator.executeScan(pendingRun.id);
    } catch (err) {
      thrownError = err;
    }

    expect(attemptedCompleted).toBe(true);
    expect(attemptedFailed).toBe(true);
    expect(thrownError).toBeInstanceOf(ScanOrchestratorError);

    const scanErr = thrownError as ScanOrchestratorError;
    // 1. Both errors are preserved without masking
    expect(scanErr.message).toContain('SQLITE_BUSY: database is locked');
    expect(scanErr.message).toContain('SQLITE_FULL: database or disk is full');
    const errDetails = scanErr.details as {
      originalError: string;
      secondaryError: string;
      persistedFindingsCount: number;
    };
    expect(errDetails.originalError).toContain('SQLITE_FULL: database or disk is full');
    expect(errDetails.secondaryError).toContain('SQLITE_BUSY: database is locked');
    expect(errDetails.persistedFindingsCount).toBe(3);

    // 2. In SQLite, the scan run remains in 'running' status because both terminal updates failed
    const inDb = scanRunRepo.getById(pendingRun.id);
    expect(inDb?.status).toBe('running');

    // 3. Persisted findings remain intact and correctly associated
    const storedFindings = findingRepo.listByScanRunId(pendingRun.id);
    expect(storedFindings.total).toBe(3);
    for (const f of storedFindings.items) {
      expect(f.scanRunId).toBe(pendingRun.id);
      expect(f.status).toBe('confirmed');
      expect(f.status).not.toBe('active');
    }

    // 4. Progress query detects scan is no longer active in memory, reporting stage: 'failed'
    const progress = orchestrator.getScanProgress({ id: pendingRun.id });
    expect(progress.stage).toBe('failed');

    // 5. Active scans slot was safely cleaned up in finally block
    expect(orchestrator.getActiveScans()).toHaveLength(0);

    // 6. Startup recovery reliably recovers the scan once DB writes succeed
    updateStatusSpy.mockRestore();
    const recoveredCount = scanRunRepo.recoverInterruptedScans('Database write failure recovery');
    expect(recoveredCount).toBe(1);

    const recoveredInDb = scanRunRepo.getById(pendingRun.id);
    expect(recoveredInDb?.status).toBe('failed');
    expect(recoveredInDb?.error?.code).toBe('ERR_SCAN_INTERRUPTED_BY_SHUTDOWN');

    // Findings are STILL intact after recovery
    const findingsAfterRecovery = findingRepo.listByScanRunId(pendingRun.id);
    expect(findingsAfterRecovery.total).toBe(3);

    orchestrator.dispose();
  });
});
