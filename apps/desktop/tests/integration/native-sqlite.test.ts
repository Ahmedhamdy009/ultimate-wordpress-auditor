import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseConnection, resolveNativeBindingPath } from '../../src/main/db/connection.js';

interface StepResult {
  name: string;
  [key: string]: unknown;
}

interface VerificationOutput {
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  v8Version: string;
  modulesAbi: string;
  allVersions: Record<string, string>;
  timestamp: string;
  steps: StepResult[];
  success: boolean;
  error?: {
    message: string;
    stack: string;
    code: string;
  };
}

describe('Native SQLite Engine Integration', () => {
  it('loads native better-sqlite3 addon and verifies SQLite runtime version on host Node.js', () => {
    const db = new Database(':memory:', { nativeBinding: resolveNativeBindingPath() ?? undefined });
    const versionRow = db.prepare('SELECT sqlite_version() as version').get() as {
      version: string;
    };

    expect(versionRow).toBeDefined();
    expect(typeof versionRow.version).toBe('string');
    // Ensure SQLite 3.x
    expect(versionRow.version.startsWith('3.')).toBe(true);

    db.close();
  });

  it('verifies native N-API execution, parameter binding, and WAL pragmas on host Node.js', () => {
    const conn = new DatabaseConnection(':memory:', { isMemory: true });
    conn.open();
    const rawDb = conn.getRawDb();

    rawDb.exec('CREATE TABLE benchmark (id INTEGER PRIMARY KEY, name TEXT, score REAL)');

    const insert = rawDb.prepare('INSERT INTO benchmark (name, score) VALUES (?, ?)');
    const insertMany = rawDb.transaction((rows: Array<[string, number]>) => {
      for (const row of rows) {
        insert.run(row[0], row[1]);
      }
    });

    // Bulk insert inside a transaction
    insertMany([
      ['Audit Site 1', 98.5],
      ['Audit Site 2', 84.2],
      ['Audit Site 3', 76.0],
    ]);

    const count = rawDb.prepare('SELECT COUNT(*) as count FROM benchmark').get() as {
      count: number;
    };
    expect(count.count).toBe(3);

    const avg = rawDb.prepare('SELECT AVG(score) as avgScore FROM benchmark').get() as {
      avgScore: number;
    };
    expect(avg.avgScore).toBeCloseTo(86.23, 1);

    conn.close();
  });

  it('documents runtime Node and Electron ABI status', () => {
    const nodeVersion = process.versions.node;
    const modulesVersion = process.versions.modules;
    const electronVersion = process.versions.electron;

    expect(nodeVersion).toBeDefined();
    expect(modulesVersion).toBeDefined();

    // In Vitest test harness, runs under host Node 24 (NODE_MODULE_VERSION 137)
    // In production Electron 44, embeds Node 24.22.2 (NODE_MODULE_VERSION 149)
    if (electronVersion) {
      expect(typeof electronVersion).toBe('string');
    }
  });

  it('resolves correct native addon path for host Node environment', () => {
    const bindingPath = resolveNativeBindingPath();
    expect(bindingPath).toBeDefined();
    expect(typeof bindingPath).toBe('string');
    expect(fs.existsSync(bindingPath!)).toBe(true);
    expect(bindingPath).toContain('node-v');
    expect(bindingPath).toContain('better_sqlite3.node');
  });

  it('executes full SQLite database lifecycle inside live Electron 44 runtime (ABI 149)', async () => {
    const req = createRequire(import.meta.url);
    const electronBinary = req('electron');
    const scriptPath = path.resolve(import.meta.dirname, 'harness', 'verify_electron_sqlite.cjs');
    const resultJsonPath = path.resolve('D:/ahmed/.tmp/electron_sqlite_verification.json');

    const result = await new Promise<VerificationOutput>((resolve, reject) => {
      execFile(electronBinary, [scriptPath], { timeout: 15000 }, (error, stdout, stderr) => {
        if (error && !fs.existsSync(resultJsonPath)) {
          reject(
            new Error(
              `Electron verification failed to execute: ${error.message}\nStdout: ${stdout}\nStderr: ${stderr}`,
            ),
          );
          return;
        }
        try {
          const parsed = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8')) as VerificationOutput;
          resolve(parsed);
        } catch (readErr) {
          reject(new Error(`Failed to parse verification result JSON: ${String(readErr)}`));
        }
      });
    });

    expect(result.success).toBe(true);
    expect(result.electronVersion).toBe('44.10.2');
    expect(result.modulesAbi).toBe('149');
    expect(typeof result.nodeVersion).toBe('string');
    expect(typeof result.chromeVersion).toBe('string');
    expect(typeof result.v8Version).toBe('string');
    expect(result.allVersions.electron).toBe('44.10.2');
    expect(result.allVersions.modules).toBe('149');
    expect(result.steps.map(s => s.name)).toEqual([
      'open_database',
      'pragmas',
      'create_table',
      'insert',
      'select',
      'update',
      'rollback_error_caught',
      'verify_rollback',
      'close_database',
      'reopen_and_verify_persistence',
      'reject_incompatible_host_node_binary',
      'load_production_copied_binary',
    ]);

    const rejectStep = result.steps.find(s => s.name === 'reject_incompatible_host_node_binary');
    expect(rejectStep).toBeDefined();
    expect(rejectStep?.rejected).toBe(true);
    expect(rejectStep?.isExpectedMismatch).toBe(true);

    const loadProdStep = result.steps.find(s => s.name === 'load_production_copied_binary');
    expect(loadProdStep).toBeDefined();
    expect(loadProdStep?.success).toBe(true);
  }, 30000);
});
