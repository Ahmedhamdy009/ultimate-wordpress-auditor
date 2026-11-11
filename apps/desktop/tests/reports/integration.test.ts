import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { ReportService } from '../../src/main/services/report.service.js';

describe('Report Workflow Integration Suite (SQLite + Filesystem)', () => {
  const testDir = path.resolve('D:/ahmed/.tmp/test-reports-integration');
  const testDbPath = path.join(testDir, 'test-audit.db');
  const reportsDir = path.join(testDir, 'exported-reports');

  let conn: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let reportRepo: ReportRepository;
  let reportService: ReportService;

  let testProjectId: string;
  let testSiteId: string;
  let testScanRunId: string;

  beforeEach(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });

    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    conn = new DatabaseConnection(testDbPath);
    conn.open();
    const runner = new MigrationRunner(conn);
    await runner.migrate();

    projectRepo = new ProjectRepository(conn);
    siteRepo = new SiteRepository(conn);
    scanRunRepo = new ScanRunRepository(conn);
    findingRepo = new FindingRepository(conn);
    reportRepo = new ReportRepository(conn);

    reportService = new ReportService(reportRepo, scanRunRepo, {
      siteRepo,
      findingRepo,
      reportsDir,
    });

    // Seed test project, site, and scan run
    const project = projectRepo.create({ name: 'Integration Test Project' });
    testProjectId = project.id;

    const site = siteRepo.create({
      projectId: testProjectId,
      name: 'Integration Test Site',
      baseUrl: 'https://test-audit.local',
      platformType: 'wordpress',
      environmentType: 'staging',
    });
    testSiteId = site.id;

    const scanRun = scanRunRepo.create({
      siteId: testSiteId,
      targetUrl: 'https://test-audit.local/',
      scanType: 'full',
      config: { maxPages: 10, crawlDepth: 2 },
    });
    testScanRunId = scanRun.id;

    // Transition scan to completed with crawl summary
    scanRunRepo.updateStatus(testScanRunId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    scanRunRepo.updateStatus(testScanRunId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      durationMs: 45000,
      summary: {
        totalFindings: 2,
        pagesScanned: 8,
        pagesFailed: 0,
        bySeverity: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
      },
    });

    // Seed findings
    findingRepo.batchCreate([
      {
        scanRunId: testScanRunId,
        ruleId: 'SEC-TLS-CERT-EXPIRED',
        category: 'security',
        title: 'TLS Certificate Expired',
        description: 'Server TLS certificate has expired.',
        severity: 'critical',
        confidence: 'confirmed',
        targetUrl: 'https://test-audit.local/',
        evidence: { notAfter: '2026-01-01T00:00:00Z' },
        remediation: 'Renew TLS certificate immediately.',
      },
      {
        scanRunId: testScanRunId,
        ruleId: 'WP-USER-ENUM-REST',
        category: 'wordpress',
        title: 'WordPress User Enumeration via REST API',
        description: 'User accounts exposed via /wp-json/wp/v2/users.',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://test-audit.local/wp-json/wp/v2/users',
        evidence: { exposedUsersCount: 3 },
        remediation: 'Restrict REST API users endpoint to authenticated users.',
      },
    ]);
  });

  afterEach(() => {
    try {
      conn?.close();
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Best effort
    }
  });

  it('generates, persists, retrieves, and lists standalone HTML reports', () => {
    const report = reportService.createReport({
      scanRunId: testScanRunId,
      title: 'Full Site Security Audit',
      format: 'html',
    });

    expect(report.id).toBeDefined();
    expect(report.scanRunId).toBe(testScanRunId);
    expect(report.status).toBe('generated');
    expect(report.format).toBe('html');
    expect(report.storagePath).toBeDefined();
    expect(fs.existsSync(report.storagePath!)).toBe(true);

    // Verify file contents
    const fileHtml = fs.readFileSync(report.storagePath!, 'utf8');
    expect(fileHtml).toContain('Full Site Security Audit');
    expect(fileHtml).toContain('TLS Certificate Expired');
    expect(fileHtml).toContain('WordPress User Enumeration');
    expect(fileHtml).toContain('Renew TLS certificate immediately');
    expect(fileHtml).toContain("default-src 'none'");

    // Verify database retrieval
    const fetched = reportService.getReportById({ id: report.id });
    expect(fetched.id).toBe(report.id);
    expect(fetched.storagePath).toBe(report.storagePath);

    // Verify listing filtered by scanRunId
    const runReports = reportService.listReports({ scanRunId: testScanRunId });
    expect(runReports.total).toBe(1);
    expect(runReports.items[0].id).toBe(report.id);

    // Verify listing filtered by siteId
    const siteReports = reportService.listReports({ siteId: testSiteId });
    expect(siteReports.total).toBe(1);
    expect(siteReports.items[0].id).toBe(report.id);
  });

  it('generates versioned JSON export and reads content via getReportContent', () => {
    const report = reportService.createReport({
      scanRunId: testScanRunId,
      title: 'Site JSON Audit Export',
      format: 'json',
    });

    expect(report.status).toBe('generated');
    expect(report.format).toBe('json');
    expect(report.storagePath).toBeDefined();

    const contentDTO = reportService.getReportContent({ id: report.id });
    expect(contentDTO.id).toBe(report.id);
    expect(contentDTO.format).toBe('json');

    const parsed = JSON.parse(contentDTO.content);
    expect(parsed.schemaVersion).toBe('1.0.0');
    expect(parsed.summary.totalFindings).toBe(2);
    expect(parsed.findings).toHaveLength(2);
  });

  it('deletes report file from disk and database without touching scan runs or findings', () => {
    const report = reportService.createReport({
      scanRunId: testScanRunId,
      title: 'Temporary Report to Delete',
      format: 'html',
    });

    const filePath = report.storagePath!;
    expect(fs.existsSync(filePath)).toBe(true);

    const deleteRes = reportService.deleteReport({ id: report.id });
    expect(deleteRes.success).toBe(true);
    expect(deleteRes.fileDeleted).toBe(true);

    // File on disk removed
    expect(fs.existsSync(filePath)).toBe(false);

    // Database record removed
    expect(() => reportService.getReportById({ id: report.id })).toThrow('not found');

    // Underlying scan run and findings MUST remain intact
    const scanRun = scanRunRepo.getById(testScanRunId);
    expect(scanRun).not.toBeNull();
    const findings = findingRepo.getAllByScanRunId(testScanRunId);
    expect(findings).toHaveLength(2);
  });

  it('safely deletes database record even if disk file was already deleted or missing', () => {
    const report = reportService.createReport({
      scanRunId: testScanRunId,
      title: 'Report with Pre-deleted File',
      format: 'html',
    });

    const filePath = report.storagePath!;
    expect(fs.existsSync(filePath)).toBe(true);
    // Simulate external file removal
    fs.unlinkSync(filePath);
    expect(fs.existsSync(filePath)).toBe(false);

    // Deletion should succeed and remove stale DB record cleanly
    const deleteRes = reportService.deleteReport({ id: report.id });
    expect(deleteRes.success).toBe(true);
    expect(deleteRes.fileDeleted).toBe(false);
    expect(() => reportService.getReportById({ id: report.id })).toThrow('not found');
  });

  it('simulates crash after DB deletion and verifies startup reconciliation cleans orphaned files', () => {
    // 1. Create an active report that must be preserved
    const activeReport = reportService.createReport({
      scanRunId: testScanRunId,
      title: 'Active Retained Report',
      format: 'html',
    });
    expect(fs.existsSync(activeReport.storagePath!)).toBe(true);

    // 2. Create another report, then simulate a crash where DB row is deleted but process dies before file unlink
    const crashedReport = reportService.createReport({
      scanRunId: testScanRunId,
      title: 'Crashed Deletion Report',
      format: 'html',
    });
    const orphanedFile = crashedReport.storagePath!;
    expect(fs.existsSync(orphanedFile)).toBe(true);

    // Directly delete row from SQLite (simulating process crash between DB delete and unlink)
    reportRepo.delete(crashedReport.id);
    expect(reportRepo.getById(crashedReport.id)).toBeNull();
    expect(fs.existsSync(orphanedFile)).toBe(true); // Orphaned on disk

    // 3. Now simulate application startup / recovery running reconcileStorage()
    const recon = reportService.reconcileStorage();
    expect(recon.orphanFilesDeleted).toBeGreaterThanOrEqual(1);

    // Orphaned file must now be cleaned up from disk
    expect(fs.existsSync(orphanedFile)).toBe(false);
    // Active report file MUST be preserved
    expect(fs.existsSync(activeReport.storagePath!)).toBe(true);
  });

  it('handles simulated filesystem unlink failure (EBUSY/EACCES) gracefully and reconciles orphan subsequently', () => {
    // 1. Create an active report that must remain intact throughout
    const activeReport = reportService.createReport({
      scanRunId: testScanRunId,
      title: 'Active Retained Report During Failure',
      format: 'html',
    });
    const activeFilePath = activeReport.storagePath!;
    expect(fs.existsSync(activeFilePath)).toBe(true);

    // 2. Create target report to delete
    const reportToDelete = reportService.createReport({
      scanRunId: testScanRunId,
      title: 'Report with Locked File',
      format: 'html',
    });
    const lockedFilePath = reportToDelete.storagePath!;
    expect(fs.existsSync(lockedFilePath)).toBe(true);

    // 3. Spy on fs.unlinkSync to simulate an EBUSY or EACCES error when deleting lockedFilePath
    const originalUnlinkSync = fs.unlinkSync;
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation((targetPath: fs.PathLike) => {
      if (String(targetPath) === lockedFilePath) {
        const error = new Error('EBUSY: resource busy or locked, unlink') as NodeJS.ErrnoException;
        error.code = 'EBUSY';
        throw error;
      }
      return originalUnlinkSync(targetPath);
    });

    // 4. Execute deleteReport(): must NOT throw/crash despite filesystem failure
    const deleteRes = reportService.deleteReport({ id: reportToDelete.id });

    // Assert: delete succeeded at database level, but fileDeleted indicates failure
    expect(deleteRes.success).toBe(true);
    expect(deleteRes.fileDeleted).toBe(false);

    // Assert: SQLite report record is deleted successfully
    expect(() => reportService.getReportById({ id: reportToDelete.id })).toThrow('not found');

    // Assert: physical file still remains on disk as an orphan
    expect(fs.existsSync(lockedFilePath)).toBe(true);
    expect(fs.existsSync(activeFilePath)).toBe(true);

    // 5. Restore filesystem behavior (file lock released)
    unlinkSpy.mockRestore();

    // 6. Execute reconciliation: detects orphan and unlinks it now that lock is released
    const recon = reportService.reconcileStorage();
    expect(recon.orphanFilesDeleted).toBeGreaterThanOrEqual(1);

    // Assert: orphan file is now deleted
    expect(fs.existsSync(lockedFilePath)).toBe(false);

    // Assert: active report file remains completely untouched
    expect(fs.existsSync(activeFilePath)).toBe(true);
    const activeInDb = reportService.getReportById({ id: activeReport.id });
    expect(activeInDb).toBeDefined();
    expect(activeInDb.title).toBe('Active Retained Report During Failure');
  });

  it('strictly isolates findings between scan runs and never mixes results', () => {
    // Create second scan run on the same site
    const run2 = scanRunRepo.create({
      siteId: testSiteId,
      targetUrl: 'https://test-audit.local/blog',
      scanType: 'quick',
    });

    // Add unique finding to run 2 only
    findingRepo.create({
      scanRunId: run2.id,
      ruleId: 'SEO-CANONICAL-MISSING',
      category: 'seo',
      title: 'Unique SEO Issue Only In Run 2',
      description: 'Missing canonical URL link.',
      severity: 'low',
      confidence: 'potential',
      targetUrl: 'https://test-audit.local/blog',
    });

    const reportRun2 = reportService.createReport({
      scanRunId: run2.id,
      title: 'Run 2 Report',
      format: 'json',
    });

    const content2 = reportService.getReportContent({ id: reportRun2.id });
    const parsed2 = JSON.parse(content2.content);

    // Must ONLY contain run 2 finding
    expect(parsed2.findings).toHaveLength(1);
    expect(parsed2.findings[0].title).toBe('Unique SEO Issue Only In Run 2');
    expect(content2.content).not.toContain('TLS Certificate Expired');
  });

  it('preserves failed and cancelled statuses and renders warning notice', () => {
    const failedRun = scanRunRepo.create({
      siteId: testSiteId,
      targetUrl: 'https://test-audit.local/aborted',
      scanType: 'full',
    });

    scanRunRepo.updateStatus(failedRun.id, {
      status: 'failed',
      durationMs: 3500,
      error: { code: 'ERR_NETWORK', message: 'Connection timed out' },
    });

    const report = reportService.createReport({
      scanRunId: failedRun.id,
      title: 'Failed Scan Report',
      format: 'html',
    });

    const html = fs.readFileSync(report.storagePath!, 'utf8');
    expect(html).toContain('SCAN FAILED');
    expect(html).toContain('Warning: Incomplete / FAILED Scan Run');
    expect(html).toContain('represent partial evidence collected before termination');
  });
});
