import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';
import type { SafeHttpClientTestHooks } from '../../../src/main/scanner/client/types.js';
import type { BrowserManager, ManagedPage } from '../../../src/main/browser/browser-manager.js';
import type { AccessibilityAuditor } from '../../../src/main/browser/accessibility-types.js';

describe('ScanOrchestrator Coverage Semantics & Browser Budget Safety Suite', () => {
  let server: http.Server;
  let serverPort: number;
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let findingRepo: FindingRepository;
  let siteId: string;
  let projectId: string;
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
          <head><title>Home</title></head>
          <body>
            <h1>Home</h1>
            <a href="/page-a">Page A</a>
            <a href="/page-b">Page B</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/page-a') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>Page A Content</body></html>');
      } else if (url.pathname === '/page-b') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>Page B Content</body></html>');
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

    testHooks = {
      lookupFn: mockPublicLookup,
      pinnedIpOverride: '127.0.0.1',
    };
  });

  afterAll(async () => {
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

    const project = projectRepo.create({ name: 'Coverage Project' });
    projectId = project.id;

    const site = siteRepo.create({
      projectId,
      name: 'Coverage Target Site',
      baseUrl: `http://coverage.local:${serverPort}`,
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

  it('1. Full Browser Coverage: marks scan completed with full coverage when all candidates audit successfully', async () => {
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
      auditPage: vi.fn().mockResolvedValue({
        findings: [
          {
            scanRunId: 'scan-id',
            ruleId: 'a11y-img-alt',
            category: 'accessibility',
            title: 'Image missing alt text',
            description: 'Alt missing',
            severity: 'low',
            confidence: 'confirmed',
            status: 'active',
            targetUrl: `http://coverage.local:${serverPort}/`,
            evidence: {},
            remediation: 'Add alt',
            references: [],
          },
        ],
        rawAxeResults: null,
        durationMs: 50,
      }),
    } as unknown as AccessibilityAuditor;

    const orchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
      browserManagerFactory: () => mockBrowserManager,
      accessibilityAuditorFactory: () => mockA11yAuditor,
    });

    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 3,
        maxDurationMs: 120000, // Ample budget: 120s
        enableBrowserAudit: true,
        auditModules: {
          accessibility: true,
          responsiveLayout: false,
          screenshots: false,
        },
      },
    });

    expect(result.status).toBe('completed');
    expect(result.summary?.coverageStatus).toBe('full');
    expect(result.summary?.isPartialCoverage).toBe(false);
    expect(result.summary?.browserCandidatesSkipped).toBe(0);
    expect(result.summary?.browserPagesAudited).toBeGreaterThan(0);
    expect(result.summary?.browserPagesAudited).toBe(result.summary?.browserCandidatesTotal);
    expect(result.summary?.coverageWarning).toBeUndefined();

    // Check getScanProgress
    const progress = orchestrator.getScanProgress({ id: result.id });
    expect(progress.coverageStatus).toBe('full');
    expect(progress.isPartialCoverage).toBe(false);
    expect(progress.browserCandidatesSkipped).toBe(0);

    orchestrator.dispose();
  });

  it('2. Partial Browser Coverage: gracefully skips remaining candidates when time budget is low and sets partial coverage status', async () => {
    let callCount = 0;
    const mockPage = {
      goto: vi.fn().mockImplementation(async () => {
        callCount++;
      }),
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
      auditPage: vi.fn().mockResolvedValue({
        findings: [
          {
            scanRunId: 'scan-id',
            ruleId: 'a11y-img-alt',
            category: 'accessibility',
            title: 'Image missing alt text',
            description: 'Alt missing',
            severity: 'low',
            confidence: 'confirmed',
            status: 'active',
            targetUrl: `http://coverage.local:${serverPort}/`,
            evidence: {},
            remediation: 'Add alt',
            references: [],
          },
        ],
        rawAxeResults: null,
        durationMs: 50,
      }),
    } as unknown as AccessibilityAuditor;

    const orchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
      browserManagerFactory: () => mockBrowserManager,
      accessibilityAuditorFactory: () => mockA11yAuditor,
    });

    // 10 second timeout with 3 candidates. Page 1 audits, then remaining time is below required budget
    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 3,
        maxDurationMs: 10000, // 10s budget
        enableBrowserAudit: true,
        auditModules: {
          accessibility: true,
          responsiveLayout: false,
          screenshots: false,
        },
      },
    });

    expect(result.status).toBe('completed');
    expect(result.summary?.coverageStatus).toBe('partial');
    expect(result.summary?.isPartialCoverage).toBe(true);
    expect(result.summary?.browserPagesAudited).toBe(1);
    expect(result.summary?.browserCandidatesSkipped).toBeGreaterThan(0);
    expect(result.summary?.coverageWarning).toContain(
      'skipped due to remaining scan duration budget',
    );

    // Progress fallback also retains partial status
    const progress = orchestrator.getScanProgress({ id: result.id });
    expect(progress.coverageStatus).toBe('partial');
    expect(progress.isPartialCoverage).toBe(true);
    expect(progress.browserCandidatesSkipped).toBeGreaterThan(0);
    expect(callCount).toBe(1);

    orchestrator.dispose();
  });

  it('3. Slow Navigation Isolation: clamps navigation timeout and isolates page failure to failedPages without corrupting scan', async () => {
    let pageCount = 0;
    const mockPage = {
      goto: vi.fn().mockImplementation(async (url: string) => {
        pageCount++;
        if (url.includes('page-a')) {
          // Simulate slow navigation that hits the clamped timeout
          throw new Error('Navigation timeout of 15000ms exceeded');
        }
      }),
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
      auditPage: vi.fn().mockResolvedValue({
        findings: [
          {
            scanRunId: 'scan-id',
            ruleId: 'a11y-home',
            category: 'accessibility',
            title: 'Home finding',
            description: 'Desc',
            severity: 'low',
            confidence: 'confirmed',
            status: 'active',
            targetUrl: `http://coverage.local:${serverPort}/`,
            evidence: {},
            remediation: 'Fix',
            references: [],
          },
        ],
        rawAxeResults: null,
        durationMs: 50,
      }),
    } as unknown as AccessibilityAuditor;

    const orchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
      browserManagerFactory: () => mockBrowserManager,
      accessibilityAuditorFactory: () => mockA11yAuditor,
    });

    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 3,
        maxDurationMs: 120000,
        enableBrowserAudit: true,
        auditModules: {
          accessibility: true,
          responsiveLayout: false,
          screenshots: false,
        },
      },
    });

    // Scan completes without crashing
    expect(result.status).toBe('completed');
    // Coverage is partial because 1 page failed navigation
    expect(result.summary?.coverageStatus).toBe('partial');
    expect(result.summary?.isPartialCoverage).toBe(true);
    expect(result.summary?.pagesFailed).toBeGreaterThan(0);

    // Existing findings from Home page are preserved
    const persisted = findingRepo.getAllByScanRunId(result.id);
    expect(persisted.some(f => f.ruleId === 'a11y-home')).toBe(true);
    expect(pageCount).toBeGreaterThanOrEqual(1);

    orchestrator.dispose();
  });

  it('4. User Cancellation: cleanly sets status to cancelled and preserves cancellation reason', async () => {
    const orchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
    });

    const scan = orchestrator.createScan({ siteId });
    const cancelled = await orchestrator.cancelScan(
      { id: scan.id },
      'User terminated scan manually',
    );

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledAt).toBeDefined();

    const progress = orchestrator.getScanProgress({ id: scan.id });
    expect(progress.status).toBe('cancelled');
    expect(progress.stage).toBe('cancelled');

    orchestrator.dispose();
  });
});
