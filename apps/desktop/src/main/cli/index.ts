import fs from 'node:fs';
import path from 'node:path';
import { DatabaseConnection, recoverPendingBackupReplacements } from '../db/connection.js';
import { MigrationRunner, computeMigrationChecksum } from '../db/migrations/runner.js';
import { MIGRATIONS } from '../db/migrations/definitions.js';
import { getDatabasePath, getBackupDirectory, ensureDatabaseDirectory } from '../db/paths.js';
import type { AppliedMigrationRecord } from '../db/migrations/types.js';

export interface CliOptions {
  command?: 'status' | 'migrate' | 'verify' | 'diagnostics' | 'backup' | 'help';
  dbPath?: string;
  backupTarget?: string;
  json?: boolean;
  env?: 'development' | 'production';
  overwrite?: boolean;
}

export interface CliOutputHandler {
  log: (msg: string) => void;
  error: (msg: string) => void;
}

export interface SafePathValidationOptions {
  mode?: 'development' | 'production';
  purpose?: 'database' | 'backup' | 'general';
  allowMemory?: boolean;
}

const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/**
 * Validates database and backup filesystem paths with comprehensive security controls:
 * - Rejects null bytes, ASCII control characters, and Windows reserved device names (CON, NUL, COM1-9, etc.).
 * - Rejects filesystem root paths (e.g. C:\, D:\) and direct root file placements (e.g. C:\auditor.db).
 * - Rejects protected Windows operating system directories (e.g. C:\Windows, C:\Program Files).
 * - In development mode: enforces strict boundary on Drive D:, rejecting Drive C: operations.
 * - In production mode: permits approved customer directories (e.g. %APPDATA%\... or user backup directories).
 */
export function validateSafePath(targetPath: string, options?: SafePathValidationOptions): string {
  if (targetPath === ':memory:') {
    if (options?.allowMemory !== false && options?.purpose !== 'backup') {
      return ':memory:';
    }
    throw new Error('ERR_INVALID_PATH: In-memory target is not allowed for this operation.');
  }

  // Check for null bytes or control characters
  for (let i = 0; i < targetPath.length; i++) {
    const code = targetPath.charCodeAt(i);
    if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      throw new Error(
        `ERR_INVALID_PATH: Path contains prohibited control or null characters ('${targetPath}').`,
      );
    }
  }

  // Reject UNC network paths and device namespace paths
  if (targetPath.startsWith('\\\\') || targetPath.startsWith('//')) {
    throw new Error(
      `ERR_UNC_PATH_PROHIBITED: UNC network paths and device namespace paths are prohibited ('${targetPath}').`,
    );
  }

  const resolved = path.resolve(targetPath);
  if (resolved.startsWith('\\\\')) {
    throw new Error(
      `ERR_UNC_PATH_PROHIBITED: UNC network paths and device namespace paths are prohibited ('${resolved}').`,
    );
  }

  const parsed = path.parse(resolved);

  // Check Windows reserved device names in all segments
  const segments = resolved.split(/[\\/]/);
  for (const segment of segments) {
    if (!segment) continue;
    const baseName = segment.split('.')[0].toUpperCase();
    if (WINDOWS_RESERVED_DEVICE_NAMES.has(baseName)) {
      throw new Error(
        `ERR_RESERVED_DEVICE_PATH: Path references prohibited Windows device name ('${resolved}').`,
      );
    }
  }

  // Reject direct filesystem root paths
  if (resolved === parsed.root) {
    throw new Error(
      `ERR_UNSAFE_ROOT_PATH: Operations directly targeting filesystem root are prohibited ('${resolved}').`,
    );
  }

  // Reject placing files directly in drive root (e.g. C:\file.db or D:\file.db)
  if (parsed.dir === parsed.root) {
    throw new Error(
      `ERR_UNSAFE_ROOT_PATH: Files cannot be placed directly in drive root ('${resolved}'). Target must reside in a dedicated directory.`,
    );
  }

  // Resolve canonical filesystem realpath to prevent symlink and junction boundary escapes
  let existingAncestor = resolved;
  const subSegments: string[] = [];
  while (existingAncestor && !fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    subSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }

  let realCanonicalPath = resolved;
  if (existingAncestor && fs.existsSync(existingAncestor)) {
    try {
      const realAncestor = fs.realpathSync(existingAncestor);
      realCanonicalPath =
        subSegments.length > 0 ? path.join(realAncestor, ...subSegments) : realAncestor;
    } catch {
      realCanonicalPath = resolved;
    }
  }

  // Reject Windows protected system directories on both resolved path and real canonical path
  const pathsToCheck = [resolved, realCanonicalPath];
  for (const checkPath of pathsToCheck) {
    const lowerPath = checkPath.toLowerCase();
    const checkParsed = path.parse(checkPath);
    const rootLower = checkParsed.root.toLowerCase();
    const systemDirs = [
      `${rootLower}windows`,
      `${rootLower}program files`,
      `${rootLower}program files (x86)`,
      `${rootLower}system volume information`,
      `${rootLower}$recycle.bin`,
      `${rootLower}recovery`,
    ];
    for (const sysDir of systemDirs) {
      if (lowerPath === sysDir || lowerPath.startsWith(`${sysDir}\\`)) {
        throw new Error(
          `ERR_PROTECTED_SYSTEM_PATH: Target path resides in protected system directory ('${checkPath}').`,
        );
      }
    }
    if (checkPath === checkParsed.root || checkParsed.dir === checkParsed.root) {
      throw new Error(
        `ERR_UNSAFE_ROOT_PATH: Operations directly targeting filesystem root are prohibited ('${checkPath}').`,
      );
    }
  }

  // Mode boundary enforcement
  const mode = options?.mode ?? 'development';
  if (mode === 'development') {
    if (parsed.root.toUpperCase().startsWith('C:')) {
      throw new Error(
        `ERR_INVALID_PROJECT_DRIVE: Prohibited operation on Drive C: ('${resolved}'). All project databases and caches must reside on Drive D: in development mode.`,
      );
    }
    if (
      realCanonicalPath.toUpperCase().startsWith('C:') ||
      !realCanonicalPath.toUpperCase().startsWith('D:\\')
    ) {
      throw new Error(
        `ERR_INVALID_PROJECT_DRIVE: Target path escapes approved project storage via symlink or junction ('${resolved}' -> '${realCanonicalPath}'). All project databases and caches must reside on Drive D: in development mode.`,
      );
    }
  }

  return resolved;
}

