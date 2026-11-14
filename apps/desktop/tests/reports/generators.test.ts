import { describe, it, expect } from 'vitest';
import { generateHtmlReport } from '../../src/main/reports/html-generator.js';
import { generateJsonReport } from '../../src/main/reports/json-generator.js';
import { generateCsvReport } from '../../src/main/reports/csv-generator.js';
import type { ReportModel } from '../../src/main/reports/types.js';

describe('Report Generators (HTML, JSON, CSV)', () => {
  const sampleModel: ReportModel = {
    reportId: 'rep-1111-2222-3333-4444',
    title: 'Audit Report — Acme WordPress Store',
    site: {
      id: 'site-1',
      projectId: 'proj-1',
      name: 'Acme Store <PROD>',
      baseUrl: 'https://acme.test',
      platformType: 'wordpress',
      environmentType: 'production',
      description: 'Official online store',
    },
    scanRun: {
      id: 'scan-1',
      siteId: 'site-1',
      scanType: 'full',
      status: 'completed',
      targetUrl: 'https://acme.test/',
      startedAt: '2026-11-07T10:00:00.000Z',
      completedAt: '2026-11-07T10:02:30.000Z',
      cancelledAt: null,
      durationMs: 150000,
      config: { maxPages: 10 },
      pagesScanned: 10,
      pagesFailed: 0,
    },
    findings: [
      {
        id: 'f-1',
        scanRunId: 'scan-1',
        ruleId: 'SEC-HEADER-XFO',
        category: 'security',
        title: 'Missing X-Frame-Options Header',
        description: 'Page can be framed in clickjacking attacks.',
        severity: 'medium',
        confidence: 'confirmed',
        status: 'active',
        targetUrl: 'https://acme.test/',
        evidence: { observedHeader: null, cookie: 'PHPSESSID=secret-cookie-val' },
        remediation: 'Set X-Frame-Options to DENY or SAMEORIGIN.',
        references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options'],
        createdAt: '2026-11-07T10:01:00.000Z',
      },
    ],
    summary: {
      totalFindings: 1,
      bySeverity: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
      byCategory: { security: 1 },
      confirmedCount: 1,
      potentialCount: 0,
      pagesScanned: 10,
      pagesFailed: 0,
      scanDurationMs: 150000,
      scanStatus: 'completed',
      generatedAt: '2026-11-07T10:05:00.000Z',
    },
    generatedAt: '2026-11-07T10:05:00.000Z',
    version: '1.0.0',
  };

  describe('HTML Generator', () => {
    it('generates a valid, self-contained HTML document with strict CSP', () => {
      const html = generateHtmlReport(sampleModel);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("style-src 'unsafe-inline'");
      expect(html).toContain('Ultimate WordPress &amp; Website Auditor');
      expect(html).toContain('Audit Report — Acme WordPress Store');
      expect(html).toContain('Acme Store &lt;PROD&gt;'); // HTML-escaped site name
      expect(html).toContain('Missing X-Frame-Options Header');
      expect(html).toContain('SCAN COMPLETED');
    });

    it('redacts sensitive cookies and authorization tokens in evidence block', () => {
      const html = generateHtmlReport(sampleModel);
      expect(html).not.toContain('secret-cookie-val');
      expect(html).toContain('[REDACTED_SECRET]');
    });

    it('renders a prominent warning callout when scan status is failed or cancelled', () => {
      const failedModel: ReportModel = {
        ...sampleModel,
        scanRun: {
          ...sampleModel.scanRun,
          status: 'failed',
        },
        summary: {
          ...sampleModel.summary,
          scanStatus: 'failed',
        },
      };

      const html = generateHtmlReport(failedModel);
      expect(html).toContain('Warning: Incomplete / FAILED Scan Run');
      expect(html).toContain('represent partial evidence collected before termination');
    });

    it('renders empty state message when findings array is empty', () => {
      const emptyModel: ReportModel = {
        ...sampleModel,
        findings: [],
        summary: {
          ...sampleModel.summary,
          totalFindings: 0,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        },
      };

      const html = generateHtmlReport(emptyModel);
      expect(html).toContain('No Findings Detected');
      expect(html).not.toContain('<article class="finding-card');
    });

    it('contains no external script tags or external font links', () => {
      const html = generateHtmlReport(sampleModel);
      expect(html).not.toContain('<script src=');
      expect(html).not.toContain('https://fonts.googleapis.com');
      expect(html).not.toContain('https://cdnjs.cloudflare.com');
    });

    it('renders distinct Firm badges, status badges, canonical labels, and embedded data-URI visual previews', () => {
      const firmAndVisualModel: ReportModel = {
        ...sampleModel,
        findings: [
          {
            ...sampleModel.findings[0],
            id: 'f-firm-visual',
            ruleId: 'WP_REST_API_ADVERTISED',
            category: 'wordpress',
            confidence: 'firm',
            status: 'potential',
            evidence: {
              screenshot: {
                fileName: 'wp-signal.png',
                viewportProfile: 'desktop-1440',
                width: 1440,
                height: 900,
                fileSizeBytes: 1200,
              },
            },
          },
        ],
        summary: {
          ...sampleModel.summary,
          totalFindings: 1,
          byCategory: { wordpress: 1 },
          confirmedCount: 0,
          firmCount: 1,
          potentialCount: 0,
        },
        visualEvidence: {
          'wp-signal.png': {
            fileName: 'wp-signal.png',
            byteLength: 68,
            embedded: true,
            mimeType: 'image/png',
            dataUri:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          },
        },
      };

      const html = generateHtmlReport(firmAndVisualModel);
      expect(html).toContain('0 Confirmed');
      expect(html).toContain('1 Firm');
      expect(html).toContain('0 Potential');
      expect(html).toContain('badge badge-conf conf-firm');
      expect(html).toContain('badge badge-status status-potential');
      expect(html).toContain('<td class="cat-name">WordPress</td>');
      expect(html).toContain('<img class="visual-evidence-img" src="data:image/png;base64,');
    });
  });

  describe('JSON Generator', () => {
    it('generates versioned, valid JSON with redacted secrets', () => {
      const jsonStr = generateJsonReport(sampleModel);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.schemaVersion).toBe('1.0.0');
      expect(parsed.reportId).toBe(sampleModel.reportId);
      expect(parsed.title).toBe(sampleModel.title);
      expect(parsed.site.name).toBe(sampleModel.site.name);
      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0].status).toBe('confirmed');
      expect(parsed.findings[0].category).toBe('security');
      expect(parsed.findings[0].categoryLabel).toBe('Security');
      expect(parsed.summary.firmCount).toBe(0);

      // Verify secret redaction
      expect(parsed.findings[0].evidence.cookie).toBe('[REDACTED_SECRET]');
    });
  });

  describe('CSV Generator', () => {
    it('generates compliant CSV starting with UTF-8 BOM', () => {
      const csv = generateCsvReport(sampleModel);
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('"Report ID","Scan Run ID","Site Name"');
      expect(csv).toContain('"Acme Store <PROD>"');
      expect(csv).toContain('"Missing X-Frame-Options Header"');
    });

    it('neutralizes spreadsheet formula injection in CSV cells', () => {
      const injectionModel: ReportModel = {
        ...sampleModel,
        findings: [
          {
            ...sampleModel.findings[0],
            title: '=cmd|\'/C calc\'!A0',
            description: '+2+5',
            remediation: '@SUM(1,2)',
          },
        ],
      };

      const csv = generateCsvReport(injectionModel);
      expect(csv).toContain("\"'=cmd|'/C calc'!A0\"");
      expect(csv).toContain("\"'+2+5\"");
      expect(csv).toContain("\"'@SUM(1,2)\"");
    });

    it('accurately encodes Arabic, Unicode, and multi-byte characters in CSV output with UTF-8 BOM', () => {
      const arabicModel: ReportModel = {
        ...sampleModel,
        site: {
          ...sampleModel.site,
          name: 'متجر ووردبريس العربي التجريبي',
        },
        findings: [
          {
            ...sampleModel.findings[0],
            title: 'غياب شهادة التشفير الآمنة TLS',
            description: 'الموقع يعمل عبر بروتوكول غير مشفر مما يعرض البيانات للاعتراض.',
            remediation: 'قم بتثبيت شهادة SSL صالحة وتفعيل إعادة التوجيه إلى HTTPS.',
          },
        ],
      };

      const csv = generateCsvReport(arabicModel);
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('متجر ووردبريس العربي التجريبي');
      expect(csv).toContain('غياب شهادة التشفير الآمنة TLS');
      expect(csv).toContain('الموقع يعمل عبر بروتوكول غير مشفر');
      expect(csv).toContain('قم بتثبيت شهادة SSL صالحة');
    });

    it('exports 17 columns with causality, classification, observed value, and threshold for performance findings', () => {
      const perfFindingModel: ReportModel = {
        ...sampleModel,
        findings: [
          {
            id: 'f-perf-1',
            scanRunId: 'scan-1',
            ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
            category: 'static-performance',
            title: 'Server Latency Bottleneck',
            description: 'TTFB was 950ms exceeding 800ms.',
            severity: 'high',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: 'https://acme.test/',
            evidence: {
              classification: 'SERVER_LATENCY',
              causality: 'causal',
              primaryMetricName: 'TTFB',
              observedValue: 950,
              thresholdValue: 800,
              unit: 'ms',
            },
            remediation: 'Enable page caching.',
            references: [],
            createdAt: '2026-11-07T10:01:00.000Z',
          },
          {
            id: 'f-sec-2',
            scanRunId: 'scan-1',
            ruleId: 'SEC-NON-PERF',
            category: 'security',
            title: 'Missing Security Header',
            description: 'Standard security finding.',
            severity: 'low',
            confidence: 'confirmed',
            status: 'active',
            targetUrl: 'https://acme.test/',
            evidence: { header: 'missing' },
            remediation: 'Set header.',
            references: [],
            createdAt: '2026-11-07T10:01:00.000Z',
          },
        ],
      };

      const csv = generateCsvReport(perfFindingModel);
      const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
      expect(lines).toHaveLength(3); // header + 2 findings

      // Check header row: exactly 17 columns
      const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, ''));
      expect(headers).toHaveLength(17);
      expect(headers.slice(0, 13)).toEqual([
        'Report ID',
        'Scan Run ID',
        'Site Name',
        'Rule ID',
        'Severity',
        'Confidence',
        'Category',
        'Title',
        'Target URL',
        'Description',
        'Remediation',
        'Status',
        'Created At',
      ]);
      expect(headers.slice(13)).toEqual([
        'Causality',
        'Classification',
        'Observed Value',
        'Threshold',
      ]);

      // Check performance finding row (line 1)
      const perfRow = lines[1].split(',').map(c => c.replace(/^"|"$/g, ''));
      expect(perfRow).toHaveLength(17);
      expect(perfRow[3]).toBe('PERF_BOTTLENECK_DIAGNOSIS');
      expect(perfRow[13]).toBe('causal');
      expect(perfRow[14]).toBe('SERVER_LATENCY');
      expect(perfRow[15]).toBe('950 ms');
      expect(perfRow[16]).toBe('800 ms');

      // Check non-performance finding row (line 2)
      const nonPerfRow = lines[2].split(',').map(c => c.replace(/^"|"$/g, ''));
      expect(nonPerfRow).toHaveLength(17);
      expect(nonPerfRow[3]).toBe('SEC-NON-PERF');
      expect(nonPerfRow[13]).toBe(''); // Causality empty
      expect(nonPerfRow[14]).toBe(''); // Classification empty
      expect(nonPerfRow[15]).toBe(''); // Observed Value empty
      expect(nonPerfRow[16]).toBe(''); // Threshold empty
    });
  });

  describe('Performance Integration in Reports', () => {
    const performanceModel: ReportModel = {
      ...sampleModel,
      summary: {
        ...sampleModel.summary,
        performanceMetrics: {
          labMetrics: {
            ttfbMs: 320,
            fcpMs: 1200,
            lcpMs: 2800,
            cls: 0.15,
            tbtMs: 350,
            isLcpCapped: true,
            lcpElementUrl: 'https://acme.test/hero.jpg',
            lcpElementSelector: 'header > img.hero',
          },
          resourceSummary: {
            totalResources: 45,
            totalTransferSizeBytes: 1500000,
            renderBlockingCount: 3,
            scriptsCount: 15,
            stylesheetsCount: 8,
            imagesCount: 18,
            oversizedImagesCount: 2,
            uncompressedAssetsCount: 4,
          },
        },
      },
      findings: [
        {
          id: 'f-perf-1',
          scanRunId: 'scan-1',
          ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
          category: 'static-performance',
          title: 'Server Response Latency Bottleneck',
          description: 'Time to First Byte was 950ms.',
          severity: 'high',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://acme.test/',
          evidence: {
            classification: 'SERVER_LATENCY',
            causality: 'causal',
            primaryMetricName: 'TTFB',
            observedValue: 950,
            thresholdValue: 800,
            unit: 'ms',
            limitationsNotice: 'TTFB includes DNS transit.',
            inferenceRationale: 'Server latency delay verified.',
          },
          remediation: 'Enable page caching and CDN.',
          references: ['https://web.dev/articles/ttfb'],
          createdAt: '2026-11-07T10:01:00.000Z',
        },
        {
          id: 'f-perf-2',
          scanRunId: 'scan-1',
          ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
          category: 'static-performance',
          title: 'Heavy JavaScript Payload',
          description: 'Script payload is large.',
          severity: 'medium',
          confidence: 'potential',
          status: 'potential',
          targetUrl: 'https://acme.test/',
          evidence: {
            classification: 'HEAVY_ASSET_PAYLOAD',
            causality: 'correlational',
            primaryMetricName: 'Total Transfer',
            observedValue: 3500000,
            thresholdValue: 3145728,
            unit: 'bytes',
            limitationsNotice: 'Buffer saturation observed.',
          },
          remediation: 'Minify and bundle assets.',
          references: ['https://web.dev'],
          createdAt: '2026-11-07T10:01:00.000Z',
        },
      ],
    };

    it('renders Web Vitals laboratory metrics grid, lab disclaimer, and bottleneck cards in HTML report', () => {
      const html = generateHtmlReport(performanceModel);

      // Section Header & Lab Disclaimer
      expect(html).toContain('Laboratory Web Vitals &amp; Performance Diagnostics');
      expect(html).toContain('AUTOMATED CHROMIUM SESSION');
      expect(html).toContain('Laboratory Context &amp; Methodology Notice');
      expect(html).toContain('Interaction to Next Paint (INP)');

      // Web Vitals Metric Tiles
      expect(html).toContain('Time to First Byte (TTFB)');
      expect(html).toContain('320 ms');
      expect(html).toContain('GOOD');
      expect(html).toContain('First Contentful Paint (FCP)');
      expect(html).toContain('1200 ms');
      expect(html).toContain('Largest Contentful Paint (LCP)');
      expect(html).toContain('2800 ms');
      expect(html).toContain('NEEDS IMPROVEMENT');
      expect(html).toContain('Capped by 5,000ms deadline ceiling');
      expect(html).toContain('Cumulative Layout Shift (CLS)');
      expect(html).toContain('0.150');
      expect(html).toContain('Total Blocking Time (TBT)');
      expect(html).toContain('350 ms');

      // Page Resource Metrics
      expect(html).toContain('Page Resource Metrics');
      expect(html).toContain('1465 KB'); // 1500000 / 1024
      expect(html).toContain('15 / 8'); // scripts / stylesheets

      // Diagnosed Bottlenecks List
      expect(html).toContain('Diagnosed Bottlenecks (2)');
      expect(html).toContain('CAUSAL (PROVEN CAUSE)');
      expect(html).toContain('CORRELATIONAL (ASSOCIATED FACTOR)');
      expect(html).toContain('BOTTLENECK: SERVER_LATENCY');
      expect(html).toContain('BOTTLENECK: HEAVY_ASSET_PAYLOAD');

      // Finding Card Enrichment
      expect(html).toContain('Measurement Limitations');
      expect(html).toContain('TTFB includes DNS transit.');
      expect(html).toContain('Inference Rationale:');
      expect(html).toContain('Server latency delay verified.');
    });

    it('gracefully omits performance section for historical scans without performance telemetry', () => {
      const historicalModel: ReportModel = {
        ...sampleModel,
        summary: {
          ...sampleModel.summary,
          performanceMetrics: null,
        },
        findings: [
          {
            id: 'f-hist-1',
            scanRunId: 'scan-1',
            ruleId: 'SEC-HISTORICAL-1',
            category: 'security',
            title: 'Legacy Security Issue',
            description: 'Legacy finding from Phase 1.',
            severity: 'low',
            confidence: 'confirmed',
            status: 'active',
            targetUrl: 'https://acme.test/',
            evidence: null,
            remediation: 'Fix it.',
            references: [],
            createdAt: '2026-11-01T10:00:00.000Z',
          },
        ],
      };

      const html = generateHtmlReport(historicalModel);
      expect(html).not.toContain('Laboratory Web Vitals &amp; Performance Diagnostics');
      expect(html).not.toContain('class="perf-section"');
      expect(html).not.toContain('class="perf-metrics-grid"');
      expect(html).toContain('Legacy Security Issue');
    });

    it('preserves performance metrics in JSON report export', () => {
      const jsonStr = generateJsonReport(performanceModel);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.summary.performanceMetrics).toBeDefined();
      expect(parsed.summary.performanceMetrics.labMetrics.ttfbMs).toBe(320);
      expect(parsed.summary.performanceMetrics.labMetrics.lcpMs).toBe(2800);
      expect(parsed.summary.performanceMetrics.labMetrics.isLcpCapped).toBe(true);
      expect(parsed.findings[0].evidence.classification).toBe('SERVER_LATENCY');
      expect(parsed.findings[0].evidence.causality).toBe('causal');
      expect(parsed.findings[0].evidence.observedValue).toBe(950);
      expect(parsed.findings[1].evidence.classification).toBe('HEAVY_ASSET_PAYLOAD');
      expect(parsed.findings[1].evidence.causality).toBe('correlational');
    });
  });
});
