import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { ReportService } from '../../src/main/services/report.service.js';
import {
  resolveReportVisualEvidence,
  getScreenshotEvidenceKey,
} from '../../src/main/reports/visual-evidence.js';
import { assembleReportData } from '../../src/main/reports/assembler.js';
import { generateHtmlReport } from '../../src/main/reports/html-generator.js';
import type { PageScreenshotRecord, FindingDTO } from '@auditor/shared';

describe('DEF-004 Clean-Page Screenshot Referencing Regression Suite', () => {
  const baseTestDir = path.resolve('D:/ahmed/.tmp/test-def-004-screenshots');
  const screenshotsDir = path.join(baseTestDir, 'screenshots');
  const reportsDir = path.join(baseTestDir, 'reports');

  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let reportRepo: ReportRepository;
  let reportService: ReportService;

  let testProjectId: string;
  let testSiteId: string;

  // 1x1 transparent PNG buffer for mock image creation
  const samplePngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeEach(async () => {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });

    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    scanRunRepo = new ScanRunRepository(connection);
    findingRepo = new FindingRepository(connection);
    reportRepo = new ReportRepository(connection);

    reportService = new ReportService(reportRepo, scanRunRepo, {
      siteRepo,
      findingRepo,
      reportsDir,
      screenshotsDir,
    });

    const project = projectRepo.create({ name: 'DEF-004 Screenshot Verification Project' });
    testProjectId = project.id;

    const site = siteRepo.create({
      projectId: testProjectId,
      name: 'Clean Page Showcase Site',
      baseUrl: 'https://clean-site.example.com',
    });
    testSiteId = site.id;
  });

  afterEach(() => {
    if (connection && connection.isOpen()) {
      connection.close();
    }
    try {
      fs.rmSync(baseTestDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // Helper to create a mock screenshot file on disk
  function createDiskScreenshot(fileName: string, content = samplePngBuffer): string {
    const filePath = path.join(screenshotsDir, fileName);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function createRunningScan(targetUrl = 'https://clean-site.example.com/'): string {
    const run = scanRunRepo.create({
      siteId: testSiteId,
      scanType: 'full',
      targetUrl,
    });
    scanRunRepo.updateStatus(run.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    return run.id;
  }

  describe('1. Clean Page Screenshot Classification & Referencing', () => {
    it('Scenario 1: Clean page with desktop screenshot is referenced with category desktop', () => {
      const fileName = 'clean-desktop-01.png';
      createDiskScreenshot(fileName);

      const record: PageScreenshotRecord = {
        id: 'sc-clean-desktop-01',
        pageUrl: 'https://clean-site.example.com/about',
        viewportId: 'desktop',
        viewportName: 'Desktop Viewport (1440x900)',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [record],
      });

      expect(evidence[fileName]).toBeDefined();
      expect(evidence[fileName].embedded).toBe(true);
      expect(evidence[fileName].viewportCategory).toBe('desktop');
      expect(evidence[fileName].viewport).toBe('Desktop Viewport (1440x900)');
      expect(evidence[fileName].width).toBe(1440);
      expect(evidence[fileName].height).toBe(900);
      expect(evidence[fileName].pageUrl).toBe('https://clean-site.example.com/about');
    });

    it('Scenario 2: Clean page with mobile screenshot is referenced with category mobile', () => {
      const fileName = 'clean-mobile-01.png';
      createDiskScreenshot(fileName);

      const record: PageScreenshotRecord = {
        id: 'sc-clean-mobile-01',
        pageUrl: 'https://clean-site.example.com/contact',
        viewportId: 'mobile',
        viewportName: 'Mobile Viewport (390x844)',
        viewportCategory: 'mobile',
        width: 390,
        height: 844,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [record],
      });

      expect(evidence[fileName]).toBeDefined();
      expect(evidence[fileName].embedded).toBe(true);
      expect(evidence[fileName].viewportCategory).toBe('mobile');
      expect(evidence[fileName].width).toBe(390);
    });

    it('Scenario 3: Clean page with tablet screenshot is referenced with category tablet', () => {
      const fileName = 'clean-tablet-01.png';
      createDiskScreenshot(fileName);

      const record: PageScreenshotRecord = {
        id: 'sc-clean-tablet-01',
        pageUrl: 'https://clean-site.example.com/pricing',
        viewportId: 'tablet',
        viewportName: 'Tablet Viewport (820x1180)',
        viewportCategory: 'tablet',
        width: 820,
        height: 1180,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [record],
      });

      expect(evidence[fileName]).toBeDefined();
      expect(evidence[fileName].embedded).toBe(true);
      expect(evidence[fileName].viewportCategory).toBe('tablet');
    });

    it('Scenario 4: Completely clean scan (0 findings) references screenshots across reporting pipeline', () => {
      const fileName = 'homepage-clean.png';
      createDiskScreenshot(fileName);

      const scanId = createRunningScan('https://clean-site.example.com/');

      const screenshotRecord: PageScreenshotRecord = {
        id: 'sc-hp-clean',
        pageUrl: 'https://clean-site.example.com/',
        viewportId: 'desktop',
        viewportName: 'Desktop Viewport (1440x900)',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      scanRunRepo.updateStatus(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        durationMs: 1200,
        summary: {
          totalPagesAttempted: 1,
          urlsCrawled: 1,
          pagesScanned: 1,
          pagesFailed: 0,
          browserPagesAudited: 1,
          screenshotsCaptured: 1,
          pageScreenshots: [screenshotRecord],
        },
      });

      // 1. Check IPC service retrieval
      const ipcResult = reportService.getScanVisualEvidence({ scanRunId: scanId });
      expect(ipcResult.scanRunId).toBe(scanId);
      expect(ipcResult.entries[fileName]).toBeDefined();
      expect(ipcResult.entries[fileName].embedded).toBe(true);
      expect(ipcResult.entries[fileName].viewportCategory).toBe('desktop');

      // 2. Check Assembler model
      const deps = { scanRunRepo, siteRepo, findingRepo };
      const reportModel = assembleReportData(scanId, deps, { screenshotsDir });

      expect(reportModel.visualEvidence).toBeDefined();
      expect(reportModel.visualEvidence![fileName]).toBeDefined();
      expect(reportModel.visualEvidence![fileName].embedded).toBe(true);

      // 3. Check HTML generation visual gallery
      const html = generateHtmlReport(reportModel);
      expect(html).toContain('Visual Evidence &amp; Captured Screenshots (1)');
      expect(html).toContain(fileName);
      expect(html).toContain('data:image/png;base64,');
    });

    it('Scenario 5: Multiple viewport screenshots for one page coexist without collision', () => {
      const desktopFile = 'home-desktop.png';
      const tabletFile = 'home-tablet.png';
      const mobileFile = 'home-mobile.png';

      createDiskScreenshot(desktopFile);
      createDiskScreenshot(tabletFile);
      createDiskScreenshot(mobileFile);

      const pageUrl = 'https://clean-site.example.com/responsive';
      const records: PageScreenshotRecord[] = [
        {
          id: 'sc-1-desktop',
          pageUrl,
          viewportId: 'desktop',
          viewportName: 'Desktop Viewport (1440x900)',
          viewportCategory: 'desktop',
          width: 1440,
          height: 900,
          captureType: 'viewport',
          fileName: desktopFile,
          fileSizeBytes: samplePngBuffer.length,
          format: 'png',
          status: 'captured',
          findingIds: [],
        },
        {
          id: 'sc-2-tablet',
          pageUrl,
          viewportId: 'tablet',
          viewportName: 'Tablet Viewport (768x1024)',
          viewportCategory: 'tablet',
          width: 768,
          height: 1024,
          captureType: 'viewport',
          fileName: tabletFile,
          fileSizeBytes: samplePngBuffer.length,
          format: 'png',
          status: 'captured',
          findingIds: [],
        },
        {
          id: 'sc-3-mobile',
          pageUrl,
          viewportId: 'mobile',
          viewportName: 'Mobile Viewport (375x667)',
          viewportCategory: 'mobile',
          width: 375,
          height: 667,
          captureType: 'viewport',
          fileName: mobileFile,
          fileSizeBytes: samplePngBuffer.length,
          format: 'png',
          status: 'captured',
          findingIds: [],
        },
      ];

      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: records,
      });

      expect(Object.keys(evidence)).toHaveLength(3);
      expect(evidence[desktopFile].viewportCategory).toBe('desktop');
      expect(evidence[tabletFile].viewportCategory).toBe('tablet');
      expect(evidence[mobileFile].viewportCategory).toBe('mobile');
    });

    it('Scenario 6: Multiple distinct pages retain independent screenshots', () => {
      const file1 = 'page1.png';
      const file2 = 'page2.png';
      createDiskScreenshot(file1);
      createDiskScreenshot(file2);

      const records: PageScreenshotRecord[] = [
        {
          id: 'sc-p1',
          pageUrl: 'https://clean-site.example.com/page-1',
          viewportId: 'desktop',
          viewportName: 'Desktop',
          viewportCategory: 'desktop',
          width: 1440,
          height: 900,
          captureType: 'viewport',
          fileName: file1,
          fileSizeBytes: samplePngBuffer.length,
          format: 'png',
          status: 'captured',
          findingIds: [],
        },
        {
          id: 'sc-p2',
          pageUrl: 'https://clean-site.example.com/page-2',
          viewportId: 'desktop',
          viewportName: 'Desktop',
          viewportCategory: 'desktop',
          width: 1440,
          height: 900,
          captureType: 'viewport',
          fileName: file2,
          fileSizeBytes: samplePngBuffer.length,
          format: 'png',
          status: 'captured',
          findingIds: [],
        },
      ];

      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: records,
      });

      expect(evidence[file1].pageUrl).toBe('https://clean-site.example.com/page-1');
      expect(evidence[file2].pageUrl).toBe('https://clean-site.example.com/page-2');
    });
  });

  describe('2. Negative & Edge Scenarios (Disabled, Failed, Missing, Traversal)', () => {
    it('Scenario 7: Screenshot capture disabled generates no phantom records', () => {
      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [],
      });
      expect(Object.keys(evidence)).toHaveLength(0);
    });

    it('Scenario 8: Screenshot capture failure (status !== captured) is marked omitted and not embedded', () => {
      const fileName = 'failed-capture.png';
      createDiskScreenshot(fileName);

      const record: PageScreenshotRecord = {
        id: 'sc-failed',
        pageUrl: 'https://clean-site.example.com/broken',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: 0,
        format: 'png',
        status: 'failed',
        findingIds: [],
      };

      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [record],
      });

      expect(evidence[fileName]).toBeDefined();
      expect(evidence[fileName].embedded).toBe(false);
      expect(evidence[fileName].omittedReason).toContain('screenshot status is failed');
    });

    it('Scenario 9: Browser audit failure does not corrupt previously captured page screenshots', () => {
      const fileName = 'preserved-before-fail.png';
      createDiskScreenshot(fileName);

      const record: PageScreenshotRecord = {
        id: 'sc-preserved',
        pageUrl: 'https://clean-site.example.com/ok-page',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: 'https://clean-site.example.com/',
      });

      // Scan transitioned to failed with error details preserving partial screenshots
      scanRunRepo.updateStatus(run.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        durationMs: 4000,
        error: {
          code: 'ERR_BROWSER_CRASH',
          message: 'Browser crashed during audit',
          details: {
            pageScreenshots: [record],
          },
        },
      });

      const ipcResult = reportService.getScanVisualEvidence({ scanRunId: run.id });
      expect(ipcResult.entries[fileName]).toBeDefined();
      expect(ipcResult.entries[fileName].embedded).toBe(true);
    });

    it('Scenario 10: Scan cancellation preserves captured screenshots via errorDetails', () => {
      const fileName = 'cancelled-partial.png';
      createDiskScreenshot(fileName);

      const record: PageScreenshotRecord = {
        id: 'sc-cancelled',
        pageUrl: 'https://clean-site.example.com/cancelled',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: 'https://clean-site.example.com/',
      });

      scanRunRepo.updateStatus(run.id, {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        durationMs: 2500,
        error: {
          code: 'ERR_SCAN_CANCELLED',
          message: 'Scan cancelled by user',
          details: {
            pageScreenshots: [record],
          },
        },
      });

      const ipcResult = reportService.getScanVisualEvidence({ scanRunId: run.id });
      expect(ipcResult.entries[fileName]).toBeDefined();
      expect(ipcResult.entries[fileName].embedded).toBe(true);
    });

    it('Scenario 11: Scan timeout preserves captured screenshots via errorDetails', () => {
      const fileName = 'timeout-partial.png';
      createDiskScreenshot(fileName);

      const record: PageScreenshotRecord = {
        id: 'sc-timeout',
        pageUrl: 'https://clean-site.example.com/timeout',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      const run = scanRunRepo.create({
        siteId: testSiteId,
        scanType: 'full',
        targetUrl: 'https://clean-site.example.com/',
      });

      scanRunRepo.updateStatus(run.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        durationMs: 60000,
        error: {
          code: 'ERR_SCAN_TIMEOUT',
          message: 'Scan exceeded maximum duration limit',
          details: {
            pageScreenshots: [record],
          },
        },
      });

      const ipcResult = reportService.getScanVisualEvidence({ scanRunId: run.id });
      expect(ipcResult.entries[fileName]).toBeDefined();
      expect(ipcResult.entries[fileName].embedded).toBe(true);
    });

    it('Scenario 12 & 13: Persistence in summary_json and reloading from database with full fidelity', () => {
      const fileName = 'db-fidelity.png';
      createDiskScreenshot(fileName);

      const record: PageScreenshotRecord = {
        id: 'sc-fidelity-01',
        pageUrl: 'https://clean-site.example.com/persisted',
        viewportId: 'desktop',
        viewportName: 'Desktop Viewport',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: ['finding-123'],
      };

      const scanId = createRunningScan('https://clean-site.example.com/');

      scanRunRepo.updateStatus(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        durationMs: 3000,
        summary: {
          totalPagesAttempted: 1,
          urlsCrawled: 1,
          pagesScanned: 1,
          pagesFailed: 0,
          browserPagesAudited: 1,
          screenshotsCaptured: 1,
          pageScreenshots: [record],
        },
      });

      // Reload fresh from SQLite
      const reloaded = scanRunRepo.getById(scanId)!;
      expect(reloaded.summary?.pageScreenshots).toBeDefined();
      const loadedRecord = reloaded.summary!.pageScreenshots![0];
      expect(loadedRecord.id).toBe('sc-fidelity-01');
      expect(loadedRecord.viewportCategory).toBe('desktop');
      expect(loadedRecord.width).toBe(1440);
      expect(loadedRecord.findingIds).toEqual(['finding-123']);
    });

    it('Scenario 14: Historical scans without pageScreenshots load safely without throwing', () => {
      const scanId = createRunningScan('https://clean-site.example.com/');

      // Old scan with no pageScreenshots field in summary
      scanRunRepo.updateStatus(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        durationMs: 1500,
        summary: {
          totalPagesAttempted: 1,
          urlsCrawled: 1,
          pagesScanned: 1,
          pagesFailed: 0,
        },
      });

      const ipcResult = reportService.getScanVisualEvidence({ scanRunId: scanId });
      expect(ipcResult.scanRunId).toBe(scanId);
      expect(ipcResult.entries).toEqual({});

      const deps = { scanRunRepo, siteRepo, findingRepo };
      expect(() =>
        assembleReportData(scanId, deps, { screenshotsDir }),
      ).not.toThrow();
    });

    it('Scenario 15: Visual evidence IPC returns all captured screenshots', () => {
      const f1 = 'ipc-01.png';
      const f2 = 'ipc-02.png';
      createDiskScreenshot(f1);
      createDiskScreenshot(f2);

      const scanId = createRunningScan('https://clean-site.example.com/');

      scanRunRepo.updateStatus(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        durationMs: 2000,
        summary: {
          totalPagesAttempted: 2,
          urlsCrawled: 2,
          pagesScanned: 2,
          pagesFailed: 0,
          browserPagesAudited: 2,
          screenshotsCaptured: 2,
          pageScreenshots: [
            {
              id: 'sc-ipc-1',
              pageUrl: 'https://clean-site.example.com/1',
              viewportId: 'desktop',
              viewportName: 'Desktop',
              viewportCategory: 'desktop',
              width: 1440,
              height: 900,
              captureType: 'viewport',
              fileName: f1,
              fileSizeBytes: samplePngBuffer.length,
              format: 'png',
              status: 'captured',
              findingIds: [],
            },
            {
              id: 'sc-ipc-2',
              pageUrl: 'https://clean-site.example.com/2',
              viewportId: 'mobile',
              viewportName: 'Mobile',
              viewportCategory: 'mobile',
              width: 390,
              height: 844,
              captureType: 'viewport',
              fileName: f2,
              fileSizeBytes: samplePngBuffer.length,
              format: 'png',
              status: 'captured',
              findingIds: [],
            },
          ],
        },
      });

      const res = reportService.getScanVisualEvidence({ scanRunId: scanId });
      expect(Object.keys(res.entries)).toHaveLength(2);
      expect(res.entries[f1].embedded).toBe(true);
      expect(res.entries[f2].embedded).toBe(true);
    });

    it('Scenario 16: Missing screenshot file on disk returns safe omittedReason', () => {
      const missingFile = 'deleted-by-user.png';
      // Deliberately do not create disk file

      const record: PageScreenshotRecord = {
        id: 'sc-missing',
        pageUrl: 'https://clean-site.example.com/page',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName: missingFile,
        fileSizeBytes: 1024,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [record],
      });

      expect(evidence[missingFile]).toBeDefined();
      expect(evidence[missingFile].embedded).toBe(false);
      expect(evidence[missingFile].omittedReason).toContain('screenshot file missing on disk');
    });

    it('Scenario 17: Path traversal attempt is rejected with security omission reason', () => {
      const maliciousRecord: PageScreenshotRecord = {
        id: 'sc-traversal',
        pageUrl: 'https://clean-site.example.com/',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName: '../../../../windows/system32/cmd.exe',
        fileSizeBytes: 1024,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      // getScreenshotEvidenceKey preserves raw fileName
      const key = getScreenshotEvidenceKey(maliciousRecord as unknown as Record<string, unknown>);
      expect(key).toBe('../../../../windows/system32/cmd.exe');

      const directEvil = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [maliciousRecord],
      });
      expect(directEvil[key!].embedded).toBe(false);
      expect(directEvil[key!].omittedReason).toContain(
        'invalid or non-confined screenshot path',
      );
    });

    it('Scenario 18: Symlink escape outside screenshots directory is safely rejected', () => {
      const outsideDir = path.join(baseTestDir, 'outside-secret');
      fs.mkdirSync(outsideDir, { recursive: true });
      const secretFile = path.join(outsideDir, 'secret.png');
      fs.writeFileSync(secretFile, samplePngBuffer);

      const symlinkPath = path.join(screenshotsDir, 'escaped-link.png');
      try {
        fs.symlinkSync(secretFile, symlinkPath, 'file');
      } catch {
        // Skip if OS privileges prevent symlink creation
        return;
      }

      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [
          {
            id: 'sc-symlink',
            pageUrl: 'https://clean-site.example.com/',
            viewportId: 'desktop',
            viewportName: 'Desktop',
            viewportCategory: 'desktop',
            width: 1440,
            height: 900,
            captureType: 'viewport',
            fileName: 'escaped-link.png',
            fileSizeBytes: samplePngBuffer.length,
            format: 'png',
            status: 'captured',
            findingIds: [],
          },
        ],
      });

      expect(evidence['escaped-link.png'].embedded).toBe(false);
      expect(evidence['escaped-link.png'].omittedReason).toContain(
        'symlink escape outside screenshots directory rejected',
      );
    });

    it('Scenario 19: Sensitive query parameters in pageUrl are redacted across visual evidence', () => {
      const fileName = 'sensitive-clean.png';
      createDiskScreenshot(fileName);

      const unredactedUrl =
        'https://clean-site.example.com/checkout?token=secret_998877&api_key=priv_key_4433&step=2';

      const record: PageScreenshotRecord = {
        id: 'sc-sensitive',
        pageUrl: unredactedUrl,
        viewportId: 'desktop',
        viewportName: 'Desktop',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [record],
      });

      expect(evidence[fileName].pageUrl).toBeDefined();
      expect(evidence[fileName].pageUrl).not.toContain('secret_998877');
      expect(evidence[fileName].pageUrl).not.toContain('priv_key_4433');
      expect(evidence[fileName].pageUrl).toContain('step=2');
      expect(evidence[fileName].pageUrl).toContain('REDACTED');
    });

    it('Scenario 20: Standalone HTML report renders visual gallery across Simple, Technical, and Dual modes', () => {
      const f1 = 'gallery-viewmode.png';
      createDiskScreenshot(f1);

      const record: PageScreenshotRecord = {
        id: 'sc-gallery-vm',
        pageUrl: 'https://clean-site.example.com/showcase',
        viewportId: 'desktop',
        viewportName: 'Desktop Viewport (1440x900)',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName: f1,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      const scanId = createRunningScan('https://clean-site.example.com/');

      scanRunRepo.updateStatus(scanId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        durationMs: 2500,
        summary: {
          totalPagesAttempted: 1,
          urlsCrawled: 1,
          pagesScanned: 1,
          pagesFailed: 0,
          browserPagesAudited: 1,
          screenshotsCaptured: 1,
          pageScreenshots: [record],
        },
      });

      const deps = { scanRunRepo, siteRepo, findingRepo };

      // 1. Simple mode
      const simpleModel = assembleReportData(scanId, deps, {
        screenshotsDir,
        viewMode: 'simple',
      });
      const simpleHtml = generateHtmlReport(simpleModel);
      expect(simpleHtml).toContain(f1);
      expect(simpleHtml).toContain('Visual Evidence &amp; Captured Screenshots (1)');

      // 2. Technical mode
      const techModel = assembleReportData(scanId, deps, {
        screenshotsDir,
        viewMode: 'technical',
      });
      const techHtml = generateHtmlReport(techModel);
      expect(techHtml).toContain(f1);

      // 3. Dual mode (Arabic)
      const dualArModel = assembleReportData(scanId, deps, {
        screenshotsDir,
        viewMode: 'dual',
        locale: 'ar',
      });
      const dualArHtml = generateHtmlReport(dualArModel);
      expect(dualArHtml).toContain(f1);
      expect(dualArHtml).toContain('الأدلة البصرية ولقطات الشاشة (1)');
    });

    it('Scenario 21: Idempotency: re-running report assembly or re-resolving does not duplicate entries', () => {
      const f1 = 'idempotent-test.png';
      createDiskScreenshot(f1);

      const record: PageScreenshotRecord = {
        id: 'sc-idempotent',
        pageUrl: 'https://clean-site.example.com/idempotent',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        fileName: f1,
        fileSizeBytes: samplePngBuffer.length,
        format: 'png',
        status: 'captured',
        findingIds: [],
      };

      // Pass duplicate identical records in array
      const evidence = resolveReportVisualEvidence([], {
        screenshotsDir,
        pageScreenshots: [record, record, { ...record }],
      });

      expect(Object.keys(evidence)).toHaveLength(1);
      expect(evidence[f1]).toBeDefined();
    });
  });
});
