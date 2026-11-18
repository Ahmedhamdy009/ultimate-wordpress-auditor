import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  type IPCResult,
  type SiteDTO,
  type ScanRunDTO,
} from '@auditor/shared';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { SiteService } from '../../src/main/services/site.service.js';
import { ScanRunService } from '../../src/main/services/scan-run.service.js';
import { ScanOrchestrator } from '../../src/main/scanner/orchestrator/orchestrator.js';
import { SCAN_ORCHESTRATOR_ERROR_CODES } from '../../src/main/scanner/orchestrator/errors.js';
import {
  createSiteCreateHandler,
  createSiteUpdateHandler,
} from '../../src/main/ipc/project-site-handlers.js';
import { createScanCreateHandler } from '../../src/main/ipc/scan-handlers.js';
import { SecureIpcDispatcher } from '../../src/main/ipc/dispatcher.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { SecurityWebRequestManager } from '../../src/main/security/csp.js';
import { mockDnsLookup } from '../support/fixture-network.js';
import {
  VisualAuditor,
  MIN_VISUAL_NAVIGATION_TIMEOUT_MS,
  VISUAL_FINALIZATION_RESERVE_MS,
} from '../../src/main/browser/visual-auditor.js';
import { VisualAuditorTimeoutError } from '../../src/main/browser/visual-types.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

function createMockIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  return {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => Promise<unknown>,
    ) => {
      handlers.set(channel, listener);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
    handlers,
  };
}

let nextEventId = 2000;
function createAuthorizedEvent() {
  const webContentsId = ++nextEventId;
  const windowId = ++nextEventId;
  const url = 'http://localhost:5173';

  const listeners: Record<string, (() => void)[]> = {};
  const mainFrame = {
    url,
    parent: null,
  };

  const targetSession = {
    webRequest: {
      onHeadersReceived: vi.fn(),
    },
  } as unknown as Electron.Session;

  SecurityWebRequestManager.initialize({
    isDev: true,
    targetSession,
  });

  const webContents = {
    id: webContentsId,
    isDestroyed: vi.fn(() => false),
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
  } as unknown as Electron.WebContents;

  const browserWindow = {
    id: windowId,
    isDestroyed: vi.fn(() => false),
    webContents,
    once: vi.fn(),
  } as unknown as Electron.BrowserWindow;

  WindowSecurityRegistry.register(browserWindow, {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  });

  return {
    senderFrame: mainFrame,
    sender: webContents,
  };
}

