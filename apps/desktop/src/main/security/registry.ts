import type { BrowserWindow, WebContents } from 'electron';

export type SecurityState = 'CONFIRMED_ACTIVE' | 'CONFIRMED_INACTIVE' | 'UNVERIFIABLE';

export interface SecuritySnapshotOptions {
  contextIsolation: SecurityState;
  nodeIntegration: SecurityState;
  nodeIntegrationInWorker: SecurityState;
  sandbox: SecurityState;
  webSecurity: SecurityState;
  allowRunningInsecureContent: SecurityState;
}

export interface WindowSecuritySnapshot {
  windowId: number;
  webContentsId: number;
  createdAt: number;
  options: Readonly<SecuritySnapshotOptions>;
}

interface RegistrationRecord {
  token: symbol;
  windowId: number;
  webContentsId: number;
  snapshot: WindowSecuritySnapshot;
  win: BrowserWindow;
}

/**
 * Internal private registry storing active window security records.
 * Encapsulated strictly at module scope to prevent unauthorized tampering.
 */
const activeRecords = new Map<number, RegistrationRecord>();

/**
 * Internal removal of a window registration.
 * If expectedToken is provided, only deletes if the record token matches,
 * preventing delayed destruction callbacks from removing recycled window IDs.
 */
function internalUnregister(webContentsId: number, expectedToken?: symbol): boolean {
  const record = activeRecords.get(webContentsId);
  if (!record) {
    return false;
  }

  if (expectedToken && record.token !== expectedToken) {
    return false; // Token mismatch: delayed cleanup from older registration ignored
  }

  activeRecords.delete(webContentsId);
  return true;
}

export class WindowSecurityRegistry {
  /**
   * Evaluates a security option against its required secure value.
   * If undefined or null, returns UNVERIFIABLE (absence of an option is never assumed safe).
   */
  public static evaluateOption(
    value: boolean | undefined | null,
    secureValue: boolean,
  ): SecurityState {
    if (value === undefined || value === null) {
      return 'UNVERIFIABLE';
    }
    return value === secureValue ? 'CONFIRMED_ACTIVE' : 'CONFIRMED_INACTIVE';
  }

  /**
   * Registers a BrowserWindow and takes an immutable, deeply-frozen snapshot of the options passed at creation.
   * Protects against duplicate registrations and binds a unique registration token strictly internal to the record.
   */
  public static register(
    win: BrowserWindow,
    webPreferences?: Electron.WebPreferences,
  ): WindowSecuritySnapshot {
    if (!win || win.isDestroyed()) {
      throw new Error('ERR_CANNOT_REGISTER_DESTROYED_WINDOW');
    }

    const webContents = win.webContents;
    if (!webContents || webContents.isDestroyed()) {
      throw new Error('ERR_CANNOT_REGISTER_DESTROYED_WEBCONTENTS');
    }

    const webContentsId = webContents.id;
    const windowId = win.id;

    // Duplicate registration protection: safely unregister existing entry before re-registering
    if (activeRecords.has(webContentsId)) {
      internalUnregister(webContentsId);
    }

    const registrationToken = Symbol(`window_reg_${webContentsId}_${Date.now()}`);

    const rawSnapshot: WindowSecuritySnapshot = {
      windowId,
      webContentsId,
      createdAt: Date.now(),
      options: Object.freeze({
        contextIsolation: this.evaluateOption(webPreferences?.contextIsolation, true),
        nodeIntegration: this.evaluateOption(webPreferences?.nodeIntegration, false),
        nodeIntegrationInWorker: this.evaluateOption(
          webPreferences?.nodeIntegrationInWorker,
          false,
        ),
        sandbox: this.evaluateOption(webPreferences?.sandbox, true),
        webSecurity: this.evaluateOption(webPreferences?.webSecurity, true),
        allowRunningInsecureContent: this.evaluateOption(
          webPreferences?.allowRunningInsecureContent,
          false,
        ),
      }),
    };

    const frozenSnapshot = Object.freeze(rawSnapshot);

    activeRecords.set(webContentsId, {
      token: registrationToken,
      windowId,
      webContentsId,
      snapshot: frozenSnapshot,
      win,
    });

    // Auto-cleanup on destruction bound strictly to this registration's unique token
    const cleanup = () => {
      internalUnregister(webContentsId, registrationToken);
    };

    win.once('closed', cleanup);
    webContents.once('destroyed', cleanup);

    return this.getSnapshot(webContentsId)!;
  }

  /**
   * Retrieves a deeply-frozen defensive copy of the snapshot for a given webContentsId.
   */
  public static getSnapshot(webContentsId: number): WindowSecuritySnapshot | undefined {
    const record = activeRecords.get(webContentsId);
    if (!record) {
      return undefined;
    }

    const defensiveCopy: WindowSecuritySnapshot = {
      windowId: record.snapshot.windowId,
      webContentsId: record.snapshot.webContentsId,
      createdAt: record.snapshot.createdAt,
      options: Object.freeze({ ...record.snapshot.options }),
    };

    return Object.freeze(defensiveCopy);
  }

  /**
   * Validates whether all 6 security properties in a snapshot are CONFIRMED_ACTIVE.
   */
  public static isSnapshotSecure(snapshot: WindowSecuritySnapshot): boolean {
    const opts = snapshot.options;
    return (
      opts.contextIsolation === 'CONFIRMED_ACTIVE' &&
      opts.nodeIntegration === 'CONFIRMED_ACTIVE' &&
      opts.nodeIntegrationInWorker === 'CONFIRMED_ACTIVE' &&
      opts.sandbox === 'CONFIRMED_ACTIVE' &&
      opts.webSecurity === 'CONFIRMED_ACTIVE' &&
      opts.allowRunningInsecureContent === 'CONFIRMED_ACTIVE'
    );
  }

  /**
   * Verifies if a given WebContents and its associated BrowserWindow are currently valid, matching, and secure.
   */
  public static verifyLivenessAndSecurity(webContents: WebContents): {
    isValid: boolean;
    errorCode?: string;
    snapshot?: WindowSecuritySnapshot;
  } {
    if (!webContents || webContents.isDestroyed()) {
      return { isValid: false, errorCode: 'ERR_WEBCONTENTS_DESTROYED' };
    }

    const record = activeRecords.get(webContents.id);
    if (!record) {
      return { isValid: false, errorCode: 'ERR_UNREGISTERED_WINDOW' };
    }

    const { win, snapshot, token } = record;
    if (!win || win.isDestroyed() || win.id !== snapshot.windowId) {
      internalUnregister(webContents.id, token);
      return { isValid: false, errorCode: 'ERR_BROWSER_WINDOW_DESTROYED' };
    }

    if (win.webContents !== webContents) {
      internalUnregister(webContents.id, token);
      return { isValid: false, errorCode: 'ERR_WEBCONTENTS_WINDOW_MISMATCH' };
    }

    if (!this.isSnapshotSecure(snapshot)) {
      return {
        isValid: false,
        errorCode: 'ERR_INSECURE_WINDOW_SNAPSHOT',
        snapshot: this.getSnapshot(webContents.id),
      };
    }

    return { isValid: true, snapshot: this.getSnapshot(webContents.id) };
  }
}
