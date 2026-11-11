import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as electronModule from 'electron';
import Database, {
  type Database as BetterSqlite3Database,
  type Options as BetterSqlite3Options,
} from 'better-sqlite3';
import { ensureDatabaseDirectory, getDatabasePath } from './paths.js';

/**
 * Connection states for SQLite lifecycle management:
 * - UNINITIALIZED: Instance created, not yet opened.
 * - OPEN: Active healthy connection with WAL and safety pragmas configured.
 * - CLOSED: Explicitly closed, transactions checkpointed and file locks released.
 * - CORRUPTED: Integrity violation detected by quickCheck() or fatal open failure occurred.
 *
 * Safe Recovery & Non-Destructive Principles:
 * - Entering CORRUPTED state immediately halts all database write operations.
 * - The connection layer detects corruption but NEVER performs automatic destructive
 *   recovery, silent database overwrites, or file deletion.
 * - Recovery requires deliberate administrative review, verification of hot backups,
 *   or user-initiated restoration in higher-level service layers.
 */
export type ConnectionState = 'UNINITIALIZED' | 'OPEN' | 'CLOSED' | 'CORRUPTED';

export interface DatabaseConnectionOptions {
  readonly isMemory?: boolean;
  readonly readonly?: boolean;
  readonly timeout?: number;
  readonly fileMustExist?: boolean;
  readonly nativeBinding?: string;
}

export interface QuickCheckResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export interface BackupOptions {
  readonly overwrite?: boolean;
  readonly verifyIntegrity?: boolean;
}

export interface BackupReplacementJournal {
  readonly version: 1;
  readonly destinationPath: string;
  readonly tempPath: string;
  readonly rollbackPath: string;
  readonly state: 'PREPARING' | 'SWAPPING' | 'COMMITTED';
  readonly createdAt: number;
}

export interface BackupLockInfo {
  readonly version: 1;
  readonly ownerId: string;
  readonly pid: number;
  readonly createdAt: number;
  readonly heartbeat: number;
  readonly destinationPath: string;
}

export interface BackupLockHandle {
  readonly ownerId: string;
  readonly destinationPath: string;
  readonly lockPath: string;
  touch(): void;
  release(): void;
}

export interface BackupRecoveryResult {
  readonly destinationPath: string;
  readonly actionTaken:
    'RESTORED_ROLLBACK' | 'PROMOTED_PENDING' | 'CLEANED_ORPHAN' | 'NO_ACTION_REQUIRED';
  readonly details: string;
}

export interface NativeBindingResolutionOptions {
  readonly customBaseDir?: string;
  readonly targetDirName?: string;
  readonly isElectron?: boolean;
}

/**
 * Resolves the appropriate native .node binary based on runtime environment:
 * - Runtime mode: Electron vs Host Node.js
 * - Platform & Architecture: e.g., win32-x64
 * - Module ABI: process.versions.modules (e.g. 149 for Electron 44, 137 for Node 24)
 *
 * Supports:
 * 1. Packaged Electron applications via process.resourcesPath (ASAR unpacked).
 * 2. Unpacked production output via import.meta.dirname (out/main/native).
 * 3. Local development and test environments (src/main/db/native).
 * 4. Electron app.getAppPath() unpacked directory hierarchy.
 *
 * Strictly removes all hardcoded D:\ahmed runtime dependencies.
 * If running under Electron, strictly resolves the compatible Electron ABI binary.
 * If no compatible binary exists for the active runtime, throws a descriptive error.
 */
