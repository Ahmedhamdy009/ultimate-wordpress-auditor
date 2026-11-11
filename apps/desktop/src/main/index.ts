import { app, BrowserWindow, session } from 'electron';
import { IPC_CHANNELS } from '@auditor/shared';
import {
  createMainWindow,
  resolveEffectiveIsDev,
  type ModeResolutionOptions,
  type MainWindowPublicOptions,
} from './window.js';
import {
  APPLICATION_NAME,
  APPLICATION_ID,
  initializeDesktopStorage,
  isDesktopStorageInitialized,
  type StorageConfigurationDependencies,
} from './config/paths.js';
import { handleStartupError, setupGlobalProcessErrorHandlers } from './config/startup-error.js';
import { SecurityWebRequestManager } from './security/csp.js';
import {
  CentralIpcRegistrationManager,
  SecureIpcDispatcher,
  registerCoreIpcHandlers,
  type IpcMainLike,
  type CoreIpcHandlersDependencies,
} from './ipc/index.js';
import { DatabaseConnection, recoverPendingBackupReplacements } from './db/connection.js';
import { getBackupDirectory } from './db/paths.js';
import { MigrationRunner } from './db/migrations/runner.js';
import { ProjectRepository } from './db/repositories/project.repository.js';
import { SiteRepository } from './db/repositories/site.repository.js';
import { ScanRunRepository } from './db/repositories/scan-run.repository.js';
import { FindingRepository } from './db/repositories/finding.repository.js';
import { ReportRepository } from './db/repositories/report.repository.js';
import { ProjectService } from './services/project.service.js';
import { SiteService } from './services/site.service.js';
import { ScanRunService } from './services/scan-run.service.js';
import { FindingService } from './services/finding.service.js';
import { ReportService } from './services/report.service.js';
import { ScanOrchestrator } from './scanner/orchestrator/index.js';
import { getReportsDirectory } from './reports/index.js';

export interface MainProcessDatabaseOptions {
  readonly connection?: DatabaseConnection;
  readonly customDbPath?: string;
  readonly isMemory?: boolean;
  readonly autoInitDatabase?: boolean;
}

export interface MainProcessBootstrapOptions {
  readonly ipcMain?: IpcMainLike;
  readonly handlerDeps?: CoreIpcHandlersDependencies;
  readonly modeOptions?: ModeResolutionOptions;
  readonly storageDeps?: StorageConfigurationDependencies;
  readonly mainWindowOptions?: MainWindowPublicOptions;
  readonly databaseOptions?: MainProcessDatabaseOptions;
}

const CORE_CHANNELS = [
  IPC_CHANNELS.APP_PING,
  IPC_CHANNELS.APP_GET_SYSTEM_INFO,
  IPC_CHANNELS.AUDIT_VALIDATE_TARGET,
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
  IPC_CHANNELS.SCAN_CREATE,
  IPC_CHANNELS.SCAN_GET,
  IPC_CHANNELS.SCAN_LIST,
  IPC_CHANNELS.SCAN_CANCEL,
  IPC_CHANNELS.SCAN_PROGRESS,
  IPC_CHANNELS.FINDING_LIST,
  IPC_CHANNELS.FINDING_GET,
  IPC_CHANNELS.REPORT_CREATE,
  IPC_CHANNELS.REPORT_GET,
  IPC_CHANNELS.REPORT_LIST,
] as const;

let activeDispatcher: SecureIpcDispatcher | null = null;
let activeDatabaseConnection: DatabaseConnection | null = null;
let activeOrchestrator: ScanOrchestrator | null = null;
let isInitialized = false;
let isInitializing = false;
let isLifecycleWired = false;

export function getActiveDatabaseConnection(): DatabaseConnection | null {
  return activeDatabaseConnection;
}

export function getActiveOrchestrator(): ScanOrchestrator | null {
  return activeOrchestrator;
}

function hasUnresolvedCoreChannelRemovals(): boolean {
  return CORE_CHANNELS.some(channel => CentralIpcRegistrationManager.isRemovalFailed(channel));
}

/**
 * Tears down the given dispatcher and preserves `activeDispatcher` if any owned
 * channel remains in `removal_failed` state so subsequent `shutdownMainProcess()`
 * or `initializeMainProcess()` calls can retry removal with the original owner token.
 */
