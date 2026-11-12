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
  });
});
