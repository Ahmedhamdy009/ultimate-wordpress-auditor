import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { ReportService } from '../../src/main/services/report.service.js';
import {
  IPC_CHANNELS,
  IPC_ERROR_CODES,
  IPCError,
  validateIPCRequest,
  validateIPCResponse,
} from '@auditor/shared';

const VALID_PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

describe('Phase 7.4.4 Part C — Visual Evidence IPC & Path Confinement', () => {
  let connection: DatabaseConnection;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let reportService: ReportService;
  let tmpRootDir: string;
  let tmpScreenshotsDir: string;
  let scanId: string;

  beforeEach(async () => {
    tmpRootDir = path.resolve(
      import.meta.dirname,
      `../../../../.tmp/test-visual-ipc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    tmpScreenshotsDir = path.join(tmpRootDir, 'screenshots');
    fs.mkdirSync(tmpScreenshotsDir, { recursive: true });

    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    await new MigrationRunner(connection).migrate();

    const projectRepo = new ProjectRepository(connection);
    const siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);
    const reportRepo = new ReportRepository(connection);

    reportService = new ReportService(reportRepo, scanRunRepo, {
      siteRepo,
      findingRepo,
      reportsDir: tmpRootDir,
      screenshotsDir: tmpScreenshotsDir,
    });

    const project = projectRepo.create({ name: 'Visual Evidence Test' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Visual Test Site',
      baseUrl: 'https://visual.example.test',
    });
    const run = scanRunRepo.create({
      siteId: site.id,
      targetUrl: 'https://visual.example.test',
      scanType: 'full',
      config: {},
    });
    scanId = run.id;
  });

  afterEach(() => {
    connection.close();
    fs.rmSync(tmpRootDir, { recursive: true, force: true });
  });

  it('resolves confined screenshot files into base64 data URIs and rejects traversal/missing files', () => {
    const validShotName = 'shot-mobile-home.png';
    fs.writeFileSync(path.join(tmpScreenshotsDir, validShotName), VALID_PNG_BYTES);

    // Outside file that traversal must NEVER read
    const secretFile = path.join(tmpRootDir, 'outside-secret.png');
    fs.writeFileSync(secretFile, VALID_PNG_BYTES);

    findingRepo.create({
      scanRunId: scanId,
      ruleId: 'RESPONSIVE_HORIZONTAL_OVERFLOW',
      category: 'responsive-design',
      title: 'Mobile Horizontal Overflow',
      description: 'Overflow detected on mobile viewport.',
      severity: 'medium',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: 'https://visual.example.test/',
      evidence: {
        screenshot: {
          id: 'shot-mobile-home',
          fileName: validShotName,
          viewportProfile: 'mobile',
          captureType: 'viewport',
          width: 390,
          height: 844,
        },
      },
      remediation: 'Fix overflow.',
      references: [],
    });

    findingRepo.create({
      scanRunId: scanId,
      ruleId: 'LAYOUT_SHIFT_HERO',
      category: 'layout-stability',
      title: 'Traversal Attempt Finding',
      description: 'Tests path traversal containment.',
      severity: 'low',
      confidence: 'firm',
      status: 'confirmed',
      targetUrl: 'https://visual.example.test/',
      evidence: {
        screenshot: {
          fileName: '../outside-secret.png',
        },
      },
      remediation: null,
      references: [],
    });

    findingRepo.create({
      scanRunId: scanId,
      ruleId: 'A11Y_CONTRAST',
      category: 'accessibility',
      title: 'Missing Disk Screenshot Finding',
      description: 'Tests missing screenshot fallback.',
      severity: 'low',
      confidence: 'potential',
      status: 'needs_manual_review',
      targetUrl: 'https://visual.example.test/',
      evidence: {
        screenshot: {
          fileName: 'does-not-exist.png',
        },
      },
      remediation: null,
      references: [],
    });

    const req = validateIPCRequest(IPC_CHANNELS.REPORT_GET_VISUAL_EVIDENCE, { scanRunId: scanId });
    const rawRes = reportService.getScanVisualEvidence(req);
    const res = validateIPCResponse(IPC_CHANNELS.REPORT_GET_VISUAL_EVIDENCE, rawRes);

    expect(res.scanRunId).toBe(scanId);
    expect(res.entries[validShotName]).toBeDefined();
    expect(res.entries[validShotName].embedded).toBe(true);
    expect(res.entries[validShotName].mimeType).toBe('image/png');
    expect(res.entries[validShotName].dataUri).toMatch(/^data:image\/png;base64,/);

    expect(res.entries['../outside-secret.png']).toBeDefined();
    expect(res.entries['../outside-secret.png'].embedded).toBe(false);
    expect(res.entries['../outside-secret.png'].dataUri).toBeUndefined();
    expect(res.entries['../outside-secret.png'].omittedReason).toContain('non-confined');

    expect(res.entries['does-not-exist.png']).toBeDefined();
    expect(res.entries['does-not-exist.png'].embedded).toBe(false);
    expect(res.entries['does-not-exist.png'].omittedReason).toContain('missing on disk');
  });

  it('rejects invalid UUID payloads and unknown scanRunId safely', () => {
    expect(() =>
      validateIPCRequest(IPC_CHANNELS.REPORT_GET_VISUAL_EVIDENCE, { scanRunId: 'not-a-uuid' }),
    ).toThrow();

    try {
      reportService.getScanVisualEvidence({ scanRunId: '11111111-1111-4111-8111-111111111111' });
      expect.unreachable('Expected SCAN_RUN_NOT_FOUND');
    } catch (err) {
      expect(err).toBeInstanceOf(IPCError);
      expect((err as IPCError).code).toBe(IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND);
    }
  });
});