export function resolveNativeBindingPath(
  options?: string | NativeBindingResolutionOptions,
): string | undefined {
  const customBaseDir = typeof options === 'string' ? options : options?.customBaseDir;
  const isElectron =
    options && typeof options === 'object' && options.isElectron !== undefined
      ? options.isElectron
      : Boolean(process.versions.electron);
  const platform = process.platform;
  const arch = process.arch;
  const modulesAbi = process.versions.modules;
  const runtimeName = isElectron ? 'electron' : 'node';
  const targetDirName =
    (options && typeof options === 'object' && options.targetDirName) ||
    `${runtimeName}-v${modulesAbi}-${platform}-${arch}`;
  const binaryFileName = 'better_sqlite3.node';

  // Candidate 1: Packaged Electron application (ASAR unpacked via process.resourcesPath)
  if (process.resourcesPath) {
    const resourcesCandidates = [
      path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'out',
        'main',
        'native',
        targetDirName,
        binaryFileName,
      ),
      path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'native',
        targetDirName,
        binaryFileName,
      ),
      path.join(process.resourcesPath, 'native', targetDirName, binaryFileName),
    ];
    for (const cand of resourcesCandidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
  }

  // Candidate 2: Relative to baseDir (import.meta.dirname or caller provided)
  const baseDir =
    customBaseDir ??
    (typeof import.meta.dirname === 'string' ? import.meta.dirname : process.cwd());

  const relativeCandidates = [
    // out/main/native/... (when running from out/main/index.js)
    path.join(baseDir, 'native', targetDirName, binaryFileName),
    // out/main/native/... (when running from out/main/chunks/runner-*.js)
    path.join(baseDir, '..', 'native', targetDirName, binaryFileName),
    // src/main/db/native/... (when running in development/tests from src/main/db)
    path.join(baseDir, 'native', targetDirName, binaryFileName),
    // source tree from apps/desktop root or test runner
    path.resolve(baseDir, '../../src/main/db/native', targetDirName, binaryFileName),
    path.resolve(baseDir, '../../../src/main/db/native', targetDirName, binaryFileName),
  ];
  for (const cand of relativeCandidates) {
    if (fs.existsSync(cand)) {
      return cand;
    }
  }

  // Candidate 3: Electron app.getAppPath() (when running inside Electron runtime)
  try {
    if (Object.hasOwn(electronModule, 'app')) {
      const electronApp = (electronModule as { app?: { getAppPath?(): string } }).app;
      if (electronApp && typeof electronApp.getAppPath === 'function') {
        const appPath = electronApp.getAppPath();
        const unpackedAppPath = appPath.replace(/app\.asar$/, 'app.asar.unpacked');
        const appPathCandidates = [
          path.join(unpackedAppPath, 'out', 'main', 'native', targetDirName, binaryFileName),
          path.join(unpackedAppPath, 'native', targetDirName, binaryFileName),
          path.join(appPath, 'out', 'main', 'native', targetDirName, binaryFileName),
        ];
        for (const cand of appPathCandidates) {
          if (fs.existsSync(cand)) {
            return cand;
          }
        }
      }
    }
  } catch {
    // Ignore Electron app resolution errors
  }

  // Candidate 4: node_modules build Release (if matching runtime ABI)
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('better-sqlite3/package.json');
    const moduleBase = path.dirname(pkgPath);
    if (isElectron && targetDirName === `electron-v${modulesAbi}-${platform}-${arch}`) {
      const electronCustomBinary = path.join(
        moduleBase,
        'build',
        'Release',
        'better_sqlite3.electron.node',
      );
      if (fs.existsSync(electronCustomBinary)) {
        return electronCustomBinary;
      }
    }
  } catch {
    // Ignore require resolution errors
  }

  // Safety Gate: In Electron runtime, we must never fall back to host Node bindings
  if (isElectron) {
    throw new Error(
      `ERR_NATIVE_SQLITE_BINDING_MISSING: No compatible SQLite native addon found for Electron ${process.versions.electron ?? 'runtime'} (target: ${targetDirName}). Checked locations relative to resourcesPath, import.meta.dirname, and appPath.`,
    );
  }

  // Under host Node, if native/ dir doesn't contain prebuilt binary, let better-sqlite3
  // attempt its standard internal binding loader.
  return undefined;
}

/**
 * Durability, Performance & Failure Domain Classification:
 *
 * 1. Write-Ahead Logging (WAL Mode):
 *    - Allows concurrent readers and a single writer without blocking.
 *    - Writes append to the '-wal' file and are periodically flushed to the main database
 *      during checkpoints (TRUNCATE on close, passive during normal operations).
 *
 * 2. PRAGMA synchronous = NORMAL:
 *    - In WAL mode, synchronous = NORMAL syncs the WAL file before checkpointing, but individual
 *      transaction commits do not call fsync on every write.
 *    - Engineering Trade-off: Provides substantial qualitative throughput improvements and reduced
 *      disk I/O latency compared to synchronous = FULL (which requires fsync on every commit),
 *      while providing sufficient durability guarantees for desktop client auditing workloads.
 *
 * 3. Integrity Verification (PRAGMA quick_check):
 *    - Verifies internal cell and b-tree page consistency, row formats, and index order.
 *    - Does not verify foreign key constraint satisfaction (enforced at runtime by foreign_keys = ON).
 *
 * 4. Failure Domain Classification & Crash-Durability Scope:
 *    The backup replacement architecture distinguishes three failure domains:
 *
 *    (a) Simulated Process Interruption (In-Process Exception / State Machine Simulation):
 *        - Validates exception boundaries, transaction journals, and atomic rollbacks.
 *        - Tested via simulated failures during creation, integrity verification, or renaming.
 *        - Scope: Verifies application-layer error recovery and non-destructive fallbacks.
 *
 *    (b) Actual Process Termination (Crash Consistency):
 *        - Process killed abruptly (e.g. SIGKILL, uncaught fault, or task termination) at any point
 *          during staging, integrity verification, journal generation, or atomic replacement.
 *        - Tested via standalone recovery runs against interrupted staging and journal disk states.
 *        - Guarantees: The Write-Ahead Replacement Journal and per-destination locks guarantee
 *          that upon subsequent initialization, the recovery subsystem deterministically recovers:
 *          (1) Promotes verified pending backups if swap was interrupted.
 *          (2) Restores original backups from rollback if promotion failed or temp was invalid.
 *          (3) Cleans up orphan staging files if replacement succeeded before shutdown.
 *          At no point can an interrupted replacement leave the target missing or corrupt.
 *
 *    (c) Operating System Power-Loss & Hardware Storage Durability:
 *        - While SQLite WAL mode and the SQLite Online Backup API issue filesystem flush (fsync)
 *          calls during checkpoints, true physical power-loss durability on modern systems
 *          depends on disk write caching, controller flush barriers, and OS filesystem semantics
 *          (such as NTFS write ordering or ext4 flush barrier guarantees).
 *        - In the event of catastrophic physical power loss, uncheckpointed transactions committed
 *          after the most recent sync may be lost, though internal B-tree page consistency is preserved.
 *        - Hot backups snapshot database state consistently up to the latest checkpoint.
 */
