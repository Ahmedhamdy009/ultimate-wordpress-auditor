/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  type IPCResult,
  type ScanRunDTO,
  type ScanRunListResponseDTO,
  type FindingDTO,
  type FindingListResponseDTO,
  type ReportDTO,
  type ReportListResponseDTO,
  type ScanProgressDTO,
} from '@auditor/shared';
import { ScanOrchestrator } from '../../src/main/scanner/orchestrator/index.js';
import { SecureIpcDispatcher } from '../../src/main/ipc/dispatcher.js';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { ScanRunService } from '../../src/main/services/scan-run.service.js';
import { FindingService } from '../../src/main/services/finding.service.js';
import { ReportService } from '../../src/main/services/report.service.js';
import {
  registerScanHandlers,
  createScanProgressHandler,
} from '../../src/main/ipc/scan-handlers.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { SecurityWebRequestManager } from '../../src/main/security/csp.js';

interface MockIpcMain {
  handlers: Map<string, (event: unknown, payload: unknown) => Promise<unknown>>;
  handle: ReturnType<typeof vi.fn>;
  removeHandler: ReturnType<typeof vi.fn>;
}

function createMockIpcMain(): MockIpcMain {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
  return {
    handlers,
    handle: vi.fn(
      (channel: string, listener: (event: unknown, payload: unknown) => Promise<unknown>) => {
        handlers.set(channel, listener);
      },
    ),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };
}

const activeCleanups: (() => void)[] = [];

function createAuthorizedEvent(overrides?: { isSubFrame?: boolean }): IpcMainInvokeEvent {
  const webContentsId = 901;
  const windowId = 90;
  const url = 'http://localhost:5173';

  const listeners: Record<string, (() => void)[]> = {};
  let isWcDestroyed = false;

  const mainFrame = {
    url,
    parent: null,
  };

  const senderFrame = overrides?.isSubFrame
    ? {
        url: 'https://evil.com/iframe.html',
        parent: mainFrame,
      }
    : mainFrame;

  const targetSession: any = {
    webRequest: {
      onHeadersReceived: vi.fn(),
    },
  };

  SecurityWebRequestManager.initialize({
    isDev: true,
    targetSession,
  });

  const webContents: any = {
    id: webContentsId,
    isDestroyed: vi.fn(() => isWcDestroyed),
    mainFrame,
    session: targetSession,
    once: vi.fn((evt: string, cb: () => void) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(cb);
    }),
    removeListener: vi.fn((evt: string, cb: () => void) => {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(fn => fn !== cb);
      }
    }),
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

  activeCleanups.push(() => {
    isWcDestroyed = true;
    for (const cb of listeners['destroyed'] ?? []) {
      cb();
    }
  });

  return {
    sender: webContents,
    senderFrame,
  } as unknown as IpcMainInvokeEvent;
}

