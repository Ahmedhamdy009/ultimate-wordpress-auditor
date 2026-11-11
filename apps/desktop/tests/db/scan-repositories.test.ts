import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';

describe('Phase 2.3 Repositories: Scan Runs, Findings & Reports', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let reportRepo: ReportRepository;

  let testSiteId: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);
    reportRepo = new ReportRepository(connection);

    const project = projectRepo.create({ name: 'Acme Corp' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Acme Main',
      baseUrl: 'https://example.com',
    });
    testSiteId = site.id;
  });

  afterEach(() => {
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  describe('ScanRunRepository', () => {
    it('creates and retrieves a scan run in pending status', () => {
      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'security',
        targetUrl: 'https://example.com/login',
        config: { timeoutMs: 5000 },
      });

      expect(run.id).toBeDefined();
      expect(run.siteId).toBe(testSiteId);
      expect(run.scanType).toBe('security');
      expect(run.status).toBe('pending');
      expect(run.targetUrl).toBe('https://example.com/login');
      expect(run.config).toEqual({ timeoutMs: 5000 });
      expect(run.startedAt).toBeNull();

      const fetched = scanRunRepo.getById(run.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(run.id);
      expect(fetched?.config).toEqual({ timeoutMs: 5000 });
    });

    it('enforces legal lifecycle transitions', () => {
      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: 'https://example.com',
      });

      // Pending -> Running
      const now = new Date().toISOString();
      const running = scanRunRepo.updateStatus(run.id, {
        status: 'running',
        startedAt: now,
      });
      expect(running.status).toBe('running');
      expect(running.startedAt).toBe(now);

      // Running -> Completed
      const completedNow = new Date().toISOString();
      const completed = scanRunRepo.updateStatus(run.id, {
        status: 'completed',
        completedAt: completedNow,
        durationMs: 1250,
        summary: {
          totalFindings: 2,
          criticalCount: 1,
          highCount: 1,
          mediumCount: 0,
          lowCount: 0,
          infoCount: 0,
        },
      });
      expect(completed.status).toBe('completed');
      expect(completed.durationMs).toBe(1250);
      expect(completed.summary?.totalFindings).toBe(2);

      // Terminal Completed cannot transition to Running or any other state
      expect(() => {
        scanRunRepo.updateStatus(run.id, { status: 'running' });
      }).toThrow(/ERR_SCAN_RUN_INVALID_TRANSITION/);
    });

    it('rejects illegal transition from pending directly to completed', () => {
      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'quick',
        targetUrl: 'https://example.com',
      });

      expect(() => {
        scanRunRepo.updateStatus(run.id, { status: 'completed' });
      }).toThrow(/ERR_SCAN_RUN_INVALID_TRANSITION/);
    });

    it('prevents site deletion when historical scan runs exist (ON DELETE RESTRICT)', () => {
      scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: 'https://example.com',
      });

      // Raw delete of site must fail due to foreign key restriction
      expect(() => {
        connection.getRawDb().prepare('DELETE FROM sites WHERE id = ?').run(testSiteId);
      }).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  describe('FindingRepository', () => {
    it('creates, batches, and queries findings with severity counts', () => {
      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: 'https://example.com',
      });

      const single = findingRepo.create({
        scanRunId: run.id,
        ruleId: 'sec-tls-001',
        category: 'security',
        title: 'Weak TLS Cipher',
        description: 'Server accepts deprecated TLS 1.0',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://example.com',
        evidence: { cipher: 'TLS_RSA_WITH_AES_128_CBC_SHA' },
      });
      expect(single.id).toBeDefined();
      expect(single.severity).toBe('high');

      const batch = findingRepo.batchCreate([
        {
          scanRunId: run.id,
          ruleId: 'sec-xss-001',
          category: 'security',
          title: 'Reflected XSS in query param',
          description: 'Parameter "q" unsanitized',
          severity: 'critical',
          confidence: 'confirmed',
          targetUrl: 'https://example.com/search',
          evidence: { param: 'q', payload: '<script>alert(1)</script>' },
        },
        {
          scanRunId: run.id,
          ruleId: 'perf-img-001',
          category: 'performance',
          title: 'Uncompressed Image',
          description: 'Image missing WebP variant',
          severity: 'low',
          confidence: 'firm',
          targetUrl: 'https://example.com/hero.jpg',
        },
      ]);
      expect(batch).toHaveLength(2);

      const listAll = findingRepo.listByScanRunId(run.id);
      expect(listAll.total).toBe(3);
      expect(listAll.items).toHaveLength(3);

      const listCritical = findingRepo.listByScanRunId(run.id, { severity: 'critical' });
      expect(listCritical.total).toBe(1);
      expect(listCritical.items[0].title).toContain('Reflected XSS');

      const counts = findingRepo.getSeverityCounts(run.id);
      expect(counts.critical).toBe(1);
      expect(counts.high).toBe(1);
      expect(counts.low).toBe(1);
      expect(counts.medium).toBe(0);
    });

    it('cascades deletion of findings when scan run is deleted', () => {
      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'quick',
        targetUrl: 'https://example.com',
      });

      findingRepo.create({
        scanRunId: run.id,
        ruleId: 'rule-1',
        category: 'cat-1',
        title: 'Title 1',
        description: 'Desc 1',
        severity: 'info',
        confidence: 'tentative',
        targetUrl: 'https://example.com',
      });
      expect(findingRepo.countByScanRunId(run.id)).toBe(1);

      // Deleting scan run should cascade delete findings
      connection.getRawDb().prepare('DELETE FROM scan_runs WHERE id = ?').run(run.id);
      expect(findingRepo.countByScanRunId(run.id)).toBe(0);
    });
  });

  describe('ReportRepository', () => {
    it('creates, queries, and updates reports', () => {
      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: 'https://example.com',
      });

      const report = reportRepo.create({
        scanRunId: run.id,
        title: 'Executive Audit Summary',
        format: 'pdf',
        summary: { score: 95 },
      });

      expect(report.id).toBeDefined();
      expect(report.status).toBe('pending');
      expect(report.summary).toEqual({ score: 95 });

      const updated = reportRepo.updateStatus(report.id, 'generated', {
        storagePath: 'D:\\ahmed\\reports\\rep-001.pdf',
      });
      expect(updated.status).toBe('generated');
      expect(updated.storagePath).toBe('D:\\ahmed\\reports\\rep-001.pdf');

      const list = reportRepo.list({ scanRunId: run.id });
      expect(list.total).toBe(1);
      expect(list.items[0].id).toBe(report.id);
    });

    it('enforces foreign key ON DELETE RESTRICT from scan_runs to reports', () => {
      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'security',
        targetUrl: 'https://example.com/fk-test',
      });

      const report = reportRepo.create({
        scanRunId: run.id,
        title: 'Report Guarding Scan Run',
        format: 'html',
      });

      // Attempting to delete scan_run while report exists must fail due to ON DELETE RESTRICT
      expect(() => {
        connection.getRawDb().prepare('DELETE FROM scan_runs WHERE id = ?').run(run.id);
      }).toThrow(/FOREIGN KEY constraint failed/);

      // Once the report is deleted, scan_run can be deleted
      const deleted = reportRepo.delete(report.id);
      expect(deleted).toBe(true);

      expect(() => {
        connection.getRawDb().prepare('DELETE FROM scan_runs WHERE id = ?').run(run.id);
      }).not.toThrow();
    });

    it('retrieves all active storage paths for orphan reconciliation', () => {
      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'quick',
        targetUrl: 'https://example.com/paths',
      });

      reportRepo.create({
        scanRunId: run.id,
        title: 'Report 1',
        format: 'html',
        storagePath: 'D:\\ahmed\\reports\\r1.html',
      });

      reportRepo.create({
        scanRunId: run.id,
        title: 'Report 2 (No Path)',
        format: 'json',
        storagePath: null,
      });

      reportRepo.create({
        scanRunId: run.id,
        title: 'Report 3',
        format: 'json',
        storagePath: 'D:\\ahmed\\reports\\r3.json',
      });

      const paths = reportRepo.getAllStoragePaths();
      expect(paths.size).toBe(2);
      expect(paths.has(path.resolve('D:\\ahmed\\reports\\r1.html'))).toBe(true);
      expect(paths.has(path.resolve('D:\\ahmed\\reports\\r3.json'))).toBe(true);
    });
  });
});