/**
 * Validates that database and backup filesystem paths reside strictly on Drive D: in development mode.
 * Maintained for backward compatibility.
 */
export function validateSafeDrivePath(targetPath: string): string {
  return validateSafePath(targetPath, { mode: 'development' });
}

/**
 * Parses CLI command line arguments.
 */
export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.command = 'help';
    } else if (arg === '--db' || arg === '-d') {
      if (i + 1 < args.length) {
        options.dbPath = args[++i];
      }
    } else if (arg.startsWith('--db=')) {
      options.dbPath = arg.slice(5);
    } else if (arg === '--production' || arg === '--prod') {
      options.env = 'production';
    } else if (arg === '--dev' || arg === '--development') {
      options.env = 'development';
    } else if (arg === '--env') {
      if (i + 1 < args.length) {
        const val = args[++i].toLowerCase();
        options.env = val === 'prod' || val === 'production' ? 'production' : 'development';
      }
    } else if (arg.startsWith('--env=')) {
      const val = arg.slice(6).toLowerCase();
      options.env = val === 'prod' || val === 'production' ? 'production' : 'development';
    } else if (arg === '--overwrite' || arg === '-f' || arg === '--force') {
      options.overwrite = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (!options.command) {
    const cmd = positional[0]?.toLowerCase();
    if (
      cmd === 'status' ||
      cmd === 'migrate' ||
      cmd === 'verify' ||
      cmd === 'diagnostics' ||
      cmd === 'backup' ||
      cmd === 'help'
    ) {
      options.command = cmd;
    } else if (!cmd) {
      options.command = 'help';
    } else {
      throw new Error(`Unknown command '${cmd}'. Use --help for available commands.`);
    }
  }

  if (options.command === 'backup' && positional.length > 1) {
    options.backupTarget = positional[1];
  }

  return options;
}

