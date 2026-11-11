import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';

describe('Browser Coverage Prioritization & Exclusion Suite', () => {
  let server: http.Server;
  let serverPort: number;
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let orchestrator: ScanOrchestrator;
  let siteId: string;
  const auditedBrowserUrls: string[] = [];

  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Home</title></head>
            <body>
              <a href="/blog/p1">Blog 1</a>
              <a href="/blog/p2">Blog 2</a>
              <a href="/blog/p3">Blog 3</a>
              <a href="/about">About</a>
              <a href="/contact">Contact</a>
              <a href="/cdn-cgi/l/email-protection">Email Protection</a>
            </body>
          </html>
        `);
      } else if (
        url.pathname.startsWith('/blog/') ||
        url.pathname === '/about' ||
        url.pathname === '/contact'
      ) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!DOCTYPE html><html><head><title>${url.pathname}</title></head><body><h1>Content</h1></body></html>`,
        );
      } else if (url.pathname.startsWith('/cdn-cgi/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body>Utility Cloudflare</body></html>');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as net.AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  beforeEach(async () => {
    auditedBrowserUrls.length = 0;
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);

    const project = projectRepo.create({
      name: 'Prioritization Test Project',
    });

    const site = siteRepo.create({
      projectId: project.id,
      name: 'Prioritization Target',
      baseUrl: `http://audit-target.test:${serverPort}/`,
    });
    siteId = site.id;
  });

  afterEach(() => {
    if (orchestrator) {
      orchestrator.dispose();
    }
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  it('intelligently prioritizes entry page and distinct stems, and excludes /cdn-cgi/ from browser audit', async () => {
    const mockBrowserManagerFactory = () => ({
      launch: async () => {},
      close: async () => {},
      acquirePage: async () => ({
        page: {
          goto: async (targetUrl: string) => {
            auditedBrowserUrls.push(targetUrl);
          },
          isClosed: () => false,
        },
        release: async () => {},
      }),
    });

    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks: {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
      },
      browserManagerFactory: mockBrowserManagerFactory as unknown as (
        opts: unknown,
      ) => import('../../../src/main/browser/manager.js').BrowserManager,
      accessibilityAuditorFactory: () => ({
        auditPage: async () => ({
          findings: [],
          summary: {
            totalRulesEvaluated: 0,
            passedRules: 0,
            failedRules: 0,
            incompleteRules: 0,
            durationMs: 0,
          },
        }),
      }),
      runtimeAuditorFactory: () => ({
        attach: () => {},
        audit: () => ({
          findings: [],
          summary: { totalErrors: 0, totalWarnings: 0, durationMs: 0 },
        }),
        detach: () => {},
      }),
      visualAuditorFactory: () => ({
        auditUrl: async (url: string) => ({
          targetUrl: url,
          profilesEvaluated: 1,
          totalFindings: 0,
          findings: [],
          viewportResults: [],
          totalScreenshots: 0,
          totalScreenshotStorageBytes: 0,
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 10,
          limitsReached: {
            profilesLimit: false,
            elementsLimit: false,
            shiftEventsLimit: false,
            screenshotCountLimit: false,
            screenshotStorageLimit: false,
          },
        }),
      }),
    });

    const completedRun = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 10,
        maxConcurrency: 1,
        maxDurationMs: 30000,
        enableBrowserAudit: true,
        auditModules: {
          accessibility: true,
        },
        maxBrowserPages: 3,
        captureScreenshots: false,
      },
    });

    expect(completedRun.status).toBe('completed');
    expect(auditedBrowserUrls.length).toBeLessThanOrEqual(3);

    // Entry URL must be audited first
    expect(auditedBrowserUrls[0]).toBe(`http://audit-target.test:${serverPort}/`);

    // Under no circumstances should /cdn-cgi/ be audited
    for (const url of auditedBrowserUrls) {
      expect(url).not.toContain('/cdn-cgi/');
    }

    // Diverse stems: if multiple pages exist, it should not pick all blog pages
    const hasBlog = auditedBrowserUrls.some(u => u.includes('/blog/'));
    const hasOtherStem = auditedBrowserUrls.some(
      u => u.includes('/about') || u.includes('/contact'),
    );
    expect(hasBlog).toBe(true);
    expect(hasOtherStem).toBe(true);
  });
});
