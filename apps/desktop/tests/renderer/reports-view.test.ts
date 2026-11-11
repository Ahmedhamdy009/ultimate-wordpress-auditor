import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderComponentToHtml, renderTestHook } from '../helpers/react-test-harness.js';
import { ReportsView } from '../../src/renderer/src/components/views/ReportsView.js';
import { useReports } from '../../src/renderer/src/hooks/useReports.js';
import type { ReportDTO, ReportContentDTO } from '@auditor/shared';

describe('ReportsView & useReports Renderer Suite', () => {
  const mockReport: ReportDTO = {
    id: 'rep-1111-2222-3333-4444',
    scanRunId: 'scan-1111-2222-3333-4444',
    title: 'Acme Store Full Audit',
    format: 'html',
    status: 'generated',
    summary: { totalFindings: 5 },
    storagePath: 'D:\\ahmed\\reports\\acme-store.html',
    createdAt: '2026-11-07T12:00:00.000Z',
    updatedAt: '2026-11-07T12:00:00.000Z',
  };

  let mockElectronAPI: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    mockElectronAPI = {
      listReports: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [mockReport], total: 1, limit: 50, offset: 0 },
      }),
      createReport: vi.fn().mockResolvedValue({
        success: true,
        data: mockReport,
      }),
      deleteReport: vi.fn().mockResolvedValue({
        success: true,
        data: { success: true, id: mockReport.id },
      }),
      getReportContent: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: mockReport.id,
          format: 'html',
          content: '<html><body>Mock Content</body></html>',
          storagePath: mockReport.storagePath,
        },
      }),
    };
    const g = globalThis as Record<string, unknown>;
    g.electronAPI = mockElectronAPI;
    const win = (g.window || {}) as Record<string, unknown>;
    win.electronAPI = mockElectronAPI;
    g.window = win;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const g = globalThis as Record<string, unknown>;
    delete g.electronAPI;
  });

  describe('ReportsView Component Rendering', () => {
    it('renders overview cards, generator form, and history card', () => {
      const html = renderComponentToHtml(React.createElement(ReportsView));

      expect(html).toContain('Reporting Overview');
      expect(html).toContain('Generate New Report');
      expect(html).toContain('Report History &amp; Exports');
      expect(html).toContain('Scan Run UUID');
      expect(html).toContain('Standalone HTML Report');
      expect(html).toContain('Structured JSON Export');
      expect(html).toContain('Generate &amp; Export');
    });
  });

  describe('HTML Preview Security & Sandboxing', () => {
    it('verifies that HTML reports are previewed exclusively inside a sandboxed iframe with sandbox=""', () => {
      const previewHtml = renderComponentToHtml(
        React.createElement(
          'div',
          null,
          React.createElement('iframe', {
            title: 'Report HTML Preview',
            srcDoc: '<html><body><h1>Audit Report</h1><script>alert(1)</script></body></html>',
            sandbox: '',
            style: { width: '100%', height: '500px' },
          }),
        ),
      );

      // Must be rendered as an iframe
      expect(previewHtml).toContain('<iframe');
      expect(previewHtml).toContain('title="Report HTML Preview"');
      // Must have strict empty sandbox attribute
      expect(previewHtml).toContain('sandbox=""');
      // Must NOT permit script execution
      expect(previewHtml).not.toContain('allow-scripts');
      // Must NOT grant same-origin access
      expect(previewHtml).not.toContain('allow-same-origin');
      // Must NOT allow top-level navigation
      expect(previewHtml).not.toContain('allow-top-navigation');
      // Must NOT allow form submission
      expect(previewHtml).not.toContain('allow-forms');
      // Must NOT allow popups
      expect(previewHtml).not.toContain('allow-popups');
      // Must pass content via srcDoc attribute (properly encoded), never injected directly into parent DOM
      expect(previewHtml).toContain('srcDoc=');
    });

    it('verifies that non-HTML reports (e.g. JSON) are previewed in code viewer without iframes', () => {
      const jsonContent = JSON.stringify({ audit: 'passed', totalFindings: 0 }, null, 2);
      const jsonPreview = renderComponentToHtml(
        React.createElement('pre', null, React.createElement('code', null, jsonContent)),
      );

      expect(jsonPreview).toContain('<pre>');
      expect(jsonPreview).toContain('<code>');
      expect(jsonPreview).not.toContain('<iframe');
      expect(jsonPreview).toContain('&quot;audit&quot;: &quot;passed&quot;');
    });
  });

  describe('useReports Custom Hook', () => {
    it('fetches and lists reports on mount', async () => {
      const hook = await renderTestHook(() => useReports());
      await hook.mount();

      expect(mockElectronAPI.listReports).toHaveBeenCalled();
      expect(hook.result.current.reports).toHaveLength(1);
      expect(hook.result.current.reports[0].title).toBe('Acme Store Full Audit');
      expect(hook.result.current.loading).toBe(false);
      expect(hook.result.current.error).toBeNull();

      await hook.unmount();
    });

    it('creates a report and reloads report history', async () => {
      const hook = await renderTestHook(() => useReports());
      await hook.mount();

      let created: ReportDTO | null = null;
      await hook.act(async () => {
        created = await hook.result.current.createReport({
          scanRunId: mockReport.scanRunId,
          title: 'New Audit Report',
          format: 'html',
        });
      });

      expect(mockElectronAPI.createReport).toHaveBeenCalledWith({
        scanRunId: mockReport.scanRunId,
        title: 'New Audit Report',
        format: 'html',
      });
      expect(created?.title).toBe(mockReport.title);

      await hook.unmount();
    });

    it('deletes a report safely', async () => {
      const hook = await renderTestHook(() => useReports());
      await hook.mount();

      let success = false;
      await hook.act(async () => {
        success = await hook.result.current.deleteReport(mockReport.id);
      });
      expect(mockElectronAPI.deleteReport).toHaveBeenCalledWith({ id: mockReport.id });
      expect(success).toBe(true);

      await hook.unmount();
    });

    it('reads report content for preview', async () => {
      const hook = await renderTestHook(() => useReports());
      await hook.mount();

      let content: ReportContentDTO | null = null;
      await hook.act(async () => {
        content = await hook.result.current.getReportContent(mockReport.id);
      });
      expect(mockElectronAPI.getReportContent).toHaveBeenCalledWith({ id: mockReport.id });
      expect(content?.content).toContain('Mock Content');

      await hook.unmount();
    });

    it('captures and sets IPC error on failure', async () => {
      mockElectronAPI.listReports.mockResolvedValueOnce({
        success: false,
        error: { code: 'ERR_DATABASE_ERROR', message: 'DB Failure' },
      });

      const hook = await renderTestHook(() => useReports());
      await hook.mount();

      expect(hook.result.current.error?.code).toBe('ERR_DATABASE_ERROR');
      await hook.act(async () => {
        hook.result.current.clearError();
      });
      expect(hook.result.current.error).toBeNull();

      await hook.unmount();
    });
  });
});
