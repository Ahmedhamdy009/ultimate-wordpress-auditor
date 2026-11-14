import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';
import { SCAN_ORCHESTRATOR_ERROR_CODES } from '../../../src/main/scanner/orchestrator/errors.js';
import type { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import type { CrawlResult } from '../../../src/main/scanner/crawler/types.js';

describe('ScanOrchestrator Lifecycle & State Machine', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let orchestrator: ScanOrchestrator;
  let validSiteId: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);

    const project = projectRepo.create({ name: 'Lifecycle Test Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Lifecycle Test Site',
      baseUrl: 'https://example.com',
    });
    validSiteId = site.id;

    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);
  });

  afterEach(() => {
    orchestrator.dispose();
    if (connection.isOpen()) {
      connection.close();
    }
  });

  it('rejects scan creation for non-existent site', () => {
    const fakeSiteId = '00000000-0000-0000-0000-000000000000';
    expect(() => {
      orchestrator.createScan({ siteId: fakeSiteId, scanType: 'full' });
    }).toThrowError(/not found/);
  });

  it('rejects scan creation for an archived site', () => {
    siteRepo.archive(validSiteId);
    expect(() => {
      orchestrator.createScan({ siteId: validSiteId, scanType: 'full' });
    }).toThrowError(/archived/);
  });

  it('rejects invalid scan configurations exceeding bounds', () => {
    expect(() => {
      orchestrator.createScan({
        siteId: validSiteId,
        config: { maxPages: 99999 }, // Max is 500
      });
    }).toThrowError();
  });

  it('rejects target URL that does not match the registered site origin', () => {
    expect(() => {
      orchestrator.createScan({
        siteId: validSiteId,
        targetUrl: 'https://different-domain.com/blog',
      });
    }).toThrowError(new RegExp(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INVALID_ENTRY_URL));
  });

  it('creates scan run in pending status with defaults', () => {
    const run = orchestrator.createScan({
      siteId: validSiteId,
      scanType: 'security',
    });

    expect(run.status).toBe('pending');
    expect(run.siteId).toBe(validSiteId);
    expect(run.targetUrl).toBe('https://example.com/');
    expect(run.startedAt).toBeNull();
    expect(run.completedAt).toBeNull();

    const inDb = scanRunRepo.getById(run.id);
    expect(inDb).not.toBeNull();
    expect(inDb?.status).toBe('pending');
  });

  it('retrieves progress for a pending scan', () => {
    const run = orchestrator.createScan({ siteId: validSiteId });
    const progress = orchestrator.getScanProgress({ id: run.id });

    expect(progress.scanId).toBe(run.id);
    expect(progress.status).toBe('pending');
    expect(progress.stage).toBe('pending');
    expect(progress.pagesAttempted).toBe(0);
    expect(progress.findingsProduced).toBe(0);
  });

  it('executes a pending scan with mock crawler and completes state transitions', async () => {
    const mockCrawlResult: CrawlResult = {
      summary: {
        entryUrl: 'https://example.com',
        authorizedOrigin: 'https://example.com',
        totalPagesAttempted: 1,
        successfulPages: 1,
        failedPages: 0,
        nonHtmlPages: 0,
        uniqueUrlsDiscovered: 1,
        urlsSkippedScope: 0,
        urlsSkippedLimits: 0,
        maxDepthReached: 0,
        durationMs: 50,
        cancelled: false,
      },
      pages: [
        {
          requestedUrl: 'https://example.com',
          finalUrl: 'https://example.com',
          statusCode: 200,
          statusMessage: 'OK',
          headers: { 'content-type': 'text/html' },
          contentType: 'text/html',
          isHtml: true,
          durationMs: 40,
          depth: 0,
          parentUrl: null,
          encodedBodyBytes: 150,
          decompressedBodyBytes: 150,
          parsedDocument: null,
        },
      ],
      discoveredUrls: ['https://example.com'],
      errors: [],
    };

    const mockCrawler: Partial<BoundedCrawler> = {
      crawl: async (_config, onProgress) => {
        onProgress?.({
          pagesCrawled: 1,
          queueSize: 0,
          currentUrl: 'https://example.com',
          depth: 0,
        });
        return mockCrawlResult;
      },
    };

    const customOrchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as BoundedCrawler,
    });

    const progressUpdates: string[] = [];
    const finalRun = await customOrchestrator.startScan(
      { siteId: validSiteId, scanType: 'full' },
      p => {
        progressUpdates.push(p.stage);
      },
    );

    expect(finalRun.status).toBe('completed');
    expect(finalRun.completedAt).not.toBeNull();
    expect(finalRun.durationMs).toBeGreaterThanOrEqual(0);
    expect(finalRun.summary).not.toBeNull();
    expect(progressUpdates).toContain('crawling');
    expect(progressUpdates).toContain('completed');

    customOrchestrator.dispose();
  }, 15_000);

  it('prevents executing an already terminal scan', async () => {
    const run = orchestrator.createScan({ siteId: validSiteId });
    scanRunRepo.updateStatus(run.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: { code: 'MANUAL_FAIL', message: 'Manual' },
    });

    await expect(orchestrator.executeScan(run.id)).rejects.toThrowError(
      new RegExp(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_ALREADY_TERMINAL),
    );
  });

  it('rejects operations after disposal', () => {
    orchestrator.dispose();
    expect(() => orchestrator.createScan({ siteId: validSiteId })).toThrowError(/disposed/);
  });
});