function teardownAndPreserveIfUnresolved(dispatcher: SecureIpcDispatcher): void {
  dispatcher.teardown();

  if (hasUnresolvedCoreChannelRemovals()) {
    activeDispatcher = dispatcher;
  } else if (activeDispatcher === dispatcher) {
    activeDispatcher = null;
  }
}

/**
 * Initializes the Main Process security and IPC infrastructure in the mandatory fail-closed order:
 * 1. Verify desktop filesystem storage paths were configured on D: prior to Electron ready.
 * 2. Initialize trusted Session security configuration (`SecurityWebRequestManager.initialize`).
 * 3. Initialize IPC dispatcher (`SecureIpcDispatcher`).
 * 4. Register the three approved handlers (`app:ping`, `app:get-system-info`, `audit:validate-target`).
 * 5. Create the hardened main `BrowserWindow` (`createMainWindow`).
 *
 * - Rejects synchronous re-entrant calls while initialization is in progress.
 * - Idempotent if already initialized.
 * - Fails closed and tears down partial IPC state if any step fails, retaining `activeDispatcher`
 *   whenever a native `removeHandler` call fails during rollback so cleanup can be retried.
 */
export function initializeMainProcess(options?: MainProcessBootstrapOptions): SecureIpcDispatcher {
  if (isInitializing) {
    throw new Error('Re-entrant Main Process initialization is not permitted');
  }

  if (isInitialized && activeDispatcher !== null) {
    return activeDispatcher;
  }

  isInitializing = true;
  try {
    // If a previous shutdown or rollback left unresolved handler removals, retry cleanup first
    if (activeDispatcher !== null) {
      shutdownMainProcess();
      if (activeDispatcher !== null) {
        throw new Error(
          'Cannot initialize Main Process IPC while previous handler removals remain unresolved',
        );
      }
    }

    const isPackaged =
      options?.modeOptions?.isPackaged ??
      (typeof app !== 'undefined' ? Boolean(app.isPackaged) : false);
    const isDev = resolveEffectiveIsDev(options?.modeOptions);

    // Step 1: Ensure dedicated storage directories on D: were configured before Electron is ready
    if (options?.storageDeps) {
      initializeDesktopStorage({ isDev: !isPackaged, ...options.storageDeps });
    } else if (
      typeof app?.isReady === 'function' &&
      app.isReady() &&
      !isDesktopStorageInitialized()
    ) {
      throw new Error(
        'ERR_STORAGE_INIT_TOO_LATE: Desktop storage paths must be configured before Electron emits ready event',
      );
    }

    // Step 2: Initialize the existing trusted Session security configuration before IPC or windows
    SecurityWebRequestManager.initialize({
      isDev,
      targetSession: session.defaultSession,
    });

    // Step 2.5: Initialize database engine, run migrations, and initialize domain services
    let dbConn: DatabaseConnection | null = options?.databaseOptions?.connection ?? null;
    let projectService = options?.handlerDeps?.projectService;
    let siteService = options?.handlerDeps?.siteService;
    let scanRunService = options?.handlerDeps?.scanRunService;
    let findingService = options?.handlerDeps?.findingService;
    let reportService = options?.handlerDeps?.reportService;
    const shouldInitDb =
      options?.databaseOptions?.autoInitDatabase === true ||
      (options?.databaseOptions?.autoInitDatabase === undefined &&
        (Boolean(options?.databaseOptions?.connection) ||
          Boolean(options?.handlerDeps?.projectService) ||
          Boolean(options?.handlerDeps?.siteService) ||
          Boolean(options?.handlerDeps?.scanRunService)));

    if (
      shouldInitDb &&
      (!projectService || !siteService || !scanRunService || !findingService || !reportService)
    ) {
      try {
        if (!dbConn) {
          dbConn = new DatabaseConnection(options?.databaseOptions?.customDbPath, {
            isMemory: options?.databaseOptions?.isMemory,
          });
        }
        if (!dbConn.isOpen()) {
          dbConn.open();
        }
        const migrationRunner = new MigrationRunner(dbConn);
        migrationRunner.migrateSync();

        const projectRepo = new ProjectRepository(dbConn);
        const siteRepo = new SiteRepository(dbConn);
        const scanRunRepo = new ScanRunRepository(dbConn);
        const findingRepo = new FindingRepository(dbConn);
        const reportRepo = new ReportRepository(dbConn);

        if (!projectService) {
          projectService = new ProjectService(projectRepo);
        }
        if (!siteService) {
          siteService = new SiteService(siteRepo, projectRepo);
        }
        if (!scanRunService) {
          scanRunService = new ScanRunService(scanRunRepo, siteRepo);
        }
        if (!findingService) {
          findingService = new FindingService(findingRepo, scanRunRepo);
        }
        if (!reportService) {
          // Storage confinement follows !isPackaged rather than renderer dev-server mode so
          // unpackaged test/preview launches never reconcile against %APPDATA%\reports.
          reportService = new ReportService(reportRepo, scanRunRepo, {
            siteRepo,
            findingRepo,
            reportsDir: getReportsDirectory({ isDev: !isPackaged }),
          });
        }
        reportService.reconcileStorage();

        let orchestrator = options?.handlerDeps?.orchestrator;
        if (!orchestrator) {
          orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);
          orchestrator.recoverInterruptedScans();
        }
        activeOrchestrator = orchestrator instanceof ScanOrchestrator ? orchestrator : null;

        activeDatabaseConnection = dbConn;

        if (typeof globalThis !== 'undefined') {
          (globalThis as Record<string, unknown>).__activeOrchestrator = activeOrchestrator;
          (globalThis as Record<string, unknown>).__activeDatabaseConnection =
            activeDatabaseConnection;
        }
      } catch (dbErr) {
        if (dbConn && dbConn.isOpen()) {
          dbConn.close();
        }
        activeDatabaseConnection = null;
        throw dbErr;
      }
    }

    // Step 3: Initialize the existing IPC infrastructure
    const dispatcher = new SecureIpcDispatcher({
      isDev,
      isPackaged,
      ipcMain: options?.ipcMain,
    });

    // Step 4: Register the approved core and database handlers (fail-closed with teardown on any error)
    try {
      registerCoreIpcHandlers(dispatcher, {
        ...options?.handlerDeps,
        projectService,
        siteService,
        scanRunService,
        findingService,
        reportService,
        orchestrator: activeOrchestrator ?? options?.handlerDeps?.orchestrator,
      });
    } catch (error) {
      teardownAndPreserveIfUnresolved(dispatcher);
      throw error;
    }

    // Step 5: Create the main BrowserWindow only after security and IPC initialization succeed
    try {
      createMainWindow({
        ...options?.mainWindowOptions,
        modeOptions: options?.modeOptions,
      });
    } catch (error) {
      teardownAndPreserveIfUnresolved(dispatcher);
      throw error;
    }

    activeDispatcher = dispatcher;
    isInitialized = true;
    return dispatcher;
  } finally {
    isInitializing = false;
  }
}

