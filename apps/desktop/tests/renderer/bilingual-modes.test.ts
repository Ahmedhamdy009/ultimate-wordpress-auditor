import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import { AuditUiProvider } from '../../src/renderer/src/context/AuditUiContext.js';
import { HeartbeatProvider } from '../../src/renderer/src/context/HeartbeatContext.js';
import { AppShell } from '../../src/renderer/src/components/layout/AppShell.js';
import { ReportsView } from '../../src/renderer/src/components/views/ReportsView.js';

describe('Phase 7.4.4 Part D — Bilingual RTL/LTR, Audience Modes & Reports Integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  it('renders AppShell, Header controls, and Sidebar in English LTR and Arabic RTL', () => {
    const enHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(
          HeartbeatProvider,
          { enabled: false },
          React.createElement(
            AppShell,
            {
              activeView: 'scans',
              activeViewTitle: 'Audit & Scans',
              onSelectView: vi.fn(),
              systemInfo: null,
              connected: true,
              latencyMs: 5,
            },
            React.createElement('div', null, 'Content'),
          ),
        ),
      ),
    );

    expect(enHtml).toContain('dir="ltr"');
    expect(enHtml).toContain('lang="en"');
    expect(enHtml).toContain('data-testid="locale-switcher"');
    expect(enHtml).toContain('data-testid="viewmode-switcher"');
    expect(enHtml).toContain('Simple');
    expect(enHtml).toContain('Technical');
    expect(enHtml).toContain('Dual');

    const arHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'ar', initialViewMode: 'simple' },
        React.createElement(
          HeartbeatProvider,
          { enabled: false },
          React.createElement(
            AppShell,
            {
              activeView: 'scans',
              activeViewTitle: 'Audit & Scans',
              onSelectView: vi.fn(),
              systemInfo: null,
              connected: true,
              latencyMs: 5,
            },
            React.createElement('div', null, 'Content'),
          ),
        ),
      ),
    );

    expect(arHtml).toContain('dir="rtl"');
    expect(arHtml).toContain('lang="ar"');
    expect(arHtml).toContain('نظرة عامة');
    expect(arHtml).toContain('الفحوصات والتدقيق');
    expect(arHtml).toContain('مبسط');
    expect(arHtml).toContain('تقني');
    expect(arHtml).toContain('مزدوج');
  });

  it('exposes report language and view mode controls in ReportsView synchronized with AuditUiProvider', () => {
    (globalThis as Record<string, unknown>).electronAPI = {
      listReports: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [], total: 0, limit: 50, offset: 0 },
      }),
      listScanRuns: vi.fn().mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: '11111111-1111-4111-8111-111111111101',
              siteId: '22222222-2222-4222-8222-222222222201',
              scanType: 'full',
              status: 'completed',
              targetUrl: 'https://example.test',
              completedAt: '2026-11-15T10:00:00.000Z',
              summary: { totalFindings: 1 },
            },
          ],
          total: 1,
          limit: 100,
          offset: 0,
        },
      }),
      listProjects: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [], total: 0, limit: 100, offset: 0 },
      }),
    };

    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'ar', initialViewMode: 'technical' },
        React.createElement(ReportsView, {
          initialScanRunId: '11111111-1111-4111-8111-111111111101',
        }),
      ),
    );

    expect(html).toContain('لغة التقرير');
    expect(html).toContain('وضع عرض التقرير');
    expect(html).toContain('العربية (RTL)');
  });
});
