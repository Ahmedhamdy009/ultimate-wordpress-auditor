import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import { SecureReportPreview } from '../../src/renderer/src/components/reports/SecureReportPreview.js';
import type { ReportDTO, ReportContentDTO } from '@auditor/shared';

describe('SecureReportPreview Component Suite', () => {
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

  describe('HTML Report Preview & Sandbox Security Boundary', () => {
    it('renders HTML report in an iframe with strict empty sandbox attribute', () => {
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
      expect(html).toContain('Scripts and external network calls are disabled');

      // Verify Iframe isolation attributes
      expect(html).toContain('data-testid="sandboxed-html-iframe"');
      expect(html).toContain('sandbox=""');

      // Strict security verification: ensure NO dangerous sandbox relaxation tokens exist
      expect(html).not.toContain('allow-scripts');
      expect(html).not.toContain('allow-same-origin');
      expect(html).not.toContain('allow-top-navigation');
      expect(html).not.toContain('allow-modals');
      expect(html).not.toContain('allow-popups');

      // Verify action buttons
      expect(html).toContain('Expand');
      expect(html).toContain('Close');
      // For HTML, raw copy button is omitted
      expect(html).not.toContain('Copy to Clipboard');
    });

    it('retains strict sandbox even when report contains potential malicious payloads', () => {
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

      // Verify iframe sandbox remains strictly empty
      expect(html).toContain('sandbox=""');
      expect(html).not.toContain('allow-scripts');
      expect(html).not.toContain('allow-same-origin');
    });
  });

  describe('CSV Report Preview & Tabular Parsing', () => {
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
          version: '0.1.6',
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