/**
 * Deterministically tears down the active `SecureIpcDispatcher`, unregistering all owned
 * IPC handlers and aborting any in-flight requests via `WebContentsLifecycleManager`.
 */
export function shutdownMainProcess(): void {
  if (activeOrchestrator !== null) {
    try {
      activeOrchestrator.dispose();
    } catch {
      // Ignore orchestrator disposal errors on shutdown
    } finally {
      activeOrchestrator = null;
      if (typeof globalThis !== 'undefined') {
        (globalThis as Record<string, unknown>).__activeOrchestrator = null;
      }
    }
  }

  if (activeDatabaseConnection !== null) {
    try {
      activeDatabaseConnection.close();
    } catch {
      // Ignore database close errors on shutdown
    } finally {
      activeDatabaseConnection = null;
      if (typeof globalThis !== 'undefined') {
        (globalThis as Record<string, unknown>).__activeDatabaseConnection = null;
      }
    }
  }

  if (activeDispatcher === null) {
    isInitialized = false;
    return;
  }

  const dispatcher = activeDispatcher;
  isInitialized = false;
  teardownAndPreserveIfUnresolved(dispatcher);
}

export function resetMainProcessLifecycleForTesting(): void {
  isLifecycleWired = false;
}

/**
 * Restores and focuses the existing main application window when a secondary launch is attempted.
 */
export interface FocusableBrowserWindowLike {
  isDestroyed(): boolean;
  isMinimized?(): boolean;
  isVisible?(): boolean;
  restore?(): void;
  show?(): void;
  focus?(): void;
}

/**
 * Restores and focuses the existing main application window when a secondary launch is attempted.
 */