export function printHelp(out: CliOutputHandler): void {
  out.log(
    `
Ultimate WordPress & Website Auditor — Database Migration & Maintenance CLI

Usage:
  db:cli <command> [options]

Commands:
  status                     Display schema version, defined migrations, and applied history
  migrate                    Execute all pending database migrations within a safe transaction
  verify                     Perform database integrity checks, foreign key checks, and checksum verification
  diagnostics                Show database file metrics, SQLite pragma settings, and table row counts
  backup [targetPath]        Create an atomic hot backup of the SQLite database
  help                       Show this help message

Options:
  --db, -d <path>            Target SQLite database path
  --production, --prod       Operate on production database (standard system userData)
  --dev, --development       Operate on development database (isolated on Drive D:)
  --env <dev|prod>           Specify environment explicitly
  --overwrite, -f            Allow overwriting destination backup file
  --json                     Output structured JSON instead of formatted text
  -h, --help                 Show help message
`.trim(),
  );
}

/**
 * Core CLI execution function with dependency injection for output and error handling.
 * Returns standard exit code (0 for success, 1 for error).
 */
export async function runCli(
  args: string[],
  handler: CliOutputHandler = {
    log: msg => console.log(msg),
    error: msg => console.error(msg),
  },
): Promise<number> {
  let parsed: CliOptions;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    handler.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (parsed.command === 'help') {
    printHelp(handler);
    return 0;
  }

  const envMode: 'development' | 'production' = parsed.env ?? 'development';
  let rawDbPath = parsed.dbPath;
  if (!rawDbPath) {
    rawDbPath = getDatabasePath(undefined, { isDev: envMode === 'development' });
  }

  let dbPath: string;
  try {
    dbPath = validateSafePath(rawDbPath, { mode: envMode, purpose: 'database' });
  } catch (pathErr) {
    handler.error(`Path Error: ${pathErr instanceof Error ? pathErr.message : String(pathErr)}`);
    return 1;
  }

  const isMemory = dbPath === ':memory:';
  const dbExists = isMemory || fs.existsSync(dbPath);

  // Non-destructive inspection when database does not exist on disk
  if (!dbExists && parsed.command !== 'migrate') {
    switch (parsed.command) {
      case 'status': {
        const migrationsStatus = MIGRATIONS.map(def => ({
          version: def.version,
          name: def.name,
          applied: false,
          appliedAt: null,
          checksumMatch: null,
        }));

        if (parsed.json) {
          handler.log(
            JSON.stringify(
              {
                databasePath: dbPath,
                databaseExists: false,
                currentVersion: 0,
                totalMigrations: MIGRATIONS.length,
                appliedCount: 0,
                pendingCount: MIGRATIONS.length,
                migrations: migrationsStatus,
              },
              null,
              2,
            ),
          );
        } else {
          handler.log(`Database: ${dbPath} (File does not exist on disk)`);
          handler.log(`Current Schema Version: 0`);
          handler.log(`Total Defined Migrations: ${MIGRATIONS.length}`);
          handler.log(`Applied: 0 | Pending: ${MIGRATIONS.length}\n`);
          handler.log(
            `Status: Uninitialized. Run 'migrate' to create and initialize the database schema.`,
          );
        }
        return 0;
      }

      case 'verify': {
        handler.error(
          `Database file does not exist at '${dbPath}'. Cannot verify nonexistent database.`,
        );
        return 1;
      }

      case 'diagnostics': {
        handler.error(
          `Database file does not exist at '${dbPath}'. Cannot inspect nonexistent database.`,
        );
        return 1;
      }

      case 'backup': {
        handler.error(`Source database file does not exist at '${dbPath}'. Cannot perform backup.`);
        return 1;
      }

      default:
        break;
    }
  }

  if (!isMemory) {
    ensureDatabaseDirectory(path.dirname(dbPath));
  }

  const connection = new DatabaseConnection(dbPath, { isMemory });
  try {
    connection.open();
    const rawDb = connection.getRawDb();
    const runner = new MigrationRunner(connection, MIGRATIONS);

    switch (parsed.command) {
      case 'status': {
        const currentVersion = runner.getCurrentVersion();
        let appliedRows: AppliedMigrationRecord[] = [];
        try {
          appliedRows = rawDb
            .prepare(
              'SELECT version, name, checksum, applied_at FROM _migrations ORDER BY version ASC',
            )
            .all() as AppliedMigrationRecord[];
        } catch {
          appliedRows = [];
        }

        const appliedMap = new Map(appliedRows.map(r => [r.version, r]));
        const migrationsStatus = MIGRATIONS.map(def => {
          const applied = appliedMap.get(def.version);
          const expectedChecksum = computeMigrationChecksum(def.up);
          return {
            version: def.version,
            name: def.name,
            applied: Boolean(applied),
            appliedAt: applied ? applied.applied_at : null,
            checksumMatch: applied ? applied.checksum === expectedChecksum : null,
          };
        });

        const pendingCount = MIGRATIONS.filter(m => !appliedMap.has(m.version)).length;

        if (parsed.json) {
          handler.log(
            JSON.stringify(
              {
                databasePath: dbPath,
                databaseExists: true,
                currentVersion,
                totalMigrations: MIGRATIONS.length,
                appliedCount: appliedRows.length,
                pendingCount,
                migrations: migrationsStatus,
              },
              null,
              2,
            ),
          );
        } else {
          handler.log(`Database: ${dbPath}`);
          handler.log(`Current Schema Version: ${currentVersion}`);
          handler.log(`Total Defined Migrations: ${MIGRATIONS.length}`);
          handler.log(`Applied: ${appliedRows.length} | Pending: ${pendingCount}\n`);
          handler.log('Migrations:');
          for (const m of migrationsStatus) {
            const statusLabel = m.applied ? `[APPLIED ${m.appliedAt}]` : '[PENDING]';
            const checksumLabel =
              m.applied && m.checksumMatch === false ? ' (WARNING: Checksum Mismatch!)' : '';
            handler.log(`  v${m.version} - ${m.name}: ${statusLabel}${checksumLabel}`);
          }
        }
        return 0;
      }

      case 'migrate': {
        const preVersion = runner.getCurrentVersion();
        const result = await runner.migrate();

        if (parsed.json) {
          handler.log(
            JSON.stringify(
              {
                success: true,
                previousVersion: preVersion,
                currentVersion: result.currentVersion,
                appliedCount: result.appliedCount,
              },
              null,
              2,
            ),
          );
        } else {
          handler.log(`Migrations executed successfully.`);
          handler.log(`Previous Version: ${preVersion}`);
          handler.log(`Current Version: ${result.currentVersion}`);
          handler.log(`Newly Applied: ${result.appliedCount}`);
        }
        return 0;
      }

      case 'verify': {
        // 1. PRAGMA integrity_check
        const integrityCheck = rawDb.prepare('PRAGMA integrity_check').all() as Array<
          Record<string, unknown>
        >;
        const integrityOk =
          integrityCheck.length === 1 && Object.values(integrityCheck[0])[0] === 'ok';

        // 2. PRAGMA foreign_key_check
        const fkCheck = rawDb.prepare('PRAGMA foreign_key_check').all() as Array<
          Record<string, unknown>
        >;
        const fkOk = fkCheck.length === 0;

        // 3. Migration Checksums
        let checksumsOk = true;
        const checksumErrors: string[] = [];
        try {
          const appliedRows = rawDb
            .prepare('SELECT version, name, checksum FROM _migrations ORDER BY version ASC')
            .all() as Array<{ version: number; name: string; checksum: string }>;

          for (const applied of appliedRows) {
            const def = MIGRATIONS.find(m => m.version === applied.version);
            if (!def) {
              checksumsOk = false;
              checksumErrors.push(`Missing definition for applied migration v${applied.version}`);
            } else {
              const expected = computeMigrationChecksum(def.up);
              if (applied.checksum !== expected) {
                checksumsOk = false;
                checksumErrors.push(
                  `Checksum mismatch in migration v${applied.version} ('${applied.name}')`,
                );
              }
            }
          }
        } catch {
          // _migrations may not exist yet if fresh
        }

        const overallOk = integrityOk && fkOk && checksumsOk;

        if (parsed.json) {
          handler.log(
            JSON.stringify(
              {
                verified: overallOk,
                integrityCheck: integrityOk ? 'ok' : integrityCheck,
                foreignKeyViolations: fkCheck.length,
                checksumsVerified: checksumsOk,
                checksumErrors,
              },
              null,
              2,
            ),
          );
        } else {
          handler.log(`Database Integrity Verification:`);
          handler.log(`  SQLite Integrity Check: ${integrityOk ? 'PASSED' : 'FAILED'}`);
          handler.log(
            `  Foreign Key Constraints: ${fkOk ? 'PASSED (0 violations)' : `FAILED (${fkCheck.length} violations)`}`,
          );
          handler.log(`  Migration Checksums: ${checksumsOk ? 'PASSED' : 'FAILED'}`);
          if (checksumErrors.length > 0) {
            for (const err of checksumErrors) {
              handler.log(`    - ${err}`);
            }
          }
          handler.log(`\nOverall Verification: ${overallOk ? 'PASSED' : 'FAILED'}`);
        }
        return overallOk ? 0 : 1;
      }

      case 'diagnostics': {
        const pageSizeRow = rawDb.prepare('PRAGMA page_size').get() as Record<string, unknown>;
        const pageCountRow = rawDb.prepare('PRAGMA page_count').get() as Record<string, unknown>;
        const journalModeRow = rawDb.prepare('PRAGMA journal_mode').get() as Record<
          string,
          unknown
        >;
        const fkRow = rawDb.prepare('PRAGMA foreign_keys').get() as Record<string, unknown>;

        const pageSize = Number(Object.values(pageSizeRow)[0] ?? 0);
        const pageCount = Number(Object.values(pageCountRow)[0] ?? 0);
        const journalMode = String(Object.values(journalModeRow)[0] ?? '');
        const foreignKeys = Boolean(Object.values(fkRow)[0]);

        let fileSizeBytes = pageSize * pageCount;
        if (!isMemory && fs.existsSync(dbPath)) {
          fileSizeBytes = fs.statSync(dbPath).size;
        }

        const countTable = (table: string): number => {
          try {
            const row = rawDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
              count: number;
            };
            return row ? Number(row.count) : 0;
          } catch {
            return 0;
          }
        };

        const tableCounts = {
          projects: countTable('projects'),
          sites: countTable('sites'),
          scanRuns: countTable('scan_runs'),
          findings: countTable('findings'),
          reports: countTable('reports'),
        };

        if (parsed.json) {
          handler.log(
            JSON.stringify(
              {
                databasePath: dbPath,
                fileSizeBytes,
                fileSizeKb: (fileSizeBytes / 1024).toFixed(2),
                pageSize,
                pageCount,
                journalMode,
                foreignKeysEnabled: foreignKeys,
                rowCounts: tableCounts,
              },
              null,
              2,
            ),
          );
        } else {
          handler.log(`Database Diagnostics:`);
          handler.log(`  Path: ${dbPath}`);
          handler.log(
            `  Size on disk: ${(fileSizeBytes / 1024).toFixed(2)} KB (${fileSizeBytes} bytes)`,
          );
          handler.log(`  Page Size: ${pageSize} bytes | Page Count: ${pageCount}`);
          handler.log(`  Journal Mode: ${journalMode}`);
          handler.log(`  Foreign Keys: ${foreignKeys ? 'ENABLED' : 'DISABLED'}`);
          handler.log(`\nTable Row Counts:`);
          handler.log(`  projects:   ${tableCounts.projects}`);
          handler.log(`  sites:      ${tableCounts.sites}`);
          handler.log(`  scan_runs:  ${tableCounts.scanRuns}`);
          handler.log(`  findings:   ${tableCounts.findings}`);
          handler.log(`  reports:    ${tableCounts.reports}`);
        }
        return 0;
      }

      case 'backup': {
        const rawBackupTarget = parsed.backupTarget
          ? parsed.backupTarget
          : path.join(
              getBackupDirectory(path.dirname(dbPath), { isDev: envMode === 'development' }),
              `manual-backup-${Date.now()}.db`,
            );

        const backupTarget = validateSafePath(rawBackupTarget, {
          mode: envMode,
          purpose: 'backup',
        });
        ensureDatabaseDirectory(path.dirname(backupTarget));
        recoverPendingBackupReplacements(path.dirname(backupTarget));

        await connection.backup(backupTarget, {
          overwrite: Boolean(parsed.overwrite),
          verifyIntegrity: true,
        });
        const backupStat = fs.statSync(backupTarget);

        if (parsed.json) {
          handler.log(
            JSON.stringify(
              {
                success: true,
                sourceDb: dbPath,
                backupPath: backupTarget,
                sizeBytes: backupStat.size,
              },
              null,
              2,
            ),
          );
        } else {
          handler.log(`Hot Backup Created Successfully.`);
          handler.log(`  Source: ${dbPath}`);
          handler.log(`  Backup Path: ${backupTarget}`);
          handler.log(
            `  Size: ${(backupStat.size / 1024).toFixed(2)} KB (${backupStat.size} bytes)`,
          );
        }
        return 0;
      }

      default:
        printHelp(handler);
        return 0;
    }
  } catch (err) {
    handler.error(`Execution Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    if (connection.isOpen()) {
      connection.close();
    }
  }
}
