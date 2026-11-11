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

describe('ScanOrchestrator Concurrency & Capacity Limits', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let siteAId: string;
  let siteBId: string;
  let siteCId: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);

    const project = projectRepo.create({ name: 'Concurrency Test Project' });
    const siteA = siteRepo.create({
      projectId: project.id,
      name: 'Site A',
      baseUrl: 'https://site-a.example.com',
    });
    const siteB = siteRepo.create({
      projectId: project.id,
      name: 'Site B',
      baseUrl: 'https://site-b.example.com',
    });
    const siteC = siteRepo.create({
      projectId: project.id,
      name: 'Site C',
      baseUrl: 'https://site-c.example.com',
    });

    siteAId = siteA.id;
    siteBId = siteB.id;
    siteCId = siteC.id;
  });

  afterEach(() => {
    if (connection.isOpen()) {
      connection.close();
    }
  });

  const createDummyCrawlResult = (origin: string): CrawlResult => ({
    summary: {
      entryUrl: origin,
      authorizedOrigin: origin,
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
    discoveredUrls: [origin],
    errors: [],
  });

  it('rejects a second concurrent scan on the same site with ERR_SITE_SCAN_IN_PROGRESS', async () => {
    let unblockCrawl: (() => void) | null = null;
    const crawlGate = new Promise<void>(resolve => {
      unblockCrawl = resolve;
    });

    const mockCrawler: Partial<BoundedCrawler> = {
      crawl: async () => {
        await crawlGate;
        return createDummyCrawlResult('https://site-a.example.com');
      },
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as BoundedCrawler,
    });

    // Start first scan on Site A (which hangs on crawlGate)
    const scanAPromise = orchestrator.startScan({ siteId: siteAId, scanType: 'full' });

    // Wait a tick to ensure scan A is registered as active
    await new Promise(r => setTimeout(r, 10));

    // Attempting a second scan on Site A must fail immediately
    expect(() => {
      orchestrator.createScan({ siteId: siteAId, scanType: 'full' });
    }).toThrowError(new RegExp(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SITE_SCAN_IN_PROGRESS));

    // Unblock and complete scan A
    unblockCrawl!();
    const resultA = await scanAPromise;
    expect(resultA.status).toBe('completed');

    orchestrator.dispose();
  });

  it('enforces max global concurrent scan capacity limit of 2', async () => {
    let unblockAll: (() => void) | null = null;
    const gate = new Promise<void>(resolve => {
      unblockAll = resolve;
    });

    const mockCrawler: Partial<BoundedCrawler> = {
      crawl: async config => {
        await gate;
        return createDummyCrawlResult(config.authorizedOrigin ?? config.entryUrl);
      },
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      maxConcurrentScans: 2,
      crawlerFactory: () => mockCrawler as BoundedCrawler,
    });

    // Start Scan 1 on Site A
    const p1 = orchestrator.startScan({ siteId: siteAId });
    // Start Scan 2 on Site B
    const p2 = orchestrator.startScan({ siteId: siteBId });

    await new Promise(r => setTimeout(r, 10));
    expect(orchestrator.getActiveScans()).toHaveLength(2);

    // Attempting Scan 3 on Site C must be rejected due to global limit
    expect(() => {
      orchestrator.createScan({ siteId: siteCId });
    }).toThrowError(new RegExp(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_CONCURRENT_SCAN_LIMIT_REACHED));

    // Unblock scans
    unblockAll!();
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.status).toBe('completed');
    expect(res2.status).toBe('completed');

    // Slot is now released: Site C can start and succeed
    const res3 = await orchestrator.startScan({ siteId: siteCId });
    expect(res3.status).toBe('completed');

    orchestrator.dispose();
  });

  it('handles simultaneous startScan calls on the same site via Promise.allSettled without race conditions', async () => {
    let unblockCrawl: (() => void) | null = null;
    const crawlGate = new Promise<void>(resolve => {
      unblockCrawl = resolve;
    });

    const mockCrawler: Partial<BoundedCrawler> = {
      crawl: async () => {
        await crawlGate;
        return createDummyCrawlResult('https://site-a.example.com');
      },
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () => mockCrawler as BoundedCrawler,
    });

    // Unblock the active crawl after a short delay so it can complete
    setTimeout(() => {
      unblockCrawl?.();
    }, 50);

    // Launch both simultaneously
    const results = await Promise.allSettled([
      orchestrator.startScan({ siteId: siteAId }),
      orchestrator.startScan({ siteId: siteAId }),
    ]);

    // One must be fulfilled (or started), one must be rejected with ERR_SITE_SCAN_IN_PROGRESS
    const rejected = results.find(r => r.status === 'rejected') as
      PromiseRejectedResult | undefined;
    const fulfilled = results.find(r => r.status === 'fulfilled') as
      PromiseFulfilledResult<unknown> | undefined;

    expect(rejected).toBeDefined();
    expect(rejected?.reason.message).toMatch(
      new RegExp(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SITE_SCAN_IN_PROGRESS),
    );

    // Unblock the successful scan
    unblockCrawl!();
    if (fulfilled) {
      expect((fulfilled.value as { status: string }).status).toBe('completed');
    }

    orchestrator.dispose();
  });

  it('releases concurrency slot on unhandled crawler error, allowing next scan to proceed', async () => {
    const mockFailingCrawler: Partial<BoundedCrawler> = {
      crawl: async () => {
        throw new Error('Fatal socket failure during crawl');
      },
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      maxConcurrentScans: 1,
      crawlerFactory: () => mockFailingCrawler as BoundedCrawler,
    });

    // Run first failing scan
    const failedRun = await orchestrator.startScan({ siteId: siteAId });
    expect(failedRun.status).toBe('failed');
    expect(failedRun.error?.code).toBe(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INTERNAL_SCAN_ERROR);
    expect(orchestrator.getActiveScans()).toHaveLength(0);

    // Slot should be free immediately: a subsequent scan can be started
    const mockSuccessCrawler: Partial<BoundedCrawler> = {
      crawl: async () => createDummyCrawlResult('https://site-b.example.com'),
    };
    const nextOrchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      maxConcurrentScans: 1,
      crawlerFactory: () => mockSuccessCrawler as BoundedCrawler,
    });

    const nextRun = await nextOrchestrator.startScan({ siteId: siteBId });
    expect(nextRun.status).toBe('completed');

    orchestrator.dispose();
    nextOrchestrator.dispose();
  });
});
