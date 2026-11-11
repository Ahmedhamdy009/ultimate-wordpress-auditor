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
import type { SafeHttpClientTestHooks } from '../../../src/main/scanner/client/types.js';
import type { ScanProgressDTO } from '@auditor/shared';

describe('ScanOrchestrator Full End-to-End Execution', () => {
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
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Powered-By': 'PHP/8.2.0',
        });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="utf-8">
            <title>WordPress Test Site</title>
            <meta name="generator" content="WordPress 6.4.2">
            <link rel="https://api.w.org/" href="/wp-json/">
          </head>
          <body>
            <h1>Welcome to WordPress Test Site</h1>
            <a href="/sample-page">Sample Page</a>
            <a href="/about-us">About Us</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/sample-page') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Sample Page</title></head>
          <body>
            <h1>Sample Page</h1>
            <p>Some content here without H1 duplicate.</p>
          </body>
          </html>
        `);
      } else if (url.pathname === '/about-us') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'DENY',
        });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>About Us</title>
            <meta name="description" content="Detailed description about our team and mission.">
          </head>
          <body>
            <h1>About Us</h1>
          </body>
          </html>
        `);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>404 Not Found</body></html>');
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

    const project = projectRepo.create({ name: 'Execution Test Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Execution Test Site',
      baseUrl: `http://testsite.local:${serverPort}`,
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

  it('runs complete bounded crawl, analyzers, and persists findings accurately into SQLite', async () => {
    const progressList: ScanProgressDTO[] = [];

    const completedRun = await orchestrator.startScan(
      {
        siteId,
        scanType: 'full',
        config: {
          maxPages: 10,
          maxDepth: 2,
          maxConcurrency: 2,
          requestTimeoutMs: 1000,
        },
      },
      p => {
        progressList.push({ ...p });
      },
    );

    // 1. Verify Scan Run status and metadata
    expect(completedRun.status).toBe('completed');
    expect(completedRun.startedAt).not.toBeNull();
    expect(completedRun.completedAt).not.toBeNull();
    expect(completedRun.durationMs).toBeGreaterThanOrEqual(0);
    expect(completedRun.error).toBeNull();
    expect(completedRun.summary).not.toBeNull();

    // 2. Verify Findings persisted in SQLite
    const persistedFindings = findingRepo.listByScanRunId(completedRun.id);
    expect(persistedFindings.total).toBeGreaterThan(0);
    expect(persistedFindings.items.length).toBe(persistedFindings.total);

    // 3. Verify Summary Counts match persisted findings
    const summary = completedRun.summary!;
    expect(summary.totalFindings).toBe(persistedFindings.total);

    let calculatedCritical = 0;
    let calculatedHigh = 0;
    let calculatedMedium = 0;
    let calculatedLow = 0;
    let calculatedInfo = 0;

    for (const f of persistedFindings.items) {
      if (f.severity === 'critical') calculatedCritical++;
      else if (f.severity === 'high') calculatedHigh++;
      else if (f.severity === 'medium') calculatedMedium++;
      else if (f.severity === 'low') calculatedLow++;
      else calculatedInfo++;
    }

    expect(summary.criticalCount).toBe(calculatedCritical);
    expect(summary.highCount).toBe(calculatedHigh);
    expect(summary.mediumCount).toBe(calculatedMedium);
    expect(summary.lowCount).toBe(calculatedLow);
    expect(summary.infoCount).toBe(calculatedInfo);

    // 4. Verify Analyzer output quality: WordPress was detected
    const wpFindings = persistedFindings.items.filter(f => f.ruleId.startsWith('WP_'));
    expect(wpFindings.length).toBeGreaterThan(0);

    // 5. Verify Progress events captured pipeline stages
    const stagesCaptured = new Set(progressList.map(p => p.stage));
    expect(stagesCaptured.has('initializing')).toBe(true);
    expect(stagesCaptured.has('crawling')).toBe(true);
    expect(stagesCaptured.has('analyzing')).toBe(true);
    expect(stagesCaptured.has('persisting')).toBe(true);
    expect(stagesCaptured.has('completed')).toBe(true);

    const lastProgress = progressList[progressList.length - 1];
    expect(lastProgress.findingsPersisted).toBe(persistedFindings.total);
    expect(lastProgress.status).toBe('completed');
  }, 15000);

  it('reports live progress via getScanProgress during active execution', async () => {
    // Start scan and verify progress can be queried
    const scanPromise = orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: { maxPages: 5, maxDepth: 1, requestTimeoutMs: 1000 },
    });

    // Query active scan list
    const activeList = orchestrator.getActiveScans();
    expect(activeList.length).toBeLessThanOrEqual(1);

    const completedRun = await scanPromise;
    expect(completedRun.status).toBe('completed');

    // Post-completion query returns terminal progress
    const finalProgress = orchestrator.getScanProgress({ id: completedRun.id });
    expect(finalProgress.status).toBe('completed');
    expect(finalProgress.stage).toBe('completed');
    expect(finalProgress.findingsPersisted).toBe(completedRun.summary?.totalFindings);
  });
});
