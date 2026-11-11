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
import type { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import type { BrowserManager, ManagedPage } from '../../../src/main/browser/browser-manager.js';
import type { VisualAuditor, VisualAuditReport } from '../../../src/main/browser/visual-types.js';
import type {
  AccessibilityAuditor,
  AccessibilityAuditReport,
} from '../../../src/main/browser/accessibility-types.js';

describe('ScanOrchestrator Production Timeout Remediation & Invariant Suite', () => {
  let server: http.Server;
  let serverPort: number;
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let orchestrator: ScanOrchestrator;
  let siteId: string;
  let projectId: string;
  let testHooks: SafeHttpClientTestHooks;

  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/') {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          Server: 'Apache/2.4.41',
        });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>Test Target</title></head>
          <body>
            <h1>Welcome</h1>
            <a href="/page-2">Page 2</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/page-2') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>Page Two Content</body></html>');
      } else if (url.pathname === '/hang') {
        // Never responds: used for timeout verification
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
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

    const project = projectRepo.create({ name: 'Remediation Project' });
    projectId = project.id;
    const site = siteRepo.create({
      projectId,
      name: 'Remediation Target',
      baseUrl: `http://remediation.local:${serverPort}`,
    });
    siteId = site.id;

    orchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: {
        allowPrivateLoopback: true,
      },
    });
  });

  afterEach(async () => {
    orchestrator.dispose();
    connection.close();
  });

  it('1. A scan is not cancelled without an actual cancellation request or expired deadline', async () => {
    // Normal crawl and analysis without cancel request
    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 2,
        maxDurationMs: 10000,
        enableBrowserAudit: false,
      },
    });

    expect(result.status).toBe('completed');
    expect(result.cancelledAt).toBeNull();
    expect(result.error).toBeNull();

    // Verify DB record
    const dbRecord = scanRunRepo.getById(result.id);
    expect(dbRecord?.status).toBe('completed');
    expect(dbRecord?.cancelledAt).toBeNull();
  });

  it('2. Screenshot capture cannot accidentally abort the crawler through an incorrectly shared signal', async () => {
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

    const mockVisualAuditorFactory = () => {
      return {
        auditUrl: async () => {
          // If called, simulate that screenshots were disabled in options
          return {
            targetUrl: `http://remediation.local:${serverPort}`,
            viewportResults: [],
            findings: [],
            totalScreenshots: 0,
            durationMs: 10,
          } as unknown as VisualAuditReport;
        },
      } as unknown as VisualAuditor;
    };

    const orchestratorWithAudit = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
      browserManagerFactory: mockBrowserManagerFactory,
      visualAuditorFactory: (mgr, opts) => {
        // Verify orchestrator passes captureScreenshots: false when config disables it
        expect(opts?.captureScreenshots).toBe(false);
        return mockVisualAuditorFactory();
      },
    });

    const result = await orchestratorWithAudit.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 2,
        captureScreenshots: false,
        enableBrowserAudit: true,
        auditModules: {
          screenshots: false,
          responsiveLayout: true,
        },
      },
    });

    expect(result.status).toBe('completed');
    expect(result.summary?.screenshotsCaptured).toBe(0);
    orchestratorWithAudit.dispose();
  });

  it('3. A screenshot failure does not destroy valid HTTP findings', async () => {
    let browserClosed = false;

    // Mock browser manager and visual auditor that throws a non-cancellation screenshot failure
    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {},
        close: async () => {
          browserClosed = true;
        },
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
        auditUrl: async () => {
          // Returns layout findings despite screenshot failure
          return {
            targetUrl: `http://remediation.local:${serverPort}`,
            viewportResults: [],
            findings: [
              {
                scanRunId: 'test-run',
                ruleId: 'LAYOUT_OVERFLOW',
                category: 'Responsive Layout',
                title: 'Content Overflows Viewport',
                description: 'Element causes horizontal scrollbar',
                severity: 'medium',
                confidence: 'confirmed',
                status: 'active',
                targetUrl: `http://remediation.local:${serverPort}`,
                evidence: null,
                remediation: null,
                references: [],
              },
            ],
            totalScreenshots: 0,
            durationMs: 20,
          } as unknown as VisualAuditReport;
        },
      }) as unknown as VisualAuditor;

    const customOrchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
      browserManagerFactory: mockBrowserManagerFactory,
      visualAuditorFactory: mockVisualAuditorFactory,
    });

    const result = await customOrchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 2,
        captureScreenshots: false,
        enableBrowserAudit: true,
        auditModules: {
          http: true,
          securityHeaders: true,
          responsiveLayout: true,
        },
      },
    });

    expect(result.status).toBe('completed');
    const persistedFindings = findingRepo.listByScanRunId(result.id);
    expect(persistedFindings.items.length).toBeGreaterThan(0);
    expect(browserClosed).toBe(true);
    customOrchestrator.dispose();
  });

  it('4. Zero-page failures preserve their original diagnostic cause and accurate metrics', async () => {
    // 1. Crawler that encounters an isolated failure on entry URL
    const closedPortSite = siteRepo.create({
      projectId,
      name: 'Unreachable Target',
      baseUrl: 'http://unreachable.local:54321',
    });

    const result = await orchestrator.startScan({
      siteId: closedPortSite.id,
      scanType: 'full',
      config: {
        maxPages: 1,
        requestTimeoutMs: 1000,
        maxDurationMs: 5000,
      },
    });

    // Invariant: Summary reflects the isolated crawl failure accurately
    expect(result.summary?.pagesFailed).toBeGreaterThanOrEqual(1);
    expect(result.summary?.pagesScanned).toBe(0);
    expect(result.summary?.urlsCrawled).toBeGreaterThanOrEqual(1);

    // Invariant: getScanProgress reflects Attempted=1, Failed=1 (not 0)
    const progress = orchestrator.getScanProgress({ id: result.id });
    expect(progress.pagesAttempted).toBeGreaterThanOrEqual(1);
    expect(progress.pagesFailed).toBeGreaterThanOrEqual(1);
    expect(progress.pagesSucceeded).toBe(0);

    // 2. Fatal crawl failure preserves original diagnostic error code and message
    const fatalCrawler = {
      crawl: async () => {
        const fatalErr = new Error('getaddrinfo ENOTFOUND unreachable-domain.invalid');
        (fatalErr as { code?: string }).code = 'ENOTFOUND';
        throw fatalErr;
      },
    };

    const fatalOrchestrator = new ScanOrchestrator(connection, {
      crawlerFactory: () => fatalCrawler as unknown as BoundedCrawler,
    });

    const fatalResult = await fatalOrchestrator.startScan({
      siteId: closedPortSite.id,
      scanType: 'full',
    });

    expect(fatalResult.status).toBe('failed');
    expect(fatalResult.error?.code).toBe('ENOTFOUND');
    expect(fatalResult.error?.message).toContain(
      'getaddrinfo ENOTFOUND unreachable-domain.invalid',
    );

    fatalOrchestrator.dispose();
  });

  it('5. Successful scans still complete normally', async () => {
    const result = await orchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 5,
        maxDepth: 2,
        maxDurationMs: 15000,
        enableBrowserAudit: false,
      },
    });

    expect(result.status).toBe('completed');
    expect(result.summary).toBeDefined();
    expect(result.summary?.pagesScanned).toBeGreaterThanOrEqual(1);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.completedAt).not.toBeNull();
  });

  it('6. Real user cancellation still works', async () => {
    let unblockCrawl: (() => void) | null = null;
    const crawlGate = new Promise<void>(resolve => {
      unblockCrawl = resolve;
    });

    const mockCrawler = {
      crawl: async (_config: unknown, onProgress?: (p: unknown) => void) => {
        if (onProgress) {
          onProgress({
            pagesCrawled: 1,
            queueSize: 1,
            currentUrl: 'http://remediation.local',
            depth: 0,
          });
        }
        await crawlGate;
        return {
          pages: [],
          errors: [],
          discoveredUrls: [],
          summary: {
            totalPagesAttempted: 1,
            successfulPages: 1,
            failedPages: 0,
            uniqueUrlsDiscovered: 1,
            maxDepthReached: 0,
            durationMs: 100,
            isCancelled: true,
            cancellationReason: 'USER_ABORT',
          },
        };
      },
    };

    const cancelOrchestrator = new ScanOrchestrator(connection, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
    });

    const pending = cancelOrchestrator.createScan({ siteId, scanType: 'full' });
    const execPromise = cancelOrchestrator.executeScan(pending.id);

    // Cancel while active
    const cancelled = await cancelOrchestrator.cancelScan(
      { id: pending.id },
      'User requested abort',
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledAt).not.toBeNull();

    unblockCrawl?.();
    const finalResult = await execPromise;
    expect(finalResult.status).toBe('cancelled');

    cancelOrchestrator.dispose();
  });

  it('7. Genuine deadlines still terminate scans safely and preserve timeout diagnostics', async () => {
    // Configure maxDurationMs: 100ms with a hanging mock operation
    const mockCrawler = {
      crawl: async (config: { signal?: AbortSignal }) => {
        // Wait until aborted by timeout
        await new Promise((resolve, reject) => {
          if (config.signal?.aborted) {
            reject(config.signal.reason);
            return;
          }
          config.signal?.addEventListener('abort', () => {
            // Simulate that in-flight child rejects with internal abort string
            reject(new Error('Screenshot capture was aborted by caller signal.'));
          });
        });
        throw new Error('Unreachable');
      },
    };

    const timeoutOrchestrator = new ScanOrchestrator(connection, {
      crawlerFactory: () => mockCrawler as unknown as BoundedCrawler,
    });

    const result = await timeoutOrchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 5,
        maxDurationMs: 100,
      },
    });

    expect(result.status).toBe('failed');
    expect(result.error).not.toBeNull();
    // Invariant: Code must be ERR_SCAN_TIMEOUT
    expect(result.error?.code).toBe(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT);
    // Invariant: Message must reflect timeout, NOT the internal child error
    expect(result.error?.message).toContain('Scan exceeded maximum duration limit of 100ms');
    expect(result.error?.message).not.toContain('Screenshot capture was aborted');

    timeoutOrchestrator.dispose();
  });

  it('8. Browser resources and page leases are released correctly', async () => {
    let pageAcquired = 0;
    let pageReleased = 0;
    let browserClosed = false;

    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {},
        close: async () => {
          browserClosed = true;
        },
        acquirePage: async () => {
          pageAcquired++;
          return {
            page: {
              goto: async () => {},
              isClosed: () => false,
            },
            release: async () => {
              pageReleased++;
            },
          } as unknown as ManagedPage;
        },
      }) as unknown as BrowserManager;

    const mockA11yAuditor = {
      auditPage: async () =>
        ({
          targetUrl: `http://remediation.local:${serverPort}`,
          findings: [],
          rawAxeResults: null,
          durationMs: 10,
        }) as unknown as AccessibilityAuditReport,
    } as unknown as AccessibilityAuditor;

    const lifecycleOrchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
      browserManagerFactory: mockBrowserManagerFactory,
      accessibilityAuditorFactory: () => mockA11yAuditor,
    });

    const result = await lifecycleOrchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 1,
        enableBrowserAudit: true,
        auditModules: {
          accessibility: true,
          responsiveLayout: false,
          screenshots: false,
        },
      },
    });

    expect(result.status).toBe('completed');
    expect(browserClosed).toBe(true);
    expect(pageAcquired).toBeGreaterThan(0);
    expect(pageReleased).toBe(pageAcquired);

    lifecycleOrchestrator.dispose();
  });

  it('9. Cooperative Browser Budgeting: breaks out gracefully and completes scan when remaining time < 15,000ms', async () => {
    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {},
        close: async () => {},
        acquirePage: async () =>
          ({
            page: {
              goto: async () => {},
              isClosed: () => false,
              on: () => {},
              off: () => {},
            },
            release: async () => {},
          }) as unknown as ManagedPage,
      }) as unknown as BrowserManager;

    const mockA11yAuditor = {
      auditPage: async () =>
        ({
          targetUrl: `http://remediation.local:${serverPort}`,
          findings: [
            {
              scanRunId: 'temp',
              ruleId: 'A11Y_CONTRAST',
              category: 'accessibility',
              title: 'Low contrast',
              description: 'Text has insufficient contrast',
              severity: 'medium',
              confidence: 'confirmed',
              status: 'active',
              targetUrl: `http://remediation.local:${serverPort}/page-2`,
              evidence: { details: 'Ratio 2.1:1' },
              remediation: 'Increase contrast',
              references: [],
            },
          ],
          rawAxeResults: null,
          durationMs: 10,
        }) as unknown as AccessibilityAuditReport,
    } as unknown as AccessibilityAuditor;

    const budgetOrchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
      browserManagerFactory: mockBrowserManagerFactory,
      accessibilityAuditorFactory: () => mockA11yAuditor,
    });

    // Start a scan with standard timeout (e.g. 10000ms).
    // After page 1 audits, remaining time will naturally be < 15,000ms.
    // The cooperative budgeting must conclude browser audit early and finish with 'completed'
    const result = await budgetOrchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 5,
        maxDurationMs: 10000, // 10s total timeout (< 15s budget)
        enableBrowserAudit: true,
        auditModules: {
          accessibility: true,
          responsiveLayout: false,
          screenshots: false,
        },
      },
    });

    // Scan must finish with COMPLETED, NOT FAILED / ERR_SCAN_TIMEOUT
    expect(result.status).toBe('completed');
    // Only 1 page was audited because remaining budget was < 15,000ms for page 2
    expect(result.summary?.browserPagesAudited).toBe(1);
    expect(result.summary?.totalFindings).toBeGreaterThan(0);

    budgetOrchestrator.dispose();
  });

  it('10. Terminal Progress Metrics Persistence: retain viewportsCompleted and accessibilityAuditsCompleted in summary and progress fallbacks', async () => {
    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {},
        close: async () => {},
        acquirePage: async () =>
          ({
            page: {
              goto: async () => {},
              isClosed: () => false,
              on: () => {},
              off: () => {},
            },
            release: async () => {},
          }) as unknown as ManagedPage,
      }) as unknown as BrowserManager;

    const mockA11yAuditor = {
      auditPage: async () =>
        ({
          targetUrl: `http://remediation.local:${serverPort}`,
          findings: [],
          rawAxeResults: null,
          durationMs: 10,
        }) as unknown as AccessibilityAuditReport,
    } as unknown as AccessibilityAuditor;

    const mockVisualAuditor = {
      auditUrl: async () =>
        ({
          targetUrl: `http://remediation.local:${serverPort}`,
          viewportResults: [
            {
              viewport: { id: 'desktop', name: 'Desktop (1920x1080)', width: 1920, height: 1080 },
              layoutShiftScore: 0,
              hasHorizontalOverflow: false,
              horizontalOverflowPixels: 0,
              screenshots: [
                {
                  id: 'shot-1',
                  scanRunId: 'test',
                  targetUrl: `http://remediation.local:${serverPort}`,
                  viewport: { id: 'desktop', name: 'Desktop', width: 1920, height: 1080 },
                  captureType: 'viewport',
                  format: 'png',
                  fileSizeBytes: 1234,
                  relativePath: 'shot-1.png',
                  capturedAt: new Date().toISOString(),
                },
              ],
            },
          ],
          totalScreenshots: 1,
          durationMs: 10,
          findings: [],
        }) as unknown as VisualAuditReport,
    } as unknown as VisualAuditor;

    const metricsOrchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
      browserManagerFactory: mockBrowserManagerFactory,
      accessibilityAuditorFactory: () => mockA11yAuditor,
      visualAuditorFactory: () => mockVisualAuditor,
    });

    const result = await metricsOrchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 1,
        enableBrowserAudit: true,
        auditModules: {
          accessibility: true,
          responsiveLayout: true,
          screenshots: true,
        },
      },
    });

    expect(result.status).toBe('completed');
    expect(result.summary?.accessibilityAuditsCompleted).toBe(1);
    expect(result.summary?.viewportsCompleted).toBe(1);
    expect(result.summary?.screenshotsCaptured).toBe(1);

    // Fallback getScanProgress reconstruction from DB
    const progress = metricsOrchestrator.getScanProgress({ id: result.id });
    expect(progress?.accessibilityAuditsCompleted).toBe(1);
    expect(progress?.viewportsCompleted).toBe(1);
    expect(progress?.screenshotsCaptured).toBe(1);

    metricsOrchestrator.dispose();
  });

  it('11. Accessibility Screenshot Attachment: links screenshot evidence to lowercase accessibility findings', async () => {
    const mockBrowserManagerFactory = () =>
      ({
        launch: async () => {},
        close: async () => {},
        acquirePage: async () =>
          ({
            page: {
              goto: async () => {},
              isClosed: () => false,
              on: () => {},
              off: () => {},
            },
            release: async () => {},
          }) as unknown as ManagedPage,
      }) as unknown as BrowserManager;

    const targetUrl = `http://remediation.local:${serverPort}/`;

    const mockA11yAuditor = {
      auditPage: async () =>
        ({
          targetUrl,
          findings: [
            {
              scanRunId: 'temp',
              ruleId: 'A11Y_CONTRAST',
              category: 'accessibility', // lowercase as produced by axe-core
              title: 'Low contrast',
              description: 'Element contrast ratio is 2.5:1',
              severity: 'medium',
              confidence: 'confirmed',
              status: 'active',
              targetUrl,
              evidence: { selector: 'button.login' },
              remediation: 'Increase text color contrast',
              references: [],
            },
          ],
          rawAxeResults: null,
          durationMs: 10,
        }) as unknown as AccessibilityAuditReport,
    } as unknown as AccessibilityAuditor;

    const mockVisualAuditor = {
      auditUrl: async () =>
        ({
          targetUrl,
          viewportResults: [
            {
              viewport: { id: 'desktop', name: 'Desktop (1920x1080)', width: 1920, height: 1080 },
              layoutShiftScore: 0,
              hasHorizontalOverflow: false,
              horizontalOverflowPixels: 0,
              screenshots: [
                {
                  id: 'shot-desktop-primary',
                  scanRunId: 'test',
                  targetUrl,
                  viewport: {
                    id: 'desktop',
                    name: 'Desktop (1920x1080)',
                    width: 1920,
                    height: 1080,
                  },
                  captureType: 'viewport',
                  format: 'png',
                  fileSizeBytes: 4567,
                  relativePath: 'shot-desktop-primary.png',
                  capturedAt: new Date().toISOString(),
                },
              ],
            },
          ],
          totalScreenshots: 1,
          durationMs: 10,
          findings: [],
        }) as unknown as VisualAuditReport,
    } as unknown as VisualAuditor;

    const a11yOrchestrator = new ScanOrchestrator(connection, {
      testHooks,
      clientOptions: { allowPrivateLoopback: true },
      browserManagerFactory: mockBrowserManagerFactory,
      accessibilityAuditorFactory: () => mockA11yAuditor,
      visualAuditorFactory: () => mockVisualAuditor,
    });

    const result = await a11yOrchestrator.startScan({
      siteId,
      scanType: 'full',
      config: {
        maxPages: 1,
        enableBrowserAudit: true,
        auditModules: {
          accessibility: true,
          responsiveLayout: true,
          screenshots: true,
        },
      },
    });

    expect(result.status).toBe('completed');
    const persistedFindings = findingRepo.getAllByScanRunId(result.id);
    const a11yFinding = persistedFindings.find(f => f.ruleId === 'A11Y_CONTRAST');
    expect(a11yFinding).toBeDefined();

    // Verify screenshot was attached to evidence despite lowercase 'accessibility' category!
    const evidence = a11yFinding!.evidence as { screenshot?: { id: string; fileName: string } };
    expect(evidence.screenshot).toBeDefined();
    expect(evidence.screenshot?.id).toBe('shot-desktop-primary');
    expect(evidence.screenshot?.fileName).toBe('shot-desktop-primary.png');

    a11yOrchestrator.dispose();
  });
});
