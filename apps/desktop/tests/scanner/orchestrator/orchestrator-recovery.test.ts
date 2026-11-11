import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';

describe('ScanOrchestrator Crash Recovery & Interruption Containment', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let siteId: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);

    const project = projectRepo.create({ name: 'Recovery Test Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Recovery Test Site',
      baseUrl: 'https://recovery.example.com',
    });
    siteId = site.id;
  });

  afterEach(() => {
    if (connection.isOpen()) {
      connection.close();
    }
  });

  it('recovers orphaned pending and running scan runs to failed status with shutdown diagnostics', () => {
    // 1. Seed simulated crashed state directly into database
    // Pending scan
    const pendingRun = scanRunRepo.create({
      siteId,
      scanType: 'full',
      targetUrl: 'https://recovery.example.com/',
    });

    // Running scan that was active when crash occurred
    const runningRun = scanRunRepo.create({
      siteId,
      scanType: 'security',
      targetUrl: 'https://recovery.example.com/',
    });
    const startedAt = new Date(Date.now() - 15000).toISOString();
    scanRunRepo.updateStatus(runningRun.id, {
      status: 'running',
      startedAt,
    });

    // Already completed scan
    const completedRun = scanRunRepo.create({
      siteId,
      scanType: 'quick',
      targetUrl: 'https://recovery.example.com/',
    });
    scanRunRepo.updateStatus(completedRun.id, {
      status: 'running',
      startedAt: new Date(Date.now() - 30000).toISOString(),
    });
    scanRunRepo.updateStatus(completedRun.id, {
      status: 'completed',
      completedAt: new Date(Date.now() - 25000).toISOString(),
      durationMs: 5000,
    });

    // 2. Initialize orchestrator (simulating application startup)
    const orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo);

    // 3. Run crash recovery
    const recoveredCount = orchestrator.recoverInterruptedScans(
      'Simulated system restart during active scan',
    );
    expect(recoveredCount).toBe(2);

    // 4. Inspect recovered pending scan
    const recoveredPending = scanRunRepo.getById(pendingRun.id);
    expect(recoveredPending?.status).toBe('failed');
    expect(recoveredPending?.completedAt).not.toBeNull();
    expect(recoveredPending?.error?.code).toBe('ERR_SCAN_INTERRUPTED_BY_SHUTDOWN');
    expect(recoveredPending?.error?.message).toContain('Simulated system restart');

    // 5. Inspect recovered running scan
    const recoveredRunning = scanRunRepo.getById(runningRun.id);
    expect(recoveredRunning?.status).toBe('failed');
    expect(recoveredRunning?.completedAt).not.toBeNull();
    expect(recoveredRunning?.durationMs).toBeGreaterThanOrEqual(15000);
    expect(recoveredRunning?.error?.code).toBe('ERR_SCAN_INTERRUPTED_BY_SHUTDOWN');

    // 6. Completed scan must remain untouched
    const untouchedCompleted = scanRunRepo.getById(completedRun.id);
    expect(untouchedCompleted?.status).toBe('completed');
    expect(untouchedCompleted?.durationMs).toBe(5000);

    // 7. Idempotence: subsequent recovery call finds 0 active scans
    const secondRecoveryCount = orchestrator.recoverInterruptedScans();
    expect(secondRecoveryCount).toBe(0);

    orchestrator.dispose();
  });
});
