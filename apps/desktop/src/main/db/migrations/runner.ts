import crypto from 'node:crypto';
import path from 'node:path';
import type { DatabaseConnection } from '../connection.js';
import { getBackupDirectory, ensureDatabaseDirectory } from '../paths.js';
import type { AppliedMigrationRecord, MigrationDefinition, MigrationResult } from './types.js';
import { MIGRATIONS } from './definitions.js';

export function computeMigrationChecksum(sql: string): string {
  return crypto.createHash('sha256').update(sql.trim(), 'utf8').digest('hex');
}

export class MigrationRunner {
  private readonly connection: DatabaseConnection;
  private readonly migrations: readonly MigrationDefinition[];

  constructor(
    connection: DatabaseConnection,
    migrations: readonly MigrationDefinition[] = MIGRATIONS,
  ) {
    this.connection = connection;
    // Ensure migrations are strictly ordered by version ascending
    this.migrations = [...migrations].sort((a, b) => a.version - b.version);
  }

  /**
   * Runs all pending migrations within a transactional context, performing integrity checks,
   * checksum validation, downgrade prevention, and pre-migration backup.
   */
  public async migrate(): Promise<MigrationResult> {
    const rawDb = this.connection.getRawDb();

    // 1. Ensure _migrations tracking table exists
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    // 2. Fetch all previously applied migrations
    const appliedRows = rawDb
      .prepare('SELECT version, name, checksum, applied_at FROM _migrations ORDER BY version ASC')
      .all() as AppliedMigrationRecord[];

    const appliedMap = new Map<number, AppliedMigrationRecord>();
    let maxAppliedVersion = 0;

    for (const row of appliedRows) {
      appliedMap.set(row.version, row);
      if (row.version > maxAppliedVersion) {
        maxAppliedVersion = row.version;
      }
    }

    const latestRunnerVersion =
      this.migrations.length > 0 ? this.migrations[this.migrations.length - 1].version : 0;

    // 3. Downgrade protection: check if database has a higher version than the application knows about
    if (maxAppliedVersion > latestRunnerVersion) {
      throw new Error(
        `ERR_DATABASE_VERSION_NEWER: Database schema version (${maxAppliedVersion}) is newer than supported by this application (${latestRunnerVersion})`,
      );
    }

    // 4. Checksum verification for all already-applied migrations
    for (const applied of appliedRows) {
      const defined = this.migrations.find(m => m.version === applied.version);
      if (!defined) {
        throw new Error(
          `ERR_MIGRATION_FAILED: Applied migration version ${applied.version} ('${applied.name}') is missing from application definitions`,
        );
      }

      const expectedChecksum = computeMigrationChecksum(defined.up);
      if (applied.checksum !== expectedChecksum) {
        throw new Error(
          `ERR_MIGRATION_CHECKSUM_MISMATCH: Migration version ${applied.version} ('${applied.name}') checksum mismatch. Expected ${expectedChecksum}, found ${applied.checksum}`,
        );
      }
    }

    // 5. Determine pending migrations
    const pendingMigrations = this.migrations.filter(m => !appliedMap.has(m.version));

    if (pendingMigrations.length === 0) {
      return {
        appliedCount: 0,
        currentVersion: maxAppliedVersion,
      };
    }

    // 6. Pre-migration backup if file-backed and there are pending migrations
    const dbPath = this.connection.getPath();
    if (dbPath !== ':memory:') {
      const backupFilename = `pre-migrate-v${maxAppliedVersion}-${Date.now()}.db`;
      const backupPath = path.join(getBackupDirectory(path.dirname(dbPath)), backupFilename);
      try {
        await this.connection.backup(backupPath);
      } catch (backupErr) {
        throw new Error(
          `ERR_MIGRATION_FAILED: Pre-migration backup creation failed: ${backupErr instanceof Error ? backupErr.message : String(backupErr)}`,
          { cause: backupErr },
        );
      }
    }

    // 7. Execute pending migrations sequentially in a single or per-migration transaction
    let newlyAppliedCount = 0;
    let currentVersion = maxAppliedVersion;

    const executeMigrationTx = rawDb.transaction((migration: MigrationDefinition) => {
      // Execute the migration DDL/DML statements
      rawDb.exec(migration.up);

      // Record applied migration in _migrations
      const checksum = computeMigrationChecksum(migration.up);
      const appliedAt = new Date().toISOString();

      rawDb
        .prepare(
          'INSERT INTO _migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        )
        .run(migration.version, migration.name, checksum, appliedAt);
    });

    for (const pending of pendingMigrations) {
      try {
        executeMigrationTx(pending);
        newlyAppliedCount++;
        currentVersion = pending.version;
      } catch (err) {
        throw new Error(
          `ERR_MIGRATION_FAILED: Failed executing migration ${pending.version} ('${pending.name}'): ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }

    return {
      appliedCount: newlyAppliedCount,
      currentVersion,
    };
  }

  /**
   * Synchronously runs all pending migrations.
   * Leverages VACUUM INTO for synchronous pre-migration backups on file-backed databases.
   */
  public migrateSync(): MigrationResult {
    const rawDb = this.connection.getRawDb();

    // 1. Ensure _migrations tracking table exists
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    // 2. Fetch all previously applied migrations
    const appliedRows = rawDb
      .prepare('SELECT version, name, checksum, applied_at FROM _migrations ORDER BY version ASC')
      .all() as AppliedMigrationRecord[];

    const appliedMap = new Map<number, AppliedMigrationRecord>();
    let maxAppliedVersion = 0;

    for (const row of appliedRows) {
      appliedMap.set(row.version, row);
      if (row.version > maxAppliedVersion) {
        maxAppliedVersion = row.version;
      }
    }

    const latestRunnerVersion =
      this.migrations.length > 0 ? this.migrations[this.migrations.length - 1].version : 0;

    // 3. Downgrade protection
    if (maxAppliedVersion > latestRunnerVersion) {
      throw new Error(
        `ERR_DATABASE_VERSION_NEWER: Database schema version (${maxAppliedVersion}) is newer than supported by this application (${latestRunnerVersion})`,
      );
    }

    // 4. Checksum verification
    for (const applied of appliedRows) {
      const defined = this.migrations.find(m => m.version === applied.version);
      if (!defined) {
        throw new Error(
          `ERR_MIGRATION_FAILED: Applied migration version ${applied.version} ('${applied.name}') is missing from application definitions`,
        );
      }

      const expectedChecksum = computeMigrationChecksum(defined.up);
      if (applied.checksum !== expectedChecksum) {
        throw new Error(
          `ERR_MIGRATION_CHECKSUM_MISMATCH: Migration version ${applied.version} ('${applied.name}') checksum mismatch. Expected ${expectedChecksum}, found ${applied.checksum}`,
        );
      }
    }

    // 5. Determine pending migrations
    const pendingMigrations = this.migrations.filter(m => !appliedMap.has(m.version));

    if (pendingMigrations.length === 0) {
      return {
        appliedCount: 0,
        currentVersion: maxAppliedVersion,
      };
    }

    // 6. Pre-migration backup if file-backed and there are pending migrations
    const dbPath = this.connection.getPath();
    if (dbPath !== ':memory:') {
      const backupFilename = `pre-migrate-v${maxAppliedVersion}-${Date.now()}.db`;
      const backupDir = getBackupDirectory(path.dirname(dbPath));
      ensureDatabaseDirectory(path.join(backupDir, backupFilename));
      const backupPath = path.join(backupDir, backupFilename);
      try {
        const escaped = backupPath.replace(/'/g, "''");
        rawDb.exec(`VACUUM INTO '${escaped}'`);
      } catch (backupErr) {
        throw new Error(
          `ERR_MIGRATION_FAILED: Pre-migration backup creation failed: ${backupErr instanceof Error ? backupErr.message : String(backupErr)}`,
          { cause: backupErr },
        );
      }
    }

    // 7. Execute pending migrations sequentially in a single transaction
    let newlyAppliedCount = 0;
    let currentVersion = maxAppliedVersion;

    const executeMigrationTx = rawDb.transaction((migration: MigrationDefinition) => {
      rawDb.exec(migration.up);
      const checksum = computeMigrationChecksum(migration.up);
      const appliedAt = new Date().toISOString();
      rawDb
        .prepare(
          'INSERT INTO _migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        )
        .run(migration.version, migration.name, checksum, appliedAt);
    });

    for (const pending of pendingMigrations) {
      try {
        executeMigrationTx(pending);
        newlyAppliedCount++;
        currentVersion = pending.version;
      } catch (err) {
        throw new Error(
          `ERR_MIGRATION_FAILED: Failed executing migration ${pending.version} ('${pending.name}'): ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }

    return {
      appliedCount: newlyAppliedCount,
      currentVersion,
    };
  }

  /**
   * Retrieves the current schema version of the database.
   */
  public getCurrentVersion(): number {
    const rawDb = this.connection.getRawDb();
    try {
      const row = rawDb.prepare('SELECT MAX(version) as max_version FROM _migrations').get() as
        | {
            max_version: number | null;
          }
        | undefined;
      return row?.max_version ?? 0;
    } catch {
      return 0;
    }
  }
}