describe('DEF-006: Final Security Verification — DNS Enforcement and Zero Persistence', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let siteService: SiteService;
  let scanRunService: ScanRunService;
  let testProjectId: string;
  let mockIpcMain: ReturnType<typeof createMockIpcMain>;
  let dispatcher: SecureIpcDispatcher;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);

    siteService = new SiteService(siteRepo, projectRepo);
    scanRunService = new ScanRunService(scanRunRepo, siteRepo);

    const project = projectRepo.create({ name: 'Security Verification Project' });
    testProjectId = project.id;

    mockIpcMain = createMockIpcMain();
    dispatcher = new SecureIpcDispatcher({
      isDev: true,
      isPackaged: false,
      ipcMain: mockIpcMain as unknown as typeof import('electron').ipcMain,
    });
  });

  afterEach(() => {
    dispatcher.teardown();
    if (connection && connection.isOpen()) {
      connection.close();
    }
    vi.restoreAllMocks();
  });

  describe('1. Site Creation: Prohibited DNS Target Rejection with Zero Rows Persisted', () => {
    it('rejects target resolving to 127.0.0.1 and persists zero site rows', async () => {
      mockDnsLookup(async () => [{ address: '127.0.0.1', family: 4 }]);
      dispatcher.registerHandler(IPC_CHANNELS.SITE_CREATE, createSiteCreateHandler(siteService));

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        projectId: testProjectId,
        name: 'Loopback Target',
        baseUrl: 'http://internal-portal.domain.test',
      })) as IPCResult<SiteDTO>;

      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET);

      // Verify zero site rows in database
      const sites = siteRepo.listByProject(testProjectId);
      expect(sites.total).toBe(0);
      expect(sites.items.length).toBe(0);
    });

    it('rejects target resolving to private RFC 1918 10.0.0.5 and persists zero site rows', async () => {
      mockDnsLookup(async () => [{ address: '10.0.0.5', family: 4 }]);
      dispatcher.registerHandler(IPC_CHANNELS.SITE_CREATE, createSiteCreateHandler(siteService));

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        projectId: testProjectId,
        name: 'Private Class A Target',
        baseUrl: 'https://corporate-vault.corp.internal',
      })) as IPCResult<SiteDTO>;

      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET);

      const sites = siteRepo.listByProject(testProjectId);
      expect(sites.total).toBe(0);
    });

    it('rejects mixed DNS answers (public + loopback) fail-closed and persists zero site rows', async () => {
      mockDnsLookup(async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]);
      dispatcher.registerHandler(IPC_CHANNELS.SITE_CREATE, createSiteCreateHandler(siteService));

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        projectId: testProjectId,
        name: 'Round Robin Rebind Target',
        baseUrl: 'https://round-robin-dns.attacker.com',
      })) as IPCResult<SiteDTO>;

      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET);

      const sites = siteRepo.listByProject(testProjectId);
      expect(sites.total).toBe(0);
    });

    it('rejects DNS resolution timeout fail-closed and persists zero site rows', async () => {
      mockDnsLookup(
        async () =>
          new Promise<Array<{ address: string; family: number }>>(() => {
            // Never resolves
          }),
      );
      dispatcher.registerHandler(
        IPC_CHANNELS.SITE_CREATE,
        createSiteCreateHandler(siteService, {
          timeoutMs: 50, // Short timeout for deterministic fast test
        }),
      );

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        projectId: testProjectId,
        name: 'Hanging DNS Target',
        baseUrl: 'https://stalled-nameserver.example.com',
      })) as IPCResult<SiteDTO>;

      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.DNS_RESOLUTION_FAILED);

      const sites = siteRepo.listByProject(testProjectId);
      expect(sites.total).toBe(0);
    });

    it('rejects non-existent domain (ENOTFOUND) fail-closed and persists zero site rows', async () => {
      mockDnsLookup(async () => {
        const error = new Error('getaddrinfo ENOTFOUND non-existent.domain');
        (error as { code?: string }).code = 'ENOTFOUND';
        throw error;
      });
      dispatcher.registerHandler(IPC_CHANNELS.SITE_CREATE, createSiteCreateHandler(siteService));

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        projectId: testProjectId,
        name: 'Non Existent Target',
        baseUrl: 'https://non-existent.domain',
      })) as IPCResult<SiteDTO>;

      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.DNS_RESOLUTION_FAILED);

      const sites = siteRepo.listByProject(testProjectId);
      expect(sites.total).toBe(0);
    });

    it('rejects empty DNS answers list fail-closed and persists zero site rows', async () => {
      mockDnsLookup(async () => []);
      dispatcher.registerHandler(IPC_CHANNELS.SITE_CREATE, createSiteCreateHandler(siteService));

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        projectId: testProjectId,
        name: 'Empty DNS Target',
        baseUrl: 'https://empty-answers.example.com',
      })) as IPCResult<SiteDTO>;

      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.DNS_RESOLUTION_FAILED);

      const sites = siteRepo.listByProject(testProjectId);
      expect(sites.total).toBe(0);
    });

    it('accepts legitimate public target and persists exactly one site row', async () => {
      mockDnsLookup(async () => [{ address: '93.184.216.34', family: 4 }]);
      dispatcher.registerHandler(IPC_CHANNELS.SITE_CREATE, createSiteCreateHandler(siteService));

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        projectId: testProjectId,
        name: 'Valid Target',
        baseUrl: 'https://legitimate-store.com',
      })) as IPCResult<SiteDTO>;

      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.data.baseUrl).toBe('https://legitimate-store.com/');

      const sites = siteRepo.listByProject(testProjectId);
      expect(sites.total).toBe(1);
    });
  });

  describe('2. Site Update: Prohibited DNS Rebinding Guard', () => {
    it('rejects updating baseUrl to hostname resolving to private IP and leaves site unchanged', async () => {
      // First create a legitimate site
      const initialSite = siteRepo.create({
        projectId: testProjectId,
        name: 'Production Site',
        baseUrl: 'https://legit-store.com',
      });

      mockDnsLookup(async () => [{ address: '127.0.0.1', family: 4 }]);
      dispatcher.registerHandler(IPC_CHANNELS.SITE_UPDATE, createSiteUpdateHandler(siteService));

      const updateFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_UPDATE)!;
      const res = (await updateFn(createAuthorizedEvent(), {
        id: initialSite.id,
        baseUrl: 'http://attacker-controlled.local',
      })) as IPCResult<SiteDTO>;

      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET);

      // Verify database record baseUrl is completely unchanged
      const freshSite = siteRepo.getById(initialSite.id);
      expect(freshSite!.baseUrl).toBe('https://legit-store.com');
    });
  });

  describe('3. Scan Creation & Execution: Complete Zero-Row, Zero-Crawler, Zero-Browser Guarantee', () => {
    it('rejects scan creation on DNS rebound site: zero scan rows, zero crawler starts, zero browser sessions', async () => {
      // Create site originally with public URL
      const site = siteRepo.create({
        projectId: testProjectId,
        name: 'Target Site',
        baseUrl: 'https://initially-legit.com',
      });

      // DNS lookup now returns loopback 127.0.0.1 (simulated DNS rebinding)
      mockDnsLookup(async () => [{ address: '127.0.0.1', family: 4 }]);

      const mockCrawler = {
        crawl: vi.fn(),
      };
      const crawlerFactory = vi.fn(
        () =>
          mockCrawler as unknown as import('../../src/main/scanner/crawler/crawler.js').BoundedCrawler,
      );

      const mockBrowserManager = {
        acquirePage: vi.fn(),
        launch: vi.fn(),
        close: vi.fn(),
      };
      const browserManagerFactory = vi.fn(
        () =>
          mockBrowserManager as unknown as import('../../src/main/browser/manager.js').BrowserManager,
      );

      const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
        maxConcurrentScans: 2,
        crawlerFactory,
        browserManagerFactory,
      });

      const spyCreateScan = vi.spyOn(orchestrator, 'createScan');
      const spyExecuteScan = vi.spyOn(orchestrator, 'executeScan');

      dispatcher.registerHandler(
        IPC_CHANNELS.SCAN_CREATE,
        createScanCreateHandler(scanRunService, orchestrator, {
          siteService,
        }),
      );

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        siteId: site.id,
        scanType: 'full',
      })) as IPCResult<ScanRunDTO>;

      // 1. Assert rejection via IPC
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET);

      // 2. Assert orchestrator.createScan was NOT called
      expect(spyCreateScan).not.toHaveBeenCalled();

      // 3. Assert orchestrator.executeScan was NOT called
      expect(spyExecuteScan).not.toHaveBeenCalled();

      // 4. Assert ZERO scan runs in SQLite database
      const scanRuns = scanRunRepo.list({ siteId: site.id });
      expect(scanRuns.total).toBe(0);
      expect(scanRuns.items.length).toBe(0);

      // 5. Assert ZERO crawler instances or executions
      expect(crawlerFactory).not.toHaveBeenCalled();
      expect(mockCrawler.crawl).not.toHaveBeenCalled();

      // 6. Assert ZERO browser sessions or page acquisitions
      expect(browserManagerFactory).not.toHaveBeenCalled();
      expect(mockBrowserManager.acquirePage).not.toHaveBeenCalled();
    });

    it('rejects scan creation when explicit targetUrl resolves to 10.0.0.5: zero scan rows', async () => {
      const site = siteRepo.create({
        projectId: testProjectId,
        name: 'Corporate Site',
        baseUrl: 'http://corporate-gateway.internal',
      });

      mockDnsLookup(async () => [{ address: '10.0.0.5', family: 4 }]);

      const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);

      const spyCreateScan = vi.spyOn(orchestrator, 'createScan');

      dispatcher.registerHandler(
        IPC_CHANNELS.SCAN_CREATE,
        createScanCreateHandler(scanRunService, orchestrator, {
          siteService,
        }),
      );

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        siteId: site.id,
        targetUrl: 'http://corporate-gateway.internal/api',
      })) as IPCResult<ScanRunDTO>;

      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET);

      expect(spyCreateScan).not.toHaveBeenCalled();
      const runs = scanRunRepo.list({ siteId: site.id });
      expect(runs.total).toBe(0);
    });

    it('rejects scan creation when DNS times out: zero scan rows', async () => {
      const site = siteRepo.create({
        projectId: testProjectId,
        name: 'Timeout Site',
        baseUrl: 'https://timeout-site.example.com',
      });

      mockDnsLookup(async () => new Promise<Array<{ address: string; family: number }>>(() => {}));

      const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);

      dispatcher.registerHandler(
        IPC_CHANNELS.SCAN_CREATE,
        createScanCreateHandler(scanRunService, orchestrator, {
          timeoutMs: 50,
          siteService,
        }),
      );

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        siteId: site.id,
      })) as IPCResult<ScanRunDTO>;

      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error.code).toBe(IPC_ERROR_CODES.DNS_RESOLUTION_FAILED);

      const runs = scanRunRepo.list({ siteId: site.id });
      expect(runs.total).toBe(0);
    });

    it('allows scan creation for valid public target without real network call', async () => {
      const site = siteRepo.create({
        projectId: testProjectId,
        name: 'Public Site',
        baseUrl: 'https://legitimate-store.com',
      });

      mockDnsLookup(async () => [{ address: '93.184.216.34', family: 4 }]);

      const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);

      dispatcher.registerHandler(
        IPC_CHANNELS.SCAN_CREATE,
        createScanCreateHandler(scanRunService, orchestrator, {
          siteService,
        }),
      );

      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_CREATE)!;
      const res = (await createFn(createAuthorizedEvent(), {
        siteId: site.id,
        scanType: 'full',
      })) as IPCResult<ScanRunDTO>;

      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.data.status).toBe('pending');
      expect(res.data.targetUrl).toBe('https://legitimate-store.com/');

      const runs = scanRunRepo.list({ siteId: site.id });
      expect(runs.total).toBe(1);
    });
  });

  describe('4. Direct Orchestrator createScan Defense-in-Depth', () => {
    it('orchestrator.createScan rejects prohibited IP literal targets BEFORE creating pending run in SQLite', () => {
      const site = siteRepo.create({
        projectId: testProjectId,
        name: 'Direct Orchestrator Site',
        baseUrl: 'http://127.0.0.1:8080',
      });

      const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);

      expect(() =>
        orchestrator.createScan({
          siteId: site.id,
          scanType: 'full',
        }),
      ).toThrow(SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SSRF_PROHIBITED_TARGET);

      // Verify zero scan runs exist in SQLite
      const runs = scanRunRepo.list({ siteId: site.id });
      expect(runs.total).toBe(0);
    });

    it('rejects hostile payloads attempting to activate test hooks via site:create, site:update, or scan:create IPC', async () => {
      const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);
      dispatcher.registerHandler(IPC_CHANNELS.SITE_CREATE, createSiteCreateHandler(siteService));
      dispatcher.registerHandler(IPC_CHANNELS.SITE_UPDATE, createSiteUpdateHandler(siteService));
      dispatcher.registerHandler(
        IPC_CHANNELS.SCAN_CREATE,
        createScanCreateHandler(scanRunService, orchestrator, { siteService }),
      );

      const legitSite = siteRepo.create({
        projectId: testProjectId,
        name: 'Legit Site',
        baseUrl: 'https://example.com',
      });

      const hostileOverrides = {
        testHooks: {
          pinnedIpOverride: '127.0.0.1',
          allowLoopbackInTests: true,
          lookupFn: 'bypass',
        },
        pinnedIpOverride: '127.0.0.1',
        allowLoopbackInTests: true,
        allowPrivateLoopback: true,
        lookupFn: 'bypass',
      };

      const createSiteRes = (await mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!(
        createAuthorizedEvent(),
        {
          projectId: testProjectId,
          name: 'Hostile Localhost',
          baseUrl: 'http://localhost:8080',
          ...hostileOverrides,
        },
      )) as IPCResult<SiteDTO>;

      expect(createSiteRes.success).toBe(false);

      const updateSiteRes = (await mockIpcMain.handlers.get(IPC_CHANNELS.SITE_UPDATE)!(
        createAuthorizedEvent(),
        {
          id: legitSite.id,
          baseUrl: 'http://127.0.0.1:8080',
          ...hostileOverrides,
        },
      )) as IPCResult<SiteDTO>;

      expect(updateSiteRes.success).toBe(false);

      const badSite = siteRepo.create({
        projectId: testProjectId,
        name: 'Stored Loopback',
        baseUrl: 'http://127.0.0.1:9000',
      });

      const createScanRes = (await mockIpcMain.handlers.get(IPC_CHANNELS.SCAN_CREATE)!(
        createAuthorizedEvent(),
        {
          siteId: badSite.id,
          scanType: 'quick',
          config: hostileOverrides,
          ...hostileOverrides,
        },
      )) as IPCResult<ScanRunDTO>;

      expect(createScanRes.success).toBe(false);
      orchestrator.dispose();
    });
  });

  describe('5. DEF-005 Minimum Deadline Budget Boundary Enforcement', () => {
    it('VisualAuditor throws VisualAuditorTimeoutError without acquiring page when remaining budget is insufficient for navigation timeout plus reserve', async () => {
      const mockBrowserManager = {
        acquirePage: vi.fn(),
      };

      const mockTime = 5_000;
      const clock = () => mockTime;
      // Insufficient budget: 1,200ms < MIN_VISUAL_NAVIGATION_TIMEOUT_MS (1,000) + VISUAL_FINALIZATION_RESERVE_MS (500) = 1,500ms
      expect(1_200).toBeLessThan(MIN_VISUAL_NAVIGATION_TIMEOUT_MS + VISUAL_FINALIZATION_RESERVE_MS);
      const deadlineAt = mockTime + 1_200;

      const auditor = new VisualAuditor(
        mockBrowserManager as unknown as import('../../src/main/browser/manager.js').BrowserManager,
        {
          profiles: [DEFAULT_VIEWPORT_PROFILES[0]],
          captureScreenshots: false,
          deadlineAt,
          clock,
        },
      );

      const targetUrl = 'https://example.com/page';
      await expect(auditor.auditUrl(targetUrl)).rejects.toThrow(VisualAuditorTimeoutError);

      try {
        await auditor.auditUrl(targetUrl);
      } catch (err) {
        expect(err).toBeInstanceOf(VisualAuditorTimeoutError);
        const vaErr = err as VisualAuditorTimeoutError;
        expect(vaErr.code).toBe('ERR_SCAN_TIMEOUT');
        expect(vaErr.remainingBudgetMs).toBe(1_200);
      }

      // Assert ZERO page acquisitions
      expect(mockBrowserManager.acquirePage).not.toHaveBeenCalled();
    });
  });
});