export function focusExistingApplicationWindow(browserWindowClass?: {
  getAllWindows(): readonly FocusableBrowserWindowLike[];
}): FocusableBrowserWindowLike | null {
  const bwClass =
    browserWindowClass ??
    (typeof BrowserWindow !== 'undefined'
      ? (BrowserWindow as unknown as {
          getAllWindows?(): readonly FocusableBrowserWindowLike[];
        })
      : undefined);
  if (typeof bwClass?.getAllWindows !== 'function') {
    return null;
  }
  const windows = bwClass.getAllWindows().filter(win => !win.isDestroyed());
  const target = windows[0] ?? null;
  if (!target) {
    return null;
  }
  if (typeof target.isMinimized === 'function' && target.isMinimized()) {
    target.restore?.();
  }
  if (
    typeof target.show === 'function' &&
    (typeof target.isVisible !== 'function' || !target.isVisible())
  ) {
    target.show();
  }
  if (typeof target.focus === 'function') {
    target.focus();
  }
  return target;
}

/**
 * Acquires Electron's single-instance lock for the resolved `userData` scope.
 * If another instance already holds the lock, exits immediately before DB init or scan recovery.
 */
export function acquireSingleInstanceLockOrExit(options?: {
  readonly electronApp?: {
    requestSingleInstanceLock?(): boolean;
    on?(event: string, listener: (...args: unknown[]) => void): void;
    quit?(): void;
    exit?(code?: number): void;
  };
  readonly onSecondInstance?: () => void;
}): boolean {
  const electronApp =
    options?.electronApp ??
    (app as unknown as {
      requestSingleInstanceLock?(): boolean;
      on?(event: string, listener: (...args: unknown[]) => void): void;
      quit?(): void;
      exit?(code?: number): void;
    });

  if (typeof electronApp?.requestSingleInstanceLock !== 'function') {
    return true;
  }

  const lockAcquired = electronApp.requestSingleInstanceLock();
  if (!lockAcquired) {
    if (typeof electronApp.quit === 'function') {
      electronApp.quit();
    } else if (typeof electronApp.exit === 'function') {
      electronApp.exit(0);
    }
    return false;
  }

  if (typeof electronApp.on === 'function') {
    electronApp.on('second-instance', () => {
      if (options?.onSecondInstance) {
        options.onSecondInstance();
      } else {
        focusExistingApplicationWindow();
      }
    });
  }

  return true;
}

/**
 * Wires the Electron `app` lifecycle events (`whenReady`, `activate`, `window-all-closed`, `will-quit`).
 * Guarded against duplicate attachment and protected by Electron single-instance locking.
 */
export function setupMainProcessLifecycle(): void {
  if (isLifecycleWired) {
    return;
  }
  isLifecycleWired = true;

  // 1. Configure Windows application branding identity and storage scope before acquiring lock
  if (typeof app?.setName === 'function') {
    app.setName(APPLICATION_NAME);
  }
  if (typeof app?.setAppUserModelId === 'function') {
    app.setAppUserModelId(APPLICATION_ID);
  }

  const isDev = typeof app !== 'undefined' ? !app.isPackaged : true;
  // Synchronously configure storage paths before single-instance lock & ready
  // (honors explicit isolated --user-data-dir / AUDITOR_USER_DATA_DIR, D: in dev, %APPDATA% in prod)
  initializeDesktopStorage({ isDev });

  // 2. Enforce strict single-instance protection BEFORE opening SQLite, restoring backups,
  // running interrupted-scan recovery, or launching services that mutate scan state.
  if (!acquireSingleInstanceLockOrExit()) {
    return;
  }

  // 3. Attach global uncaught exception and unhandled rejection handlers for the owning instance
  setupGlobalProcessErrorHandlers({
    cleanup: () => {
      shutdownMainProcess();
    },
  });

  try {
    recoverPendingBackupReplacements(getBackupDirectory());
  } catch {
    // Non-fatal startup recovery
  }

  void app
    .whenReady()
    .then(() => {
      initializeMainProcess({
        databaseOptions: { autoInitDatabase: true },
      });

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow();
        }
      });
    })
    .catch((startupErr: unknown) => {
      handleStartupError(startupErr, { source: 'whenReady' });
      shutdownMainProcess();
      if (typeof app?.quit === 'function') {
        app.quit();
      }
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    shutdownMainProcess();
  });
}

if (typeof app?.whenReady === 'function' && typeof app?.on === 'function') {
  setupMainProcessLifecycle();
}