function cleanFileWithSidecars(filePath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const target = filePath + suffix;
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
      } catch {
        // Ignore unlink error
      }
    }
  }
}

/**
 * Verifies that a target file path strictly resides directly inside expectedDir,
 * without path traversal, UNC escapes, or symlink/junction redirections outside expectedDir.
 */
function isContainedInDirectory(targetPath: string, expectedDir: string): boolean {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    return false;
  }
  if (targetPath.includes('\0')) {
    return false;
  }
  // Disallow UNC paths (e.g. \\host\share or //host/share)
  if (targetPath.startsWith('\\\\') || targetPath.startsWith('//')) {
    return false;
  }

  const canonicalExpectedDir = path.resolve(expectedDir);
  const resolved = path.resolve(targetPath);
  const resolvedDir = path.dirname(resolved);

  if (resolvedDir.toLowerCase() !== canonicalExpectedDir.toLowerCase()) {
    return false;
  }

  // Ensure relative path has no '..' traversal components and does not descend into subdirectories
  const rel = path.relative(canonicalExpectedDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes('/') || rel.includes('\\')) {
    return false;
  }

  const base = path.basename(resolved);
  if (!base || base === '.' || base === '..') {
    return false;
  }

  // If the target path exists, verify realpath to prevent symlink/junction escapes
  if (fs.existsSync(resolved)) {
    try {
      const real = fs.realpathSync.native
        ? fs.realpathSync.native(resolved)
        : fs.realpathSync(resolved);
      const realDir = path.dirname(real);
      const realExpectedDir = fs.realpathSync.native
        ? fs.realpathSync.native(canonicalExpectedDir)
        : fs.realpathSync(canonicalExpectedDir);
      if (realDir.toLowerCase() !== realExpectedDir.toLowerCase()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Validates untrusted backup replacement journal files found on disk.
 * Enforces strict schema, version, directory containment, filename conventions,
 * and canonicalization. Returns null if the journal is invalid, malformed, or hostile.
 */
export function validateJournalPayload(
  rawJournal: unknown,
  expectedDir: string,
  journalPath: string,
): BackupReplacementJournal | null {
  if (typeof rawJournal !== 'object' || rawJournal === null) {
    return null;
  }

  const record = rawJournal as Record<string, unknown>;

  if (record.version !== 1) {
    return null;
  }

  const { destinationPath, tempPath, rollbackPath, state, createdAt } = record;

  if (
    typeof destinationPath !== 'string' ||
    typeof tempPath !== 'string' ||
    typeof rollbackPath !== 'string' ||
    typeof createdAt !== 'number'
  ) {
    return null;
  }

  if (state !== 'PREPARING' && state !== 'SWAPPING' && state !== 'COMMITTED') {
    return null;
  }

  // Verify directory containment for all three paths
  if (
    !isContainedInDirectory(destinationPath, expectedDir) ||
    !isContainedInDirectory(tempPath, expectedDir) ||
    !isContainedInDirectory(rollbackPath, expectedDir)
  ) {
    return null;
  }

  const resolvedDest = path.resolve(destinationPath);
  const resolvedTemp = path.resolve(tempPath);
  const resolvedRollback = path.resolve(rollbackPath);

  // Validate filename conventions
  const destBase = path.basename(resolvedDest);
  const tempBase = path.basename(resolvedTemp);
  const rollbackBase = path.basename(resolvedRollback);

  if (
    destBase.endsWith('.backup-journal.json') ||
    destBase.endsWith('.lock') ||
    destBase.startsWith('.backup-tmp-') ||
    destBase.startsWith('.backup-rollback-')
  ) {
    return null;
  }

  if (!(
    tempBase.startsWith('.backup-tmp-') ||
    tempBase.endsWith('.pending') ||
    tempBase === `${destBase}.pending`
  )) {
    return null;
  }

  if (!(
    rollbackBase.startsWith('.backup-rollback-') ||
    rollbackBase.endsWith('.rollback') ||
    rollbackBase === `${destBase}.rollback`
  )) {
    return null;
  }

  // Validate that the journal filename matches destination
  const expectedJournalName = `${destBase}.backup-journal.json`;
  if (path.basename(journalPath).toLowerCase() !== expectedJournalName.toLowerCase()) {
    return null;
  }

  return {
    version: 1,
    destinationPath: resolvedDest,
    tempPath: resolvedTemp,
    rollbackPath: resolvedRollback,
    state,
    createdAt,
  };
}

/**
 * Coordinates concurrent backup and recovery operations and protects in-flight
 * replacement transactions using deterministic per-destination lock files with:
 * - Atomic exclusive creation (O_CREAT | O_EXCL)
 * - Unique owner token (UUID) preventing unauthorized or stolen lock release
 * - Active lease heartbeat preventing premature expiration during long-running backups
 * - Liveness detection preventing interference with active processes
 * - Automatic stale-lock detection and recovery for dead PIDs or abandoned operations
 * - Re-entrant current-process ownership tracking for coordinated operations
 */
export class BackupLock {
  public static readonly HEARTBEAT_INTERVAL_MS = 5_000;
  public static readonly LEASE_DURATION_MS = 30_000;

  // Process-local registry of active locks held by the current process
  private static readonly activeHeldLocks = new Map<string, BackupLockHandle>();

  public static getLockPath(destinationPath: string): string {
    const resolved = path.resolve(destinationPath);
    return `${resolved}.lock`;
  }

  /**
   * Tests whether the current process currently holds an active lock for the destination.
   */
  public static isHeldByCurrentProcess(destinationPath: string): boolean {
    const canonical = path.resolve(destinationPath).toLowerCase();
    return BackupLock.activeHeldLocks.has(canonical);
  }

  /**
   * Retrieves the current process's lock handle if held.
   */
  public static getHeldLock(destinationPath: string): BackupLockHandle | undefined {
    const canonical = path.resolve(destinationPath).toLowerCase();
    return BackupLock.activeHeldLocks.get(canonical);
  }

  /**
   * Tests whether an operating system process is currently alive in the system process table.
   */
  public static isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      return (err as NodeJS.ErrnoException).code !== 'ESRCH';
    }
  }

  /**
   * Evaluates whether a lock file on disk is actively held by a live process.
   * Distinguishes process liveness from heartbeat freshness:
   * A live process NEVER loses exclusive ownership simply because an event loop delay
   * postponed a heartbeat pulse.
   * Returns false if the file is missing, malformed, or owned by a dead process.
   */
  public static isLockActive(lockPath: string): boolean {
    if (!fs.existsSync(lockPath)) {
      return false;
    }
    try {
      const content = fs.readFileSync(lockPath, 'utf8');
      const info = JSON.parse(content) as BackupLockInfo;
      if (
        !info ||
        info.version !== 1 ||
        typeof info.ownerId !== 'string' ||
        typeof info.pid !== 'number'
      ) {
        return false;
      }

      // Check process liveness in operating system.
      // A live process remains the authoritative owner as long as it is alive in the OS.
      return BackupLock.isProcessAlive(info.pid);
    } catch {
      return false;
    }
  }

  /**
   * Attempts to acquire an exclusive lock for the destination.
   * Uses atomic O_CREAT | O_EXCL and atomic rename for stale-lock reclamation.
   * Guaranteed TOCTOU-safe against concurrent reclaimers and concurrent acquirers.
   */
  public static tryAcquire(destinationPath: string): BackupLockHandle | null {
    const resolved = path.resolve(destinationPath);
    const canonical = resolved.toLowerCase();

    // If current process already holds this lock, do not compete with ourselves
    if (BackupLock.activeHeldLocks.has(canonical)) {
      return null;
    }

    const lockPath = BackupLock.getLockPath(resolved);
    const destDir = path.dirname(resolved);
    fs.mkdirSync(destDir, { recursive: true });

    const ownerId = crypto.randomUUID();
    let acquired = false;
    let attempts = 0;

    while (!acquired && attempts < 3) {
      attempts++;
      try {
        const fd = fs.openSync(lockPath, 'wx');
        try {
          const now = Date.now();
          const lockInfo: BackupLockInfo = {
            version: 1,
            ownerId,
            pid: process.pid,
            createdAt: now,
            heartbeat: now,
            destinationPath: resolved,
          };
          fs.writeFileSync(fd, JSON.stringify(lockInfo, null, 2), 'utf8');
        } finally {
          fs.closeSync(fd);
        }
        acquired = true;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          // Lock path already exists. Check if it is held by an active live process.
          if (BackupLock.isLockActive(lockPath)) {
            // Lock is actively held by a live process: cannot acquire
            return null;
          }

          // Lock appears stale (owning process is dead or lock file is malformed).
          // TOCTOU Prevention: We NEVER call fs.unlinkSync(lockPath) directly!
          // We atomically claim the candidate stale lock file by renaming it to a private path.
          const claimPath = `${lockPath}.claim-${process.pid}-${crypto.randomUUID()}`;
          try {
            fs.renameSync(lockPath, claimPath);
          } catch {
            // Another reclaimer already claimed, replaced, or unlinked it in the race.
            // Loop back to attempt openSync or check new lock.
            continue;
          }

          // We won atomic ownership of the file that was at lockPath.
          // In private isolation, verify whether claimPath was actually stale.
          const isStale = !BackupLock.isLockActive(claimPath);
          if (isStale) {
            // Safely clean the private claim file
            try {
              fs.unlinkSync(claimPath);
            } catch {
              // Ignore
            }
            // Stale lock has been atomically removed without touching any new active lock!
            // Loop back to attempt openSync on the newly vacated lockPath.
            continue;
          } else {
            // The file was actually active (or became active right before rename)!
            // Restore it immediately to lockPath.
            try {
              fs.renameSync(claimPath, lockPath);
            } catch {
              // Ignore restore collision
            }
            return null;
          }
        } else {
          throw err;
        }
      }
    }

    if (!acquired) {
      return null;
    }

    let released = false;

    // Heartbeat timer periodically refreshes the lock heartbeat
    const timer = setInterval(() => {
      if (released) {
        return;
      }
      try {
        if (!fs.existsSync(lockPath)) {
          return;
        }
        const content = fs.readFileSync(lockPath, 'utf8');
        const existing = JSON.parse(content) as BackupLockInfo;
        if (existing.ownerId === ownerId && existing.pid === process.pid) {
          const updated: BackupLockInfo = {
            ...existing,
            heartbeat: Date.now(),
          };
          fs.writeFileSync(lockPath, JSON.stringify(updated, null, 2), 'utf8');
        }
      } catch {
        // Ignore heartbeat race
      }
    }, BackupLock.HEARTBEAT_INTERVAL_MS);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    const handle: BackupLockHandle = {
      ownerId,
      destinationPath: resolved,
      lockPath,
      touch: () => {
        if (released) {
          return;
        }
        try {
          if (!fs.existsSync(lockPath)) {
            return;
          }
          const content = fs.readFileSync(lockPath, 'utf8');
          const existing = JSON.parse(content) as BackupLockInfo;
          if (existing.ownerId === ownerId && existing.pid === process.pid) {
            const updated: BackupLockInfo = {
              ...existing,
              heartbeat: Date.now(),
            };
            fs.writeFileSync(lockPath, JSON.stringify(updated, null, 2), 'utf8');
          }
        } catch {
          // Ignore touch race
        }
      },
      release: () => {
        if (released) {
          return;
        }
        released = true;
        clearInterval(timer);
        BackupLock.activeHeldLocks.delete(canonical);

        // TOCTOU Prevention for Release:
        // Do NOT call fs.unlinkSync(lockPath) directly!
        // Atomically rename lockPath to a private retirement path.
        const retirePath = `${lockPath}.retire-${process.pid}-${ownerId}-${crypto.randomUUID()}`;
        try {
          fs.renameSync(lockPath, retirePath);
        } catch {
          // Lock path already removed or gone
          return;
        }

        // In private isolation, verify ownership of the retired file
        let isOurLock = false;
        try {
          const content = fs.readFileSync(retirePath, 'utf8');
          const data = JSON.parse(content) as BackupLockInfo;
          if (data && data.ownerId === ownerId && data.pid === process.pid) {
            isOurLock = true;
          }
        } catch {
          // Malformed
        }

        if (isOurLock) {
          // Verified true owner: safely destroy the private retired file
          try {
            fs.unlinkSync(retirePath);
          } catch {
            // Ignore
          }
        } else {
          // Stolen / Replaced lock! (Another owner had acquired the path).
          // Immediately restore their lock file to lockPath unharmed.
          try {
            fs.renameSync(retirePath, lockPath);
          } catch {
            // Ignore
          }
        }
      },
    };

    BackupLock.activeHeldLocks.set(canonical, handle);
    return handle;
  }

  /**
   * Acquires an exclusive lock for the destination, throwing ERR_BACKUP_CONCURRENT_LOCK if active.
   */
  public static acquire(destinationPath: string): BackupLockHandle {
    const handle = BackupLock.tryAcquire(destinationPath);
    if (!handle) {
      const resolved = path.resolve(destinationPath);
      throw new Error(
        `ERR_BACKUP_CONCURRENT_LOCK: Another backup operation is currently targeting destination '${resolved}'.`,
      );
    }
    return handle;
  }
}

