/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock('electron', () => ({
  app: undefined,
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
  },
}));

import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { ProjectService } from '../../src/main/services/project.service.js';
import { SiteService } from '../../src/main/services/site.service.js';
import { ScanRunService } from '../../src/main/services/scan-run.service.js';
import { FindingService } from '../../src/main/services/finding.service.js';
import { ReportService } from '../../src/main/services/report.service.js';
import { ScanOrchestrator } from '../../src/main/scanner/orchestrator/orchestrator.js';
import { SecureIpcDispatcher } from '../../src/main/ipc/dispatcher.js';
import { registerDatabaseIpcHandlers } from '../../src/main/ipc/project-site-handlers.js';
import { registerScanHandlers } from '../../src/main/ipc/scan-handlers.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { SecurityWebRequestManager } from '../../src/main/security/csp.js';
import { createElectronAPI } from '../../src/preload/index.js';
import type { ElectronAPI } from '../../src/common/ipc/contracts.js';
import type { CrawlResult } from '../../src/main/scanner/crawler/types.js';
import type { AnalyzerEngineResult } from '../../src/main/scanner/analyzers/analyzer-engine.js';
import type { NormalizedFinding } from '../../src/main/scanner/analyzers/types.js';

describe('Phase 3 — Batch 3.7: End-to-End Scan Integration Workflow', () => {
  let connection: DatabaseConnection;
  let dispatcher: SecureIpcDispatcher;
  let orchestrator: ScanOrchestrator;
  let findingRepo: FindingRepository;
  let scanRunRepo: ScanRunRepository;
  let api: ElectronAPI;
  let crawlerBlocker: Promise<void> | null = null;
  let crawlerUnblocker: (() => void) | null = null;

  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  let cleanups: (() => void)[] = [];

  const mockIpcMain = {
    handle: vi.fn(
      (channel: string, listener: (event: unknown, payload: unknown) => Promise<unknown>) => {
        handlers.set(channel, listener);
      },
    ),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };

  beforeEach(async () => {
    handlers.clear();
    cleanups = [];
    crawlerBlocker = null;
    crawlerUnblocker = null;

    // 1. In-memory SQLite with migrations
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    // 2. Repositories
    const projectRepo = new ProjectRepository(connection);
    const siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);
    const reportRepo = new ReportRepository(connection);

    // 3. Domain Services
    const projectService = new ProjectService(projectRepo);
    const siteService = new SiteService(siteRepo, projectRepo);
    const scanRunService = new ScanRunService(scanRunRepo, siteRepo);
    const findingService = new FindingService(findingRepo, scanRunRepo);
    const reportService = new ReportService(reportRepo, scanRunRepo, {
      siteRepo,
      findingRepo,
      reportsDir: 'D:\\ahmed\\.tmp\\e2e-reports',
    });

    // 4. Mock Crawler Factory for Controlled Scan Execution
    const mockCrawlerFactory = () => {
      return {
        crawl: vi.fn(async () => {
          if (crawlerBlocker) {
            await crawlerBlocker;
          }
          const result: CrawlResult = {
            summary: {
              entryUrl: 'https://test-site.com',
              authorizedOrigin: 'https://test-site.com',
              totalPagesAttempted: 3,
              successfulPages: 3,
              failedPages: 0,
              nonHtmlPages: 0,
              uniqueUrlsDiscovered: 5,
              urlsSkippedScope: 0,
              urlsSkippedLimits: 0,
              maxDepthReached: 1,
              durationMs: 150,
              cancelled: false,
            },
            pages: [
              {
                url: 'https://test-site.com',
                status: 200,
                headers: { 'content-type': 'text/html' },
                bodyLength: 1024,
                discoveredUrls: ['https://test-site.com/about'],
                crawlDepth: 0,
                retries: 0,
                tlsVersion: 'TLSv1.3',
              },
            ],
            discoveredUrls: ['https://test-site.com', 'https://test-site.com/about'],
            errors: [],
          };
          return result;
        }),
        abort: vi.fn(),
      } as unknown as ReturnType<
        NonNullable<ConstructorParameters<typeof ScanOrchestrator>[3]>['crawlerFactory']
      >;
    };

    // 5. Mock Analyzer Engine Factory with Realistic Evidence-Based Findings
    const mockAnalyzerFactory = () => {
      return {
        runAnalysis: vi.fn(async (): Promise<AnalyzerEngineResult> => {
          const findings: NormalizedFinding[] = [
            {
              ruleId: 'SEC-HEADER-HSTS-MISSING',
              category: 'Security Headers',
              title: 'Strict-Transport-Security Header Missing',
              description: 'The site does not instruct browsers to only use HTTPS.',
              severity: 'high',
              confidence: 'confirmed',
              status: 'active',
              targetUrl: 'https://test-site.com',
              evidence: { header: 'Strict-Transport-Security', found: false },
              remediation: 'Add Strict-Transport-Security header.',
              references: ['https://tools.ietf.org/html/rfc6797'],
            },
            {
              ruleId: 'WP-VERSION-DISCLOSED',
              category: 'WordPress',
              title: 'WordPress Generator Tag Disclosed',
              description: 'The HTML contains meta generator revealing WordPress version.',
              severity: 'medium',
              confidence: 'confirmed',
              status: 'active',
              targetUrl: 'https://test-site.com',
              evidence: { generator: 'WordPress 6.4.2' },
              remediation: 'Remove the meta generator tag.',
              references: [],
            },
            {
              ruleId: 'SEO-META-DESCRIPTION-MISSING',
              category: 'SEO',
              title: 'Meta Description Missing',
              description: 'Page lacks a description tag.',
              severity: 'low',
              confidence: 'confirmed',
              status: 'active',
              targetUrl: 'https://test-site.com',
              evidence: { metaDescription: null },
              remediation: 'Add a concise meta description.',
              references: [],
            },
          ];
          return {
            findings,
            stats: {
              totalFindings: 3,
              bySeverity: { critical: 0, high: 1, medium: 1, low: 1, info: 0 },
              byCategory: { 'Security Headers': 1, WordPress: 1, SEO: 1 },
              byConfidence: { confirmed: 3 },
              byRule: {
                'SEC-HEADER-HSTS-MISSING': 1,
                'WP-VERSION-DISCLOSED': 1,
                'SEO-META-DESCRIPTION-MISSING': 1,
              },
              pagesAnalyzed: 1,
              durationMs: 25,
              findingsTruncatedCount: 0,
              evidenceTruncatedCount: 0,
              duplicatesFilteredCount: 0,
            },
            durationMs: 25,
            errorCount: 0,
          } as unknown as AnalyzerEngineResult;
        }),
      } as unknown as ReturnType<
        NonNullable<ConstructorParameters<typeof ScanOrchestrator>[3]>['analyzerEngineFactory']
      >;
    };

    // 6. Real Orchestrator with injected factories
    orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      crawlerFactory: mockCrawlerFactory as unknown as NonNullable<
        ConstructorParameters<typeof ScanOrchestrator>[3]
      >['crawlerFactory'],
      analyzerEngineFactory: mockAnalyzerFactory as unknown as NonNullable<
        ConstructorParameters<typeof ScanOrchestrator>[3]
      >['analyzerEngineFactory'],
    });

    // 7. Secure Dispatcher
    dispatcher = new SecureIpcDispatcher({
      isDev: true,
      isPackaged: false,
      ipcMain: mockIpcMain as unknown as typeof import('electron').ipcMain,
    });

    registerDatabaseIpcHandlers(dispatcher, { projectService, siteService });
    registerScanHandlers(dispatcher, scanRunService, findingService, reportService, orchestrator);

    // 8. Register Trusted Web Contents & Preload Invoker
    const webContentsId = 910;
    const windowId = 91;
    const url = 'http://localhost:5173';
    let isWcDestroyed = false;

    const mainFrame = { url, parent: null };
    const targetSession: any = {
      webRequest: { onHeadersReceived: vi.fn() },
    };

    SecurityWebRequestManager.initialize({ isDev: true, targetSession });

    const webContents: any = {
      id: webContentsId,
      isDestroyed: vi.fn(() => isWcDestroyed),
      mainFrame,
      session: targetSession,
      once: vi.fn(),
      removeListener: vi.fn(),
    };

    const browserWindow: any = {
      id: windowId,
      isDestroyed: vi.fn(() => false),
      webContents,
      once: vi.fn(),
    };

    WindowSecurityRegistry.register(browserWindow, {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });

    cleanups.push(() => {
      isWcDestroyed = true;
      WindowSecurityRegistry.unregister(windowId);
      SecurityWebRequestManager.resetForTesting();
    });

    const validEvent = {
      sender: webContents,
      senderFrame: mainFrame,
    } as unknown as IpcMainInvokeEvent;

    const mockInvoke = async (channel: string, payload: unknown) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No IPC handler registered for channel: ${channel}`);
      }
      return handler(validEvent, payload);
    };

    api = createElectronAPI(mockInvoke);
  });

  afterEach(() => {
    if (crawlerUnblocker) {
      crawlerUnblocker();
    }
    while (cleanups.length > 0) {
      const c = cleanups.pop();
      try {
        c?.();
      } catch {
        // Safe fail-through during teardown
      }
    }
    orchestrator.dispose();
    dispatcher.teardown();
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  it('executes the complete 12-step scan, monitoring, cancellation, findings, and report workflow', async () => {
    // ----------------------------------------------------
    // Step 1: Create a Project
    // ----------------------------------------------------
    const createProjectRes = await api.createProject({
      name: 'Acme Test Corp',
      description: 'End-to-End integration test workspace',
    });
    expect(createProjectRes.success).toBe(true);
    if (!createProjectRes.success) return;
    const project = createProjectRes.data;
    expect(project.name).toBe('Acme Test Corp');

    // ----------------------------------------------------
    // Step 2: Create a Site under Project
    // ----------------------------------------------------
    const createSiteRes = await api.createSite({
      projectId: project.id,
      name: 'Production Store',
      baseUrl: 'https://test-site.com',
      platformType: 'wordpress',
      environmentType: 'production',
    });
    expect(createSiteRes.success).toBe(true);
    if (!createSiteRes.success) return;
    const site = createSiteRes.data;
    expect(site.baseUrl).toBe('https://test-site.com/');

    // ----------------------------------------------------
    // Step 3: Validate bounded scan inputs (rejection of out-of-bounds / invalid limits)
    // ----------------------------------------------------
    const invalidScanRes = await api.createScanRun({
      siteId: site.id,
      config: { maxPages: 0 }, // Out of bounds (< 1)
    });
    expect(invalidScanRes.success).toBe(false);

    // ----------------------------------------------------
    // Step 4 & 5: Start a scan and verify initial pending/running state
    // ----------------------------------------------------
    crawlerBlocker = new Promise<void>(resolve => {
      crawlerUnblocker = resolve;
    });

    const scan1Res = await api.createScanRun({
      siteId: site.id,
      scanType: 'full',
      config: { maxPages: 10, maxDepth: 2 },
    });
    expect(scan1Res.success).toBe(true);
    if (!scan1Res.success) return;
    const scan1 = scan1Res.data;
    expect(scan1.status).toBe('pending');
    expect(scan1.siteId).toBe(site.id);

    // ----------------------------------------------------
    // Step 6: Observe actual progress via getScanProgress
    // ----------------------------------------------------
    const progress1Res = await api.getScanProgress({ id: scan1.id });
    expect(progress1Res.success).toBe(true);
    if (!progress1Res.success) return;
    expect(progress1Res.data.scanId).toBe(scan1.id);

    // ----------------------------------------------------
    // Step 7: Cancel an active in-flight scan and verify its final cancelled state
    // ----------------------------------------------------
    const cancelRes = await api.cancelScanRun({ id: scan1.id });
    expect(cancelRes.success).toBe(true);
    if (!cancelRes.success) return;
    expect(cancelRes.data.status).toBe('cancelled');
    expect(cancelRes.data.cancelledAt).not.toBeNull();

    if (crawlerUnblocker) {
      crawlerUnblocker();
      crawlerBlocker = null;
      crawlerUnblocker = null;
    }

    // ----------------------------------------------------
    // Step 8: Start another scan and allow it to complete through the pipeline
    // ----------------------------------------------------
    const scan2 = orchestrator.createScan({
      siteId: site.id,
      targetUrl: site.baseUrl,
      scanType: 'full',
      config: { maxPages: 10, maxDepth: 2 },
    });
    expect(scan2.status).toBe('pending');

    // Execute scan pipeline to completion
    const completedScan = await orchestrator.executeScan(scan2.id);
    expect(completedScan.status).toBe('completed');
    expect(completedScan.completedAt).not.toBeNull();
    expect(completedScan.durationMs).toBeGreaterThan(0);
    expect(completedScan.summary?.totalFindings).toBe(3);

    // ----------------------------------------------------
    // Step 9: Open and inspect findings for the completed scan
    // ----------------------------------------------------
    const findingsRes = await api.listFindings({ scanRunId: scan2.id });
    expect(findingsRes.success).toBe(true);
    if (!findingsRes.success) return;

    expect(findingsRes.data.total).toBe(3);
    const findingsList = findingsRes.data.items;

    // Verify findings severity breakdown
    const hstsFinding = findingsList.find(f => f.ruleId === 'SEC-HEADER-HSTS-MISSING');
    expect(hstsFinding).toBeDefined();
    expect(hstsFinding?.severity).toBe('high');
    expect(hstsFinding?.confidence).toBe('confirmed');
    expect(hstsFinding?.remediation).toContain('Add Strict-Transport-Security header');

    const wpFinding = findingsList.find(f => f.ruleId === 'WP-VERSION-DISCLOSED');
    expect(wpFinding).toBeDefined();
    expect(wpFinding?.severity).toBe('medium');

    const seoFinding = findingsList.find(f => f.ruleId === 'SEO-META-DESCRIPTION-MISSING');
    expect(seoFinding).toBeDefined();
    expect(seoFinding?.severity).toBe('low');

    // Filter by severity
    const criticalOnly = await api.listFindings({ scanRunId: scan2.id, severity: 'critical' });
    expect(criticalOnly.success).toBe(true);
    if (criticalOnly.success) {
      expect(criticalOnly.data.total).toBe(0);
    }

    const highOnly = await api.listFindings({ scanRunId: scan2.id, severity: 'high' });
    expect(highOnly.success).toBe(true);
    if (highOnly.success) {
      expect(highOnly.data.total).toBe(1);
    }

    // ----------------------------------------------------
    // Step 10: Generate an HTML report from the completed scan run
    // ----------------------------------------------------
    const createReportRes = await api.createReport({
      scanRunId: scan2.id,
      title: 'E2E Full Audit Report',
      format: 'html',
    });
    expect(createReportRes.success).toBe(true);
    if (!createReportRes.success) return;
    const report = createReportRes.data;
    expect(report.title).toBe('E2E Full Audit Report');
    expect(report.format).toBe('html');
    expect(report.status).toBe('generated');

    // ----------------------------------------------------
    // Step 11: Open report through existing Reports workflow
    // ----------------------------------------------------
    const reportContentRes = await api.getReportContent({ id: report.id });
    expect(reportContentRes.success).toBe(true);
    if (!reportContentRes.success) return;
    expect(reportContentRes.data.content).toContain('<!DOCTYPE html>');
    expect(reportContentRes.data.content).toContain('Strict-Transport-Security');

    // ----------------------------------------------------
    // Step 12: Verify scan history after state refresh
    // ----------------------------------------------------
    const scanHistoryRes = await api.listScanRuns({ siteId: site.id });
    expect(scanHistoryRes.success).toBe(true);
    if (!scanHistoryRes.success) return;

    expect(scanHistoryRes.data.total).toBe(2);
    const historyItems = scanHistoryRes.data.items;

    // Scan 1 is cancelled
    const histScan1 = historyItems.find(s => s.id === scan1.id);
    expect(histScan1?.status).toBe('cancelled');

    // Scan 2 is completed
    const histScan2 = historyItems.find(s => s.id === scan2.id);
    expect(histScan2?.status).toBe('completed');
    expect(histScan2?.summary?.totalFindings).toBe(3);
  });

  it('enforces backend concurrency limits: rejects simultaneous scans for same site', async () => {
    // Setup project and site
    const project = (await api.createProject({ name: 'Concurrency Test' })) as {
      success: true;
      data: { id: string };
    };
    const site = (await api.createSite({
      projectId: project.data.id,
      name: 'Site Concurrency',
      baseUrl: 'https://concurrency.test',
    })) as { success: true; data: { id: string } };

    // Setup a blocker on crawler so scan 1 stays in-flight
    crawlerBlocker = new Promise<void>(resolve => {
      crawlerUnblocker = resolve;
    });

    // Start scan 1
    const scan1Res = await api.createScanRun({
      siteId: site.data.id,
      config: { maxPages: 5 },
    });
    expect(scan1Res.success).toBe(true);

    // Try starting scan 2 for same site while scan 1 is in-flight
    const scan2Res = await api.createScanRun({
      siteId: site.data.id,
      config: { maxPages: 5 },
    });

    expect(scan2Res.success).toBe(false);
    if (!scan2Res.success) {
      expect(scan2Res.error.code).toBe('ERR_SCAN_RUN_ACTIVE');
      expect(scan2Res.error.message).toMatch(/active|in progress/i);
    }

    // Unblock crawler and let scan 1 finish cleanly
    if (crawlerUnblocker) {
      crawlerUnblocker();
      crawlerBlocker = null;
      crawlerUnblocker = null;
    }
  });
});
