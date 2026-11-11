import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  acquireSingleInstanceLockOrExit,
  focusExistingApplicationWindow,
} from '../../src/main/index.js';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { getDatabasePath } from '../../src/main/db/paths.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { ElectronProcessRunner } from './harness/electron-runner.js';
import { prepareElectronTestApp } from './harness/fixture.js';

const ELECTRON_EXECUTABLE_PATH = path.resolve(
  'D:/ahmed/node_modules/.pnpm/electron@44.10.2/node_modules/electron/dist/electron.exe',
);

interface CreatedRecordResponse {
  success: boolean;
  data?: { id: string };
}

interface ScanRunListIpcResponse {
  success: boolean;
  data?: {
    items: Array<{
      id: string;
      status: string;
      error?: { code?: string; message?: string } | null;
    }>;
  };
}

describe('D1 — Single-Instance Lock & Scan Integrity', () => {
  const tempDirsToCleanup: string[] = [];

  afterEach(() => {
    for (const dir of tempDirsToCleanup.splice(0)) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
      } catch {
        // Best-effort cleanup
      }
    }
  });

  it('exits immediately via app.quit() without registering second-instance handler when lock is denied', () => {
    const quit = vi.fn();
    const exit = vi.fn();
    const on = vi.fn();

    const acquired = acquireSingleInstanceLockOrExit({
      electronApp: {
        requestSingleInstanceLock: () => false,
        on,
        quit,
        exit,
      },
    });

    expect(acquired).toBe(false);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(on).not.toHaveBeenCalled();
  });

  it('registers second-instance listener and restores/focuses existing BrowserWindow when lock succeeds', () => {
    const listeners = new Map<string, () => void>();
    const onSecondInstance = vi.fn();

    const acquired = acquireSingleInstanceLockOrExit({
      electronApp: {
        requestSingleInstanceLock: () => true,
        on: (event, listener) => {
          listeners.set(event, listener as () => void);
        },
        quit: vi.fn(),
        exit: vi.fn(),
      },
      onSecondInstance,
    });

    expect(acquired).toBe(true);
    expect(listeners.has('second-instance')).toBe(true);

    listeners.get('second-instance')?.();
    expect(onSecondInstance).toHaveBeenCalledTimes(1);

    const restore = vi.fn();
    const show = vi.fn();
    const focus = vi.fn();
    focusExistingApplicationWindow({
      getAllWindows: () => [
        {
          isDestroyed: () => false,
          isMinimized: () => true,
          restore,
          show,
          focus,
        },
      ],
    });

    expect(restore).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('keeps an active running scan intact when a second Electron instance launches against the same userData dir, then recovers genuine orphaned crashes once lock is free', async () => {
    if (!fs.existsSync(ELECTRON_EXECUTABLE_PATH)) {
      throw new Error(`Electron executable missing at ${ELECTRON_EXECUTABLE_PATH}`);
    }

    const runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const sharedUserDataDir = path.resolve(
      'D:/ahmed/.tmp/userData',
      `single-instance-e2e-${runToken}`,
    );
    const secondAppDir = path.resolve('D:/ahmed/.tmp', `electron-second-instance-${runToken}`);
    tempDirsToCleanup.push(sharedUserDataDir, secondAppDir);

    const runner1 = new ElectronProcessRunner(undefined, ELECTRON_EXECUTABLE_PATH, {
      AUDITOR_USER_DATA_DIR: sharedUserDataDir,
    });

    const ready1 = await runner1.start(25000);
    expect(path.resolve(ready1.storagePaths.userData)).toBe(path.resolve(sharedUserDataDir));

    // Create project & site via Instance 1 IPC so foreign keys exist in SQLite
    const projectRes = await runner1.executeScenario<CreatedRecordResponse>(
      'EXECUTE_RENDERER_IPC',
      {
        method: 'createProject',
        payload: { name: 'Single Instance Test Project' },
      },
    );
    expect(projectRes.success).toBe(true);
    const projectId = projectRes.data?.id;
    expect(projectId).toBeDefined();

    const siteRes = await runner1.executeScenario<CreatedRecordResponse>('EXECUTE_RENDERER_IPC', {
      method: 'createSite',
      payload: {
        projectId,
        name: 'Single Instance Test Site',
        baseUrl: 'https://example.com',
      },
    });
    expect(siteRes.success).toBe(true);
    const siteId = siteRes.data?.id;
    expect(siteId).toBeDefined();

    // Insert an active 'running' scan run directly in the shared SQLite DB while Instance 1 holds the lock
    const dbPath = getDatabasePath(path.join(sharedUserDataDir, 'database', 'auditor.db'));
    let runningScanId: string;
    {
      const conn = new DatabaseConnection(dbPath);
      conn.open();
      try {
        await new MigrationRunner(conn).migrate();
        const scanRepo = new ScanRunRepository(conn);
        const created = scanRepo.create({
          siteId: siteId!,
          scanType: 'full',
          targetUrl: 'https://example.com/',
        });
        scanRepo.updateStatus(created.id, {
          status: 'running',
          startedAt: new Date().toISOString(),
        });
        runningScanId = created.id;
      } finally {
        conn.close();
      }
    }

    // Launch a second Electron instance pointing at the exact same AUDITOR_USER_DATA_DIR
    prepareElectronTestApp(secondAppDir);
    const secondInstanceExitCode = await new Promise<number | null>((resolve, reject) => {
      const child2 = spawn(ELECTRON_EXECUTABLE_PATH, [secondAppDir], {
        stdio: 'ignore',
        env: {
          ...process.env,
          PROJECT_ROOT: 'D:\\ahmed',
          NODE_ENV: 'test',
          AUDITOR_USER_DATA_DIR: sharedUserDataDir,
        },
      });
      const timer = setTimeout(() => {
        try {
          child2.kill();
        } catch {
          // ignore
        }
        reject(
          new Error('Second Electron instance did not exit within 10s single-instance timeout'),
        );
      }, 10000);
      child2.once('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      child2.once('exit', code => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(secondInstanceExitCode).toBe(0);

    // Verify Instance 1 stays alive & responsive and the running scan row was NOT corrupted/recovered by Instance 2
    const pingAfterSecond = await runner1.executeScenario<{
      success: boolean;
      data?: { pong: boolean };
    }>('EXECUTE_RENDERER_IPC', { method: 'ping', payload: {} });
    expect(pingAfterSecond.success).toBe(true);
    expect(pingAfterSecond.data?.pong).toBe(true);

    const listDuringOwner = await runner1.executeScenario<ScanRunListIpcResponse>(
      'EXECUTE_RENDERER_IPC',
      { method: 'listScanRuns', payload: { siteId } },
    );
    expect(listDuringOwner.success).toBe(true);
    const activeRow = listDuringOwner.data?.items.find(s => s.id === runningScanId);
    expect(activeRow?.status).toBe('running');

    // Now stop Instance 1 without transitioning the 'running' scan (simulating an unexpected crash)
    await runner1.stop();

    // Launch Instance 3 against the same userData dir -> should acquire lock cleanly and recover the genuinely orphaned scan
    const runner3 = new ElectronProcessRunner(undefined, ELECTRON_EXECUTABLE_PATH, {
      AUDITOR_USER_DATA_DIR: sharedUserDataDir,
    });
    try {
      await runner3.start(25000);
      const listAfterCrashRecovery = await runner3.executeScenario<ScanRunListIpcResponse>(
        'EXECUTE_RENDERER_IPC',
        { method: 'listScanRuns', payload: { siteId } },
      );
      expect(listAfterCrashRecovery.success).toBe(true);
      const recoveredRow = listAfterCrashRecovery.data?.items.find(s => s.id === runningScanId);
      expect(recoveredRow?.status).toBe('failed');
      expect(recoveredRow?.error?.code).toBe('ERR_SCAN_INTERRUPTED_BY_SHUTDOWN');
    } finally {
      await runner3.stop();
    }
  }, 60000);
});
