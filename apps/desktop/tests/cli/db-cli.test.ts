import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  runCli,
  parseArgs,
  validateSafePath,
  validateSafeDrivePath,
  type CliOutputHandler,
} from '../../src/main/cli/index.js';

describe('Phase 2.3 — Database Migration & Maintenance CLI', () => {
  const testDbDir = 'D:\\ahmed\\.tmp\\test-cli-db';
  const testDbPath = path.join(testDbDir, 'cli-test.db');
  const testBackupDir = path.join(testDbDir, 'backups');

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
      // Ignore Windows cleanup errors
    }
  });

  function createTestOutput(): {
    handler: CliOutputHandler;
    logs: string[];
    errors: string[];
  } {
    const logs: string[] = [];
    const errors: string[] = [];
    return {
      handler: {
        log: (msg: string) => logs.push(msg),
        error: (msg: string) => errors.push(msg),
      },
      logs,
      errors,
    };
  }

  describe('Path & Argument Safety Guards', () => {
    it('validates safe paths on Drive D: and permits :memory:', () => {
      expect(validateSafeDrivePath(':memory:')).toBe(':memory:');
      expect(validateSafeDrivePath('D:\\ahmed\\.tmp\\db.sqlite')).toBe(
        'D:\\ahmed\\.tmp\\db.sqlite',
      );
    });

    it('strictly forbids database paths on Drive C: in development mode', () => {
      expect(() => {
        validateSafeDrivePath('C:\\Users\\Ahmed\\db.sqlite');
      }).toThrow(/ERR_INVALID_PROJECT_DRIVE/);

      expect(() => {
        validateSafePath('C:\\Users\\Ahmed\\db.sqlite', { mode: 'development' });
      }).toThrow(/ERR_INVALID_PROJECT_DRIVE/);
    });

    it('permits valid application paths on Drive C: in production mode', () => {
      const prodPath = 'C:\\Users\\Ahmed\\AppData\\Roaming\\auditor\\auditor.db';
      const resolved = validateSafePath(prodPath, { mode: 'production' });
      expect(resolved).toBe(path.resolve(prodPath));
    });

    it('rejects null bytes and control characters across all modes', () => {
      expect(() => validateSafePath('D:\\ahmed\\.tmp\\test\0.db')).toThrow(/ERR_INVALID_PATH/);
      expect(() => validateSafePath('C:\\auditor\x07.db', { mode: 'production' })).toThrow(
        /ERR_INVALID_PATH/,
      );
    });

    it('rejects prohibited Windows reserved device names', () => {
      expect(() => validateSafePath('D:\\ahmed\\.tmp\\con.db')).toThrow(/ERR_RESERVED_DEVICE_PATH/);
      expect(() => validateSafePath('D:\\ahmed\\.tmp\\nul')).toThrow(/ERR_RESERVED_DEVICE_PATH/);
      expect(() => validateSafePath('D:\\ahmed\\.tmp\\aux.sqlite')).toThrow(
        /ERR_RESERVED_DEVICE_PATH/,
      );
      expect(() => validateSafePath('D:\\ahmed\\.tmp\\com1.db')).toThrow(
        /ERR_RESERVED_DEVICE_PATH/,
      );
      expect(() => validateSafePath('D:\\ahmed\\.tmp\\lpt2.db')).toThrow(
        /ERR_RESERVED_DEVICE_PATH/,
      );
    });

    it('rejects UNC network paths and device namespace paths', () => {
      expect(() => validateSafePath('\\\\server\\share\\db.sqlite')).toThrow(
        /ERR_UNC_PATH_PROHIBITED/,
      );
      expect(() => validateSafePath('\\\\?\\C:\\auditor.db')).toThrow(/ERR_UNC_PATH_PROHIBITED/);
      expect(() => validateSafePath('//127.0.0.1/c$/db.sqlite')).toThrow(/ERR_UNC_PATH_PROHIBITED/);
    });

    it('prevents development mode from escaping project boundary via junctions or symlinks', () => {
      const junctionTarget = 'C:\\Users';
      const junctionPath = path.join(testDbDir, 'escape-junction');
      try {
        fs.symlinkSync(junctionTarget, junctionPath, 'junction');
        const escapePath = path.join(junctionPath, 'leak.db');
        expect(() => validateSafePath(escapePath, { mode: 'development' })).toThrow(
          /ERR_INVALID_PROJECT_DRIVE/,
        );
      } finally {
        if (fs.existsSync(junctionPath)) {
          try {
            fs.unlinkSync(junctionPath);
          } catch {
            // Ignore cleanup
          }
        }
      }
    });

    it('rejects junctions or symlinks pointing to protected Windows system directories in production mode', () => {
      const sysJunctionPath = path.join(testDbDir, 'sys-junction');
      try {
        fs.symlinkSync('C:\\Windows', sysJunctionPath, 'junction');
        const target = path.join(sysJunctionPath, 'test.db');
        expect(() => validateSafePath(target, { mode: 'production' })).toThrow(
          /ERR_PROTECTED_SYSTEM_PATH/,
        );
      } finally {
        if (fs.existsSync(sysJunctionPath)) {
          try {
            fs.unlinkSync(sysJunctionPath);
          } catch {
            // Ignore cleanup
          }
        }
      }
    });

    it('rejects direct filesystem root and drive-root file placement', () => {
      expect(() => validateSafePath('C:\\', { mode: 'production' })).toThrow(
        /ERR_UNSAFE_ROOT_PATH/,
      );
      expect(() => validateSafePath('D:\\', { mode: 'development' })).toThrow(
        /ERR_UNSAFE_ROOT_PATH/,
      );
      expect(() => validateSafePath('C:\\auditor.db', { mode: 'production' })).toThrow(
        /ERR_UNSAFE_ROOT_PATH/,
      );
      expect(() => validateSafePath('D:\\auditor.db', { mode: 'development' })).toThrow(
        /ERR_UNSAFE_ROOT_PATH/,
      );
    });

    it('rejects Windows protected operating system directories', () => {
      expect(() =>
        validateSafePath('C:\\Windows\\System32\\bad.db', { mode: 'production' }),
      ).toThrow(/ERR_PROTECTED_SYSTEM_PATH/);
      expect(() =>
        validateSafePath('C:\\Program Files\\App\\bad.db', { mode: 'production' }),
      ).toThrow(/ERR_PROTECTED_SYSTEM_PATH/);
      expect(() =>
        validateSafePath('C:\\Program Files (x86)\\App\\bad.db', { mode: 'production' }),
      ).toThrow(/ERR_PROTECTED_SYSTEM_PATH/);
    });

    it('parses valid commands and options including env and overwrite flags', () => {
      const parsed = parseArgs([
        'status',
        '--json',
        '--db',
        'D:\\ahmed\\db.sqlite',
        '--production',
        '--overwrite',
      ]);
      expect(parsed.command).toBe('status');
      expect(parsed.json).toBe(true);
      expect(parsed.dbPath).toBe('D:\\ahmed\\db.sqlite');
      expect(parsed.env).toBe('production');
      expect(parsed.overwrite).toBe(true);
    });

    it('rejects unknown commands', () => {
      expect(() => parseArgs(['destroy-database'])).toThrow(/Unknown command/);
    });
  });

  describe('Non-Destructive Inspection & File Creation Guards', () => {
    it('status does NOT create an empty database file when file does not exist', async () => {
      const nonexistentPath = path.join(testDbDir, 'nonexistent-status.db');
      expect(fs.existsSync(nonexistentPath)).toBe(false);

      const { handler, logs } = createTestOutput();
      const code = await runCli(['status', '--db', nonexistentPath], handler);
      expect(code).toBe(0);
      expect(logs.some(l => l.includes('File does not exist on disk'))).toBe(true);
      expect(logs.some(l => l.includes('Current Schema Version: 0'))).toBe(true);
      expect(logs.some(l => l.includes('Pending: 2'))).toBe(true);

      // Verify that no file was created on disk
      expect(fs.existsSync(nonexistentPath)).toBe(false);
    });

    it('status returns structured JSON reporting databaseExists: false without file creation', async () => {
      const nonexistentPath = path.join(testDbDir, 'nonexistent-json.db');
      const { handler, logs } = createTestOutput();
      const code = await runCli(['status', '--json', '--db', nonexistentPath], handler);
      expect(code).toBe(0);

      const jsonStatus = JSON.parse(logs[0]);
      expect(jsonStatus.databaseExists).toBe(false);
      expect(jsonStatus.currentVersion).toBe(0);
      expect(jsonStatus.pendingCount).toBe(2);
      expect(fs.existsSync(nonexistentPath)).toBe(false);
    });

    it('verify, diagnostics, and backup reject nonexistent databases safely without file creation', async () => {
      const nonexistentPath = path.join(testDbDir, 'nonexistent-ops.db');

      // Verify
      const { handler: hVerify, errors: errVerify } = createTestOutput();
      const codeVerify = await runCli(['verify', '--db', nonexistentPath], hVerify);
      expect(codeVerify).toBe(1);
      expect(errVerify.some(e => e.includes('Cannot verify nonexistent database'))).toBe(true);
      expect(fs.existsSync(nonexistentPath)).toBe(false);

      // Diagnostics
      const { handler: hDiag, errors: errDiag } = createTestOutput();
      const codeDiag = await runCli(['diagnostics', '--db', nonexistentPath], hDiag);
      expect(codeDiag).toBe(1);
      expect(errDiag.some(e => e.includes('Cannot inspect nonexistent database'))).toBe(true);
      expect(fs.existsSync(nonexistentPath)).toBe(false);

      // Backup
      const { handler: hBackup, errors: errBackup } = createTestOutput();
      const codeBackup = await runCli(['backup', '--db', nonexistentPath], hBackup);
      expect(codeBackup).toBe(1);
      expect(errBackup.some(e => e.includes('Cannot perform backup'))).toBe(true);
      expect(fs.existsSync(nonexistentPath)).toBe(false);
    });
  });

  describe('CLI Commands Execution & Lifecycle', () => {
    it('displays help when requested via --help or help command', async () => {
      const { handler, logs } = createTestOutput();
      const code = await runCli(['--help'], handler);
      expect(code).toBe(0);
      expect(logs.some(l => l.includes('Migration & Maintenance CLI'))).toBe(true);
    });

    it('reports status on fresh database before and after migration', async () => {
      const { handler: h1, logs: l1 } = createTestOutput();
      const code1 = await runCli(['status', '--db', testDbPath], h1);
      expect(code1).toBe(0);
      expect(l1.some(l => l.includes('Current Schema Version: 0'))).toBe(true);
      expect(l1.some(l => l.includes('Pending: 2'))).toBe(true);
      expect(fs.existsSync(testDbPath)).toBe(false);

      // Run migration (which creates and initializes the DB)
      const { handler: hMigrate, logs: lMigrate } = createTestOutput();
      const codeMigrate = await runCli(['migrate', '--db', testDbPath], hMigrate);
      expect(codeMigrate).toBe(0);
      expect(lMigrate.some(l => l.includes('Current Version: 2'))).toBe(true);
      expect(fs.existsSync(testDbPath)).toBe(true);

      // Check status in JSON mode
      const { handler: h2, logs: l2 } = createTestOutput();
      const code2 = await runCli(['status', '--json', '--db', testDbPath], h2);
      expect(code2).toBe(0);
      const jsonStatus = JSON.parse(l2[0]);
      expect(jsonStatus.databaseExists).toBe(true);
      expect(jsonStatus.currentVersion).toBe(2);
      expect(jsonStatus.appliedCount).toBe(2);
      expect(jsonStatus.pendingCount).toBe(0);
      expect(jsonStatus.migrations).toHaveLength(2);
    });

    it('performs integrity and checksum verification via verify command', async () => {
      // Migrate first
      const { handler: hMigrate } = createTestOutput();
      await runCli(['migrate', '--db', testDbPath], hMigrate);

      const { handler, logs } = createTestOutput();
      const code = await runCli(['verify', '--json', '--db', testDbPath], handler);
      expect(code).toBe(0);

      const jsonVerify = JSON.parse(logs[0]);
      expect(jsonVerify.verified).toBe(true);
      expect(jsonVerify.integrityCheck).toBe('ok');
      expect(jsonVerify.foreignKeyViolations).toBe(0);
      expect(jsonVerify.checksumsVerified).toBe(true);
    });

    it('provides diagnostics with table row counts and metrics', async () => {
      // Migrate first
      const { handler: hMigrate } = createTestOutput();
      await runCli(['migrate', '--db', testDbPath], hMigrate);

      const { handler, logs } = createTestOutput();
      const code = await runCli(['diagnostics', '--json', '--db', testDbPath], handler);
      expect(code).toBe(0);

      const jsonDiag = JSON.parse(logs[0]);
      expect(jsonDiag.pageSize).toBeGreaterThan(0);
      expect(jsonDiag.rowCounts).toEqual({
        projects: 0,
        sites: 0,
        scanRuns: 0,
        findings: 0,
        reports: 0,
      });
    });

    it('creates hot database backup with target path validation and overwrite protection', async () => {
      // Migrate first
      const { handler: hMigrate } = createTestOutput();
      await runCli(['migrate', '--db', testDbPath], hMigrate);

      const targetBackup = path.join(testBackupDir, 'manual.db');
      const { handler: h1, logs: l1 } = createTestOutput();
      const code1 = await runCli(['backup', targetBackup, '--json', '--db', testDbPath], h1);
      expect(code1).toBe(0);

      const jsonBackup = JSON.parse(l1[0]);
      expect(jsonBackup.success).toBe(true);
      expect(jsonBackup.backupPath).toBe(targetBackup);
      expect(fs.existsSync(targetBackup)).toBe(true);

      // Attempt duplicate backup to same path without --overwrite flag: must fail
      const { handler: h2, errors: err2 } = createTestOutput();
      const code2 = await runCli(['backup', targetBackup, '--db', testDbPath], h2);
      expect(code2).toBe(1);
      expect(err2.some(e => e.includes('ERR_BACKUP_DESTINATION_EXISTS'))).toBe(true);

      // Duplicate backup with --overwrite flag: must succeed
      const { handler: h3, logs: l3 } = createTestOutput();
      const code3 = await runCli(
        ['backup', targetBackup, '--overwrite', '--json', '--db', testDbPath],
        h3,
      );
      expect(code3).toBe(0);
      const jsonBackup3 = JSON.parse(l3[0]);
      expect(jsonBackup3.success).toBe(true);
    });

    it('rejects backup targeting the active database file (collision protection)', async () => {
      const { handler: hMigrate } = createTestOutput();
      await runCli(['migrate', '--db', testDbPath], hMigrate);

      const { handler, errors } = createTestOutput();
      const code = await runCli(['backup', testDbPath, '--db', testDbPath], handler);
      expect(code).toBe(1);
      expect(errors.some(e => e.includes('ERR_BACKUP_DESTINATION_COLLISION'))).toBe(true);
    });

    it('rejects execution targeting Drive C with exit code 1 in default development mode', async () => {
      const { handler, errors } = createTestOutput();
      const code = await runCli(['status', '--db', 'C:\\bad\\path.db'], handler);
      expect(code).toBe(1);
      expect(errors.some(e => e.includes('ERR_INVALID_PROJECT_DRIVE'))).toBe(true);
    });

    it('supports production mode resolution and non-destructive status inspection', async () => {
      const { handler, logs } = createTestOutput();
      const code = await runCli(['status', '--production'], handler);
      expect(code).toBe(0);
      expect(logs.some(l => l.includes('auditor.db'))).toBe(true);
      expect(logs.some(l => /Current Schema Version: \d+/.test(l))).toBe(true);
    });
  });
});
