/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  type IPCResult,
  type ProjectDTO,
  type ProjectListResponseDTO,
  type ArchiveProjectResultDTO,
  type SiteDTO,
  type SiteListResponseDTO,
} from '@auditor/shared';
import { SecureIpcDispatcher } from '../../src/main/ipc/dispatcher.js';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ProjectService } from '../../src/main/services/project.service.js';
import { SiteService } from '../../src/main/services/site.service.js';
import { registerDatabaseIpcHandlers } from '../../src/main/ipc/project-site-handlers.js';
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
  const webContentsId = 801;
  const windowId = 80;
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

describe('Phase 2.2 — Database IPC Handlers Integration', () => {
  let connection: DatabaseConnection;
  let projectService: ProjectService;
  let siteService: SiteService;
  let mockIpcMain: MockIpcMain;
  let dispatcher: SecureIpcDispatcher;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    const projectRepo = new ProjectRepository(connection);
    const siteRepo = new SiteRepository(connection);
    projectService = new ProjectService(projectRepo);
    siteService = new SiteService(siteRepo, projectRepo);

    mockIpcMain = createMockIpcMain();
    dispatcher = new SecureIpcDispatcher({
      isDev: true,
      isPackaged: false,
      ipcMain: mockIpcMain as unknown as typeof import('electron').ipcMain,
    });

    registerDatabaseIpcHandlers(dispatcher, {
      projectService,
      siteService,
    });
  });

  afterEach(() => {
    while (activeCleanups.length > 0) {
      const cleanup = activeCleanups.pop();
      try {
        cleanup?.();
      } catch {
        // Safe cleanup
      }
    }
    dispatcher.teardown();
    connection.close();
  });

  it('registers all 12 database IPC channels on dispatcher', () => {
    const expectedChannels = [
      IPC_CHANNELS.PROJECT_CREATE,
      IPC_CHANNELS.PROJECT_GET,
      IPC_CHANNELS.PROJECT_LIST,
      IPC_CHANNELS.PROJECT_UPDATE,
      IPC_CHANNELS.PROJECT_ARCHIVE,
      IPC_CHANNELS.PROJECT_RESTORE,
      IPC_CHANNELS.SITE_CREATE,
      IPC_CHANNELS.SITE_GET,
      IPC_CHANNELS.SITE_LIST,
      IPC_CHANNELS.SITE_UPDATE,
      IPC_CHANNELS.SITE_ARCHIVE,
      IPC_CHANNELS.SITE_RESTORE,
    ];

    for (const channel of expectedChannels) {
      expect(mockIpcMain.handlers.has(channel)).toBe(true);
    }
  });

  describe('Project IPC Operations', () => {
    it('creates, retrieves, updates, archives, and restores a project via IPC', async () => {
      const validEvent = createAuthorizedEvent();
      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_CREATE)!;

      // 1. project:create
      const createRes = (await createFn(validEvent, {
        name: 'IPC Test Project',
        description: 'Created through secure IPC',
      })) as IPCResult<ProjectDTO>;

      expect(createRes.success).toBe(true);
      if (!createRes.success) return;
      const project = createRes.data;
      expect(project.name).toBe('IPC Test Project');
      expect(project.description).toBe('Created through secure IPC');

      // 2. project:get
      const getFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_GET)!;
      const getRes = (await getFn(validEvent, { id: project.id })) as IPCResult<ProjectDTO>;
      expect(getRes.success).toBe(true);
      if (!getRes.success) return;
      expect(getRes.data.id).toBe(project.id);

      // 3. project:list
      const listFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_LIST)!;
      const listRes = (await listFn(validEvent, {
        search: 'IPC Test',
      })) as IPCResult<ProjectListResponseDTO>;
      expect(listRes.success).toBe(true);
      if (!listRes.success) return;
      expect(listRes.data.items.length).toBe(1);

      // 4. project:update
      const updateFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_UPDATE)!;
      const updateRes = (await updateFn(validEvent, {
        id: project.id,
        name: 'IPC Updated Project',
      })) as IPCResult<ProjectDTO>;
      expect(updateRes.success).toBe(true);
      if (!updateRes.success) return;
      expect(updateRes.data.name).toBe('IPC Updated Project');

      // 5. project:archive
      const archiveFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_ARCHIVE)!;
      const archiveRes = (await archiveFn(validEvent, {
        id: project.id,
      })) as IPCResult<ArchiveProjectResultDTO>;
      expect(archiveRes.success).toBe(true);

      // 6. project:restore
      const restoreFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_RESTORE)!;
      const restoreRes = (await restoreFn(validEvent, {
        id: project.id,
      })) as IPCResult<ProjectDTO>;
      expect(restoreRes.success).toBe(true);
      if (!restoreRes.success) return;
      expect(restoreRes.data.isArchived).toBe(false);
    });

    it('rejects invalid payload or duplicate name with safe IPC error', async () => {
      const validEvent = createAuthorizedEvent();
      const createFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_CREATE)!;

      // Create initial
      await createFn(validEvent, { name: 'Existing Project' });

      // Duplicate attempt
      const dupRes = (await createFn(validEvent, {
        name: 'Existing Project',
      })) as IPCResult<ProjectDTO>;

      expect(dupRes.success).toBe(false);
      if (dupRes.success) return;
      expect(dupRes.error.code).toBe(IPC_ERROR_CODES.PROJECT_NAME_EXISTS);
    });
  });

  describe('Site IPC Operations', () => {
    it('creates, lists, updates, archives, and restores a site via IPC', async () => {
      const validEvent = createAuthorizedEvent();

      // Create parent project first
      const createProjFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_CREATE)!;
      const projRes = (await createProjFn(validEvent, {
        name: 'Site Host Project',
      })) as IPCResult<ProjectDTO>;
      expect(projRes.success).toBe(true);
      if (!projRes.success) return;
      const projectId = projRes.data.id;

      // 1. site:create
      const createSiteFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;
      const createSiteRes = (await createSiteFn(validEvent, {
        projectId,
        name: 'Production Store',
        baseUrl: 'HTTPS://Store.COM:443/',
        platformType: 'wordpress',
        environmentType: 'production',
      })) as IPCResult<SiteDTO>;

      expect(createSiteRes.success).toBe(true);
      if (!createSiteRes.success) return;
      const site = createSiteRes.data;
      expect(site.baseUrl).toBe('https://store.com/');
      expect(site.platformType).toBe('wordpress');

      // 2. site:get
      const getSiteFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_GET)!;
      const getSiteRes = (await getSiteFn(validEvent, { id: site.id })) as IPCResult<SiteDTO>;
      expect(getSiteRes.success).toBe(true);
      if (!getSiteRes.success) return;
      expect(getSiteRes.data.id).toBe(site.id);

      // 3. site:list
      const listSitesFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_LIST)!;
      const listSitesRes = (await listSitesFn(validEvent, {
        projectId,
      })) as IPCResult<SiteListResponseDTO>;
      expect(listSitesRes.success).toBe(true);
      if (!listSitesRes.success) return;
      expect(listSitesRes.data.items.length).toBe(1);

      // 4. site:update
      const updateSiteFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_UPDATE)!;
      const updateSiteRes = (await updateSiteFn(validEvent, {
        id: site.id,
        name: 'Updated Store Name',
      })) as IPCResult<SiteDTO>;
      expect(updateSiteRes.success).toBe(true);
      if (!updateSiteRes.success) return;
      expect(updateSiteRes.data.name).toBe('Updated Store Name');

      // 5. site:archive
      const archiveSiteFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_ARCHIVE)!;
      const archiveSiteRes = (await archiveSiteFn(validEvent, {
        id: site.id,
      })) as IPCResult<SiteDTO>;
      expect(archiveSiteRes.success).toBe(true);
      if (!archiveSiteRes.success) return;
      expect(archiveSiteRes.data.isArchived).toBe(true);

      // 6. site:restore
      const restoreSiteFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_RESTORE)!;
      const restoreSiteRes = (await restoreSiteFn(validEvent, {
        id: site.id,
      })) as IPCResult<SiteDTO>;
      expect(restoreSiteRes.success).toBe(true);
      if (!restoreSiteRes.success) return;
      expect(restoreSiteRes.data.isArchived).toBe(false);
    });

    it('rejects site creation with invalid protocol or duplicate URL', async () => {
      const validEvent = createAuthorizedEvent();
      const createProjFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_CREATE)!;
      const projRes = (await createProjFn(validEvent, {
        name: 'Validation Project',
      })) as IPCResult<ProjectDTO>;
      if (!projRes.success) return;
      const projectId = projRes.data.id;

      const createSiteFn = mockIpcMain.handlers.get(IPC_CHANNELS.SITE_CREATE)!;

      // Invalid protocol
      const protoRes = (await createSiteFn(validEvent, {
        projectId,
        name: 'FTP Site',
        baseUrl: 'ftp://ftp.server.com',
      })) as IPCResult<SiteDTO>;
      expect(protoRes.success).toBe(false);
      if (protoRes.success) return;
      expect(protoRes.error.code).toBe(IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED);

      // Valid site
      await createSiteFn(validEvent, {
        projectId,
        name: 'Valid Site',
        baseUrl: 'https://site.com',
      });

      // Duplicate URL
      const dupRes = (await createSiteFn(validEvent, {
        projectId,
        name: 'Duplicate Site',
        baseUrl: 'https://site.com/',
      })) as IPCResult<SiteDTO>;
      expect(dupRes.success).toBe(false);
      if (dupRes.success) return;
      expect(dupRes.error.code).toBe(IPC_ERROR_CODES.SITE_URL_EXISTS);
    });
  });

  describe('Security & Dispatcher Hardening', () => {
    it('rejects requests from unauthorized subframes via SenderGuard', async () => {
      const unauthorizedSubframeEvent = createAuthorizedEvent({ isSubFrame: true });

      const createProjFn = mockIpcMain.handlers.get(IPC_CHANNELS.PROJECT_CREATE)!;
      const result = (await createProjFn(unauthorizedSubframeEvent, {
        name: 'Unauthorized Project',
      })) as IPCResult<ProjectDTO>;

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe(IPC_ERROR_CODES.UNAUTHORIZED_SENDER);
    });
  });
});
