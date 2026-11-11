import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';
import { SCAN_ORCHESTRATOR_ERROR_CODES } from '../../../src/main/scanner/orchestrator/errors.js';
import type { SafeHttpClientTestHooks } from '../../../src/main/scanner/client/types.js';

describe('ScanOrchestrator Cancellation & Resource Cleanup', () => {
  let server: http.Server;
  let serverPort: number;
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let orchestrator: ScanOrchestrator;
  let siteId: string;
  let testHooks: SafeHttpClientTestHooks;

  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <a href="/slow-page-1">Slow 1</a>
            <a href="/slow-page-2">Slow 2</a>
          </body>
          </html>
        `);
      } else if (url.pathname.startsWith('/slow-page')) {
        // Delay response to give test time to cancel
        const timer = setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<!DOCTYPE html><html><body>Finished Slow Page</body></html>');
          }
        }, 3000);

        req.on('close', () => {
          clearTimeout(timer);
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>OK</body></html>');
      }
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        serverPort = addr.port;
        resolve();
      });
    });

    testHooks = {
      lookupFn: mockPublicLookup,
      pinnedIpOverride: '127.0.0.1',
    };
  });

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
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

    const project = projectRepo.create({ name: 'Cancellation Test Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Cancellation Test Site',
      baseUrl: `http://cancelsite.local:${serverPort}`,
    });
    siteId = site.id;

    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
    });
  });

  afterEach(() => {
    orchestrator.dispose();
    if (connection.isOpen()) {
      connection.close();
    }
  });

  it('cancels a pending scan run in database', async () => {
    const run = orchestrator.createScan({ siteId, scanType: 'full' });
    expect(run.status).toBe('pending');

    const cancelledRun = await orchestrator.cancelScan(
      { id: run.id },
      'Cancelled before execution began',
    );

    expect(cancelledRun.status).toBe('cancelled');
    expect(cancelledRun.cancelledAt).not.toBeNull();

    const inDb = scanRunRepo.getById(run.id);
    expect(inDb?.status).toBe('cancelled');

    // Attempting to cancel an already terminal scan rejects
    await expect(orchestrator.cancelScan({ id: run.id })).rejects.toThrowError(
      new RegExp(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_ALREADY_TERMINAL),
    );
  });

  it('cancels an active scan mid-crawl, clears queue, and records cancelled status without failing', async () => {
    let cancelTriggered = false;

    const scanPromise = orchestrator.startScan(
      {
        siteId,
        scanType: 'full',
        config: { maxPages: 20, maxConcurrency: 2 },
      },
      progress => {
        if (!cancelTriggered && progress.stage === 'crawling') {
          cancelTriggered = true;
          // Trigger cancellation while requests are in-flight
          setTimeout(() => {
            void orchestrator.cancelScan({ id: progress.scanId }, 'User aborted scan');
          }, 50);
        }
      },
    );

    const result = await scanPromise;
    expect(result.status).toBe('cancelled');
    expect(result.cancelledAt).not.toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify it stayed 'cancelled' and did NOT transition to 'failed'
    const finalInDb = scanRunRepo.getById(result.id);
    expect(finalInDb?.status).toBe('cancelled');
    expect(finalInDb?.error).toBeNull();

    // Verify orchestrator removed from active scans
    expect(orchestrator.getActiveScans()).toHaveLength(0);
  });

  it('handles scan execution timeout by aborting and marking status as failed with ERR_SCAN_TIMEOUT', async () => {
    // Configure very short maxDurationMs of 200ms with slow server
    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 10,
        maxDurationMs: 200,
        requestTimeoutMs: 5000,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.completedAt).not.toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT);
  });

  it('guarantees zero findings are persisted in database if cancellation occurs during analysis stage', async () => {
    let unblockAnalysis: (() => void) | null = null;
    const analysisGate = new Promise<void>(resolve => {
      unblockAnalysis = resolve;
    });

    const mockCrawler = {
      crawl: async () => ({
        summary: {
          entryUrl: `http://cancelsite.local:${serverPort}`,
          authorizedOrigin: `http://cancelsite.local:${serverPort}`,
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
        discoveredUrls: [`http://cancelsite.local:${serverPort}`],
        errors: [],
      }),
    };

    const mockAnalyzerEngine = {
      runAnalysis: async () => {
        await analysisGate;
        return {
          findings: [
            {
              ruleId: 'test-rule',
              category: 'security',
              title: 'Should not persist',
              description: 'Cancelled mid-flight',
              severity: 'high' as const,
              confidence: 'confirmed' as const,
              targetUrl: `http://cancelsite.local:${serverPort}`,
            },
          ],
          stats: {
            totalPagesAnalyzed: 1,
            totalFindings: 1,
            bySeverity: { high: 1 },
            byCategory: { security: 1 },
          },
        };
      },
    };

    const testOrchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: () =>
        mockCrawler as unknown as import('../../../src/main/scanner/crawler/crawler.js').BoundedCrawler,
      analyzerEngineFactory: () =>
        mockAnalyzerEngine as unknown as import('../../../src/main/scanner/analyzers/analyzer-engine.js').AnalyzerEngine,
    });

    let scanId = '';
    const scanPromise = testOrchestrator.startScan({ siteId, scanType: 'full' }, progress => {
      if (progress.stage === 'analyzing' && !scanId) {
        scanId = progress.scanId;
      }
    });

    // Wait until analysis stage is reached
    await new Promise(r => setTimeout(r, 20));

    // Cancel while in analysis stage
    const cancelRes = await testOrchestrator.cancelScan(
      { id: scanId },
      'Cancelled during analysis',
    );
    expect(cancelRes.status).toBe('cancelled');

    // Unblock analysis
    unblockAnalysis!();

    const finalResult = await scanPromise;
    expect(finalResult.status).toBe('cancelled');

    // Zero findings must be persisted in database
    const persisted = findingRepo.listByScanRunId(scanId);
    expect(persisted.total).toBe(0);
    expect(persisted.items).toHaveLength(0);

    testOrchestrator.dispose();
  });
});
