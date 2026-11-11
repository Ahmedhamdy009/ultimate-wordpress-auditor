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

import { IPC_ERROR_CODES } from '@auditor/shared';
import { SecureIpcDispatcher } from '../../src/main/ipc/dispatcher.js';
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
import { registerDatabaseIpcHandlers } from '../../src/main/ipc/project-site-handlers.js';
import { registerScanHandlers } from '../../src/main/ipc/scan-handlers.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { SecurityWebRequestManager } from '../../src/main/security/csp.js';
import { createElectronAPI } from '../../src/preload/index.js';

describe('Phase 2.2 & 2.3 — End-to-End Integration Sanity Walkthrough', () => {
  let connection: DatabaseConnection;
  let dispatcher: SecureIpcDispatcher;
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  let cleanups: (() => void)[] = [];
  let findingService: FindingService;

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

    // 1. Database Connection & Migration
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    // 2. Repositories
    const projectRepo = new ProjectRepository(connection);
    const siteRepo = new SiteRepository(connection);
    const scanRunRepo = new ScanRunRepository(connection);
    const findingRepo = new FindingRepository(connection);
    const reportRepo = new ReportRepository(connection);

    // 3. Domain Services
    const projectService = new ProjectService(projectRepo);
    const siteService = new SiteService(siteRepo, projectRepo);
    const scanRunService = new ScanRunService(scanRunRepo, siteRepo);
    findingService = new FindingService(findingRepo, scanRunRepo);
    const reportService = new ReportService(reportRepo, scanRunRepo);

    // 4. Secure Dispatcher
    dispatcher = new SecureIpcDispatcher({
      isDev: true,
      isPackaged: false,
      ipcMain: mockIpcMain as unknown as typeof import('electron').ipcMain,
    });

    // 5. IPC Handlers Registration
    registerDatabaseIpcHandlers(dispatcher, { projectService, siteService });
    registerScanHandlers(dispatcher, scanRunService, findingService, reportService);
  });

  afterEach(() => {
    while (cleanups.length > 0) {
      const c = cleanups.pop();
      try {
        c?.();
      } catch {
        // Safe fail-through during teardown
      }
    }
    dispatcher.teardown();
    connection.close();
  });

  function createAuthorizedEvent(): IpcMainInvokeEvent {
    const webContentsId = 901;
    const windowId = 90;
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
    });

    return { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  }

  it('executes complete Project and Site workflow through Preload -> Dispatcher -> Handlers -> Services -> Repositories -> SQLite', async () => {
    const validEvent = createAuthorizedEvent();

    // Wire Preload Bridge to the Dispatcher's actual registered handlers
    const bridge = createElectronAPI(async (channel: string, payload: unknown) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Handler not found for channel: ${channel}`);
      }
      return await handler(validEvent, payload);
    });

    // --- STEP 1: Project Creation Workflow ---
    const createProjectRes = await bridge.createProject({
      name: 'Sanity Workflow Project',
      description: 'End-to-end integration test verification',
    });
    expect(createProjectRes.success).toBe(true);
    if (!createProjectRes.success) return;
    const project = createProjectRes.data;
    expect(project.id).toBeDefined();
    expect(project.name).toBe('Sanity Workflow Project');
    expect(project.isArchived).toBe(false);

    // --- STEP 2: Project Listing ---
    const listProjectsRes = await bridge.listProjects({ includeArchived: false });
    expect(listProjectsRes.success).toBe(true);
    if (!listProjectsRes.success) return;
    expect(listProjectsRes.data.items.length).toBe(1);
    expect(listProjectsRes.data.items[0]?.id).toBe(project.id);

    // --- STEP 3: Site Creation Workflow (RFC 3986 normalization) ---
    const createSiteRes = await bridge.createSite({
      projectId: project.id,
      name: 'Primary WordPress Site',
      baseUrl: 'HTTP://EXAMPLE.COM:80/store?ignore=1#section',
      platformType: 'wordpress',
      environmentType: 'production',
    });
    expect(createSiteRes.success).toBe(true);
    if (!createSiteRes.success) return;
    const site = createSiteRes.data;
    expect(site.id).toBeDefined();
    expect(site.projectId).toBe(project.id);
    expect(site.baseUrl).toBe('http://example.com/store');
    expect(site.platformType).toBe('wordpress');
    expect(site.environmentType).toBe('production');

    // --- STEP 4: Site Listing by Project ---
    const listSitesRes = await bridge.listSites({ projectId: project.id });
    expect(listSitesRes.success).toBe(true);
    if (!listSitesRes.success) return;
    expect(listSitesRes.data.items.length).toBe(1);
    expect(listSitesRes.data.items[0]?.id).toBe(site.id);

    // --- STEP 4.5: Phase 2.3 Scan Run, Findings, and Reports Data Layer ---
    const createScanRes = await bridge.createScanRun({
      siteId: site.id,
      scanType: 'security',
      config: { aggressiveMode: false },
    });
    expect(createScanRes.success).toBe(true);
    if (!createScanRes.success) return;
    const scanRun = createScanRes.data;
    expect(scanRun.id).toBeDefined();
    expect(scanRun.status).toBe('pending');
    expect(scanRun.targetUrl).toBe('http://example.com/store');

    const getScanRes = await bridge.getScanRun({ id: scanRun.id });
    expect(getScanRes.success).toBe(true);
    if (!getScanRes.success) return;
    expect(getScanRes.data.id).toBe(scanRun.id);

    const listScansRes = await bridge.listScanRuns({ siteId: site.id });
    expect(listScansRes.success).toBe(true);
    if (!listScansRes.success) return;
    expect(listScansRes.data.total).toBe(1);

    // Insert finding and query via bridge
    findingService.createFinding({
      scanRunId: scanRun.id,
      ruleId: 'wp-security-key',
      category: 'security',
      title: 'Default Salt Found',
      description: 'AUTH_SALT uses default value',
      severity: 'critical',
      confidence: 'confirmed',
      targetUrl: site.baseUrl,
      evidence: { salt: 'put your unique phrase here' },
    });

    const listFindingsRes = await bridge.listFindings({ scanRunId: scanRun.id });
    expect(listFindingsRes.success).toBe(true);
    if (!listFindingsRes.success) return;
    expect(listFindingsRes.data.total).toBe(1);
    const findingId = listFindingsRes.data.items[0].id;

    const getFindingRes = await bridge.getFinding({ id: findingId });
    expect(getFindingRes.success).toBe(true);
    if (!getFindingRes.success) return;
    expect(getFindingRes.data.title).toBe('Default Salt Found');

    // Create Report via bridge
    const createReportRes = await bridge.createReport({
      scanRunId: scanRun.id,
      title: 'Security Executive Summary',
      format: 'html',
    });
    expect(createReportRes.success).toBe(true);
    if (!createReportRes.success) return;
    const reportId = createReportRes.data.id;

    const getReportRes = await bridge.getReport({ id: reportId });
    expect(getReportRes.success).toBe(true);
    if (!getReportRes.success) return;
    expect(getReportRes.data.format).toBe('html');

    const listReportsRes = await bridge.listReports({ scanRunId: scanRun.id });
    expect(listReportsRes.success).toBe(true);
    if (!listReportsRes.success) return;
    expect(listReportsRes.data.total).toBe(1);

    // Cancel scan run via bridge
    const cancelScanRes = await bridge.cancelScanRun({ id: scanRun.id });
    expect(cancelScanRes.success).toBe(true);
    if (!cancelScanRes.success) return;
    expect(cancelScanRes.data.status).toBe('cancelled');

    // --- STEP 5: Failure Safety & Duplicate Prevention ---
    const duplicateProjectRes = await bridge.createProject({
      name: 'Sanity Workflow Project',
    });
    expect(duplicateProjectRes.success).toBe(false);
    if (duplicateProjectRes.success) return;
    expect(duplicateProjectRes.error.code).toBe(IPC_ERROR_CODES.PROJECT_NAME_EXISTS);

    const duplicateSiteRes = await bridge.createSite({
      projectId: project.id,
      name: 'Duplicate Site',
      baseUrl: 'http://example.com/store',
    });
    expect(duplicateSiteRes.success).toBe(false);
    if (duplicateSiteRes.success) return;
    expect(duplicateSiteRes.error.code).toBe(IPC_ERROR_CODES.SITE_URL_EXISTS);

    // --- STEP 6: Project Archival Cascade ---
    const archiveProjectRes = await bridge.archiveProject({ id: project.id });
    expect(archiveProjectRes.success).toBe(true);
    if (!archiveProjectRes.success) return;
    expect(archiveProjectRes.data.archivedProjectId).toBe(project.id);
    expect(archiveProjectRes.data.archivedSiteCount).toBe(1);

    // Verify site was cascaded into archived state
    const postArchiveSites = await bridge.listSites({
      projectId: project.id,
      includeArchived: true,
    });
    expect(postArchiveSites.success).toBe(true);
    if (!postArchiveSites.success) return;
    expect(postArchiveSites.data.items[0]?.isArchived).toBe(true);

    // --- STEP 7: Rejection of Site Creation under Archived Project ---
    const siteUnderArchivedRes = await bridge.createSite({
      projectId: project.id,
      name: 'New Site on Archived Project',
      baseUrl: 'https://new-site.example.com',
    });
    expect(siteUnderArchivedRes.success).toBe(false);
    if (siteUnderArchivedRes.success) return;
    expect(siteUnderArchivedRes.error.code).toBe(IPC_ERROR_CODES.PARENT_PROJECT_ARCHIVED);
  });
});
