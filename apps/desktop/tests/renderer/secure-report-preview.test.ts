import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import {
  SecureReportPreview,
  parseCsvForPreview,
  prepareSandboxedHtml,
  REPORT_PREVIEW_CSP,
} from '../../src/renderer/src/components/reports/SecureReportPreview.js';
import type { ReportDTO, ReportContentDTO } from '@auditor/shared';

describe('SecureReportPreview Component & Helper Suite', () => {
  const baseMockReport: ReportDTO = {
    id: 'rep-test-1111-2222',
    scanRunId: 'scan-test-1111-2222',
    title: 'Security Audit Report Alpha',
    format: 'html',
    status: 'generated',
    summary: { totalFindings: 10 },
    storagePath: 'D:\\ahmed\\reports\\alpha.html',
    createdAt: '2026-11-12T12:00:00.000Z',
    updatedAt: '2026-11-12T12:00:00.000Z',
  };

  describe('HTML Preview Sanitization & CSP Injection (prepareSandboxedHtml)', () => {
    it('injects authoritative CSP into document head', () => {
      const raw =
        '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Content</h1></body></html>';
      const prepared = prepareSandboxedHtml(raw);

      expect(prepared).toContain('http-equiv="Content-Security-Policy"');
      expect(prepared).toContain(REPORT_PREVIEW_CSP);
      expect(prepared).toContain("default-src 'none'");
      expect(prepared).toContain("style-src 'unsafe-inline'");
      expect(prepared).toContain('img-src data:');
      expect(prepared).toContain("font-src 'none'");
      expect(prepared).toContain("script-src 'none'");
      expect(prepared).toContain("connect-src 'none'");
      expect(prepared).toContain("frame-src 'none'");
    });

    it('strips existing adversary or legacy CSP meta tags before injecting authoritative policy', () => {
      const hostileHtml =
        '<!DOCTYPE html><html><head>' +
        '<meta http-equiv="Content-Security-Policy" content="default-src *; script-src * \'unsafe-inline\';">' +
        '<title>Hostile</title></head><body><script>alert(1)</script></body></html>';
      const prepared = prepareSandboxedHtml(hostileHtml);

      expect(prepared).not.toContain('default-src *');
      expect(prepared).not.toContain("script-src * 'unsafe-inline'");
      expect(prepared).toContain(REPORT_PREVIEW_CSP);
    });

    it('strips <base> tags to prevent relative URL hijacking', () => {
      const htmlWithBase =
        '<!DOCTYPE html><html><head><base href="https://attacker.com/sub/"></head><body><p>Text</p></body></html>';
      const prepared = prepareSandboxedHtml(htmlWithBase);

      expect(prepared).not.toContain('<base');
      expect(prepared).not.toContain('attacker.com');
      expect(prepared).toContain(REPORT_PREVIEW_CSP);
    });

    it('safely wraps HTML fragments lacking <html> or <head>', () => {
      const fragment = '<div class="card"><h3>Snippet Only</h3></div>';
      const prepared = prepareSandboxedHtml(fragment);

      expect(prepared).toContain('<!DOCTYPE html>');
      expect(prepared).toContain('<html>');
      expect(prepared).toContain('<head>');
      expect(prepared).toContain(REPORT_PREVIEW_CSP);
      expect(prepared).toContain('Snippet Only');
    });
  });

  describe('HTML Report Preview & Sandbox Security Boundary', () => {
    it('renders HTML report in an iframe with strict empty sandbox attribute and CSP', () => {
      const content: ReportContentDTO = {
        id: baseMockReport.id,
        format: 'html',
        content:
          '<!DOCTYPE html><html><head><title>Audit</title></head><body><h1>Report Findings</h1></body></html>',
        storagePath: baseMockReport.storagePath,
      };

      const html = renderComponentToHtml(
        React.createElement(SecureReportPreview, {
          report: baseMockReport,
          content,
          onClose: vi.fn(),
        }),
      );

      // Verify component container and card headers
      expect(html).toContain('data-testid="secure-report-preview"');
      expect(html).toContain('Report Preview: Security Audit Report Alpha');
      expect(html).toContain('Format: HTML');
      expect(html).toContain('Sandboxed Preview · Isolated');

      // Verify Security Boundary Advisory
      expect(html).toContain('Security Boundary:');
      expect(html).toContain('Report content is isolated from the desktop application shell');
      expect(html).toContain(
        'Scripts and external network calls are disabled via strict sandbox and Content Security Policy',
      );

      // Verify Iframe isolation attributes
      expect(html).toContain('data-testid="sandboxed-html-iframe"');
      expect(html).toContain('sandbox=""');
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain('default-src &#x27;none&#x27;;');

      // Strict security verification: ensure NO dangerous sandbox relaxation tokens exist
      expect(html).not.toContain('allow-scripts');
      expect(html).not.toContain('allow-same-origin');
      expect(html).not.toContain('allow-top-navigation');
      expect(html).not.toContain('allow-modals');
      expect(html).not.toContain('allow-popups');

      // Verify action buttons
      expect(html).toContain('Expand');
      expect(html).toContain('Close');
      expect(html).not.toContain('Copy to Clipboard');
    });

    it('retains strict sandbox and injects CSP even when report contains potential malicious payloads', () => {
      const maliciousPayload =
        '<!DOCTYPE html><html><body>' +
        '<script>alert("xss")</script>' +
        '<img src="x" onerror="fetch(\'http://evil.com\')" />' +
        '<a href="javascript:void(0)" onclick="parent.location=\'http://evil.com\'">Click me</a>' +
        '</body></html>';

      const content: ReportContentDTO = {
        id: baseMockReport.id,
        format: 'html',
        content: maliciousPayload,
        storagePath: baseMockReport.storagePath,
      };

      const html = renderComponentToHtml(
        React.createElement(SecureReportPreview, {
          report: baseMockReport,
          content,
          onClose: vi.fn(),
        }),
      );

      // Verify iframe sandbox and CSP attributes
      expect(html).toContain('sandbox=""');
      expect(html).not.toContain('allow-scripts');
      expect(html).not.toContain('allow-same-origin');
      expect(html).toContain('default-src &#x27;none&#x27;');
    });
  });

  describe('RFC 4180 CSV State-Machine Parser (parseCsvForPreview)', () => {
    it('handles quoted commas and unquoted standard fields', () => {
      const csv = 'Header1,Header2,Header3\n"Value, with, commas",StandardVal,Simple';
      const result = parseCsvForPreview(csv);

      expect(result.hasMalformedRecords).toBe(false);
      expect(result.headers).toEqual(['Header1', 'Header2', 'Header3']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual(['Value, with, commas', 'StandardVal', 'Simple']);
    });

    it('handles escaped double quotes ("") properly', () => {
      const csv = 'ColA,ColB\n"He said, ""Hello World!""",Followup';
      const result = parseCsvForPreview(csv);

      expect(result.hasMalformedRecords).toBe(false);
      expect(result.rows[0][0]).toBe('He said, "Hello World!"');
      expect(result.rows[0][1]).toBe('Followup');
    });

    it('handles CRLF (\\r\\n) and LF (\\n) line breaks consistently', () => {
      const csv = 'A,B\r\n1,2\n3,4\r\n5,6';
      const result = parseCsvForPreview(csv);

      expect(result.headers).toEqual(['A', 'B']);
      expect(result.rows).toEqual([
        ['1', '2'],
        ['3', '4'],
        ['5', '6'],
      ]);
    });

    it('correctly handles embedded newlines inside quoted fields without breaking records', () => {
      const csv =
        'ID,Description,Status\n' +
        '1,"Line 1\r\nLine 2\nLine 3",Active\n' +
        '2,"Single line description",Pending';
      const result = parseCsvForPreview(csv);

      expect(result.hasMalformedRecords).toBe(false);
      expect(result.headers).toEqual(['ID', 'Description', 'Status']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0][0]).toBe('1');
      expect(result.rows[0][1]).toBe('Line 1\r\nLine 2\nLine 3');
      expect(result.rows[0][2]).toBe('Active');
      expect(result.rows[1][0]).toBe('2');
      expect(result.rows[1][1]).toBe('Single line description');
      expect(result.rows[1][2]).toBe('Pending');
    });

    it('strips UTF-8 BOM from start of file', () => {
      const csv = '\uFEFFRule,Severity\nSEC-001,High';
      const result = parseCsvForPreview(csv);

      expect(result.headers[0]).toBe('Rule');
      expect(result.headers[0]).not.toContain('\uFEFF');
      expect(result.rows[0]).toEqual(['SEC-001', 'High']);
    });

    it('preserves empty fields and trailing empty fields correctly', () => {
      const csv = 'A,B,C,\n1,,3,\n,2,,\n';
      const result = parseCsvForPreview(csv);

      expect(result.headers).toEqual(['A', 'B', 'C', '']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(['1', '', '3', '']);
      expect(result.rows[1]).toEqual(['', '2', '', '']);
    });

    it('safely recovers from malformed records with unclosed quotes at EOF', () => {
      const csv = 'Header1,Header2\n1,"Unclosed quote at end of file';
      const result = parseCsvForPreview(csv);

      expect(result.hasMalformedRecords).toBe(true);
      expect(result.headers).toEqual(['Header1', 'Header2']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0][1]).toBe('Unclosed quote at end of file');
    });

    it('safely recovers from malformed records with unexpected characters after quote', () => {
      const csv = 'Header1,Header2\n"Quoted"Extra,Standard';
      const result = parseCsvForPreview(csv);

      expect(result.hasMalformedRecords).toBe(true);
      expect(result.rows[0][0]).toBe('QuotedExtra');
      expect(result.rows[0][1]).toBe('Standard');
    });

    it('preserves Arabic and Unicode content without corruption', () => {
      const csv =
        '\uFEFF"اسم الثغرة","مستوى الخطورة","الحالة","التفاصيل"\r\n' +
        '"حقن SQL عبر نموذج البحث","حرجة","مؤكدة","تم اكتشاف استجابة غير مشفرة تُظهر هيكل قاعدة البيانات \u{1F512}"\r\n' +
        '"غياب ترويسات الأمان","متوسطة","تحتاج مراجعة","غياب ترويسة Strict-Transport-Security"';

      const result = parseCsvForPreview(csv);

      expect(result.headers).toEqual(['اسم الثغرة', 'مستوى الخطورة', 'الحالة', 'التفاصيل']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0][0]).toBe('حقن SQL عبر نموذج البحث');
      expect(result.rows[0][1]).toBe('حرجة');
      expect(result.rows[0][3]).toContain('قاعدة البيانات');
      expect(result.rows[0][3]).toContain('\u{1F512}');
    });

    it('respects row limits without corrupting records containing embedded newlines', () => {
      let csv = 'ID,Data\n';
      for (let i = 1; i <= 150; i++) {
        csv += `${i},"Row ${i}\nWith Newline"\n`;
      }

      const result = parseCsvForPreview(csv, 10);
      expect(result.headers).toEqual(['ID', 'Data']);
      expect(result.rows).toHaveLength(10);
      expect(result.rows[0][1]).toBe('Row 1\nWith Newline');
      expect(result.rows[9][0]).toBe('10');
      expect(result.rows[9][1]).toBe('Row 10\nWith Newline');
    });
  });

  describe('CSV Report Preview Component Rendering', () => {
    const csvMockReport: ReportDTO = {
      ...baseMockReport,
      format: 'csv',
      title: 'Vulnerability Scan Export',
      storagePath: 'D:\\ahmed\\reports\\scan.csv',
    };

    it('renders structured tabular preview for CSV content with BOM handling', () => {
      const csvData =
        '\uFEFF"Rule ID","Severity","Category","Selector","Description"\r\n' +
        '"SEC-001","Critical","Security","input[type=password]","Insecure form transmission"\r\n' +
        '"PERF-002","Medium","Performance","img.hero","Missing explicit width and height"\r\n';

      const content: ReportContentDTO = {
        id: csvMockReport.id,
        format: 'csv',
        content: csvData,
        storagePath: csvMockReport.storagePath,
      };

      const html = renderComponentToHtml(
        React.createElement(SecureReportPreview, {
          report: csvMockReport,
          content,
          onClose: vi.fn(),
        }),
      );

      // Verify table and headers
      expect(html).toContain('data-testid="csv-table-preview"');
      expect(html).toContain('Rule ID');
      expect(html).toContain('Severity');
      expect(html).toContain('Category');
      expect(html).toContain('Selector');
      expect(html).toContain('Description');

      // Verify parsed rows
      expect(html).toContain('SEC-001');
      expect(html).toContain('Critical');
      expect(html).toContain('input[type=password]');
      expect(html).toContain('PERF-002');
      expect(html).toContain('Missing explicit width and height');

      // Verify CSV-specific actions
      expect(html).toContain('Copy to Clipboard');
      expect(html).toContain('View Raw CSV');
    });

    it('handles CSV with escaped quotes and commas inside quoted fields', () => {
      const complexCsv =
        'ID,Details,Notes\n' + '1,"Finding with, comma","He said, ""Verify this"" promptly"\n';

      const content: ReportContentDTO = {
        id: csvMockReport.id,
        format: 'csv',
        content: complexCsv,
        storagePath: csvMockReport.storagePath,
      };

      const html = renderComponentToHtml(
        React.createElement(SecureReportPreview, {
          report: csvMockReport,
          content,
          onClose: vi.fn(),
        }),
      );

      expect(html).toContain('Finding with, comma');
      expect(html).toContain('He said, &quot;Verify this&quot; promptly');
    });

    it('displays fallback message when CSV has headers but no data rows', () => {
      const emptyCsv = 'ID,Rule,Status\n';

      const content: ReportContentDTO = {
        id: csvMockReport.id,
        format: 'csv',
        content: emptyCsv,
        storagePath: csvMockReport.storagePath,
      };

      const html = renderComponentToHtml(
        React.createElement(SecureReportPreview, {
          report: csvMockReport,
          content,
          onClose: vi.fn(),
        }),
      );

      expect(html).toContain('No data rows in CSV export.');
    });

    it('displays malformed warning badge when CSV has malformed quotes', () => {
      const malformedCsv = 'ID,Name\n1,"Unclosed field at EOF';

      const content: ReportContentDTO = {
        id: csvMockReport.id,
        format: 'csv',
        content: malformedCsv,
        storagePath: csvMockReport.storagePath,
      };

      const html = renderComponentToHtml(
        React.createElement(SecureReportPreview, {
          report: csvMockReport,
          content,
          onClose: vi.fn(),
        }),
      );

      expect(html).toContain('Malformed CSV records detected and safely recovered');
    });
  });

  describe('JSON Report Preview', () => {
    const jsonMockReport: ReportDTO = {
      ...baseMockReport,
      format: 'json',
      title: 'Full Audit Machine Export',
      storagePath: 'D:\\ahmed\\reports\\audit.json',
    };

    it('renders formatted JSON in a preformatted code block', () => {
      const jsonContent = JSON.stringify(
        {
          version: '0.1.7',
          scanId: 'scan-1234',
          findings: [{ id: 'F-1', ruleId: 'SEC-001', severity: 'critical' }],
        },
        null,
        2,
      );

      const content: ReportContentDTO = {
        id: jsonMockReport.id,
        format: 'json',
        content: jsonContent,
        storagePath: jsonMockReport.storagePath,
      };

      const html = renderComponentToHtml(
        React.createElement(SecureReportPreview, {
          report: jsonMockReport,
          content,
          onClose: vi.fn(),
        }),
      );

      // Verify code block rendering
      expect(html).toContain('data-testid="raw-content-preview"');
      expect(html).toContain('&quot;scanId&quot;: &quot;scan-1234&quot;');
      expect(html).toContain('&quot;severity&quot;: &quot;critical&quot;');

      // Verify controls
      expect(html).toContain('Copy to Clipboard');
      expect(html).not.toContain('View Raw CSV');
    });
  });
});