describe('Scan, Finding & Report IPC Handlers', () => {
  let mockIpcMain: MockIpcMain;
  let dispatcher: SecureIpcDispatcher;
  let connection: DatabaseConnection;

  let scanRunService: ScanRunService;
  let findingService: FindingService;
  let reportService: ReportService;
  let siteId: string;

  beforeEach(async () => {
    mockIpcMain = createMockIpcMain();
    dispatcher = new SecureIpcDispatcher({
      isDev: true,
      isPackaged: false,
      ipcMain: mockIpcMain as unknown as typeof import('electron').ipcMain,
    });

    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const migrationRunner = new MigrationRunner(connection);
    await migrationRunner.migrate();

    const projectRepo = new ProjectRepository(connection);
    const siteRepo = new SiteRepository(connection);
    const scanRunRepo = new ScanRunRepository(connection);
    const findingRepo = new FindingRepository(connection);
    const reportRepo = new ReportRepository(connection);

    scanRunService = new ScanRunService(scanRunRepo, siteRepo);
    findingService = new FindingService(findingRepo, scanRunRepo);
    reportService = new ReportService(reportRepo, scanRunRepo);

    const project = projectRepo.create({ name: 'IPC Test Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'IPC Test Site',
      baseUrl: 'https://ipc-test.example.com',
    });
    siteId = site.id;

    registerScanHandlers(dispatcher, scanRunService, findingService, reportService);
  });

  afterEach(() => {
    for (const cleanup of activeCleanups) {
      try {
        cleanup();
      } catch {
        // ignore
      }
    }
    activeCleanups.length = 0;

    dispatcher.teardown();
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  it('handles scan lifecycle channels: create, get, list, cancel', async () => {
    const validEvent = createAuthorizedEvent();

    // 1. SCAN_CREATE
    const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_CREATE)!;
    expect(createFn).toBeDefined();

    const createRes = (await createFn(validEvent, {
      siteId,
      scanType: 'security',
    })) as IPCResult<ScanRunDTO>;

    expect(createRes.success).toBe(true);
    if (!createRes.success) return;
    const runId = createRes.data.id;
    expect(createRes.data.status).toBe('pending');
    expect(createRes.data.targetUrl).toBe('https://ipc-test.example.com');

    // 2. SCAN_GET
    const getFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_GET)!;
    const getRes = (await getFn(validEvent, { id: runId })) as IPCResult<ScanRunDTO>;
    expect(getRes.success).toBe(true);
    if (!getRes.success) return;
    expect(getRes.data.id).toBe(runId);

    // 3. SCAN_LIST
    const listFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_LIST)!;
    const listRes = (await listFn(validEvent, { siteId })) as IPCResult<ScanRunListResponseDTO>;
    expect(listRes.success).toBe(true);
    if (!listRes.success) return;
    expect(listRes.data.total).toBe(1);
    expect(listRes.data.items[0].id).toBe(runId);

    // 4. SCAN_CANCEL
    const cancelFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_CANCEL)!;
    const cancelRes = (await cancelFn(validEvent, { id: runId })) as IPCResult<ScanRunDTO>;
    expect(cancelRes.success).toBe(true);
    if (!cancelRes.success) return;
    expect(cancelRes.data.status).toBe('cancelled');
  });

  it('handles finding and report channels with validation', async () => {
    const validEvent = createAuthorizedEvent();

    // Create a scan run first
    const run = scanRunService.createScanRun({ siteId, scanType: 'full' });

    // Seed a finding directly via service
    const finding = findingService.createFinding({
      scanRunId: run.id,
      ruleId: 'tls-v1',
      category: 'security',
      title: 'Deprecated TLS',
      description: 'TLS 1.0 enabled',
      severity: 'high',
      confidence: 'confirmed',
      targetUrl: 'https://ipc-test.example.com',
    });

    // 1. FINDING_GET
    const findingGetFn = mockIpcMain.handlers.get(IPC_CHANNELS.FINDING_GET)!;
    const findingGetRes = (await findingGetFn(validEvent, {
      id: finding.id,
    })) as IPCResult<FindingDTO>;
    expect(findingGetRes.success).toBe(true);
    if (!findingGetRes.success) return;
    expect(findingGetRes.data.title).toBe('Deprecated TLS');

    // 2. FINDING_LIST
    const findingListFn = mockIpcMain.handlers.get(IPC_CHANNELS.FINDING_LIST)!;
    const findingListRes = (await findingListFn(validEvent, {
      scanRunId: run.id,
    })) as IPCResult<FindingListResponseDTO>;
    expect(findingListRes.success).toBe(true);
    if (!findingListRes.success) return;
    expect(findingListRes.data.total).toBe(1);

    // Regression test: FINDING_LIST with limit: 500 (frontend default) through secure dispatcher
    const findingList500Res = (await findingListFn(validEvent, {
      scanRunId: run.id,
      limit: 500,
    })) as IPCResult<FindingListResponseDTO>;
    expect(findingList500Res.success).toBe(true);
    if (!findingList500Res.success) return;
    expect(findingList500Res.data.items.length).toBe(1);
    expect(findingList500Res.data.limit).toBe(500);

    // 3. REPORT_CREATE
    const reportCreateFn = mockIpcMain.handlers.get(IPC_CHANNELS.REPORT_CREATE)!;
    const reportCreateRes = (await reportCreateFn(validEvent, {
      scanRunId: run.id,
      title: 'Audit PDF Report',
      format: 'pdf',
    })) as IPCResult<ReportDTO>;
    expect(reportCreateRes.success).toBe(true);
    if (!reportCreateRes.success) return;
    const reportId = reportCreateRes.data.id;
    expect(reportCreateRes.data.format).toBe('pdf');

    // 4. REPORT_GET
    const reportGetFn = mockIpcMain.handlers.get(IPC_CHANNELS.REPORT_GET)!;
    const reportGetRes = (await reportGetFn(validEvent, {
      id: reportId,
    })) as IPCResult<ReportDTO>;
    expect(reportGetRes.success).toBe(true);
    if (!reportGetRes.success) return;
    expect(reportGetRes.data.title).toBe('Audit PDF Report');

    // 5. REPORT_LIST
    const reportListFn = mockIpcMain.handlers.get(IPC_CHANNELS.REPORT_LIST)!;
    const reportListRes = (await reportListFn(validEvent, {
      scanRunId: run.id,
    })) as IPCResult<ReportListResponseDTO>;
    expect(reportListRes.success).toBe(true);
    if (!reportListRes.success) return;
    expect(reportListRes.data.total).toBe(1);
  });

  it('rejects unauthorized sender (subframe) via SenderGuard', async () => {
    const unauthorizedEvent = createAuthorizedEvent({ isSubFrame: true });
    const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_CREATE)!;

    const res = (await createFn(unauthorizedEvent, {
      siteId,
      scanType: 'quick',
    })) as IPCResult<ScanRunDTO>;

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.code).toBe(IPC_ERROR_CODES.UNAUTHORIZED_SENDER);
  });

  it('registers and handles scan:progress when orchestrator is provided', async () => {
    const validEvent = createAuthorizedEvent();
    const scanRunRepo = new ScanRunRepository(connection);
    const siteRepo = new SiteRepository(connection);
    const findingRepo = new FindingRepository(connection);
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);
    dispatcher.registerHandler(IPC_CHANNELS.SCAN_PROGRESS, createScanProgressHandler(orchestrator));

    const run = scanRunService.createScanRun({ siteId, scanType: 'full' });

    const progressFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_PROGRESS)!;
    expect(progressFn).toBeDefined();

    const progressRes = (await progressFn(validEvent, {
      id: run.id,
    })) as IPCResult<ScanProgressDTO>;
    expect(progressRes.success).toBe(true);
    if (!progressRes.success) return;
    expect(progressRes.data.scanId).toBe(run.id);
    expect(progressRes.data.status).toBe('pending');
  });

  it('delegates SCAN_CREATE to orchestrator when provided and maps domain errors to IPCError', async () => {
    // Teardown beforeEach dispatcher to free channels in CentralIpcRegistrationManager
    dispatcher.teardown();

    const validEvent = createAuthorizedEvent();
    const isolatedIpcMain = createMockIpcMain();
    const scanRunRepo = new ScanRunRepository(connection);
    const siteRepo = new SiteRepository(connection);
    const findingRepo = new FindingRepository(connection);
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
      maxConcurrentScans: 2,
    });

    const orchDispatcher = new SecureIpcDispatcher({
      isDev: true,
      isPackaged: false,
      ipcMain: isolatedIpcMain as unknown as typeof import('electron').ipcMain,
    });

    // Register with orchestrator
    registerScanHandlers(
      orchDispatcher,
      scanRunService,
      findingService,
      reportService,
      orchestrator,
    );

    const createFn = isolatedIpcMain.handlers.get(IPC_CHANNELS.SCAN_CREATE)!;

    // 1. First scan creation succeeds
    const res1 = (await createFn(validEvent, {
      siteId,
      scanType: 'full',
    })) as IPCResult<ScanRunDTO>;
    expect(res1.success).toBe(true);

    // 2. Second scan creation on same site fails with SCAN_RUN_ACTIVE
    const res2 = (await createFn(validEvent, {
      siteId,
      scanType: 'full',
    })) as IPCResult<ScanRunDTO>;
    expect(res2.success).toBe(false);
    if (res2.success) return;
    expect(res2.error.code).toBe(IPC_ERROR_CODES.SCAN_RUN_ACTIVE);

    // 3. Mismatched origin targetUrl fails with INVALID_TARGET_URL
    const otherSite = siteRepo.create({
      projectId: siteRepo.getById(siteId)!.projectId,
      name: 'Site 2',
      baseUrl: 'https://site2.example.com',
    });
    const res3 = (await createFn(validEvent, {
      siteId: otherSite.id,
      targetUrl: 'https://mismatched-origin.example.com/page',
    })) as IPCResult<ScanRunDTO>;
    expect(res3.success).toBe(false);
    if (res3.success) return;
    expect(res3.error.code).toBe(IPC_ERROR_CODES.INVALID_TARGET_URL);

    orchDispatcher.teardown();
    orchestrator.dispose();
  });
});