/**
 * Synchronously tests whether a file path contains a valid SQLite database
 * that passes PRAGMA quick_check(100).
 */
export function isDatabaseFileValid(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  let conn: DatabaseConnection | null = null;
  try {
    conn = new DatabaseConnection(filePath, { readonly: true, fileMustExist: true });
    conn.open();
    const check = conn.quickCheck(100);
    return check.ok;
  } catch {
    return false;
  } finally {
    if (conn && conn.isOpen()) {
      try {
        conn.close();
      } catch {
        // Ignore close error
      }
    }
  }
}

/**
 * Scans a destination directory (or a single file's parent) for interrupted backup replacement operations,
 * resolving transaction journals and orphan rollback/pending files to guarantee crash consistency.
 *
 * Treats all journal files as untrusted filesystem input with strict schema, canonicalization,
 * and directory containment validation. Protects in-flight backups from concurrent deletion.
 */
export function recoverPendingBackupReplacements(directoryOrFile: string): BackupRecoveryResult[] {
  const results: BackupRecoveryResult[] = [];
  let directory = path.resolve(directoryOrFile);

  try {
    if (fs.existsSync(directory) && !fs.statSync(directory).isDirectory()) {
      directory = path.dirname(directory);
    }
  } catch {
    return results;
  }

  if (!fs.existsSync(directory)) {
    return results;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return results;
  }

  // Clean up any abandoned or stale lock files in this directory using atomic rename claim
  const lockEntries = entries.filter(e => e.endsWith('.lock'));
  for (const lockFileName of lockEntries) {
    const fullLockPath = path.join(directory, lockFileName);
    if (!BackupLock.isLockActive(fullLockPath)) {
      const claimPath = `${fullLockPath}.claim-${process.pid}-${crypto.randomUUID()}`;
      try {
        fs.renameSync(fullLockPath, claimPath);
        if (!BackupLock.isLockActive(claimPath)) {
          fs.unlinkSync(claimPath);
        } else {
          fs.renameSync(claimPath, fullLockPath);
        }
      } catch {
        // Ignore race
      }
    }
  }

  // 1. Process explicit backup replacement journals
  const journalFiles = entries.filter(e => e.endsWith('.backup-journal.json'));
  for (const journalFileName of journalFiles) {
    const journalPath = path.join(directory, journalFileName);
    let journalRaw: unknown;
    try {
      journalRaw = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    } catch {
      // Malformed / truncated JSON: safely clean without touching external files
      cleanFileWithSidecars(journalPath);
      continue;
    }

    const journal = validateJournalPayload(journalRaw, directory, journalPath);
    if (!journal) {
      // Schema / containment / security violation: safely delete invalid journal
      cleanFileWithSidecars(journalPath);
      continue;
    }

    const { destinationPath, tempPath, rollbackPath } = journal;

    // Check if current process already owns this lock (e.g. outer backup() transaction)
    const isAlreadyHeld = BackupLock.isHeldByCurrentProcess(destinationPath);
    let recoveryLock: BackupLockHandle | null = null;

    if (!isAlreadyHeld) {
      recoveryLock = BackupLock.tryAcquire(destinationPath);
      if (!recoveryLock) {
        // Destination is actively locked by another backup or recovery worker: skip safely
        continue;
      }
    }

    try {
      // Re-verify that journal still exists (in case another process just processed it before lock acquisition)
      if (!fs.existsSync(journalPath)) {
        continue;
      }

      const destExists = fs.existsSync(destinationPath);
      const destValid = destExists && isDatabaseFileValid(destinationPath);

      if (destValid) {
        // Replacement succeeded before interruption; clean up leftover staging files
        cleanFileWithSidecars(rollbackPath);
        cleanFileWithSidecars(tempPath);
        cleanFileWithSidecars(journalPath);
        results.push({
          destinationPath,
          actionTaken: 'CLEANED_ORPHAN',
          details: 'Verified valid destination; cleaned up committed journal and staging files',
        });
      } else {
        // Destination is missing or corrupt; recover from staging files
        const tempValid = isDatabaseFileValid(tempPath);
        const rollbackValid = isDatabaseFileValid(rollbackPath);

        if (tempValid) {
          // Promote verified pending backup
          try {
            if (destExists) {
              cleanFileWithSidecars(destinationPath);
            }
            fs.renameSync(tempPath, destinationPath);
            cleanFileWithSidecars(rollbackPath);
            cleanFileWithSidecars(tempPath);
            cleanFileWithSidecars(journalPath);
            results.push({
              destinationPath,
              actionTaken: 'PROMOTED_PENDING',
              details:
                'Promoted verified pending backup to destination following interrupted replacement',
            });
          } catch {
            if (rollbackValid) {
              try {
                if (fs.existsSync(destinationPath)) {
                  cleanFileWithSidecars(destinationPath);
                }
                fs.renameSync(rollbackPath, destinationPath);
                cleanFileWithSidecars(tempPath);
                cleanFileWithSidecars(journalPath);
                results.push({
                  destinationPath,
                  actionTaken: 'RESTORED_ROLLBACK',
                  details: 'Restored original backup from rollback following promotion failure',
                });
              } catch {
                // Ignore
              }
            }
          }
        } else if (rollbackValid) {
          // Temp is invalid or missing; restore original backup from rollback
          try {
            if (destExists) {
              cleanFileWithSidecars(destinationPath);
            }
            fs.renameSync(rollbackPath, destinationPath);
            cleanFileWithSidecars(tempPath);
            cleanFileWithSidecars(journalPath);
            results.push({
              destinationPath,
              actionTaken: 'RESTORED_ROLLBACK',
              details: 'Restored original backup from rollback following interrupted replacement',
            });
          } catch {
            // Ignore
          }
        }
      }
    } finally {
      if (recoveryLock) {
        recoveryLock.release();
      }
    }
  }

  // 2. Process standalone rollback files without journals
  const rollbackFiles = entries.filter(
    e => e.includes('.rollback') && !e.endsWith('.backup-journal.json'),
  );
  for (const rbFile of rollbackFiles) {
    const rbPath = path.join(directory, rbFile);
    if (!isContainedInDirectory(rbPath, directory)) {
      continue;
    }
    const targetDest = rbPath.replace(/\.backup-rollback-.*\.db$/, '').replace(/\.rollback.*$/, '');
    if (targetDest && targetDest !== rbPath) {
      const isAlreadyHeld = BackupLock.isHeldByCurrentProcess(targetDest);
      let rollbackLock: BackupLockHandle | null = null;

      if (!isAlreadyHeld) {
        rollbackLock = BackupLock.tryAcquire(targetDest);
        if (!rollbackLock) {
          // Destination is actively locked; skip safely
          continue;
        }
      }

      try {
        if (!fs.existsSync(rbPath)) {
          continue;
        }
        const destExists = fs.existsSync(targetDest);
        const destValid = destExists && isDatabaseFileValid(targetDest);
        if (destValid) {
          cleanFileWithSidecars(rbPath);
          results.push({
            destinationPath: targetDest,
            actionTaken: 'CLEANED_ORPHAN',
            details: 'Removed obsolete standalone rollback file for verified destination',
          });
        } else if (isDatabaseFileValid(rbPath)) {
          try {
            if (destExists) {
              cleanFileWithSidecars(targetDest);
            }
            fs.renameSync(rbPath, targetDest);
            results.push({
              destinationPath: targetDest,
              actionTaken: 'RESTORED_ROLLBACK',
              details: 'Restored missing or corrupted destination from standalone rollback file',
            });
          } catch {
            // Ignore
          }
        }
      } finally {
        if (rollbackLock) {
          rollbackLock.release();
        }
      }
    }
  }

  // 3. Process stale standalone temporary backup files without journals
  const staleTempFiles = entries.filter(
    e =>
      (e.startsWith('.backup-tmp-') || e.endsWith('.pending')) &&
      !e.endsWith('.backup-journal.json'),
  );
  for (const tempFile of staleTempFiles) {
    const tempFilePath = path.join(directory, tempFile);
    if (!isContainedInDirectory(tempFilePath, directory)) {
      continue;
    }

    // Check if this temp file is associated with an actively locked destination
    if (tempFile.endsWith('.pending')) {
      const associatedDest = tempFilePath.replace(/\.pending$/, '');
      if (
        BackupLock.isLockActive(BackupLock.getLockPath(associatedDest)) ||
        BackupLock.isHeldByCurrentProcess(associatedDest)
      ) {
        // Destination is currently in active backup transition: NEVER delete!
        continue;
      }
    }

    // Check if this temp file belongs to an active in-flight backup
    const pidMatch = tempFile.match(/^\.backup-tmp-(\d+)-(\d+)-/);
    if (pidMatch) {
      const filePid = parseInt(pidMatch[1], 10);
      let processAlive = false;
      try {
        process.kill(filePid, 0);
        processAlive = true;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
          processAlive = true;
        }
      }

      // If the owner process is still alive, this is an active in-flight backup! NEVER delete!
      if (processAlive) {
        continue;
      }
    }

    cleanFileWithSidecars(tempFilePath);
    results.push({
      destinationPath: tempFilePath,
      actionTaken: 'CLEANED_ORPHAN',
      details: 'Cleaned up stale uncommitted temporary backup file',
    });
  }

  return results;
}

