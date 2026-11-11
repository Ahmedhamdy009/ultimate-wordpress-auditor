import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import type { MigrationDefinition } from '../../src/main/db/migrations/types.js';

describe('Migration System', () => {
  const testDbDir = path.join('D:\\ahmed\\.tmp\\test-db-migrations');
  const testDbPath = path.join(testDbDir, 'test-migrations.db');
  let connection: DatabaseConnection;

  beforeEach(() => {
    fs.mkdirSync(testDbDir, { recursive: true });
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(() => {
    if (connection && connection.isOpen()) {
      connection.close();
    }
    try {
      if (fs.existsSync(testDbDir)) {
        fs.rmSync(testDbDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore Windows file lock cleanup errors
    }
  });

  describe('Fresh Database Execution', () => {
    it('applies initial migration on a fresh database', async () => {
      connection = new DatabaseConnection(':memory:', { isMemory: true });
      connection.open();

      const runner = new MigrationRunner(connection);
      const result = await runner.migrate();

      expect(result.appliedCount).toBe(2);
      expect(result.currentVersion).toBe(2);
      expect(runner.getCurrentVersion()).toBe(2);

      const rawDb = connection.getRawDb();

      // Check _migrations table
      const migrationRow = rawDb.prepare('SELECT * FROM _migrations WHERE version = 1').get() as {
        version: number;
        name: string;
        checksum: string;
        applied_at: string;
      };
      expect(migrationRow).toBeDefined();
      expect(migrationRow.name).toBe('001_initial_schema');
      expect(typeof migrationRow.checksum).toBe('string');
      expect(migrationRow.checksum.length).toBe(64); // SHA-256 hex length

      const migration2Row = rawDb.prepare('SELECT * FROM _migrations WHERE version = 2').get() as {
        version: number;
        name: string;
        checksum: string;
        applied_at: string;
      };
      expect(migration2Row).toBeDefined();
      expect(migration2Row.name).toBe('002_scan_history_and_findings');
      expect(migration2Row.checksum.length).toBe(64);

      // Check projects table exists
      const projectTableCheck = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
        .get();
      expect(projectTableCheck).toBeDefined();

      // Check sites table exists
      const siteTableCheck = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites'")
        .get();
      expect(siteTableCheck).toBeDefined();

      // Check scan_runs, findings, and reports tables exist
      const scanRunsTableCheck = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scan_runs'")
        .get();
      expect(scanRunsTableCheck).toBeDefined();

      const findingsTableCheck = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='findings'")
        .get();
      expect(findingsTableCheck).toBeDefined();

      const reportsTableCheck = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reports'")
        .get();
      expect(reportsTableCheck).toBeDefined();

      // Check indexes
      const indexes = rawDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('projects', 'sites', 'scan_runs', 'findings', 'reports')",
        )
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map(i => i.name);
      expect(indexNames).toContain('uq_projects_active_name');
      expect(indexNames).toContain('idx_projects_list');
      expect(indexNames).toContain('uq_sites_project_base_url');
      expect(indexNames).toContain('idx_sites_project_list');
      expect(indexNames).toContain('idx_scan_runs_site_id');
      expect(indexNames).toContain('idx_scan_runs_status');
      expect(indexNames).toContain('idx_scan_runs_created_at');
      expect(indexNames).toContain('idx_findings_scan_run_id');
      expect(indexNames).toContain('idx_findings_severity');
      expect(indexNames).toContain('idx_findings_category');
      expect(indexNames).toContain('idx_reports_scan_run_id');
      expect(indexNames).toContain('idx_reports_status');
    });

    it('is idempotent on an existing database at current version', async () => {
      connection = new DatabaseConnection(':memory:', { isMemory: true });
      connection.open();

      const runner = new MigrationRunner(connection);
      const firstRun = await runner.migrate();
      expect(firstRun.appliedCount).toBe(2);

      const secondRun = await runner.migrate();
      expect(secondRun.appliedCount).toBe(0);
      expect(secondRun.currentVersion).toBe(2);
    });
  });

  describe('Integrity, Checksums, and Downgrade Protection', () => {
    it('detects altered migration checksum and rejects with ERR_MIGRATION_CHECKSUM_MISMATCH', async () => {
      connection = new DatabaseConnection(':memory:', { isMemory: true });
      connection.open();

      const runner = new MigrationRunner(connection);
      await runner.migrate();

      // Tamper with the recorded checksum in _migrations
      connection
        .getRawDb()
        .prepare("UPDATE _migrations SET checksum = 'tampered_checksum_value' WHERE version = 1")
        .run();

      await expect(runner.migrate()).rejects.toThrow(/ERR_MIGRATION_CHECKSUM_MISMATCH/);
    });

    it('detects newer unsupported database version and rejects with ERR_DATABASE_VERSION_NEWER', async () => {
      connection = new DatabaseConnection(':memory:', { isMemory: true });
      connection.open();

      const runner = new MigrationRunner(connection);
      await runner.migrate();

      // Insert a future version into _migrations
      connection
        .getRawDb()
        .prepare(
          "INSERT INTO _migrations (version, name, checksum, applied_at) VALUES (99, '099_future', 'fake', ?)",
        )
        .run(new Date().toISOString());

      await expect(runner.migrate()).rejects.toThrow(/ERR_DATABASE_VERSION_NEWER/);
    });

    it('detects missing migration definition and rejects with ERR_MIGRATION_FAILED', async () => {
      connection = new DatabaseConnection(':memory:', { isMemory: true });
      connection.open();

      // Run with custom migration v1 and v2
      const customMigrations: MigrationDefinition[] = [
        { version: 1, name: 'v1', up: 'CREATE TABLE t1 (id TEXT PRIMARY KEY);' },
        { version: 2, name: 'v2', up: 'CREATE TABLE t2 (id TEXT PRIMARY KEY);' },
      ];

      const runner1 = new MigrationRunner(connection, customMigrations);
      await runner1.migrate();

      // Now create a runner that only knows about v2 (v1 missing)
      const incompleteMigrations: MigrationDefinition[] = [
        { version: 2, name: 'v2', up: 'CREATE TABLE t2 (id TEXT PRIMARY KEY);' },
      ];
      const runner2 = new MigrationRunner(connection, incompleteMigrations);

      await expect(runner2.migrate()).rejects.toThrow(/missing from application definitions/);
    });

    it('rolls back completely if a migration fails halfway', async () => {
      connection = new DatabaseConnection(':memory:', { isMemory: true });
      connection.open();

      const customMigrations: MigrationDefinition[] = [
        { version: 1, name: 'v1_ok', up: 'CREATE TABLE step1 (id TEXT PRIMARY KEY);' },
        {
          version: 2,
          name: 'v2_fail',
          up: 'CREATE TABLE step2 (id TEXT PRIMARY KEY); INVALID SQL SYNTAX HERE;',
        },
      ];

      const runner = new MigrationRunner(connection, customMigrations);

      await expect(runner.migrate()).rejects.toThrow(/ERR_MIGRATION_FAILED/);

      const rawDb = connection.getRawDb();
      // v1 was committed before v2 failed
      expect(
        rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='step1'").get(),
      ).toBeDefined();
      // step2 table must not exist due to transactional rollback of v2
      expect(
        rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='step2'").get(),
      ).toBeUndefined();
      // version in _migrations should remain 1
      expect(runner.getCurrentVersion()).toBe(1);
    });
  });

  describe('File-Backed Migration & Pre-Migration Backup', () => {
    it('creates a pre-migration backup when migrating a file-backed database with pending migrations', async () => {
      // 1. Setup file-backed database with initial migration
      connection = new DatabaseConnection(testDbPath);
      connection.open();

      const initialRunner = new MigrationRunner(connection, [
        { version: 1, name: 'v1', up: 'CREATE TABLE test_data (id TEXT PRIMARY KEY, val TEXT);' },
      ]);
      await initialRunner.migrate();

      // Insert some data
      connection.getRawDb().prepare("INSERT INTO test_data VALUES ('k1', 'v1')").run();

      // 2. Now run pending migration v2
      const updatedRunner = new MigrationRunner(connection, [
        { version: 1, name: 'v1', up: 'CREATE TABLE test_data (id TEXT PRIMARY KEY, val TEXT);' },
        { version: 2, name: 'v2', up: 'CREATE TABLE test_data2 (id TEXT PRIMARY KEY);' },
      ]);

      const result = await updatedRunner.migrate();
      expect(result.appliedCount).toBe(1);
      expect(result.currentVersion).toBe(2);

      // Check that a pre-migration backup file was created
      const backupDir = path.join(path.dirname(testDbPath), 'backups');
      const backupFiles = fs.readdirSync(backupDir).filter(f => f.startsWith('pre-migrate-v1'));
      expect(backupFiles.length).toBeGreaterThanOrEqual(1);

      connection.close();
    });
  });
});
