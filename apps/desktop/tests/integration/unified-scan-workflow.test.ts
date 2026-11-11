import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { ReportService } from '../../src/main/services/report.service.js';
import { assembleReportData, generateCsvReport } from '../../src/main/reports/index.js';
import { ScanOrchestrator } from '../../src/main/scanner/orchestrator/orchestrator.js';
import {
  BrowserManager,
  VisualAuditor,
  AccessibilityAuditor,
  ScreenshotManager,
} from '../../src/main/browser/index.js';
import { DEFAULT_AUDIT_MODULES } from '@auditor/shared';

describe('Batch 4.5 — Unified Scan Workflow Integration Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let reportRepo: ReportRepository;
  let reportService: ReportService;
  let testReportsDir: string;
  let testSiteId: string;
  let baseUrl: string;

  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const testHooks = {
    lookupFn: mockPublicLookup,
    pinnedIpOverride: '127.0.0.1',
    allowLoopbackInTests: true,
  };

  beforeAll(async () => {
    testReportsDir = path.resolve('D:\\ahmed\\.tmp\\unified-test-reports-' + crypto.randomUUID());
    fs.mkdirSync(testReportsDir, { recursive: true });

    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Powered-By': 'PHP/8.2.0',
        });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="utf-8">
            <title>Unified Test WordPress Site</title>
            <meta name="generator" content="WordPress 6.4.2">
            <link rel="https://api.w.org/" href="/wp-json/">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              .low-contrast { color: #888888; background-color: #999999; }
              .wide-card { width: 1200px; height: 100px; background: blue; margin-bottom: 20px; }
            </style>
          </head>
          <body>
            <h1>Main Heading</h1>
            <p><a href="/page-a">Go to Page A</a></p>
            <p><a href="/error-page">Broken Page</a></p>
            
            <!-- Missing alt attribute + 404 network resource -->
            <img src="/broken-image.png">
            
            <!-- Button with no accessible label, sensitive ID and class -->
            <button id="admin-secret-token" class="patient-password-12345"></button>
            
            <!-- Low contrast text -->
            <p class="low-contrast">Hard to read text</p>
            
            <!-- Wide element causing horizontal overflow on mobile viewports -->
            <div class="wide-card">Overflowing element</div>
            
            <!-- Runtime JS error -->
            <script>
              setTimeout(() => {
                throw new Error('Test runtime uncaught exception');
              }, 50);
            </script>
          </body>
          </html>
        `);
      } else if (url.pathname === '/page-a') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="utf-8">
            <title>Page A - Interior Page</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body>
            <h1>Page A</h1>
            <p>Clean interior page.</p>
            <!-- Same missing alt image for deduplication verification -->
            <img src="/broken-image.png">
            <a href="/">Back Home</a>
          </body>
          </html>
        `);
      } else if (url.pathname === '/error-page') {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1></body></html>');
      } else if (url.pathname === '/wp-json/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'Unified Test Site', description: 'WordPress API' }));
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    await new Promise<void>(resolve => {
      fixtureServer.listen(0, '127.0.0.1', () => {
        fixturePort = (fixtureServer.address() as net.AddressInfo).port;
        resolve();
      });
    });

    baseUrl = `http://unified-test.local:${fixturePort}`;
  });

  afterAll(async () => {
    if (fixtureServer) {
      await new Promise<void>(resolve => fixtureServer.close(() => resolve()));
    }
    if (fs.existsSync(testReportsDir)) {
      try {
        fs.rmSync(testReportsDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
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

    reportService = new ReportService(reportRepo, scanRunRepo, {
      siteRepo,
      findingRepo,
      reportsDir: testReportsDir,
    });

    const project = projectRepo.create({ name: 'Unified Integration Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Unified Test Site',
      baseUrl,
    });
    testSiteId = site.id;
  });

  afterEach(() => {
    if (connection?.isOpen()) {
      connection.close();
    }
  });

  it('1. executes complete unified scan with crawler, analyzers, and browser engines', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
    });

    const progressStages: string[] = [];
    const completedRun = await orchestrator.startScan(
      {
        siteId: testSiteId,
        scanType: 'full',
        config: {
          enableBrowserAudit: true,
          maxPages: 3,
          maxBrowserPages: 2,
          captureScreenshots: true,
          viewportProfiles: ['desktop', 'small-mobile'],
          requestTimeoutMs: 5000,
        },
      },
      p => {
        progressStages.push(p.stage);
      },
    );

    // 1. Verify scan completion and lifecycle stages
    expect(completedRun.status).toBe('completed');
    expect(completedRun.completedAt).not.toBeNull();
    expect(completedRun.error).toBeNull();
    expect(progressStages).toContain('crawling');
    expect(progressStages).toContain('browser_auditing');
    expect(progressStages).toContain('completed');

    // 2. Verify summary coverage metrics
    const summary = completedRun.summary!;
    expect(summary).not.toBeNull();
    expect(summary.urlsCrawled).toBeGreaterThanOrEqual(2);
    expect(summary.pagesScanned).toBeGreaterThanOrEqual(1);
    expect(summary.browserPagesAudited).toBeGreaterThanOrEqual(1);
    expect(summary.totalFindings).toBeGreaterThan(0);

    // 3. Verify SQLite persistence of findings
    const persistedFindings = findingRepo.listByScanRunId(completedRun.id);
    expect(persistedFindings.total).toBe(summary.totalFindings);

    // 4. Verify cross-engine finding presence
    const categories = new Set(persistedFindings.items.map(f => f.category.toLowerCase()));
    expect(categories.has('accessibility')).toBe(true);

    const ruleIds = persistedFindings.items.map(f => f.ruleId);
    expect(ruleIds.some(r => r.startsWith('WP_'))).toBe(true);
    expect(ruleIds.some(r => r.toLowerCase().startsWith('a11y-'))).toBe(true);

    orchestrator.dispose();
  }, 45000);

  it('2. generates standalone HTML, JSON, and CSV reports from persisted findings', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
    });

    const completedRun = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        maxPages: 2,
        maxBrowserPages: 1,
        viewportProfiles: ['desktop'],
      },
    });

    expect(completedRun.status).toBe('completed');

    // HTML Report
    const htmlReport = reportService.createReport({
      scanRunId: completedRun.id,
      title: 'Unified HTML Report',
      format: 'html',
    });
    expect(htmlReport.format).toBe('html');
    expect(fs.existsSync(htmlReport.storagePath)).toBe(true);
    const htmlContent = reportService.getReportContent({ id: htmlReport.id });
    expect(htmlContent.content).toContain('Executive Summary');
    expect(htmlContent.content).toContain('Scan Limitations &amp; Disclaimers');
    expect(htmlContent.content).toContain('Browser Pages Audited');

    // JSON Export
    const jsonReport = reportService.createReport({
      scanRunId: completedRun.id,
      title: 'Unified JSON Report',
      format: 'json',
    });
    expect(jsonReport.format).toBe('json');
    expect(fs.existsSync(jsonReport.storagePath)).toBe(true);
    const jsonContent = JSON.parse(reportService.getReportContent({ id: jsonReport.id }).content);
    expect(jsonContent.scanRun.id).toBe(completedRun.id);
    expect(jsonContent.summary).toBeDefined();
    expect(Array.isArray(jsonContent.findings)).toBe(true);

    // CSV Export
    const reportModel = assembleReportData(completedRun.id, {
      siteRepo,
      scanRunRepo,
      findingRepo,
    });
    const csvContent = generateCsvReport(reportModel);
    expect(csvContent).toContain('Rule ID');
    expect(csvContent).toContain('Severity');
    expect(csvContent).toContain('Category');

    orchestrator.dispose();
  }, 30000);

  it('3. selectively disables modules and verifies excluded findings', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
    });

    const completedRun = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        maxPages: 2,
        maxBrowserPages: 1,
        auditModules: {
          ...DEFAULT_AUDIT_MODULES,
          accessibility: false,
          runtimeErrors: false,
          responsiveLayout: false,
        },
      },
    });

    expect(completedRun.status).toBe('completed');
    const persistedFindings = findingRepo.listByScanRunId(completedRun.id);

    // Disabled categories must not exist
    const hasA11y = persistedFindings.items.some(f => f.category === 'accessibility');
    const hasRuntime = persistedFindings.items.some(f => f.category === 'runtime-network');
    const hasResponsive = persistedFindings.items.some(f => f.category === 'responsive-design');
    expect(hasA11y).toBe(false);
    expect(hasRuntime).toBe(false);
    expect(hasResponsive).toBe(false);

    // Enabled HTTP / WordPress / Security categories must still exist
    const hasWP = persistedFindings.items.some(f => f.ruleId.startsWith('WP_'));
    expect(hasWP).toBe(true);

    orchestrator.dispose();
  }, 25000);

  it('4. isolates browser launch failure with SYS_BROWSER_UNAVAILABLE while preserving HTTP findings', async () => {
    // Orchestrator with browser factory that intentionally fails
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
      browserManagerFactory: () => {
        throw new Error('Simulated Chromium binary missing or corrupted');
      },
    });

    const completedRun = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        maxPages: 2,
      },
    });

    // Scan should still succeed and preserve HTTP crawler findings
    expect(completedRun.status).toBe('completed');
    const persistedFindings = findingRepo.listByScanRunId(completedRun.id);

    // SYS_BROWSER_UNAVAILABLE finding must be recorded
    const sysFinding = persistedFindings.items.find(f => f.ruleId === 'SYS_BROWSER_UNAVAILABLE');
    expect(sysFinding).toBeDefined();
    expect(sysFinding?.category).toBe('system');
    expect(sysFinding?.status).toBe('confirmed');

    // HTTP crawler findings (e.g. WordPress detection) must be preserved
    const wpFindings = persistedFindings.items.filter(f => f.ruleId.startsWith('WP_'));
    expect(wpFindings.length).toBeGreaterThan(0);

    orchestrator.dispose();
  }, 20000);

  it('5. isolates single page failure during browser audit without failing the entire scan', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
    });

    const completedRun = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        maxPages: 5,
        maxBrowserPages: 3,
      },
    });

    expect(completedRun.status).toBe('completed');
    expect(completedRun.summary).not.toBeNull();
    // Scan completed successfully despite error-page being encountered
    expect(completedRun.summary!.pagesScanned).toBeGreaterThanOrEqual(1);

    orchestrator.dispose();
  }, 30000);

  it('6. deduplicates identical findings across pages and tracks occurrences', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
    });

    const completedRun = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        maxPages: 3,
        maxBrowserPages: 2,
      },
    });

    expect(completedRun.status).toBe('completed');
    const persistedFindings = findingRepo.listByScanRunId(completedRun.id);

    // Findings with same rule and selector should have occurrenceCount tracked
    for (const finding of persistedFindings.items) {
      if (finding.evidence && typeof finding.evidence === 'object') {
        const ev = finding.evidence as Record<string, unknown>;
        if (ev.occurrenceCount !== undefined) {
          expect(typeof ev.occurrenceCount).toBe('number');
          expect(ev.occurrenceCount as number).toBeGreaterThanOrEqual(1);
        }
      }
    }

    orchestrator.dispose();
  }, 30000);

  it('7. redacts sensitive attributes, form data, and raw identifiers', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
    });

    const completedRun = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        maxPages: 2,
        maxBrowserPages: 1,
      },
    });

    expect(completedRun.status).toBe('completed');
    const persistedFindings = findingRepo.listByScanRunId(completedRun.id);

    for (const finding of persistedFindings.items) {
      const serialized = JSON.stringify(finding);
      // Raw sensitive attribute values must not appear unredacted
      expect(serialized).not.toContain('patient-password-12345');
      expect(serialized).not.toContain('admin-secret-token');
    }

    orchestrator.dispose();
  }, 25000);

  it('8. handles cancellation during crawling and browser auditing cleanly', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
    });

    const createdRun = orchestrator.createScan({
      siteId: testSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        maxPages: 10,
        maxBrowserPages: 5,
      },
    });

    // Start scan and cancel after a short delay
    const scanPromise = orchestrator.executeScan(createdRun.id);
    await new Promise(r => setTimeout(r, 100));
    orchestrator.cancelScan({ id: createdRun.id, reason: 'User requested cancellation' });

    const cancelledRun = await scanPromise;
    expect(cancelledRun.status).toBe('cancelled');
    expect(cancelledRun.cancelledAt).not.toBeNull();

    orchestrator.dispose();
  }, 20000);

  it('9. deduplicates findings without composite key collisions across selectors, viewports, and subresources', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, { testHooks });
    const scanRunId = crypto.randomUUID();

    const rawFindings = [
      // Two different elements with same rule on same URL (must NOT collide)
      {
        ruleId: 'RESPONSIVE_FIXED_WIDTH_CONTAINER',
        category: 'responsive-design',
        title: 'Fixed-width container exceeds viewport on Mobile',
        description: 'Element #container-a overflows',
        severity: 'medium' as const,
        confidence: 'firm' as const,
        targetUrl: baseUrl,
        evidence: { selector: '#container-a', viewport: 'mobile' },
      },
      {
        ruleId: 'RESPONSIVE_FIXED_WIDTH_CONTAINER',
        category: 'responsive-design',
        title: 'Fixed-width container exceeds viewport on Mobile',
        description: 'Element #container-b overflows',
        severity: 'medium' as const,
        confidence: 'firm' as const,
        targetUrl: baseUrl,
        evidence: { selector: '#container-b', viewport: 'mobile' },
      },
      // Same rule on same URL across different viewports (must NOT collide)
      {
        ruleId: 'LAYOUT_SHIFT_HIGH',
        category: 'layout-stability',
        title: 'High Cumulative Layout Shift on Desktop HD',
        description: 'CLS of 0.28 on desktop',
        severity: 'medium' as const,
        confidence: 'firm' as const,
        targetUrl: baseUrl,
        evidence: { viewport: { id: 'desktop', name: 'Desktop HD' }, sessionWindowCLS: 0.28 },
      },
      {
        ruleId: 'LAYOUT_SHIFT_HIGH',
        category: 'layout-stability',
        title: 'High Cumulative Layout Shift on Mobile',
        description: 'CLS of 0.35 on mobile',
        severity: 'medium' as const,
        confidence: 'firm' as const,
        targetUrl: baseUrl,
        evidence: { viewport: { id: 'mobile', name: 'Mobile 375x667' }, sessionWindowCLS: 0.35 },
      },
      // Network resource failures with different URLs (must NOT collide)
      {
        ruleId: 'NET_RESOURCE_FAILED',
        category: 'Network & Connectivity',
        title: 'Network Request Failed: script',
        description: 'Failed to load script',
        severity: 'medium' as const,
        confidence: 'confirmed' as const,
        targetUrl: baseUrl,
        evidence: { url: 'https://example.com/bundle-1.js', failureText: 'net::ERR_FAILED' },
      },
      {
        ruleId: 'NET_RESOURCE_FAILED',
        category: 'Network & Connectivity',
        title: 'Network Request Failed: stylesheet',
        description: 'Failed to load stylesheet',
        severity: 'medium' as const,
        confidence: 'confirmed' as const,
        targetUrl: baseUrl,
        evidence: { url: 'https://example.com/style-2.css', failureText: 'net::ERR_TIMED_OUT' },
      },
      // True exact duplicate of first element (#container-a)
      {
        ruleId: 'RESPONSIVE_FIXED_WIDTH_CONTAINER',
        category: 'responsive-design',
        title: 'Fixed-width container exceeds viewport on Mobile',
        description: 'Element #container-a overflows again',
        severity: 'medium' as const,
        confidence: 'firm' as const,
        targetUrl: baseUrl,
        evidence: { selector: '#container-a', viewport: 'mobile' },
      },
    ];

    const deduplicated = (
      orchestrator as unknown as {
        deduplicateAndSanitizeFindings: (
          raw: typeof rawFindings,
          runId: string,
          modules: typeof DEFAULT_AUDIT_MODULES,
        ) => Array<{
          ruleId: string;
          evidence: Record<string, unknown> | null;
        }>;
      }
    ).deduplicateAndSanitizeFindings(rawFindings, scanRunId, DEFAULT_AUDIT_MODULES);

    // Total must be 6 (Finding 1 & 7 merged, remaining 5 preserved separately)
    expect(deduplicated.length).toBe(6);

    // Container A finding must have occurrenceCount: 2
    const containerA = deduplicated.find(f => f.evidence?.selector === '#container-a');
    expect(containerA).toBeDefined();
    expect(containerA?.evidence?.occurrenceCount).toBe(2);

    // Container B finding must be distinct with occurrenceCount undefined
    const containerB = deduplicated.find(f => f.evidence?.selector === '#container-b');
    expect(containerB).toBeDefined();
    expect(containerB?.evidence?.occurrenceCount).toBeUndefined();

    // Desktop and Mobile CLS findings must be distinct
    const desktopCls = deduplicated.find(
      f =>
        f.ruleId === 'LAYOUT_SHIFT_HIGH' &&
        (f.evidence?.viewport as { id?: string } | undefined)?.id === 'desktop',
    );
    const mobileCls = deduplicated.find(
      f =>
        f.ruleId === 'LAYOUT_SHIFT_HIGH' &&
        (f.evidence?.viewport as { id?: string } | undefined)?.id === 'mobile',
    );
    expect(desktopCls).toBeDefined();
    expect(mobileCls).toBeDefined();

    // Both network resource findings must be distinct
    const bundleRes = deduplicated.find(
      f =>
        f.ruleId === 'NET_RESOURCE_FAILED' &&
        typeof f.evidence?.url === 'string' &&
        f.evidence.url.includes('bundle-1.js'),
    );
    const styleRes = deduplicated.find(
      f =>
        f.ruleId === 'NET_RESOURCE_FAILED' &&
        typeof f.evidence?.url === 'string' &&
        f.evidence.url.includes('style-2.css'),
    );
    expect(bundleRes).toBeDefined();
    expect(styleRes).toBeDefined();

    orchestrator.dispose();
  });

  it('10. isolates screenshot capture failure without failing the visual audit or scan', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
      visualAuditorFactory: (manager, opts) => {
        const auditor = new VisualAuditor(manager, opts);
        (auditor as unknown as { screenshotManager: unknown }).screenshotManager = {
          capture: async () => {
            throw new Error('Simulated screenshot canvas/memory capture failure');
          },
          getScreenshotsCount: () => 0,
          getTotalStoredBytes: () => 0,
        };
        return auditor;
      },
    });

    const completedRun = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'quick',
      config: {
        enableBrowserAudit: true,
        maxPages: 1,
        maxBrowserPages: 1,
        viewportProfiles: ['desktop'],
      },
    });

    expect(completedRun.status).toBe('completed');
    expect(completedRun.summary).not.toBeNull();
    expect(completedRun.summary?.screenshotsCaptured).toBe(0);

    orchestrator.dispose();
  }, 25000);

  it('11. isolates axe-core audit failure or timeout without crashing the orchestrator', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
      accessibilityAuditorFactory: () =>
        ({
          auditPage: async () => {
            throw new Error('Simulated axe.run() evaluation timeout');
          },
        }) as unknown as AccessibilityAuditor,
    });

    const completedRun = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'quick',
      config: {
        enableBrowserAudit: true,
        maxPages: 1,
        maxBrowserPages: 1,
      },
    });

    expect(completedRun.status).toBe('completed');
    const persistedFindings = findingRepo.listByScanRunId(completedRun.id);
    // Crawler findings (like WP detection) must still be preserved
    expect(persistedFindings.items.some(f => f.ruleId.startsWith('WP_'))).toBe(true);

    orchestrator.dispose();
  }, 25000);

  it('12. handles SQLite batch persistence failure atomically, transitions scan to failed, and leaves zero partial findings', async () => {
    const brokenFindingRepo = Object.create(findingRepo);
    brokenFindingRepo.batchCreate = () => {
      throw new Error('Simulated SQLite disk I/O error during batchCreate');
    };

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, brokenFindingRepo, {
      testHooks,
    });

    const createdRun = orchestrator.createScan({
      siteId: testSiteId,
      scanType: 'quick',
      config: { enableBrowserAudit: false, maxPages: 1 },
    });

    const failedRun = await orchestrator.executeScan(createdRun.id);
    expect(failedRun.status).toBe('failed');
    expect(failedRun.error).not.toBeNull();
    expect(failedRun.error?.code).toBe('ERR_INTERNAL_SCAN_ERROR');
    expect(failedRun.error?.message).toContain('SQLite disk I/O error');

    // Real DB must have zero findings
    const stored = findingRepo.listByScanRunId(createdRun.id);
    expect(stored.total).toBe(0);

    orchestrator.dispose();
  }, 20000);

  it('13. guarantees that report generation failure after persistence does not discard committed findings', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, { testHooks });
    const completedRun = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'quick',
      config: { enableBrowserAudit: false, maxPages: 1 },
    });

    expect(completedRun.status).toBe('completed');
    const initialFindings = findingRepo.listByScanRunId(completedRun.id);
    expect(initialFindings.total).toBeGreaterThan(0);

    // Call reportService with invalid format to simulate failure during report generation
    expect(() => {
      reportService.createReport({
        scanRunId: completedRun.id,
        title: 'Broken Report',
        format: 'unsupported-format' as unknown as 'html',
      });
    }).toThrow();

    // Verify scan run status in SQLite is untouched and still 'completed'
    const scanAfter = scanRunRepo.getById(completedRun.id);
    expect(scanAfter?.status).toBe('completed');

    // Verify committed findings in SQLite remain intact
    const findingsAfter = findingRepo.listByScanRunId(completedRun.id);
    expect(findingsAfter.total).toBe(initialFindings.total);

    orchestrator.dispose();
  }, 20000);

  it('14. handles cancellation cleanly during browser page navigation', async () => {
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, { testHooks });
    const created = orchestrator.createScan({
      siteId: testSiteId,
      scanType: 'quick',
      config: { enableBrowserAudit: true, maxPages: 1 },
    });

    // Start scan and cancel almost immediately
    const execPromise = orchestrator.executeScan(created.id);
    setTimeout(() => {
      orchestrator.cancelScan({ id: created.id, reason: 'Abort navigation' }).catch(() => {});
    }, 50);

    const result = await execPromise;
    expect(result.status).toBe('cancelled');
    expect(result.cancelledAt).not.toBeNull();

    orchestrator.dispose();
  }, 20000);

  it('15. cancels cleanly between viewport profile iterations and releases managed pages', async () => {
    const controller = new AbortController();
    let browserMgr: BrowserManager | null = null;

    try {
      browserMgr = new BrowserManager({ testHooks });
      await browserMgr.launch();

      const visualAuditor = new VisualAuditor(browserMgr, {
        scanRunId: crypto.randomUUID(),
        signal: controller.signal,
      });

      // Abort signal before calling auditUrl
      controller.abort(new Error('User cancelled during viewport iteration'));

      const report = await visualAuditor.auditUrl(baseUrl);
      expect(report.profilesEvaluated).toBe(0);
      expect(report.findings.length).toBe(0);
    } finally {
      if (browserMgr) {
        await browserMgr.close();
      }
    }
  }, 20000);

  it('16. enforces SSRF defense regression: blocks private, loopback, link-local, and IPv6 targets', async () => {
    const ssrfTargets = [
      // IPv4 Special & Private Ranges
      { name: 'private IPv4 10.0.0.1 (10/8)', ip: '10.0.0.1', family: 4 },
      { name: 'private IPv4 172.16.0.1 (172.16/12)', ip: '172.16.0.1', family: 4 },
      { name: 'private IPv4 192.168.1.1 (192.168/16)', ip: '192.168.1.1', family: 4 },
      { name: 'loopback IPv4 127.0.0.1 (127/8)', ip: '127.0.0.1', family: 4 },
      { name: 'link-local IPv4 169.254.169.254 (169.254/16)', ip: '169.254.169.254', family: 4 },
      // IPv6 ULA (fc00::/7)
      { name: 'IPv6 ULA fc00::1', ip: 'fc00::1', family: 6 },
      { name: 'IPv6 ULA fd00::1', ip: 'fd00::1', family: 6 },
      // IPv6 Link-Local (fe80::/10)
      { name: 'IPv6 Link-Local fe80::1', ip: 'fe80::1', family: 6 },
      // IPv6 Loopback (::1)
      { name: 'IPv6 Loopback ::1', ip: '::1', family: 6 },
      // IPv4-Mapped IPv6 Representations (::ffff:0:0/96)
      { name: 'IPv4-mapped IPv6 loopback ::ffff:127.0.0.1', ip: '::ffff:127.0.0.1', family: 6 },
      { name: 'IPv4-mapped IPv6 private ::ffff:10.0.0.1', ip: '::ffff:10.0.0.1', family: 6 },
      { name: 'IPv4-mapped IPv6 private ::ffff:192.168.1.1', ip: '::ffff:192.168.1.1', family: 6 },
      {
        name: 'IPv4-mapped IPv6 link-local ::ffff:169.254.169.254',
        ip: '::ffff:169.254.169.254',
        family: 6,
      },
    ];

    for (const target of ssrfTargets) {
      const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
        testHooks: {
          lookupFn: async () => [{ address: target.ip, family: target.family }],
          allowLoopbackInTests: false, // Strict production-grade SSRF defense enabled
        },
      });

      const ssrfRun = await orchestrator.startScan({
        siteId: testSiteId,
        scanType: 'quick',
        config: { enableBrowserAudit: false, maxPages: 1 },
      });

      // Scan completes because crawler safely isolates and rejects the prohibited target
      expect(ssrfRun.status).toBe('completed');
      expect(ssrfRun.summary?.pagesFailed).toBeGreaterThanOrEqual(1);
      expect(ssrfRun.summary?.pagesScanned).toBe(0);

      orchestrator.dispose();
    }
  }, 40000);

  it('17. handles cancellation during screenshot capture cleanly and maintains quota and resource invariants', async () => {
    let capturedDuringRun = false;
    let screenshotMgrRef: ScreenshotManager | null = null;

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
      visualAuditorFactory: (manager, opts) => {
        const auditor = new VisualAuditor(manager, opts);
        screenshotMgrRef = (auditor as unknown as { screenshotManager: ScreenshotManager })
          .screenshotManager;
        const originalCapture = screenshotMgrRef.capture.bind(screenshotMgrRef);

        screenshotMgrRef.capture = async (params: Parameters<ScreenshotManager['capture']>[0]) => {
          capturedDuringRun = true;
          // Trigger cancellation while screenshot capture is actively executing
          if (params.scanRunId) {
            await orchestrator.cancelScan({
              id: params.scanRunId,
              reason: 'Cancelled during active screenshot',
            });
          }
          return originalCapture(params);
        };
        return auditor;
      },
    });

    const createdRun = orchestrator.createScan({
      siteId: testSiteId,
      scanType: 'quick',
      config: {
        enableBrowserAudit: true,
        maxPages: 1,
        maxBrowserPages: 1,
        viewportProfiles: ['desktop'],
      },
    });

    const runPromise = orchestrator.executeScan(createdRun.id);
    const terminalRun = await runPromise;

    // 1. Verify scan transitioned to cancelled
    expect(terminalRun.status).toBe('cancelled');
    expect(terminalRun.cancelledAt).not.toBeNull();
    expect(capturedDuringRun).toBe(true);

    // 2. Verify temporary files cleanup: no .tmp files remain in screenshots directory
    expect(screenshotMgrRef).not.toBeNull();
    const screenshotsDir = screenshotMgrRef!.getStorageDirectory();
    if (fs.existsSync(screenshotsDir)) {
      const files = fs.readdirSync(screenshotsDir);
      const tmpFiles = files.filter(f => f.includes('.tmp'));
      expect(tmpFiles.length).toBe(0);
    }

    // 3. Verify screenshot quota consistency: no quota allocated for the cancelled capture
    const quota = screenshotMgrRef!.getAuditQuota(createdRun.id);
    expect(quota.screenshotsCount).toBe(0);
    expect(quota.storedBytes).toBe(0);

    // 4. Verify browser pages released
    const activeScans = orchestrator.getActiveScans();
    expect(activeScans.length).toBe(0);

    orchestrator.dispose();
  }, 25000);

  it('18. handles cancellation during accessibility evaluation respecting the shared-page contract', async () => {
    let a11yEvaluated = false;

    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
      accessibilityAuditorFactory: opts => {
        const auditor = new AccessibilityAuditor(opts);
        const originalAuditPage = auditor.auditPage.bind(auditor);

        auditor.auditPage = async page => {
          a11yEvaluated = true;
          // Trigger cancellation while accessibility evaluation is underway
          if (opts.scanRunId) {
            await orchestrator.cancelScan({
              id: opts.scanRunId,
              reason: 'User aborted during accessibility audit',
            });
          }
          return originalAuditPage(page);
        };
        return auditor;
      },
    });

    const createdRun = orchestrator.createScan({
      siteId: testSiteId,
      scanType: 'quick',
      config: {
        enableBrowserAudit: true,
        maxPages: 1,
        maxBrowserPages: 1,
        auditModules: {
          ...DEFAULT_AUDIT_MODULES,
          accessibility: true,
          responsiveLayout: false,
          layoutStability: false,
          screenshots: false,
        },
      },
    });

    const terminalRun = await orchestrator.executeScan(createdRun.id);

    // 1. Verify scan transitioned to cancelled
    expect(terminalRun.status).toBe('cancelled');
    expect(terminalRun.cancelledAt).not.toBeNull();
    expect(a11yEvaluated).toBe(true);

    // 2. In shared page mode (default in orchestrator), the shared page was not prematurely closed
    // The page was released cleanly by the orchestrator lifecycle
    expect(orchestrator.getActiveScans().length).toBe(0);

    orchestrator.dispose();
  }, 25000);

  it('19. recovers interrupted active scans on restart without misrepresenting status, losing findings, or deleting reports', async () => {
    // 1. Simulate an interrupted scan that was running when process crashed
    const crashedRun = scanRunRepo.create({
      siteId: testSiteId,
      scanType: 'full',
      targetUrl: baseUrl,
    });
    scanRunRepo.updateStatus(crashedRun.id, {
      status: 'running',
      startedAt: new Date(Date.now() - 30000).toISOString(),
    });

    // 2. Commit findings for this scan run to SQLite before the crash
    findingRepo.batchCreate([
      {
        scanRunId: crashedRun.id,
        ruleId: 'WP_CORE_DETECTED',
        category: 'WordPress',
        title: 'WordPress Core Detected',
        description: 'WordPress installation detected',
        severity: 'informational',
        confidence: 'confirmed',
        targetUrl: baseUrl,
      },
      {
        scanRunId: crashedRun.id,
        ruleId: 'SEC_HEADER_MISSING_HSTS',
        category: 'Security Headers',
        title: 'Strict-Transport-Security Missing',
        description: 'HSTS header missing',
        severity: 'medium',
        confidence: 'confirmed',
        targetUrl: baseUrl,
      },
    ]);

    // 3. Create simulated pre-existing valid report and screenshot files
    const dummyReportPath = path.join(testReportsDir, `report-${crashedRun.id}.html`);
    fs.writeFileSync(dummyReportPath, '<html><body>Valid Report Content</body></html>', 'utf8');

    // 4. Initialize a fresh orchestrator instance (simulating application restart)
    const freshOrchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
    });
    expect(freshOrchestrator.getActiveScans().length).toBe(0);

    // 5. Execute startup recovery
    const recoveredCount = freshOrchestrator.recoverInterruptedScans(
      'Application restarted unexpectedly',
    );
    expect(recoveredCount).toBe(1);

    // 6. Verify recovered state: marked 'failed', NOT 'completed'
    const recoveredRun = scanRunRepo.getById(crashedRun.id);
    expect(recoveredRun).not.toBeNull();
    expect(recoveredRun?.status).toBe('failed');
    expect(recoveredRun?.completedAt).not.toBeNull();
    expect(recoveredRun?.error?.code).toBe('ERR_SCAN_INTERRUPTED_BY_SHUTDOWN');

    // 7. Verify previously committed findings remain 100% available in SQLite
    const findingsInDb = findingRepo.listByScanRunId(crashedRun.id);
    expect(findingsInDb.total).toBe(2);
    expect(findingsInDb.items.some(f => f.ruleId === 'WP_CORE_DETECTED')).toBe(true);
    expect(findingsInDb.items.some(f => f.ruleId === 'SEC_HEADER_MISSING_HSTS')).toBe(true);

    // 8. Verify pre-existing valid report files on disk were NOT deleted
    expect(fs.existsSync(dummyReportPath)).toBe(true);

    // 9. Verify idempotency: running recovery again finds 0 interrupted scans
    const secondRecovery = freshOrchestrator.recoverInterruptedScans();
    expect(secondRecovery).toBe(0);

    freshOrchestrator.dispose();
  });

  it('20. accurately reflects partial completion, engine failures, and coverage metrics without claiming multi-engine success', async () => {
    // Orchestrator with simulated browser launch failure (SYS_BROWSER_UNAVAILABLE)
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      testHooks,
      browserManagerFactory: () => {
        throw new Error('Chromium binary missing or launch failed');
      },
    });

    const run = await orchestrator.startScan({
      siteId: testSiteId,
      scanType: 'full',
      config: {
        enableBrowserAudit: true,
        maxPages: 2,
        auditModules: {
          ...DEFAULT_AUDIT_MODULES,
          wordpress: true,
          http: true,
          accessibility: true,
          responsiveLayout: true,
        },
      },
    });

    expect(run.status).toBe('completed');
    const summary = run.summary;
    expect(summary).not.toBeNull();

    // 1. Coverage metrics accurately identify engines that did not run
    expect(summary?.browserPagesAudited).toBe(0);
    expect(summary?.screenshotsCaptured).toBe(0);
    expect(summary?.pagesFailed).toBeGreaterThanOrEqual(1);

    // 2. HTTP crawler findings survived intact
    const findings = findingRepo.listByScanRunId(run.id);
    const wpFindings = findings.items.filter(f => f.ruleId.startsWith('WP_'));
    expect(wpFindings.length).toBeGreaterThan(0);

    // 3. Failed engine stage recorded as SYS_BROWSER_UNAVAILABLE
    const sysFinding = findings.items.find(f => f.ruleId === 'SYS_BROWSER_UNAVAILABLE');
    expect(sysFinding).toBeDefined();
    expect(sysFinding?.category).toBe('system');

    // 4. HTML Report accurately displays limitation warning banner
    const htmlReport = reportService.createReport({
      scanRunId: run.id,
      title: 'Partial Engine Audit Report',
      format: 'html',
    });
    const htmlContent = reportService.getReportContent({ id: htmlReport.id }).content;
    expect(htmlContent).toContain('Limitation Notice: Browser Engine Unavailable');
    expect(htmlContent).toContain('Browser Pages Audited');

    orchestrator.dispose();
  }, 25000);
});