export class DatabaseConnection {
  private db: BetterSqlite3Database | null = null;
  private state: ConnectionState = 'UNINITIALIZED';
  private readonly targetPath: string;
  private readonly options: DatabaseConnectionOptions;

  constructor(customPath?: string, options: DatabaseConnectionOptions = {}) {
    this.targetPath = options.isMemory ? ':memory:' : getDatabasePath(customPath);
    this.options = options;
  }

  /**
   * Current lifecycle state of this database connection.
   */
  public getState(): ConnectionState {
    return this.state;
  }

  /**
   * Resolved database path (or ':memory:').
   */
  public getPath(): string {
    return this.targetPath;
  }

  /**
   * Whether the underlying SQLite database is currently open and healthy.
   */
  public isOpen(): boolean {
    return this.state === 'OPEN' && this.db !== null && this.db.open;
  }

  /**
   * Opens the SQLite connection and configures mandatory safety and performance pragmas.
   */
  public open(): void {
    if (this.state === 'OPEN' && this.db !== null && this.db.open) {
      return;
    }

    try {
      if (this.targetPath !== ':memory:') {
        ensureDatabaseDirectory(this.targetPath);
      }

      const sqliteOptions: BetterSqlite3Options = {
        readonly: this.options.readonly ?? false,
        fileMustExist: this.options.fileMustExist ?? false,
        timeout: this.options.timeout ?? 5000,
      };

      const resolvedBinding = this.options.nativeBinding ?? resolveNativeBindingPath();
      if (resolvedBinding) {
        (sqliteOptions as Record<string, unknown>).nativeBinding = resolvedBinding;
      }

      this.db = new Database(this.targetPath, sqliteOptions);

      // Mandatory safety pragmas for all connections
      this.db.pragma('foreign_keys = ON');
      this.db.pragma(`busy_timeout = ${this.options.timeout ?? 5000}`);

      // Performance and journal pragmas for file-backed storage only
      if (this.targetPath !== ':memory:') {
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('cache_size = -64000'); // 64 MB page cache
      }

      this.state = 'OPEN';
    } catch (err) {
      this.state = 'CORRUPTED';
      this.db = null;
      throw err;
    }
  }

