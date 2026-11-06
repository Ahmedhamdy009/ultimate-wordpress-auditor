import { app, BrowserWindow, session } from 'electron';
import { IPC_CHANNELS } from '@auditor/shared';
import { createMainWindow } from './window.js';
import { SecurityWebRequestManager } from './security/csp.js';
import {
  CentralIpcRegistrationManager,
  SecureIpcDispatcher,
  registerCoreIpcHandlers,
  type IpcMainLike,
  type CoreIpcHandlersDependencies,
} from './ipc/index.js';

export interface MainProcessBootstrapOptions {
  readonly ipcMain?: IpcMainLike;
  readonly handlerDeps?: CoreIpcHandlersDependencies;
}

const CORE_CHANNELS = [
  IPC_CHANNELS.APP_PING,
  IPC_CHANNELS.APP_GET_SYSTEM_INFO,
  IPC_CHANNELS.AUDIT_VALIDATE_TARGET,
] as const;

let activeDispatcher: SecureIpcDispatcher | null = null;
let isInitialized = false;
let isInitializing = false;
let isLifecycleWired = false;

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
 * 1. (Caller ensures Electron app is ready)
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

    const isPackaged = Boolean(app?.isPackaged);
    const isDev = !isPackaged;

    // Step 2: Initialize the existing trusted Session security configuration before IPC or windows
    SecurityWebRequestManager.initialize({
      isDev,
      targetSession: session.defaultSession,
    });

    // Step 3: Initialize the existing IPC infrastructure
    const dispatcher = new SecureIpcDispatcher({
      isDev,
      isPackaged,
      ipcMain: options?.ipcMain,
    });

    // Step 4: Register the three approved handlers (fail-closed with teardown on any error)
    try {
      registerCoreIpcHandlers(dispatcher, options?.handlerDeps);
    } catch (error) {
      teardownAndPreserveIfUnresolved(dispatcher);
      throw error;
    }

    // Step 5: Create the main BrowserWindow only after security and IPC initialization succeed
    try {
      createMainWindow();
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
  if (activeDispatcher === null) {
    isInitialized = false;
    return;
  }

  const dispatcher = activeDispatcher;
  isInitialized = false;
  teardownAndPreserveIfUnresolved(dispatcher);
}

/**
 * Wires the Electron `app` lifecycle events (`whenReady`, `activate`, `window-all-closed`, `will-quit`).
 * Guarded against duplicate attachment.
 */
export function setupMainProcessLifecycle(): void {
  if (isLifecycleWired) {
    return;
  }
  isLifecycleWired = true;

  void app
    .whenReady()
    .then(() => {
      initializeMainProcess();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow();
        }
      });
    })
    .catch(() => {
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
