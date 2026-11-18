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
  validateTargetUrlSync,
  validateTargetUrlAsync,
} from '../../src/main/scanner/validator/target-validator.js';
import {
  createSiteCreateHandler,
  createSiteUpdateHandler,
} from '../../src/main/ipc/project-site-handlers.js';
import { createScanCreateHandler } from '../../src/main/ipc/scan-handlers.js';
import { SecureIpcDispatcher } from '../../src/main/ipc/dispatcher.js';
import { WindowSecurityRegistry } from '../../src/main/security/registry.js';
import { SecurityWebRequestManager } from '../../src/main/security/csp.js';
import { mockDnsLookup } from '../support/fixture-network.js';

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

let nextId = 900;
function createAuthorizedEvent() {
  const webContentsId = ++nextId;
  const windowId = ++nextId;
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

describe('DEF-006: Strict Pre-flight Target Validation & Zero-Persistence Boundary', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let siteService: SiteService;
  let scanRunService: ScanRunService;
  let projectId: string;

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

    const project = projectRepo.create({ name: 'DEF-006 Security Test Project' });
    projectId = project.id;
  });

  afterEach(() => {
    if (connection.isOpen()) {
      connection.close();
    }
  });

  describe('1. Synchronous Target Validation (validateTargetUrlSync)', () => {
    it('Case 1: rejects IPv4 loopback addresses (127.0.0.1, 127.0.0.2, 127.255.255.254)', () => {
      const loopbacks = [
        'http://127.0.0.1',
        'http://127.0.0.1:8080/path',
        'https://127.0.0.2',
        'http://127.255.255.254',
      ];
      for (const target of loopbacks) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 2: rejects IPv4 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
      const privateIps = [
        'http://10.0.0.1',
        'http://10.255.255.255:3000',
        'http://172.16.0.1',
        'http://172.31.255.255',
        'http://192.168.1.1',
        'http://192.168.254.254:8443',
      ];
      for (const target of privateIps) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 3: rejects IPv4 link-local and cloud metadata addresses (169.254.0.0/16)', () => {
      const linkLocal = ['http://169.254.169.254/latest/meta-data/', 'http://169.254.1.1'];
      for (const target of linkLocal) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 4: rejects IPv4 unspecified address (0.0.0.0/8)', () => {
      const unspecified = ['http://0.0.0.0', 'http://0.0.0.0:8000'];
      for (const target of unspecified) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 5: rejects IPv4 multicast (224.0.0.0/4)', () => {
      const multicast = ['http://224.0.0.1', 'http://239.255.255.250'];
      for (const target of multicast) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 6: rejects IPv6 loopback (::1, [::1])', () => {
      const ipv6Loopback = ['http://[::1]', 'http://[::1]:8080/wp-admin'];
      for (const target of ipv6Loopback) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 7: rejects IPv6 unspecified address ([::])', () => {
      const ipv6Unspecified = ['http://[::]', 'http://[::]:80'];
      for (const target of ipv6Unspecified) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 8: rejects IPv6 link-local addresses (fe80::/10)', () => {
      const ipv6LinkLocal = ['http://[fe80::1]', 'http://[fe80::200:5aee:feaa:20a2]'];
      for (const target of ipv6LinkLocal) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 9: rejects IPv6 unique-local addresses (fc00::/7)', () => {
      const ipv6Ula = ['http://[fc00::1]', 'http://[fd12:3456:789a:1::1]'];
      for (const target of ipv6Ula) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 10: rejects IPv6 multicast addresses (ff00::/8)', () => {
      const ipv6Multicast = ['http://[ff02::1]', 'http://[ff05::2]'];
      for (const target of ipv6Multicast) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 11: rejects IPv4-mapped IPv6 addresses (::ffff:0:0/96)', () => {
      const ipv4Mapped = [
        'http://[::ffff:127.0.0.1]',
        'http://[::ffff:192.168.1.1]',
        'http://[::ffff:10.0.0.1]',
      ];
      for (const target of ipv4Mapped) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 12: rejects RFC 6761 localhost and *.localhost domains', () => {
      const localhostHosts = [
        'http://localhost',
        'http://localhost:8080',
        'http://foo.localhost',
        'http://api.staging.localhost:3000',
      ];
      for (const target of localhostHosts) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 13: rejects alternative numeric, hex, and octal IP encodings canonicalized by WHATWG parser', () => {
      const altNumeric = [
        'http://2130706433/', // 127.0.0.1 dword
        'http://0177.0.0.1/', // octal 127
        'http://0x7f.0.0.1/', // hex 127
        'http://127.1/', // shorthand 127.0.0.1
      ];
      for (const target of altNumeric) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      }
    });

    it('Case 14: rejects URLs containing embedded credentials', () => {
      const credUrls = [
        'http://admin:secret@example.com/wp-admin',
        'https://user@example.com',
        'http://:password@example.com',
      ];
      for (const target of credUrls) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.INVALID_TARGET_URL }),
        );
      }
    });

    it('Case 15: rejects non-HTTP/HTTPS protocols', () => {
      const invalidProtocols = [
        'ftp://example.com/file.txt',
        'file:///C:/Windows/System32',
        'javascript:alert(1)',
        'ws://example.com/socket',
        'wss://example.com/socket',
        'gopher://example.com',
      ];
      for (const target of invalidProtocols) {
        expect(() => validateTargetUrlSync(target)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.INVALID_TARGET_URL }),
        );
      }
    });

    it('Case 16: rejects malformed URLs, empty strings, and unbounded lengths', () => {
      const malformed = [
        '',
        '   ',
        'not-a-url',
        'http://',
        'https://',
        'http://:8080',
        'a'.repeat(2049),
      ];
      for (const target of malformed) {
        expect(() => validateTargetUrlSync(target as string)).toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.INVALID_TARGET_URL }),
        );
      }
    });
  });

  describe('2. Bounded DNS Resolution & Fail-Closed Hostname Validation (validateTargetUrlAsync)', () => {
    it('Case 17: rejects public domain name resolving to loopback address (127.0.0.1)', async () => {
      const dnsMock = mockDnsLookup(async () => [{ address: '127.0.0.1', family: 4 }]);

      try {
        await expect(validateTargetUrlAsync('http://malicious-rebind.com')).rejects.toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      } finally {
        dnsMock.restore();
      }
    });

    it('Case 18: rejects public domain name resolving to private address (10.0.0.5)', async () => {
      const dnsMock = mockDnsLookup(async () => [{ address: '10.0.0.5', family: 4 }]);

      try {
        await expect(
          validateTargetUrlAsync('http://internal-corp-gateway.com'),
        ).rejects.toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      } finally {
        dnsMock.restore();
      }
    });

    it('Case 19: fail-closed rejection on mixed round-robin DNS answers (1 public + 1 private/loopback)', async () => {
      const dnsMock = mockDnsLookup(async () => [
        { address: '93.184.216.34', family: 4 }, // public example.com IP
        { address: '127.0.0.1', family: 4 }, // loopback IP
      ]);

      try {
        await expect(validateTargetUrlAsync('http://round-robin-rebind.com')).rejects.toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }),
        );
      } finally {
        dnsMock.restore();
      }
    });

    it('Case 20: DNS timeout handling aborts promptly with ERR_DNS_RESOLUTION_FAILED', async () => {
      const dnsMock = mockDnsLookup(
        async () =>
          new Promise<Array<{ address: string; family: number }>>(() => {
            // intentionally hangs indefinitely
          }),
      );

      try {
        await expect(
          validateTargetUrlAsync('http://slow-dns.example.com', {
            timeoutMs: 50, // 50ms bounded timeout
          }),
        ).rejects.toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.DNS_RESOLUTION_FAILED }),
        );
      } finally {
        dnsMock.restore();
      }
    });

    it('Case 21: DNS system error (ENOTFOUND) rejects with ERR_DNS_RESOLUTION_FAILED', async () => {
      const dnsMock = mockDnsLookup(async () => {
        const err = new Error('getaddrinfo ENOTFOUND non-existent.domain');
        (err as unknown as { code: string }).code = 'ENOTFOUND';
        throw err;
      });

      try {
        await expect(validateTargetUrlAsync('http://non-existent.domain')).rejects.toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.DNS_RESOLUTION_FAILED }),
        );
      } finally {
        dnsMock.restore();
      }
    });

    it('Case 22: empty DNS resolution answers ([]) reject with ERR_DNS_RESOLUTION_FAILED', async () => {
      const dnsMock = mockDnsLookup(async () => []);

      try {
        await expect(validateTargetUrlAsync('http://empty-answers.domain')).rejects.toThrowError(
          expect.objectContaining({ code: IPC_ERROR_CODES.DNS_RESOLUTION_FAILED }),
        );
      } finally {
        dnsMock.restore();
      }
    });
  });

  describe('3. Persistence Boundary Invariants: Zero SQLite Records Created on Prohibited Targets', () => {
    it('Case 23: siteService.createSite rejects prohibited targets BEFORE writing any row to sites table', () => {
      const countSitesBefore = siteRepo.listByProject(projectId).total;

      const prohibitedUrls = [
        'http://127.0.0.1:8080',
        'http://localhost',
        'http://169.254.169.254',
        'http://10.0.0.1',
        'http://2130706433',
        'http://admin:pass@example.com',
      ];

      for (const prohibited of prohibitedUrls) {
        expect(() => {
          siteService.createSite({
            projectId,
            name: `Prohibited ${prohibited}`,
            baseUrl: prohibited,
          });
        }).toThrow();
      }

      const countSitesAfter = siteRepo.listByProject(projectId).total;
      expect(countSitesAfter).toBe(countSitesBefore);
      expect(countSitesAfter).toBe(0);
    });

    it('Case 24: scanRunService.createScanRun and orchestrator.createScan reject prohibited targets BEFORE writing to scan_runs', () => {
      // Create one valid site first
      const validSite = siteService.createSite({
        projectId,
        name: 'Valid Public Site',
        baseUrl: 'https://example.com',
      });

      const countScansBefore = scanRunRepo.list({ siteId: validSite.id }).total;
      expect(countScansBefore).toBe(0);

      const prohibitedTargets = [
        'http://127.0.0.1',
        'http://localhost:3000',
        'http://192.168.1.1',
        'http://169.254.169.254/meta',
      ];

      // 1. Verify ScanRunService rejects synchronously before writing any row
      for (const target of prohibitedTargets) {
        expect(() => {
          scanRunService.createScanRun({
            siteId: validSite.id,
            targetUrl: target,
          });
        }).toThrowError(expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }));
      }

      // 2. Verify ScanOrchestrator rejects synchronously before writing any row
      const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);
      for (const target of prohibitedTargets) {
        expect(() => {
          orchestrator.createScan({
            siteId: validSite.id,
            targetUrl: target,
          });
        }).toThrowError(
          expect.objectContaining({
            code: SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SSRF_PROHIBITED_TARGET,
          }),
        );
      }
      orchestrator.dispose();

      const countScansAfter = scanRunRepo.list({ siteId: validSite.id }).total;
      expect(countScansAfter).toBe(0);
    });

    it('Case 25: IPC boundary rejects prohibited targets with ERR_SSRF_PROHIBITED_TARGET with zero rows created', async () => {
      const isolatedIpcMain = createMockIpcMain();
      const validEvent = createAuthorizedEvent();
      const dispatcher = new SecureIpcDispatcher({
        isDev: true,
        isPackaged: false,
        ipcMain: isolatedIpcMain as unknown as typeof import('electron').ipcMain,
      });

      dispatcher.registerHandler(IPC_CHANNELS.SITE_CREATE, createSiteCreateHandler(siteService));
      dispatcher.registerHandler(IPC_CHANNELS.SCAN_CREATE, createScanCreateHandler(scanRunService));

      const siteCreateFn = isolatedIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;
      const scanCreateFn = isolatedIpcMain.handlers.get(IPC_CHANNELS.SCAN_CREATE)!;

      // 1. IPC site:create with loopback -> rejected
      const siteRes = (await siteCreateFn(validEvent, {
        projectId,
        name: 'Loopback Site',
        baseUrl: 'http://127.0.0.1:8080',
      })) as IPCResult<SiteDTO>;

      expect(siteRes.success).toBe(false);
      if (!siteRes.success) {
        expect(siteRes.error.code).toBe(IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET);
      }

      // Zero sites created
      expect(siteRepo.listByProject(projectId).total).toBe(0);

      // Create a legitimate site directly in repo for scan testing
      const legitimateSite = siteRepo.create({
        projectId,
        name: 'Legitimate Site',
        baseUrl: 'https://example.com',
      });

      // 2. IPC scan:create with private IP -> rejected
      const scanRes = (await scanCreateFn(validEvent, {
        siteId: legitimateSite.id,
        targetUrl: 'http://10.0.0.1:8080',
      })) as IPCResult<ScanRunDTO>;

      expect(scanRes.success).toBe(false);
      if (!scanRes.success) {
        expect(scanRes.error.code).toBe(IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET);
      }

      // Zero scan runs created
      expect(scanRunRepo.list({ siteId: legitimateSite.id }).total).toBe(0);

      dispatcher.teardown();
    });

    it('Case 26: valid public targets are accepted cleanly across all application boundaries', async () => {
      const dnsMock = mockDnsLookup(async () => [{ address: '93.184.216.34', family: 4 }]);
      let site: ReturnType<typeof siteService.createSite>;

      try {
        // 1. Synchronous validation passes
        const syncResult = validateTargetUrlSync('https://example.com/blog');
        expect(syncResult.valid).toBe(true);
        expect(syncResult.hostname).toBe('example.com');

        // 2. Async DNS validation passes
        const asyncResult = await validateTargetUrlAsync('https://example.com/blog');
        expect(asyncResult.valid).toBe(true);
        expect(asyncResult.pinnedIp).toBe('93.184.216.34');

        // 3. Site creation succeeds
        site = siteService.createSite({
          projectId,
          name: 'Example Public Site',
          baseUrl: 'https://example.com/blog',
        });
        expect(site.id).toBeDefined();
      } finally {
        dnsMock.restore();
      }
      expect(site.baseUrl).toBe('https://example.com/blog');

      // 4. Scan creation succeeds
      const scan = scanRunService.createScanRun({
        siteId: site.id,
      });
      expect(scan.id).toBeDefined();
      expect(scan.status).toBe('pending');
      expect(scan.targetUrl).toBe('https://example.com/blog');
    });

    it('Case 27: siteService.updateSite and IPC site:update reject prohibited target URLs', async () => {
      // Create a legitimate initial site
      const site = siteService.createSite({
        projectId,
        name: 'Update Target Site',
        baseUrl: 'https://initial-domain.com',
      });

      // 1. Service-level update with loopback -> rejected
      expect(() => {
        siteService.updateSite({
          id: site.id,
          baseUrl: 'http://127.0.0.1:9000',
        });
      }).toThrowError(expect.objectContaining({ code: IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET }));

      // Database record remains unchanged
      const currentSite = siteRepo.getById(site.id)!;
      expect(currentSite.baseUrl).toBe('https://initial-domain.com/');

      // 2. IPC-level update with private range -> rejected
      const isolatedIpcMain = createMockIpcMain();
      const validEvent = createAuthorizedEvent();
      const dispatcher = new SecureIpcDispatcher({
        isDev: true,
        isPackaged: false,
        ipcMain: isolatedIpcMain as unknown as typeof import('electron').ipcMain,
      });

      dispatcher.registerHandler(IPC_CHANNELS.SITE_UPDATE, createSiteUpdateHandler(siteService));
      const siteUpdateFn = isolatedIpcMain.handlers.get(IPC_CHANNELS.SITE_UPDATE)!;

      const updateRes = (await siteUpdateFn(validEvent, {
        id: site.id,
        baseUrl: 'http://192.168.10.1',
      })) as IPCResult<SiteDTO>;

      expect(updateRes.success).toBe(false);
      if (!updateRes.success) {
        expect(updateRes.error.code).toBe(IPC_ERROR_CODES.SSRF_PROHIBITED_TARGET);
      }

      // Database record still remains unchanged
      expect(siteRepo.getById(site.id)!.baseUrl).toBe('https://initial-domain.com/');

      dispatcher.teardown();
    });
  });
});
