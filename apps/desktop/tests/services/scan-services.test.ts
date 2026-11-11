import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { ScanRunService } from '../../src/main/services/scan-run.service.js';
import {
  FindingService,
  MAX_EVIDENCE_SIZE_BYTES,
} from '../../src/main/services/finding.service.js';
import { ReportService } from '../../src/main/services/report.service.js';
import { IPC_ERROR_CODES } from '@auditor/shared';

describe('Phase 2.3 Domain Services: ScanRunService, FindingService, ReportService', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let reportRepo: ReportRepository;

  let scanRunService: ScanRunService;
  let findingService: FindingService;
  let reportService: ReportService;

  let testSiteId: string;
  let archivedSiteId: string;

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

    scanRunService = new ScanRunService(scanRunRepo, siteRepo);
    findingService = new FindingService(findingRepo, scanRunRepo);
    reportService = new ReportService(reportRepo, scanRunRepo);

    const project = projectRepo.create({ name: 'Service Test Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Active Site',
      baseUrl: 'https://service-test.example.com',
    });
    testSiteId = site.id;

    const archivedSite = siteRepo.create({
      projectId: project.id,
      name: 'Archived Site',
      baseUrl: 'https://archived.example.com',
    });
    siteRepo.archive(archivedSite.id);
    archivedSiteId = archivedSite.id;
  });

  afterEach(() => {
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  describe('ScanRunService', () => {
    it('creates a scan run defaulting targetUrl to site baseUrl', () => {
      const run = scanRunService.createScanRun({
        siteId: testSiteId,
        scanType: 'security',
      });

      expect(run.id).toBeDefined();
      expect(run.status).toBe('pending');
      expect(run.targetUrl).toBe('https://service-test.example.com');
    });

    it('rejects scan run creation on archived site', () => {
      expect(() => {
        scanRunService.createScanRun({
          siteId: archivedSiteId,
          scanType: 'quick',
        });
      }).toThrowError(expect.objectContaining({ code: IPC_ERROR_CODES.SITE_NOT_FOUND }));
    });

    it('rejects scan run creation on non-existent site', () => {
      expect(() => {
        scanRunService.createScanRun({
          siteId: '00000000-0000-0000-0000-000000000000',
        });
      }).toThrowError(expect.objectContaining({ code: IPC_ERROR_CODES.SITE_NOT_FOUND }));
    });

    it('updates status and records execution timestamps and duration', () => {
      const run = scanRunService.createScanRun({ siteId: testSiteId });

      // Start run
      const started = scanRunService.updateScanRunStatus({
        id: run.id,
        status: 'running',
      });
      expect(started.status).toBe('running');
      expect(started.startedAt).not.toBeNull();

      // Complete run
      const completed = scanRunService.updateScanRunStatus({
        id: run.id,
        status: 'completed',
        summary: {
          totalFindings: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          lowCount: 0,
          infoCount: 0,
        },
      });
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).not.toBeNull();
      expect(typeof completed.durationMs).toBe('number');
    });

    it('cancels an active run and rejects cancellation on terminal status', () => {
      const run = scanRunService.createScanRun({ siteId: testSiteId });
      const cancelled = scanRunService.cancelScanRun({ id: run.id });
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancelledAt).not.toBeNull();

      // Cancelling an already cancelled run must fail
      expect(() => {
        scanRunService.cancelScanRun({ id: run.id });
      }).toThrowError(
        expect.objectContaining({ code: IPC_ERROR_CODES.SCAN_RUN_INVALID_TRANSITION }),
      );
    });
  });

  describe('FindingService', () => {
    it('creates findings with secret redaction on sensitive headers and tokens', () => {
      const run = scanRunService.createScanRun({ siteId: testSiteId });

      const finding = findingService.createFinding({
        scanRunId: run.id,
        ruleId: 'auth-header-leak',
        category: 'security',
        title: 'Authorization Header Exposed',
        description: 'Header containing bearer token was found in logs',
        severity: 'critical',
        confidence: 'confirmed',
        targetUrl: 'https://service-test.example.com/api',
        evidence: {
          headers: {
            Authorization: 'Bearer secret_token_value_123',
            Cookie: 'session_id=abcdef123456',
            'Content-Type': 'application/json',
          },
          password: 'super_secret_password',
        },
      });

      expect(finding.id).toBeDefined();
      const evidence = finding.evidence as {
        headers: { Authorization: string; Cookie: string; 'Content-Type': string };
        password: string;
      };
      expect(evidence.headers.Authorization).toBe('[REDACTED]');
      expect(evidence.headers.Cookie).toBe('[REDACTED]');
      expect(evidence.headers['Content-Type']).toBe('application/json');
      expect(evidence.password).toBe('[REDACTED]');
    });

    it('rejects evidence exceeding 64KB with ERR_EVIDENCE_TOO_LARGE', () => {
      const run = scanRunService.createScanRun({ siteId: testSiteId });
      const oversizedEvidence = 'x'.repeat(MAX_EVIDENCE_SIZE_BYTES + 100);

      expect(() => {
        findingService.createFinding({
          scanRunId: run.id,
          ruleId: 'huge-evidence',
          category: 'performance',
          title: 'Oversized Output',
          description: 'Too much payload',
          severity: 'info',
          confidence: 'tentative',
          targetUrl: 'https://service-test.example.com',
          evidence: oversizedEvidence,
        });
      }).toThrowError(expect.objectContaining({ code: IPC_ERROR_CODES.EVIDENCE_TOO_LARGE }));
    });

    it('rejects finding creation for non-existent scan run', () => {
      expect(() => {
        findingService.createFinding({
          scanRunId: '00000000-0000-0000-0000-000000000000',
          ruleId: 'orphan-finding',
          category: 'security',
          title: 'Orphan',
          description: 'No parent run',
          severity: 'low',
          confidence: 'low',
          targetUrl: 'https://example.com',
        });
      }).toThrowError(expect.objectContaining({ code: IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND }));
    });
  });

  describe('ReportService', () => {
    it('creates and lists report records', () => {
      const run = scanRunService.createScanRun({ siteId: testSiteId });

      const report = reportService.createReport({
        scanRunId: run.id,
        title: 'Full Site Audit Summary',
        format: 'json',
        summary: { totalScore: 88 },
      });

      expect(report.id).toBeDefined();
      expect(report.title).toBe('Full Site Audit Summary');
      expect(report.status).toBe('pending');

      const fetched = reportService.getReportById({ id: report.id });
      expect(fetched.id).toBe(report.id);

      const list = reportService.listReports({ scanRunId: run.id });
      expect(list.total).toBe(1);
    });

    it('rejects report creation for non-existent scan run', () => {
      expect(() => {
        reportService.createReport({
          scanRunId: '00000000-0000-0000-0000-000000000000',
          title: 'Orphan Report',
          format: 'pdf',
        });
      }).toThrowError(expect.objectContaining({ code: IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND }));
    });
  });
});
