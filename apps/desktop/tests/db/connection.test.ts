import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  DatabaseConnection,
  recoverPendingBackupReplacements,
  isDatabaseFileValid,
  validateJournalPayload,
  BackupLock,
  type BackupReplacementJournal,
} from '../../src/main/db/connection.js';

describe('DatabaseConnection Layer', () => {
  const testDbDir = path.join('D:\\ahmed\\.tmp\\test-db-connection');
  const testDbPath = path.join(testDbDir, 'test-connection.db');

  beforeEach(() => {
    fs.mkdirSync(testDbDir, { recursive: true });
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDbDir)) {
        fs.rmSync(testDbDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore file lock cleanup errors on Windows
    }
  });

  describe('Lifecycle and State Transitions', () => {
    it('initializes in UNINITIALIZED state and transitions to OPEN on open()', () => {
      const conn = new DatabaseConnection(':memory:', { isMemory: true });
      expect(conn.getState()).toBe('UNINITIALIZED');
      expect(conn.isOpen()).toBe(false);

      conn.open();
      expect(conn.getState()).toBe('OPEN');
      expect(conn.isOpen()).toBe(true);

      conn.close();
      expect(conn.getState()).toBe('CLOSED');
      expect(conn.isOpen()).toBe(false);
    });

    it('handles idempotent open() and close() calls safely', () => {
      const conn = new DatabaseConnection(':memory:', { isMemory: true });
      conn.open();
      conn.open(); // Idempotent no-op
      expect(conn.isOpen()).toBe(true);

      conn.close();
      conn.close(); // Idempotent no-op
      expect(conn.isOpen()).toBe(false);
      expect(conn.getState()).toBe('CLOSED');
    });

    it('throws ERR_DATABASE_ERROR when accessing getRawDb() on non-open connection', () => {
      const conn = new DatabaseConnection(':memory:', { isMemory: true });
      expect(() => conn.getRawDb()).toThrow(/ERR_DATABASE_ERROR/);
    });
  });

  describe('Pragma Configurations', () => {
    it('configures foreign keys and busy_timeout on in-memory connection', () => {
      const conn = new DatabaseConnection(':memory:', { isMemory: true });
      conn.open();
      const rawDb = conn.getRawDb();

      const fk = rawDb.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);

      const timeout = rawDb.pragma('busy_timeout', { simple: true });
      expect(timeout).toBe(5000);

      conn.close();
    });

    it('configures WAL journal mode and NORMAL synchronous mode on file-backed database', () => {
      const conn = new DatabaseConnection(testDbPath);
      conn.open();
      const rawDb = conn.getRawDb();

      const journal = rawDb.pragma('journal_mode', { simple: true });
      expect(String(journal).toLowerCase()).toBe('wal');

      const sync = rawDb.pragma('synchronous', { simple: true });
      // In SQLite: 1 = NORMAL
      expect(sync).toBe(1);

      const fk = rawDb.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);

      conn.close();
    });

    it('enforces foreign key constraints at runtime', () => {
      const conn = new DatabaseConnection(':memory:', { isMemory: true });
      conn.open();
      const rawDb = conn.getRawDb();

      rawDb.exec(`
        CREATE TABLE parents (id TEXT PRIMARY KEY);
        CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id));
      `);

      expect(() => {
        rawDb.prepare("INSERT INTO children (id, parent_id) VALUES ('c1', 'non-existent')").run();
      }).toThrow(/FOREIGN KEY constraint failed/);

      conn.close();
    });
  });

  describe('Transactions, Integrity, and Backups', () => {
    it('executes transactions and automatically rolls back on error', () => {
      const conn = new DatabaseConnection(':memory:', { isMemory: true });
      conn.open();
      const rawDb = conn.getRawDb();

      rawDb.exec('CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT)');

      expect(() => {
        conn.transaction(() => {
          rawDb.prepare("INSERT INTO items (id, value) VALUES ('1', 'first')").run();
          throw new Error('Simulated failure inside transaction');
        });
      }).toThrow('Simulated failure inside transaction');

      const count = rawDb.prepare('SELECT COUNT(*) as count FROM items').get() as { count: number };
      expect(count.count).toBe(0);

      conn.close();
    });

    it('successfully commits successful transactions', () => {
      const conn = new DatabaseConnection(':memory:', { isMemory: true });
      conn.open();
      const rawDb = conn.getRawDb();

      rawDb.exec('CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT)');

      conn.transaction(() => {
        rawDb.prepare("INSERT INTO items (id, value) VALUES ('1', 'committed')").run();
      });

      const row = rawDb.prepare('SELECT value FROM items WHERE id = ?').get('1') as {
        value: string;
      };
      expect(row.value).toBe('committed');

      conn.close();
    });

    it('performs quickCheck() returning ok on a healthy database', () => {
      const conn = new DatabaseConnection(':memory:', { isMemory: true });
      conn.open();
      const result = conn.quickCheck();
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      conn.close();
    });

    it('creates hot backups on file-backed database', async () => {
      const conn = new DatabaseConnection(testDbPath);
      conn.open();
      const rawDb = conn.getRawDb();

      rawDb.exec('CREATE TABLE sample (id TEXT PRIMARY KEY, data TEXT);');
      rawDb.prepare("INSERT INTO sample VALUES ('id1', 'hello-backup');").run();

      const backupPath = path.join(testDbDir, 'backup.db');
      await conn.backup(backupPath);

      expect(fs.existsSync(backupPath)).toBe(true);

      conn.close();

      // Open the backup file to verify data integrity
      const backupConn = new DatabaseConnection(backupPath);
      backupConn.open();
      const backedUpRow = backupConn
        .getRawDb()
        .prepare('SELECT data FROM sample WHERE id = ?')
        .get('id1') as {
        data: string;
      };
      expect(backedUpRow.data).toBe('hello-backup');
      backupConn.close();
    });

    it('enforces backup destination collision protection', async () => {
      const conn = new DatabaseConnection(testDbPath);
      conn.open();

      await expect(conn.backup(testDbPath)).rejects.toThrow(/ERR_BACKUP_DESTINATION_COLLISION/);
      await expect(conn.backup(`${testDbPath}-wal`)).rejects.toThrow(
        /ERR_BACKUP_DESTINATION_COLLISION/,
      );
      await expect(conn.backup(`${testDbPath}-shm`)).rejects.toThrow(
        /ERR_BACKUP_DESTINATION_COLLISION/,
      );
      await expect(conn.backup(':memory:')).rejects.toThrow(/ERR_BACKUP_INVALID_DESTINATION/);

      conn.close();
    });

    it('enforces overwrite protection and respects explicit overwrite flag', async () => {
      const conn = new DatabaseConnection(testDbPath);
      conn.open();
      conn.getRawDb().exec('CREATE TABLE t (id INT); INSERT INTO t VALUES (42);');

      const backupPath = path.join(testDbDir, 'backup-overwrite.db');
      await conn.backup(backupPath);
      expect(fs.existsSync(backupPath)).toBe(true);

      // Attempting to backup again without overwrite throws
      await expect(conn.backup(backupPath)).rejects.toThrow(/ERR_BACKUP_DESTINATION_EXISTS/);

      // Specifying overwrite: true succeeds
      await conn.backup(backupPath, { overwrite: true });
      expect(fs.existsSync(backupPath)).toBe(true);

      conn.close();
    });

    it('preserves existing backup file and hash if overwrite backup fails during operation', async () => {
      const conn = new DatabaseConnection(testDbPath);
      conn.open();
      try {
        const rawDb = conn.getRawDb();
        rawDb.exec('CREATE TABLE original (id TEXT PRIMARY KEY, value TEXT);');
        rawDb.prepare("INSERT INTO original VALUES ('orig1', 'safe-original-data');").run();

        const backupPath = path.join(testDbDir, 'atomic-overwrite-test.db');
        await conn.backup(backupPath);
        expect(fs.existsSync(backupPath)).toBe(true);

        // Record SHA-256 hash and verify readable data
        const originalBytes = fs.readFileSync(backupPath);
        const originalHash = crypto.createHash('sha256').update(originalBytes).digest('hex');

        // Now insert new data into the active DB
        rawDb.prepare("INSERT INTO original VALUES ('new2', 'new-data');").run();

        // Mock rawDb.backup to simulate a failure halfway through writing to the destination
        const backupSpy = vi
          .spyOn(rawDb, 'backup')
          .mockImplementation(async (targetPath: string) => {
            // Write incomplete corrupted bytes to temp file to simulate partial write failure
            fs.writeFileSync(targetPath, 'CORRUPTED_INCOMPLETE_STREAM');
            throw new Error('SIMULATED_BACKUP_STREAM_FAILURE');
          });

        // Attempt to backup with overwrite: true - MUST FAIL safely
        await expect(conn.backup(backupPath, { overwrite: true })).rejects.toThrow(
          'SIMULATED_BACKUP_STREAM_FAILURE',
        );

        backupSpy.mockRestore();

        // The original backup MUST remain intact, uncorrupted, and unchanged
        expect(fs.existsSync(backupPath)).toBe(true);
        const postFailureBytes = fs.readFileSync(backupPath);
        const postFailureHash = crypto.createHash('sha256').update(postFailureBytes).digest('hex');
        expect(postFailureHash).toBe(originalHash);

        // Verify original data is readable and intact
        const verifyConn = new DatabaseConnection(backupPath, { readonly: true });
        verifyConn.open();
        const check = verifyConn.quickCheck(100);
        expect(check.ok).toBe(true);
        const row = verifyConn
          .getRawDb()
          .prepare('SELECT value FROM original WHERE id = ?')
          .get('orig1') as { value: string };
        expect(row.value).toBe('safe-original-data');
        verifyConn.close();

        // Ensure no temp files leaked in destination directory
        const files = fs.readdirSync(testDbDir);
        const tempFiles = files.filter(
          f => f.startsWith('.backup-tmp-') || f.startsWith('.backup-rollback-'),
        );
        expect(tempFiles).toHaveLength(0);
      } finally {
        conn.close();
      }
    });

    it('Point 3 & 4: recovers previous backup if replacement is interrupted between dest-rename and temp-promote', async () => {
      // 1. Create a valid original backup
      const origDb = new DatabaseConnection(path.join(testDbDir, 'seed.db'));
      origDb.open();
      origDb.getRawDb().exec("CREATE TABLE t (val TEXT); INSERT INTO t VALUES ('orig-val');");
      origDb.close();

      const finalDest = path.join(testDbDir, 'crash-test-backup.db');
      fs.copyFileSync(path.join(testDbDir, 'seed.db'), finalDest);
      expect(fs.existsSync(finalDest)).toBe(true);

      // 2. Simulate interruption state: finalDest was renamed to rollback, but pending was not yet promoted
      const rollbackPath = path.join(testDbDir, 'crash-test-backup.db.rollback');
      const tempPath = path.join(testDbDir, 'crash-test-backup.db.pending');
      const journalPath = path.join(testDbDir, 'crash-test-backup.db.backup-journal.json');

      fs.renameSync(finalDest, rollbackPath);
      expect(fs.existsSync(finalDest)).toBe(false);

      // Scenario A: Temp backup exists and is valid -> recovery promotes it
      const tempDb = new DatabaseConnection(tempPath);
      tempDb.open();
      tempDb
        .getRawDb()
        .exec("CREATE TABLE t (val TEXT); INSERT INTO t VALUES ('new-verified-val');");
      tempDb.close();

      const journalA: BackupReplacementJournal = {
        version: 1,
        destinationPath: finalDest,
        tempPath,
        rollbackPath,
        state: 'PREPARING',
        createdAt: Date.now(),
      };
      fs.writeFileSync(journalPath, JSON.stringify(journalA));

      const recoveryResultsA = recoverPendingBackupReplacements(testDbDir);
      expect(recoveryResultsA.some(r => r.actionTaken === 'PROMOTED_PENDING')).toBe(true);
      expect(fs.existsSync(finalDest)).toBe(true);
      expect(isDatabaseFileValid(finalDest)).toBe(true);

      // Verify the promoted data
      const checkConnA = new DatabaseConnection(finalDest, { readonly: true });
      checkConnA.open();
      const rowA = checkConnA.getRawDb().prepare('SELECT val FROM t').get() as { val: string };
      expect(rowA.val).toBe('new-verified-val');
      checkConnA.close();

      // Scenario B: If temp backup is corrupt/missing -> recovery restores the rollback file
      fs.renameSync(finalDest, rollbackPath);
      expect(fs.existsSync(finalDest)).toBe(false);
      // Corrupt the temp file
      fs.writeFileSync(tempPath, 'CORRUPTED_INCOMPLETE_BYTES');

      const journalB: BackupReplacementJournal = {
        version: 1,
        destinationPath: finalDest,
        tempPath,
        rollbackPath,
        state: 'PREPARING',
        createdAt: Date.now(),
      };
      fs.writeFileSync(journalPath, JSON.stringify(journalB));

      const recoveryResultsB = recoverPendingBackupReplacements(testDbDir);
      expect(recoveryResultsB.some(r => r.actionTaken === 'RESTORED_ROLLBACK')).toBe(true);
      expect(fs.existsSync(finalDest)).toBe(true);
      expect(isDatabaseFileValid(finalDest)).toBe(true);

      // Verify the restored original data
      const checkConnB = new DatabaseConnection(finalDest, { readonly: true });
      checkConnB.open();
      const rowB = checkConnB.getRawDb().prepare('SELECT val FROM t').get() as { val: string };
      expect(rowB.val).toBe('new-verified-val');
      checkConnB.close();
    });

    it('Point 5: cleans up leftover rollback and journal if process died after promotion but before cleanup', () => {
      const finalDest = path.join(testDbDir, 'cleanup-test-backup.db');
      const seedDb = new DatabaseConnection(finalDest);
      seedDb.open();
      seedDb.getRawDb().exec("CREATE TABLE t (k TEXT); INSERT INTO t VALUES ('val');");
      seedDb.close();

      const rollbackPath = path.join(testDbDir, 'cleanup-test-backup.db.rollback');
      fs.copyFileSync(finalDest, rollbackPath);

      const journalPath = path.join(testDbDir, 'cleanup-test-backup.db.backup-journal.json');
      const journal: BackupReplacementJournal = {
        version: 1,
        destinationPath: finalDest,
        tempPath: path.join(testDbDir, 'cleanup-test-backup.db.pending'),
        rollbackPath,
        state: 'COMMITTED',
        createdAt: Date.now(),
      };
      fs.writeFileSync(journalPath, JSON.stringify(journal));

      const results = recoverPendingBackupReplacements(testDbDir);
      expect(results.some(r => r.actionTaken === 'CLEANED_ORPHAN')).toBe(true);
      expect(fs.existsSync(journalPath)).toBe(false);
      expect(fs.existsSync(rollbackPath)).toBe(false);
      expect(fs.existsSync(finalDest)).toBe(true);
      expect(isDatabaseFileValid(finalDest)).toBe(true);
    });

    it('Point 6: recovers destination from standalone orphan rollback file without journal', () => {
      const finalDest = path.join(testDbDir, 'orphan-dest.db');
      const orphanRollback = path.join(testDbDir, 'orphan-dest.db.rollback');

      // Destination is missing, but rollback exists with valid data
      const seed = new DatabaseConnection(orphanRollback);
      seed.open();
      seed.getRawDb().exec('CREATE TABLE t (id INT); INSERT INTO t VALUES (999);');
      seed.close();

      expect(fs.existsSync(finalDest)).toBe(false);
      expect(fs.existsSync(orphanRollback)).toBe(true);

      const results = recoverPendingBackupReplacements(testDbDir);
      expect(results.some(r => r.actionTaken === 'RESTORED_ROLLBACK')).toBe(true);
      expect(fs.existsSync(finalDest)).toBe(true);
      expect(fs.existsSync(orphanRollback)).toBe(false);

      const conn = new DatabaseConnection(finalDest, { readonly: true });
      conn.open();
      const row = conn.getRawDb().prepare('SELECT id FROM t').get() as { id: number };
      expect(row.id).toBe(999);
      conn.close();
    });

    it('rejects untrusted journal attempting directory traversal and never touches external files', () => {
      // 1. Create a critical external file outside the backup directory
      const externalDir = path.join(testDbDir, '..', 'external-safety-test');
      fs.mkdirSync(externalDir, { recursive: true });
      const externalFile = path.join(externalDir, 'external-critical.db');
      fs.writeFileSync(externalFile, 'EXTERNALLY_PROTECTED_DATA');

      // 2. Craft a malicious journal in testDbDir referencing the external file
      const journalFileName = 'traversal-target.db.backup-journal.json';
      const journalPath = path.join(testDbDir, journalFileName);
      const maliciousJournal = {
        version: 1,
        destinationPath: path.join(testDbDir, 'traversal-target.db'),
        tempPath: externalFile,
        rollbackPath: externalFile,
        state: 'COMMITTED',
        createdAt: Date.now(),
      };
      fs.writeFileSync(journalPath, JSON.stringify(maliciousJournal, null, 2));

      // 3. Directly verify validateJournalPayload returns null
      const parsed = validateJournalPayload(maliciousJournal, testDbDir, journalPath);
      expect(parsed).toBeNull();

      // 4. Run recovery against testDbDir
      const results = recoverPendingBackupReplacements(testDbDir);

      // The malicious journal MUST be removed/cleaned, and external file MUST remain intact
      expect(fs.existsSync(journalPath)).toBe(false);
      expect(fs.existsSync(externalFile)).toBe(true);
      expect(fs.readFileSync(externalFile, 'utf8')).toBe('EXTERNALLY_PROTECTED_DATA');
      expect(results.some(r => r.destinationPath === externalFile)).toBe(false);

      // Clean up external test dir
      try {
        fs.rmSync(externalDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    it('safely cleans malformed or truncated journal files without touching valid databases', () => {
      const targetDb = path.join(testDbDir, 'safe-existing.db');
      const seed = new DatabaseConnection(targetDb);
      seed.open();
      seed.getRawDb().exec('CREATE TABLE t (x INT); INSERT INTO t VALUES (42);');
      seed.close();

      const journalPath = path.join(testDbDir, 'safe-existing.db.backup-journal.json');
      fs.writeFileSync(
        journalPath,
        '{"version": 1, "destinationPath": "D:\\\\ahmed\\\\corrupt-trun',
      );

      const results = recoverPendingBackupReplacements(testDbDir);

      expect(fs.existsSync(journalPath)).toBe(false);
      expect(fs.existsSync(targetDb)).toBe(true);
      expect(isDatabaseFileValid(targetDb)).toBe(true);
      expect(results.filter(r => r.actionTaken !== 'CLEANED_ORPHAN')).toHaveLength(0);
    });

    it('rejects journal with mismatched filename conventions', () => {
      const journalPath = path.join(testDbDir, 'mismatch.db.backup-journal.json');
      const badJournal = {
        version: 1,
        destinationPath: path.join(testDbDir, 'mismatch.db'),
        tempPath: path.join(testDbDir, 'not-a-temp-file.txt'),
        rollbackPath: path.join(testDbDir, 'not-a-rollback-file.txt'),
        state: 'PREPARING',
        createdAt: Date.now(),
      };
      fs.writeFileSync(journalPath, JSON.stringify(badJournal, null, 2));

      const parsed = validateJournalPayload(badJournal, testDbDir, journalPath);
      expect(parsed).toBeNull();

      recoverPendingBackupReplacements(testDbDir);
      expect(fs.existsSync(journalPath)).toBe(false);
    });

    it('enforces per-destination locking: concurrent backup to the same destination throws ERR_BACKUP_CONCURRENT_LOCK', async () => {
      const conn = new DatabaseConnection(testDbPath);
      conn.open();
      try {
        conn.getRawDb().exec('CREATE TABLE locks (id INT); INSERT INTO locks VALUES (1);');
        const targetDest = path.join(testDbDir, 'locked-target.db');

        // Artificially acquire lock representing an in-flight backup
        const activeLock = BackupLock.acquire(targetDest);
        expect(BackupLock.isLockActive(BackupLock.getLockPath(targetDest))).toBe(true);

        try {
          // Attempt concurrent backup targeting the same destination
          await expect(conn.backup(targetDest)).rejects.toThrow('ERR_BACKUP_CONCURRENT_LOCK');
        } finally {
          activeLock.release();
        }

        // Lock is released; subsequent backup must now succeed
        expect(BackupLock.isLockActive(BackupLock.getLockPath(targetDest))).toBe(false);
        await conn.backup(targetDest);
        expect(fs.existsSync(targetDest)).toBe(true);
        expect(isDatabaseFileValid(targetDest)).toBe(true);
      } finally {
        conn.close();
      }
    });

    it('allows concurrent backups to different destinations in the same directory without collision', async () => {
      const conn = new DatabaseConnection(testDbPath);
      conn.open();
      try {
        conn.getRawDb().exec('CREATE TABLE parallel (n INT); INSERT INTO parallel VALUES (100);');
        const destA = path.join(testDbDir, 'parallel-a.db');
        const destB = path.join(testDbDir, 'parallel-b.db');

        // Concurrent backups to separate destination files
        await Promise.all([conn.backup(destA), conn.backup(destB)]);

        expect(fs.existsSync(destA)).toBe(true);
        expect(fs.existsSync(destB)).toBe(true);
        expect(isDatabaseFileValid(destA)).toBe(true);
        expect(isDatabaseFileValid(destB)).toBe(true);
      } finally {
        conn.close();
      }
    });

    it('protects in-flight temporary backup files from deletion by concurrent recovery', () => {
      const targetDest = path.join(testDbDir, 'in-flight-dest.db');
      const activeLock = BackupLock.acquire(targetDest);

      try {
        // Create an in-flight temporary file mimicking an active backup
        const tempName = `.backup-tmp-${process.pid}-${Date.now()}-mockactive.db`;
        const tempPath = path.join(testDbDir, tempName);
        fs.writeFileSync(tempPath, 'ACTIVE_IN_FLIGHT_BACKUP_BYTES');

        // Trigger recovery pass
        recoverPendingBackupReplacements(testDbDir);

        // The active in-flight temporary file MUST be preserved
        expect(fs.existsSync(tempPath)).toBe(true);

        // Clean up mock file
        fs.unlinkSync(tempPath);
      } finally {
        activeLock.release();
      }
    });

    it('safely breaks stale lock if previous process crashed or PID is dead', () => {
      const targetDest = path.join(testDbDir, 'stale-lock-target.db');
      const lockPath = BackupLock.getLockPath(targetDest);

      // Create a stale lock file with dead PID
      const staleInfo = {
        pid: 99999999, // Unlikely to exist as active process
        createdAt: Date.now() - 100_000, // Older than STALE_TIMEOUT_MS
        destinationPath: targetDest,
      };
      fs.writeFileSync(lockPath, JSON.stringify(staleInfo, null, 2), 'utf8');

      expect(BackupLock.isLockActive(lockPath)).toBe(false);

      // acquire() must detect dead/stale lock, clean it, and acquire successfully
      const lock = BackupLock.acquire(targetDest);
      expect(BackupLock.isLockActive(lockPath)).toBe(true);
      lock.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('ensures lock is deterministically released when backup encounters an exception', async () => {
      const conn = new DatabaseConnection(testDbPath);
      conn.open();
      try {
        conn.getRawDb().exec('CREATE TABLE fail_test (id INT);');
        const targetDest = path.join(testDbDir, 'fail-release-target.db');
        const rawDb = conn.getRawDb();

        const backupSpy = vi.spyOn(rawDb, 'backup').mockImplementation(async (filePath: string) => {
          fs.writeFileSync(filePath, 'CORRUPTED_STREAM_FAILS_VERIFICATION');
          // Do not throw here so integrity check catches it and throws ERR_BACKUP_VERIFICATION_FAILED
        });

        await expect(conn.backup(targetDest)).rejects.toThrow('ERR_BACKUP_VERIFICATION_FAILED');
        backupSpy.mockRestore();

        // Verify the lock was deterministically unlinked in finally block
        const lockPath = BackupLock.getLockPath(targetDest);
        expect(fs.existsSync(lockPath)).toBe(false);

        // Subsequent backup to same target succeeds
        await conn.backup(targetDest);
        expect(fs.existsSync(targetDest)).toBe(true);
        expect(isDatabaseFileValid(targetDest)).toBe(true);
      } finally {
        conn.close();
      }
    });

    it('maintains lock active during long operations exceeding 60 seconds when owner heartbeat is alive', () => {
      const targetDest = path.join(testDbDir, 'long-running-target.db');
      const lockPath = BackupLock.getLockPath(targetDest);

      // Simulate a lock acquired 90 seconds ago, with fresh heartbeat (1 second ago)
      const lockInfo = {
        version: 1,
        ownerId: crypto.randomUUID(),
        pid: process.pid,
        createdAt: Date.now() - 90_000,
        heartbeat: Date.now() - 1_000,
        destinationPath: targetDest,
      };
      fs.writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2), 'utf8');

      // Must remain active because owner is alive and heartbeat is fresh
      expect(BackupLock.isLockActive(lockPath)).toBe(true);

      // A concurrent acquire attempt MUST be rejected
      expect(() => BackupLock.acquire(targetDest)).toThrow('ERR_BACKUP_CONCURRENT_LOCK');

      // Clean up mock lock
      fs.unlinkSync(lockPath);
    });

    it('heartbeat delay while the original owner remains alive does not cause lock loss', () => {
      const targetDest = path.join(testDbDir, 'delayed-heartbeat-target.db');
      const lockPath = BackupLock.getLockPath(targetDest);

      // Simulate a live PID whose event loop was blocked and heartbeat delayed by 60s
      const delayedInfo = {
        version: 1,
        ownerId: crypto.randomUUID(),
        pid: process.pid,
        createdAt: Date.now() - 120_000,
        heartbeat: Date.now() - 60_000, // Delayed heartbeat
        destinationPath: targetDest,
      };
      fs.writeFileSync(lockPath, JSON.stringify(delayedInfo, null, 2), 'utf8');

      // Must remain active because owning process is alive in the OS process table
      expect(BackupLock.isLockActive(lockPath)).toBe(true);

      // Another process cannot acquire or break it
      expect(() => BackupLock.acquire(targetDest)).toThrow('ERR_BACKUP_CONCURRENT_LOCK');

      fs.unlinkSync(lockPath);
    });

    it('two processes concurrently reclaiming the same stale lock coordinate safely via atomic rename claim', async () => {
      const targetDest = path.join(testDbDir, 'stale-race-target.db');
      const lockPath = BackupLock.getLockPath(targetDest);

      // Plant an initial stale lock owned by dead PID
      const staleInfo = {
        version: 1,
        ownerId: 'dead-owner-uuid',
        pid: 99999999, // Dead PID
        createdAt: Date.now() - 200_000,
        heartbeat: Date.now() - 200_000,
        destinationPath: targetDest,
      };
      fs.writeFileSync(lockPath, JSON.stringify(staleInfo, null, 2), 'utf8');

      // Child script that attempts atomic stale reclamation matching BackupLock protocol
      const childScript = `
        const fs = require('node:fs');
        const path = require('node:path');
        const crypto = require('node:crypto');

        const target = process.argv[1];
        const lockPath = path.resolve(target) + '.lock';

        function isAlive(pid) {
          try {
            process.kill(pid, 0);
            return true;
          } catch (e) {
            return e.code !== 'ESRCH';
          }
        }

        let acquired = false;
        try {
          const fd = fs.openSync(lockPath, 'wx');
          fs.writeFileSync(fd, JSON.stringify({ version: 1, ownerId: 'child-' + process.pid, pid: process.pid }), 'utf8');
          fs.closeSync(fd);
          acquired = true;
        } catch (err) {
          if (err.code === 'EEXIST') {
            let existingPid = null;
            try {
              const content = fs.readFileSync(lockPath, 'utf8');
              existingPid = JSON.parse(content).pid;
            } catch {}

            if (existingPid && isAlive(existingPid)) {
              acquired = false;
            } else {
              // Attempt atomic claim via rename
              const claimPath = lockPath + '.claim-' + process.pid + '-' + crypto.randomUUID();
              try {
                fs.renameSync(lockPath, claimPath);
                let isStale = true;
                try {
                  const claimContent = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
                  if (claimContent.pid && isAlive(claimContent.pid)) {
                    isStale = false;
                  }
                } catch {}
                if (!isStale) {
                  try { fs.renameSync(claimPath, lockPath); } catch {}
                  acquired = false;
                } else {
                  try { fs.unlinkSync(claimPath); } catch {}
                  const fd = fs.openSync(lockPath, 'wx');
                  fs.writeFileSync(fd, JSON.stringify({ version: 1, ownerId: 'child-' + process.pid, pid: process.pid }), 'utf8');
                  fs.closeSync(fd);
                  acquired = true;
                }
              } catch (e) {
                // Lost rename or open race to other reclaimer
                acquired = false;
              }
            }
          }
        }

        process.stdout.write(acquired ? 'ACQUIRED\\n' : 'FAILED\\n');
        process.stdin.once('data', () => {
          if (acquired) {
            try {
              const content = fs.readFileSync(lockPath, 'utf8');
              const data = JSON.parse(content);
              if (data.ownerId === 'child-' + process.pid) {
                fs.unlinkSync(lockPath);
              }
            } catch {}
          }
          process.exit(0);
        });
      `;

      // Spawn two child processes simultaneously to reclaim the stale lock
      const child1 = spawn(process.execPath, ['-e', childScript, targetDest], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      const child2 = spawn(process.execPath, ['-e', childScript, targetDest], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });

      const [out1, out2] = await Promise.all([
        new Promise<string>(resolve => {
          child1.stdout?.once('data', d => resolve(d.toString().trim()));
        }),
        new Promise<string>(resolve => {
          child2.stdout?.once('data', d => resolve(d.toString().trim()));
        }),
      ]);

      // Exactly ONE child must acquire; the other must fail without crashing
      const outcomes = [out1, out2];
      expect(outcomes.filter(o => o === 'ACQUIRED')).toHaveLength(1);
      expect(outcomes.filter(o => o === 'FAILED')).toHaveLength(1);

      // Verify lock on disk belongs to the winner
      expect(fs.existsSync(lockPath)).toBe(true);

      // Clean up child processes
      child1.stdin?.write('EXIT\n');
      child2.stdin?.write('EXIT\n');

      await Promise.all([
        new Promise(resolve => child1.once('exit', resolve)),
        new Promise(resolve => child2.once('exit', resolve)),
      ]);

      if (fs.existsSync(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Ignore
        }
      }
    });

    it('new lock acquired during another process reclamation attempt is preserved without deletion', () => {
      const targetDest = path.join(testDbDir, 'interleaved-reclaim-target.db');
      const lockPath = BackupLock.getLockPath(targetDest);

      // 1. Process B establishes an active lock on targetDest
      const activeLockB = BackupLock.acquire(targetDest);
      expect(BackupLock.isLockActive(lockPath)).toBe(true);

      // 2. Process A had previously renamed a stale lock to claimPath
      const claimPathA = `${lockPath}.claim-${process.pid}-simulated`;
      fs.writeFileSync(claimPathA, JSON.stringify({ version: 1, pid: 99999999 }, null, 2));

      // 3. Process A finishes unlinking its private claimPath
      fs.unlinkSync(claimPathA);

      // 4. Process A attempts to acquire lockPath via tryAcquire()
      // Because Process B holds lockPath with an active PID, Process A's acquire must return null!
      const handleA = BackupLock.tryAcquire(targetDest);
      expect(handleA).toBeNull();

      // 5. Process B's lock on disk MUST remain untouched and active!
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(BackupLock.isLockActive(lockPath)).toBe(true);

      // Process B releases cleanly
      activeLockB.release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('cross-process lock contention: second child process is rejected until first child releases', async () => {
      const targetDest = path.join(testDbDir, 'cross-process-contention.db');
      const lockPath = BackupLock.getLockPath(targetDest);

      const workerScript = `
        const fs = require('node:fs');
        const path = require('node:path');
        const target = process.argv[1];
        const lockPath = path.resolve(target) + '.lock';

        let fd = null;
        try {
          fd = fs.openSync(lockPath, 'wx');
          const info = {
            version: 1,
            ownerId: 'worker-' + process.pid,
            pid: process.pid,
            createdAt: Date.now(),
            heartbeat: Date.now(),
            destinationPath: path.resolve(target)
          };
          fs.writeFileSync(fd, JSON.stringify(info, null, 2), 'utf8');
          fs.closeSync(fd);
          process.stdout.write('ACQUIRED\\n');
        } catch (e) {
          process.stdout.write('BUSY\\n');
          process.exit(0);
        }

        process.stdin.once('data', () => {
          try {
            const content = fs.readFileSync(lockPath, 'utf8');
            const data = JSON.parse(content);
            if (data.ownerId === 'worker-' + process.pid) {
              fs.unlinkSync(lockPath);
            }
          } catch {}
          process.stdout.write('RELEASED\\n');
          process.exit(0);
        });
      `;

      // 1. Worker 1 acquires lock
      const worker1 = spawn(process.execPath, ['-e', workerScript, targetDest], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      const w1Out = await new Promise<string>(resolve => {
        worker1.stdout?.once('data', d => resolve(d.toString().trim()));
      });
      expect(w1Out).toBe('ACQUIRED');
      expect(fs.existsSync(lockPath)).toBe(true);

      // 2. Worker 2 attempts acquire while Worker 1 holds it -> must receive BUSY
      const worker2 = spawn(process.execPath, ['-e', workerScript, targetDest], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      const w2Out = await new Promise<string>(resolve => {
        worker2.stdout?.once('data', d => resolve(d.toString().trim()));
      });
      expect(w2Out).toBe('BUSY');

      // 3. Worker 1 releases
      worker1.stdin?.write('RELEASE\n');
      await new Promise(resolve => worker1.once('exit', resolve));
      expect(fs.existsSync(lockPath)).toBe(false);

      // 4. Now Worker 3 can acquire cleanly
      const worker3 = spawn(process.execPath, ['-e', workerScript, targetDest], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      const w3Out = await new Promise<string>(resolve => {
        worker3.stdout?.once('data', d => resolve(d.toString().trim()));
      });
      expect(w3Out).toBe('ACQUIRED');
      worker3.stdin?.write('RELEASE\n');
      await new Promise(resolve => worker3.once('exit', resolve));
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('prevents an owner from releasing a lock it no longer owns', () => {
      const targetDest = path.join(testDbDir, 'unowned-release-target.db');
      const lockPath = BackupLock.getLockPath(targetDest);

      const handleA = BackupLock.acquire(targetDest);

      // Simulate a different owner taking over the lock file on disk
      const newOwnerInfo = {
        version: 1,
        ownerId: 'different-owner-token',
        pid: process.pid,
        createdAt: Date.now(),
        heartbeat: Date.now(),
        destinationPath: targetDest,
      };
      fs.writeFileSync(lockPath, JSON.stringify(newOwnerInfo, null, 2), 'utf8');

      // handleA attempts release
      handleA.release();

      // The file on disk must NOT be unlinked because handleA's ownerId did not match
      expect(fs.existsSync(lockPath)).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      expect(onDisk.ownerId).toBe('different-owner-token');

      // Clean up manually
      fs.unlinkSync(lockPath);
    });

    it('two recovery attempts targeting the same journal simultaneously coordinate safely', async () => {
      const finalDest = path.join(testDbDir, 'dual-recovery.db');
      const tempPath = path.join(testDbDir, 'dual-recovery.db.pending');
      const rollbackPath = path.join(testDbDir, 'dual-recovery.db.rollback');
      const journalPath = path.join(testDbDir, 'dual-recovery.db.backup-journal.json');

      // Create valid temp database
      const tempConn = new DatabaseConnection(tempPath);
      tempConn.open();
      tempConn
        .getRawDb()
        .exec("CREATE TABLE recovered (msg TEXT); INSERT INTO recovered VALUES ('promoted');");
      tempConn.close();

      const journal: BackupReplacementJournal = {
        version: 1,
        destinationPath: finalDest,
        tempPath,
        rollbackPath,
        state: 'PREPARING',
        createdAt: Date.now(),
      };
      fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf8');

      // Execute two recovery passes simultaneously
      const [res1, res2] = await Promise.all([
        Promise.resolve().then(() => recoverPendingBackupReplacements(testDbDir)),
        Promise.resolve().then(() => recoverPendingBackupReplacements(testDbDir)),
      ]);

      const allResults = [...res1, ...res2];
      const promotedCount = allResults.filter(r => r.actionTaken === 'PROMOTED_PENDING').length;
      expect(promotedCount).toBe(1);

      expect(fs.existsSync(finalDest)).toBe(true);
      expect(isDatabaseFileValid(finalDest)).toBe(true);
      expect(fs.existsSync(journalPath)).toBe(false);
      expect(fs.existsSync(tempPath)).toBe(false);
    });

    it('recovery does not touch files during destination-to-rollback transition of an active backup', () => {
      const targetDest = path.join(testDbDir, 'transition-dest.db');
      const lockPath = BackupLock.getLockPath(targetDest);
      const rollbackPath = path.join(testDbDir, 'transition-dest.db.rollback');
      const pendingPath = path.join(testDbDir, 'transition-dest.db.pending');
      const journalPath = path.join(testDbDir, 'transition-dest.db.backup-journal.json');

      // Create an active lock owned by another process/worker (not registered in local process map)
      const lockInfo = {
        version: 1 as const,
        ownerId: crypto.randomUUID(),
        pid: process.pid,
        createdAt: Date.now(),
        heartbeat: Date.now(),
        destinationPath: targetDest,
      };
      fs.writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2), 'utf8');

      try {
        fs.writeFileSync(rollbackPath, 'ORIGINAL_ROLLBACK_DATA');
        fs.writeFileSync(pendingPath, 'PENDING_NEW_DATA');
        const journal: BackupReplacementJournal = {
          version: 1,
          destinationPath: targetDest,
          tempPath: pendingPath,
          rollbackPath,
          state: 'SWAPPING',
          createdAt: Date.now(),
        };
        fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf8');

        // Trigger recovery pass
        const results = recoverPendingBackupReplacements(testDbDir);

        // Recovery MUST skip active locked destination
        expect(results.filter(r => r.destinationPath === targetDest)).toHaveLength(0);
        expect(fs.existsSync(rollbackPath)).toBe(true);
        expect(fs.existsSync(pendingPath)).toBe(true);
        expect(fs.existsSync(journalPath)).toBe(true);

        fs.unlinkSync(rollbackPath);
        fs.unlinkSync(pendingPath);
        fs.unlinkSync(journalPath);
      } finally {
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
      }
    });

    it('two recovery attempts competing to restore the same rollback file coordinate safely', async () => {
      const finalDest = path.join(testDbDir, 'competing-rb.db');
      const orphanRollback = path.join(testDbDir, 'competing-rb.db.rollback');

      const seed = new DatabaseConnection(orphanRollback);
      seed.open();
      seed.getRawDb().exec('CREATE TABLE t (v INT); INSERT INTO t VALUES (777);');
      seed.close();

      const [res1, res2] = await Promise.all([
        Promise.resolve().then(() => recoverPendingBackupReplacements(testDbDir)),
        Promise.resolve().then(() => recoverPendingBackupReplacements(testDbDir)),
      ]);

      const all = [...res1, ...res2];
      const restored = all.filter(r => r.actionTaken === 'RESTORED_ROLLBACK').length;
      expect(restored).toBe(1);

      expect(fs.existsSync(finalDest)).toBe(true);
      expect(fs.existsSync(orphanRollback)).toBe(false);
      expect(isDatabaseFileValid(finalDest)).toBe(true);
    });

    it('recovery skips destination when encountering a valid lock from another active process', () => {
      const targetDest = path.join(testDbDir, 'other-locked.db');
      const lockPath = BackupLock.getLockPath(targetDest);
      const journalPath = path.join(testDbDir, 'other-locked.db.backup-journal.json');

      // Create a valid active lock simulating another live process
      const lockInfo = {
        version: 1,
        ownerId: crypto.randomUUID(),
        pid: process.pid,
        createdAt: Date.now(),
        heartbeat: Date.now(),
        destinationPath: targetDest,
      };
      fs.writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2), 'utf8');

      // Plant journal
      const journal: BackupReplacementJournal = {
        version: 1,
        destinationPath: targetDest,
        tempPath: path.join(testDbDir, 'other-locked.db.pending'),
        rollbackPath: path.join(testDbDir, 'other-locked.db.rollback'),
        state: 'PREPARING',
        createdAt: Date.now(),
      };
      fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf8');

      // Force BackupLock local registry not to treat this as locally held
      expect(BackupLock.isHeldByCurrentProcess(targetDest)).toBe(false);

      const results = recoverPendingBackupReplacements(testDbDir);

      // Recovery must skip and leave journal intact
      expect(results.filter(r => r.destinationPath === targetDest)).toHaveLength(0);
      expect(fs.existsSync(journalPath)).toBe(true);

      fs.unlinkSync(lockPath);
      fs.unlinkSync(journalPath);
    });

    it('process-level integration: child process holds backup lock and coordinates with parent process', async () => {
      const targetDest = path.join(testDbDir, 'child-process-test.db');
      const lockPath = BackupLock.getLockPath(targetDest);

      // Child process script: acquires lock atomically using the exact lock protocol,
      // maintains lease heartbeat, communicates status to parent, and releases on signal.
      const childScript = `
        const fs = require('node:fs');
        const path = require('node:path');
        const target = process.argv[1];
        const lockPath = path.resolve(target) + '.lock';
        const fd = fs.openSync(lockPath, 'wx');
        const now = Date.now();
        const info = {
          version: 1,
          ownerId: 'child-process-token',
          pid: process.pid,
          createdAt: now,
          heartbeat: now,
          destinationPath: path.resolve(target)
        };
        fs.writeFileSync(fd, JSON.stringify(info, null, 2), 'utf8');
        fs.closeSync(fd);

        const timer = setInterval(() => {
          try {
            const content = fs.readFileSync(lockPath, 'utf8');
            const data = JSON.parse(content);
            data.heartbeat = Date.now();
            fs.writeFileSync(lockPath, JSON.stringify(data, null, 2), 'utf8');
          } catch {}
        }, 500);

        process.stdout.write('LOCK_ACQUIRED\\n');

        process.stdin.once('data', () => {
          clearInterval(timer);
          try {
            const content = fs.readFileSync(lockPath, 'utf8');
            const data = JSON.parse(content);
            if (data.ownerId === 'child-process-token') {
              fs.unlinkSync(lockPath);
            }
          } catch {}
          process.stdout.write('LOCK_RELEASED\\n');
          process.exit(0);
        });
      `;

      const child = spawn(process.execPath, ['-e', childScript, targetDest], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });

      try {
        // Wait for child to acquire lock
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Child process lock timeout')), 5000);
          child.stdout?.once('data', data => {
            clearTimeout(timer);
            if (data.toString().includes('LOCK_ACQUIRED')) {
              resolve();
            } else {
              reject(new Error('Unexpected child output: ' + data.toString()));
            }
          });
        });

        // 1. Verify parent sees lock as active
        expect(BackupLock.isLockActive(lockPath)).toBe(true);

        // 2. Verify parent cannot acquire
        expect(BackupLock.tryAcquire(targetDest)).toBeNull();
        expect(() => BackupLock.acquire(targetDest)).toThrow('ERR_BACKUP_CONCURRENT_LOCK');

        // 3. Verify recovery preserves child's lock
        recoverPendingBackupReplacements(testDbDir);
        expect(BackupLock.isLockActive(lockPath)).toBe(true);

        // Signal child to release lock and exit
        child.stdin?.write('RELEASE\n');

        // Wait for child exit
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Child exit timeout')), 5000);
          child.once('exit', code => {
            clearTimeout(timer);
            expect(code).toBe(0);
            resolve();
          });
        });

        // Verify lock is now released
        expect(fs.existsSync(lockPath)).toBe(false);

        // Parent can now acquire cleanly
        const parentLock = BackupLock.acquire(targetDest);
        expect(BackupLock.isLockActive(lockPath)).toBe(true);
        parentLock.release();
        expect(fs.existsSync(lockPath)).toBe(false);
      } finally {
        if (!child.killed) {
          try {
            child.kill();
          } catch {
            // Ignore
          }
        }
      }
    });

    it('persists data across file-backed connection close and reopen on drive D:', () => {
      const conn1 = new DatabaseConnection(testDbPath);
      conn1.open();
      conn1
        .getRawDb()
        .exec(
          "CREATE TABLE state (key TEXT PRIMARY KEY, val TEXT); INSERT INTO state VALUES ('k1', 'v1');",
        );
      conn1.close();

      const conn2 = new DatabaseConnection(testDbPath);
      conn2.open();
      const row = conn2.getRawDb().prepare("SELECT val FROM state WHERE key = 'k1'").get() as {
        val: string;
      };
      expect(row.val).toBe('v1');
      conn2.close();
    });
  });
});
