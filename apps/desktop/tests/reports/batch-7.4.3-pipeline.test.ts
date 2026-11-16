import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../src/main/db/repositories/finding.repository.js';
import { ReportRepository } from '../../src/main/db/repositories/report.repository.js';
import { ReportService } from '../../src/main/services/report.service.js';
import { assembleReportData } from '../../src/main/reports/assembler.js';
import { generateHtmlReport } from '../../src/main/reports/html-generator.js';
import { generateJsonReport } from '../../src/main/reports/json-generator.js';
import { generateCsvReport } from '../../src/main/reports/csv-generator.js';
import { resolveReportVisualEvidence } from '../../src/main/reports/visual-evidence.js';
import type { ReportModel } from '../../src/main/reports/types.js';

const TINY_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Batch 7.4.3 — Standalone Bilingual HTML Reports, Visual Evidence & Security', () => {
  const testDir = path.resolve('D:/ahmed/.tmp/test-batch-743-pipeline');
  const testDbPath = path.join(testDir, 'audit.db');
  const reportsDir = path.join(testDir, 'reports');
  const screenshotsDir = path.join(reportsDir, 'screenshots');

  let conn: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let scanRunRepo: ScanRunRepository;
  let findingRepo: FindingRepository;
  let reportRepo: ReportRepository;
  let reportService: ReportService;

  let siteId: string;
  let scanRunId: string;
  let historicalScanRunId: string;

  beforeEach(async () => {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    fs.writeFileSync(path.join(screenshotsDir, 'hero-desktop.png'), TINY_PNG_BYTES);
    fs.writeFileSync(path.join(screenshotsDir, 'page-mobile.png'), TINY_PNG_BYTES);
    fs.writeFileSync(path.join(screenshotsDir, 'malicious.svg'), '<svg onload="alert(1)"></svg>');

    conn = new DatabaseConnection(testDbPath);
    conn.open();
    await new MigrationRunner(conn).migrate();

    projectRepo = new ProjectRepository(conn);
    siteRepo = new SiteRepository(conn);
    scanRunRepo = new ScanRunRepository(conn);
    findingRepo = new FindingRepository(conn);
    reportRepo = new ReportRepository(conn);

    reportService = new ReportService(reportRepo, scanRunRepo, {
      siteRepo,
      findingRepo,
      reportsDir,
      screenshotsDir,
    });

    const project = projectRepo.create({ name: 'Bilingual Acceptance Project' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'متجر النموذج العربي',
      baseUrl: 'https://store.example.test',
      platformType: 'wordpress',
      environmentType: 'staging',
    });
    siteId = site.id;

    // Rich scan with full Batch 7.4 telemetry & screenshots
    const run = scanRunRepo.create({
      siteId,
      targetUrl: 'https://store.example.test/',
      scanType: 'full',
      config: { maxPages: 10, enableBrowserAudit: true },
    });
    scanRunId = run.id;

    scanRunRepo.updateStatus(scanRunId, { status: 'running', startedAt: '2026-11-15T10:00:00.000Z' });
    scanRunRepo.updateStatus(scanRunId, {
      status: 'completed',
      completedAt: '2026-11-15T10:02:00.000Z',
      durationMs: 120000,
      summary: {
        totalFindings: 3,
        urlsCrawled: 10,
        pagesScanned: 10,
        crawlFailedPages: 0,
        pagesFailed: 0,
        browserPagesAudited: 5,
        browserCandidatesTotal: 5,
        browserCandidatesSkipped: 0,
        browserFailedPages: 0,
        staticPagesExpected: 10,
        staticPagesCompleted: 10,
        a11yPagesExpected: 5,
        a11yPagesCompleted: 5,
        clsPagesExpected: 5,
        clsPagesCompleted: 5,
        screenshotsCaptured: 2,
        pageScreenshots: [
          {
            fileName: 'page-mobile.png',
            pageUrl: 'https://store.example.test/checkout',
            viewport: 'mobile-390',
            captureType: 'viewport',
            status: 'captured',
          },
        ],
        performanceMetrics: {
          labMetrics: {
            ttfbMs: 310,
            fcpMs: 1100,
            lcpMs: 2400,
            cls: 0.08,
            tbtMs: 190,
            isLcpCapped: false,
          },
          resourceSummary: {
            totalResources: 28,
            totalTransferSizeBytes: 820000,
            bytesByType: {
              document: 40000,
              script: 320000,
              stylesheet: 90000,
              image: 300000,
              font: 50000,
              other: 20000,
            },
            renderBlockingCount: 2,
            scriptsCount: 10,
            stylesheetsCount: 4,
            imagesCount: 11,
            oversizedImagesCount: 1,
            uncompressedAssetsCount: 1,
          },
        },
      },
    });

    findingRepo.batchCreate([
      {
        scanRunId,
        ruleId: 'SEC_HEADER_CSP_MISSING',
        category: 'security',
        title: 'Missing Content-Security-Policy',
        description: 'Response omitted Content-Security-Policy header.',
        severity: 'high',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://store.example.test/?token=secret-query-999',
        evidence: {
          headerName: 'Content-Security-Policy',
          headers: { 'cf-ray': '999-CAI', server: 'nginx' },
          authorization: 'Bearer secret-leak-token-abc',
        },
        remediation: 'Configure CSP.',
      },
      {
        scanRunId,
        ruleId: 'WP_DETECTED',
        category: 'wordpress',
        title: 'WordPress Detected',
        description: 'WordPress detected with Elementor Pro & WooCommerce.',
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://store.example.test/',
        evidence: {
          confidence: 'confirmed',
          version: '6.7.2',
          plugins: ['elementor-pro', 'woocommerce'],
          themes: ['hello-elementor'],
          screenshot: {
            fileName: 'hero-desktop.png',
            viewportProfile: 'desktop-1440',
            captureType: 'full_page',
            status: 'captured',
            width: 1440,
            height: 900,
            fileSizeBytes: TINY_PNG_BYTES.length,
          },
        },
      },
      {
        scanRunId,
        ruleId: 'a11y-color-contrast',
        category: 'accessibility',
        title: 'Insufficient Color Contrast',
        description: 'Contrast ratio below 4.5:1.',
        severity: 'medium',
        confidence: 'potential',
        status: 'needs_manual_review',
        targetUrl: 'https://store.example.test/checkout',
        evidence: {
          nodes: [{ target: ['.checkout-btn', '#pay-now'] }],
        },
      },
    ]);

    // Legacy / historical incomplete scan (missing urlsCrawled, performanceMetrics, screenshots)
    const legacy = scanRunRepo.create({
      siteId,
      targetUrl: 'https://store.example.test/',
      scanType: 'full',
      config: { maxPages: 5 },
    });
    historicalScanRunId = legacy.id;
    scanRunRepo.updateStatus(historicalScanRunId, { status: 'running' });
    scanRunRepo.updateStatus(historicalScanRunId, {
      status: 'completed',
      summary: {
        totalFindings: 1,
        pagesScanned: 4,
        pagesFailed: 1,
      },
    });
    findingRepo.batchCreate([
      {
        scanRunId: historicalScanRunId,
        ruleId: 'SEO_TITLE_MISSING',
        category: 'seo',
        title: 'Missing Title Tag',
        description: 'Historical finding.',
        severity: 'high',
        confidence: 'confirmed',
        targetUrl: 'https://store.example.test/old',
      },
    ]);
  });

  afterEach(() => {
    conn?.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('generates offline-capable Arabic RTL and English LTR HTML reports with all 7 charts and LTR technical isolation', () => {
    const arReport = reportService.createReport({
      scanRunId,
      title: 'تقرير الفحص الشامل العربي',
      format: 'html',
      locale: 'ar',
      viewMode: 'dual',
    });
    const arHtml = reportService.getReportContent({ id: arReport.id }).content;

    expect(arHtml).toContain('<html lang="ar" dir="rtl">');
    expect(arHtml).toContain('<body dir="rtl" data-locale="ar" data-initial-view-mode="dual">');
    expect(arHtml).toContain('مؤشر الصحة المبني على الأدلة');
    expect(arHtml).toContain('التحليلات الرسومية ومخططات القياس');
    expect(arHtml).toContain('الأدلة البصرية ولقطات الشاشة');

    // All 7 chart SVGs must be rendered directly from shared chart-specs
    for (const chartType of [
      'severity_distribution',
      'category_breakdown',
      'coverage_dimensions',
      'lab_vitals',
      'asset_breakdown',
      'bottleneck_summary',
      'top_affected_pages',
    ]) {
      expect(arHtml).toContain(`data-chart="${chartType}"`);
    }
    expect(arHtml).toContain('<svg class="chart-svg"');
    expect(arHtml).toContain('INP');

    // Technical identifiers wrapped with LTR isolation
    expect(arHtml).toContain('<span class="badge font-mono" dir="ltr">SEC_HEADER_CSP_MISSING</span>');
    expect(arHtml).toContain('<code dir="ltr">.checkout-btn</code>');

    // Offline self-containment checks
    expect(arHtml).not.toContain('<script');
    expect(arHtml).not.toMatch(/https?:\/\/fonts\.googleapis\.com/i);
    expect(arHtml).not.toMatch(/url\s*\(\s*['"]?https?:/i);
    expect(arHtml).not.toMatch(/<link[^>]+stylesheet/i);
    expect(arHtml).toContain('@media print');
    expect(arHtml).toContain("default-src 'none'");
    expect(arHtml).toContain("script-src 'none'");

    // Secret redaction preserved
    expect(arHtml).not.toContain('secret-leak-token-abc');
    expect(arHtml).not.toContain('secret-query-999');

    // Screenshots safely embedded with metadata
    expect(arHtml).toContain('src="data:image/png;base64,');
    expect(arHtml).toContain('hero-desktop.png');
    expect(arHtml).toContain('page-mobile.png');
    expect(arHtml).toContain('mobile-390');
    expect(arHtml).toContain('full_page');

    // English LTR report parity
    const enReport = reportService.createReport({
      scanRunId,
      title: 'English Full Audit',
      format: 'html',
      locale: 'en',
      viewMode: 'simple',
    });
    const enHtml = reportService.getReportContent({ id: enReport.id }).content;
    expect(enHtml).toContain('<html lang="en">');
    expect(enHtml).toContain('<body dir="ltr" data-locale="en" data-initial-view-mode="simple">');
    expect(enHtml).toContain('id="vm-simple" class="vm-radio" checked');
    // Simple view MUST NOT delete underlying technical rule IDs or raw evidence
    expect(enHtml).toContain('SEC_HEADER_CSP_MISSING');
    expect(enHtml).toContain('.checkout-btn');
    expect(enHtml).toContain('a11y-color-contrast');
  });

  it('rejects path traversal, symlinks/escapes, unsupported .svg masquerades, and missing screenshots safely', () => {
    const model = assembleReportData(
      scanRunId,
      { siteRepo, scanRunRepo, findingRepo },
      { screenshotsDir },
    );
    expect(model.visualEvidence?.['hero-desktop.png']?.embedded).toBe(true);
    expect(model.visualEvidence?.['page-mobile.png']?.embedded).toBe(true);

    const maliciousFindings = [
      {
        ...model.findings[0],
        evidence: { screenshot: { fileName: '../../../../Windows/System32/drivers/etc/hosts.png' } },
      },
      {
        ...model.findings[0],
        evidence: { screenshot: { fileName: 'malicious.svg' } },
      },
      {
        ...model.findings[0],
        evidence: { screenshot: { fileName: 'does-not-exist.png' } },
      },
      {
        ...model.findings[0],
        evidence: { screenshot: { fileName: 'D:\\ahmed\\secret.png' } },
      },
    ];

    const resolved = resolveReportVisualEvidence(maliciousFindings, { screenshotsDir });
    expect(resolved['../../../../Windows/System32/drivers/etc/hosts.png']?.embedded).toBe(false);
    expect(resolved['../../../../Windows/System32/drivers/etc/hosts.png']?.omittedReason).toContain(
      'invalid or non-confined',
    );
    expect(resolved['malicious.svg']?.embedded).toBe(false);
    expect(resolved['malicious.svg']?.omittedReason).toContain('unsupported image format');
    expect(resolved['does-not-exist.png']?.embedded).toBe(false);
    expect(resolved['does-not-exist.png']?.omittedReason).toContain('missing on disk');
    expect(resolved['D:\\ahmed\\secret.png']?.embedded).toBe(false);
  });

  it('handles historical incomplete scans cleanly in HTML, JSON, and CSV without fabricating metrics', () => {
    const legacyModel = assembleReportData(
      historicalScanRunId,
      { siteRepo, scanRunRepo, findingRepo },
      { locale: 'en', viewMode: 'dual', screenshotsDir },
    );

    const legacyHtml = generateHtmlReport(legacyModel);
    expect(legacyHtml).toContain('SEO_TITLE_MISSING');
    expect(legacyHtml).toContain('Unavailable');
    expect(legacyHtml).not.toContain('class="perf-section"');
    expect(legacyHtml).toContain('Coverage &amp; Telemetry Disclosures');

    const legacyJson = JSON.parse(generateJsonReport(legacyModel));
    expect(legacyJson.healthOverview).toBeDefined();
    expect(legacyJson.charts.labVitals.status).toBe('unavailable');
    expect(legacyJson.recommendations).toHaveLength(1);

    const legacyCsv = generateCsvReport(legacyModel);
    expect(legacyCsv).toContain('"SEO_TITLE_MISSING"');
  });

  it('neutralizes hostile SVG/HTML/JS/CSV-formula payloads and preserves PDF rejection', () => {
    const hostileModel: ReportModel = {
      reportId: 'rep-hostile',
      title: '"><svg onload=alert(1)>',
      site: {
        id: 's1',
        projectId: 'p1',
        name: 'Site',
        baseUrl: 'https://safe.example',
        platformType: 'generic',
        environmentType: 'staging',
        description: null,
      },
      scanRun: {
        id: 'r1',
        siteId: 's1',
        scanType: 'full',
        status: 'completed',
        targetUrl: 'https://safe.example',
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        durationMs: null,
        config: { apiKey: 'AIzaSySecretKey987654' },
      },
      findings: [
        {
          id: 'f-h',
          scanRunId: 'r1',
          ruleId: 'CUSTOM_HOSTILE',
          category: 'security',
          title: '=HYPERLINK("http://evil.com","click")',
          description: '<svg/onload=alert("xss")><script>alert(1)</script>',
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://safe.example/?password=MyPassword123',
          evidence: {
            selector: '<img src=x onerror=alert(1)>',
            cookie: 'secret_cookie=xyz',
          },
          remediation: '@cmd|calc',
          references: ['javascript:alert(1)', 'https://owasp.org/'],
          createdAt: '2026-11-15T10:00:00.000Z',
        },
      ],
      summary: {
        totalFindings: 1,
        bySeverity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
        byCategory: { security: 1 },
        confirmedCount: 1,
        potentialCount: 0,
        pagesScanned: 1,
        pagesFailed: 0,
        scanDurationMs: null,
        scanStatus: 'completed',
        generatedAt: '2026-11-15T10:00:00.000Z',
      },
      generatedAt: '2026-11-15T10:00:00.000Z',
      version: '1.0.0',
    };

    const html = generateHtmlReport(hostileModel, { locale: 'en', viewMode: 'technical' });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<svg/onload');
    expect(html).not.toContain('<svg onload');
    expect(html).not.toContain('MyPassword123');
    expect(html).not.toContain('secret_cookie=xyz');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://owasp.org/"');

    const csv = generateCsvReport(hostileModel);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil.com\"\",\"\"click\"\")\"");
    expect(csv).toContain("\"'@cmd|calc\"");

    expect(() =>
      reportService.createReport({
        scanRunId,
        title: 'PDF Rejected Test',
        format: 'pdf',
      }),
    ).toThrow('PDF export format is not supported');
  });
});