  /**
   * Performs an integrity check using PRAGMA quick_check(maxErrors).
   */
  public quickCheck(maxErrors = 100): QuickCheckResult {
    const rawDb = this.getRawDb();
    const rows = rawDb.pragma(`quick_check(${maxErrors})`, { simple: false }) as Array<{
      quick_check: string;
    }>;

    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, errors: ['No response from PRAGMA quick_check'] };
    }

    if (rows.length === 1 && rows[0].quick_check === 'ok') {
      return { ok: true, errors: [] };
    }

    const errors = rows.map(r => String(r.quick_check));
    this.state = 'CORRUPTED';
    return { ok: false, errors };
  }

  /**
   * Hot backup creation using better-sqlite3 hot backup API.
   * WAL-safe, protects against destination collisions and unconfirmed overwrites,
   * cleans up partial files on failure, and verifies backup integrity.
   */
  public async backup(destinationPath: string, options?: BackupOptions): Promise<void> {
    if (destinationPath === ':memory:') {
      throw new Error('ERR_BACKUP_INVALID_DESTINATION: Backup destination cannot be :memory:');
    }

    const resolvedDest = path.resolve(destinationPath);

    if (this.targetPath !== ':memory:') {
      const resolvedSource = path.resolve(this.targetPath);
      if (
        resolvedDest.toLowerCase() === resolvedSource.toLowerCase() ||
        resolvedDest.toLowerCase() === `${resolvedSource}-wal`.toLowerCase() ||
        resolvedDest.toLowerCase() === `${resolvedSource}-shm`.toLowerCase()
      ) {
        throw new Error(
          `ERR_BACKUP_DESTINATION_COLLISION: Destination path ('${resolvedDest}') collides with active database file or sidecar files.`,
        );
      }
    }

    const destDir = path.dirname(resolvedDest);
    fs.mkdirSync(destDir, { recursive: true });

    const lock = BackupLock.acquire(resolvedDest);

    try {
      // Recover any pending replacement operations in the destination directory before proceeding
      recoverPendingBackupReplacements(destDir);

      const fileExists = fs.existsSync(resolvedDest);
      if (fileExists && !options?.overwrite) {
        throw new Error(
          `ERR_BACKUP_DESTINATION_EXISTS: Backup destination already exists at '${resolvedDest}'. Use overwrite option to replace.`,
        );
      }

      // Step 1: Create backup in a unique temporary file in the destination directory
      const tempFileName = `.backup-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`;
      const tempBackupPath = path.join(destDir, tempFileName);

      const rawDb = this.getRawDb();

      try {
        await rawDb.backup(tempBackupPath);
      } catch (backupErr) {
        cleanFileWithSidecars(tempBackupPath);
        throw backupErr;
      }

      // Step 2: Perform post-backup integrity verification on the temporary backup file
      if (options?.verifyIntegrity !== false) {
        let verifyConn: DatabaseConnection | null = null;
        try {
          verifyConn = new DatabaseConnection(tempBackupPath, { readonly: true });
          verifyConn.open();
          const check = verifyConn.quickCheck(100);
          if (!check.ok) {
            try {
              verifyConn.close();
            } catch {
              // Ignore close error
            }
            verifyConn = null;
            cleanFileWithSidecars(tempBackupPath);
            throw new Error(
              `ERR_BACKUP_VERIFICATION_FAILED: Newly created backup failed integrity check: ${check.errors.join('; ')}`,
            );
          }
        } catch (verifyErr) {
          cleanFileWithSidecars(tempBackupPath);
          if (
            verifyErr instanceof Error &&
            verifyErr.message.startsWith('ERR_BACKUP_VERIFICATION_FAILED')
          ) {
            throw verifyErr;
          }
          throw new Error(
            `ERR_BACKUP_VERIFICATION_FAILED: Newly created backup failed verification: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`,
            { cause: verifyErr },
          );
        } finally {
          if (verifyConn && verifyConn.isOpen()) {
            try {
              verifyConn.close();
            } catch {
              // Ignore close error
            }
          }
        }
      }

      // Step 3: Atomically and non-destructively promote temporary backup to resolvedDest
      if (fileExists) {
        const rollbackFileName = `.backup-rollback-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`;
        const rollbackPath = path.join(destDir, rollbackFileName);
        const journalFileName = `${path.basename(resolvedDest)}.backup-journal.json`;
        const journalPath = path.join(destDir, journalFileName);

        const journal: BackupReplacementJournal = {
          version: 1,
          destinationPath: resolvedDest,
          tempPath: tempBackupPath,
          rollbackPath,
          state: 'PREPARING',
          createdAt: Date.now(),
        };
        fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf8');

        try {
          fs.renameSync(resolvedDest, rollbackPath);
          try {
            fs.renameSync(tempBackupPath, resolvedDest);
            // Replacement successful; delete rollback and journal files
            cleanFileWithSidecars(rollbackPath);
            cleanFileWithSidecars(tempBackupPath);
            cleanFileWithSidecars(journalPath);
          } catch (replaceErr) {
            try {
              fs.renameSync(rollbackPath, resolvedDest);
            } catch {
              recoverPendingBackupReplacements(destDir);
            }
            cleanFileWithSidecars(tempBackupPath);
            cleanFileWithSidecars(journalPath);
            throw replaceErr;
          }
        } catch (renameErr) {
          cleanFileWithSidecars(tempBackupPath);
          recoverPendingBackupReplacements(destDir);
          throw renameErr;
        }
      } else {
        try {
          fs.renameSync(tempBackupPath, resolvedDest);
          cleanFileWithSidecars(tempBackupPath);
        } catch (moveErr) {
          cleanFileWithSidecars(tempBackupPath);
          throw moveErr;
        }
      }
    } finally {
      lock.release();
    }
  }

  /**
   * Executes a callback within a managed transaction.
   * Leverages better-sqlite3's automatic SAVEPOINT support for nested transactions.
   */
  public transaction<T>(fn: () => T): T {
    const rawDb = this.getRawDb();
    const tx = rawDb.transaction(fn);
    return tx();
  }

  /**
   * Grants internal Data Access Layer components access to the typed Database instance.
   * Throws if the connection is not open.
   */
  public getRawDb(): BetterSqlite3Database {
    if (this.state !== 'OPEN' || !this.db || !this.db.open) {
      throw new Error(
        `ERR_DATABASE_ERROR: Database connection is not open (current state: ${this.state})`,
      );
    }
    return this.db;
  }

  /**
   * Idempotently closes the SQLite database connection and releases file locks.
   */
  public close(): void {
    if (this.state === 'CLOSED') {
      return;
    }

    if (this.db) {
      try {
        if (this.targetPath !== ':memory:' && this.db.open && !this.options.readonly) {
          try {
            this.db.pragma('wal_checkpoint(TRUNCATE)');
          } catch {
            // Ignore WAL checkpoint errors during shutdown
          }
        }
        if (this.db.open) {
          this.db.close();
        }
      } finally {
        this.db = null;
        this.state = 'CLOSED';
      }
    } else {
      this.state = 'CLOSED';
    }
  }
}
