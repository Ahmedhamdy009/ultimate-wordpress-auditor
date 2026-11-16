import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import { AuditUiProvider } from '../../src/renderer/src/context/AuditUiContext.js';
import { AuditChartsGrid } from '../../src/renderer/src/components/dashboard/AuditChartsGrid.js';
import { PerformanceVitalsView } from '../../src/renderer/src/components/views/PerformanceVitalsView.js';
import { adaptScanRunForViewModel } from '../../src/renderer/src/utils/reportViewModelAdapter.js';
import {
  buildAuditChartSuite,
  type FindingDTO,
  type ScanRunDTO,
  type SiteDTO,
} from '@auditor/shared';

const SITE: SiteDTO = {
  id: 'site-charts-1',
  projectId: 'proj-charts-1',
  name: 'Charts Fixture Site',
  baseUrl: 'https://charts.example.test',
  platformType: 'wordpress',
  environmentType: 'staging',
  description: null,
  isArchived: false,
  createdAt: '2026-11-15T10:00:00.000Z',
  updatedAt: '2026-11-15T10:00:00.000Z',
};

const POPULATED_SCAN: ScanRunDTO = {
  id: 'scan-charts-populated',
  siteId: SITE.id,
  scanType: 'full',
  status: 'completed',
  targetUrl: 'https://charts.example.test',
  startedAt: '2026-11-15T10:00:00.000Z',
  completedAt: '2026-11-15T10:02:00.000Z',
  cancelledAt: null,
  durationMs: 120000,
  config: {
    enableBrowserAudit: true,
    auditModules: {
      http: true,
      wordpress: true,
      securityHeaders: true,
      cookies: true,
      seo: true,
      runtimeErrors: true,
      networkResources: true,
      responsiveLayout: true,
      layoutStability: true,
      screenshots: true,
      accessibility: true,
    },
  },
  summary: {
    totalFindings: 3,
    criticalCount: 1,
    highCount: 1,
    mediumCount: 1,
    lowCount: 0,
    infoCount: 0,
    urlsCrawled: 8,
    pagesScanned: 8,
    crawlFailedPages: 0,
    staticModulesExecuted: 5,
    staticModulesTotal: 5,
    browserPagesAudited: 4,
    browserCandidatesTotal: 4,
    runtimeAuditsCompleted: 4,
    accessibilityCandidatesTotal: 4,
    accessibilityAuditsCompleted: 4,
    layoutStabilityPagesCompleted: 4,
    screenshotsCaptured: 4,
    resourceBytesByType: {
      document: 45_000,
      script: 320_000,
      stylesheet: 110_000,
      image: 480_000,
      font: 95_000,
    },
    performanceMetrics: {
      labMetrics: {
        ttfbMs: 420,
        fcpMs: 1350,
        lcpMs: 3100,
        cls: 0.08,
        tbtMs: 240,
        isLcpCapped: true,
      },
      resourceSummary: {
        totalResources: 28,
        totalTransferSizeBytes: 1_050_000,
        renderBlockingCount: 3,
        scriptsCount: 10,
        stylesheetsCount: 5,
        imagesCount: 9,
        oversizedImagesCount: 2,
        uncompressedAssetsCount: 1,
      },
    },
  },
  error: null,
  createdAt: '2026-11-15T10:00:00.000Z',
  updatedAt: '2026-11-15T10:02:00.000Z',
};

const POPULATED_FINDINGS: readonly FindingDTO[] = [
  {
    id: 'f-crit-sec',
    scanRunId: POPULATED_SCAN.id,
    ruleId: 'SEC_HEADER_CSP_MISSING',
    category: 'security',
    title: 'Missing Content-Security-Policy Header',
    description: 'CSP header missing.',
    severity: 'critical',
    confidence: 'confirmed',
    status: 'confirmed',
    targetUrl: 'https://charts.example.test/checkout',
    evidence: { headerName: 'Content-Security-Policy' },
    remediation: 'Configure CSP.',
    references: [],
    createdAt: '2026-11-15T10:01:00.000Z',
  },
  {
    id: 'f-bottleneck',
    scanRunId: POPULATED_SCAN.id,
    ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
    category: 'static-performance',
    title: 'Render-Blocking Assets Bottleneck',
    description: 'Multiple render-blocking stylesheets and scripts.',
    severity: 'high',
    confidence: 'confirmed',
    status: 'confirmed',
    targetUrl: 'https://charts.example.test/',
    evidence: {
      classification: 'RENDER_BLOCKING_ASSETS',
      causality: 'causal',
      primaryMetricName: 'LCP',
      observedValue: 3100,
      thresholdValue: 2500,
      unit: 'ms',
    },
    remediation: 'Defer non-critical JS and inline critical CSS.',
    references: [],
    createdAt: '2026-11-15T10:01:10.000Z',
  },
  {
    id: 'f-sys-meta',
    scanRunId: POPULATED_SCAN.id,
    ruleId: 'SYS_META_INFO',
    category: 'system',
    title: 'System Meta Note',
    description: 'Internal meta note.',
    severity: 'info',
    confidence: 'confirmed',
    status: 'confirmed',
    targetUrl: 'https://charts.example.test/',
    evidence: null,
    remediation: null,
    references: [],
    createdAt: '2026-11-15T10:01:15.000Z',
  },
];

describe('Phase 7.4.4 Part B — Visual Analytics Charts & Performance Dashboard', () => {
  it('renders all 7 shared charts using exact buildAuditChartSuite numbers with zero recalculation', () => {
    const vm = adaptScanRunForViewModel({
      scanRun: POPULATED_SCAN,
      site: SITE,
      findings: POPULATED_FINDINGS,
      locale: 'en',
      viewMode: 'dual',
    });

    const directSuite = buildAuditChartSuite({
      scanType: POPULATED_SCAN.scanType,
      scanStatus: POPULATED_SCAN.status,
      config: POPULATED_SCAN.config,
      summary: POPULATED_SCAN.summary,
      findings: POPULATED_FINDINGS,
    });

    expect(vm.charts.severityDistribution.totalItems).toBe(
      directSuite.severityDistribution.totalItems,
    );
    expect(vm.charts.labVitals.hasMeasuredVitals).toBe(true);
    expect(vm.charts.assetBreakdown.mode).toBe('bytes_by_type');

    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(AuditChartsGrid, { viewModel: vm }),
        React.createElement(PerformanceVitalsView, {
          scanRun: POPULATED_SCAN,
          findings: POPULATED_FINDINGS,
        }),
      ),
    );

    // All 7 chart testids present
    expect(html).toContain('data-testid="chart-severity-distribution"');
    expect(html).toContain('data-testid="chart-category-breakdown"');
    expect(html).toContain('data-testid="chart-coverage-dimensions"');
    expect(html).toContain('data-testid="chart-lab-vitals"');
    expect(html).toContain('data-testid="chart-asset-breakdown"');
    expect(html).toContain('data-testid="chart-bottleneck-summary"');
    expect(html).toContain('data-testid="chart-top-affected-pages"');

    // Lab vs field distinction and explicit INP unsupported-in-lab handling
    expect(html).toContain('Lab Measurement Only — Not CrUX / Lighthouse');
    expect(html).toContain('Unsupported in passive lab audit (field-only metric)');
    expect(html).toContain('data-testid="vital-tile-inp"');
    expect(html).toContain('Capped at 5,000ms deadline ceiling');
    expect(html).toContain('RENDER_BLOCKING_ASSETS');
    expect(html).toContain('https://charts.example.test/checkout');
    expect(html).toContain('sys_meta_findings_excluded');
  });

  it('handles empty, unavailable, excluded, and counts-only partial datasets transparently', () => {
    const partialScan: ScanRunDTO = {
      ...POPULATED_SCAN,
      id: 'scan-charts-partial',
      status: 'failed',
      summary: {
        totalFindings: 1,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 1,
        pagesScanned: 2,
        performanceMetrics: {
          resourceSummary: {
            scriptsCount: 4,
            stylesheetsCount: 2,
            imagesCount: 3,
            oversizedImagesCount: 1,
          },
        },
      },
    };

    const resolvedOnlyFindings: readonly FindingDTO[] = [
      {
        ...POPULATED_FINDINGS[0],
        id: 'f-resolved-only',
        scanRunId: partialScan.id,
        status: 'resolved',
      },
    ];

    const vm = adaptScanRunForViewModel({
      scanRun: partialScan,
      site: SITE,
      findings: resolvedOnlyFindings,
      locale: 'en',
      viewMode: 'dual',
    });

    expect(vm.charts.severityDistribution.status).toBe('excluded');
    expect(vm.charts.assetBreakdown.mode).toBe('counts_and_flagged_only');

    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(AuditChartsGrid, { viewModel: vm }),
      ),
    );

    expect(html).toContain('Excluded from chart metric');
    expect(html).toContain('Exact byte-by-type telemetry was not recorded');
    expect(html).toContain('Metric data unavailable or not executed in this scan.');
  });

  it('renders Arabic RTL charts and PerformanceVitalsView with LTR isolation for URLs and values', () => {
    const arVm = adaptScanRunForViewModel({
      scanRun: POPULATED_SCAN,
      site: SITE,
      findings: POPULATED_FINDINGS,
      locale: 'ar',
      viewMode: 'dual',
    });

    const arHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'ar', initialViewMode: 'dual' },
        React.createElement(AuditChartsGrid, { viewModel: arVm }),
        React.createElement(PerformanceVitalsView, {
          scanRun: POPULATED_SCAN,
          findings: POPULATED_FINDINGS,
        }),
      ),
    );

    expect(arHtml).toContain('dir="rtl"');
    expect(arHtml).toContain('lang="ar"');
    expect(arHtml).toContain('توزيع درجات الخطورة');
    expect(arHtml).toContain('توزيع الملاحظات حسب الفئة');
    expect(arHtml).toContain('أبعاد تغطية الفحص (D1–D4)');
    expect(arHtml).toContain('قياسات الأداء المعملية (Web Vitals)');
    expect(arHtml).toContain('توزيع الأصول والموارد');
    expect(arHtml).toContain('ملخص اختناقات الأداء');
    expect(arHtml).toContain('أكثر الصفحات تأثراً');
    expect(arHtml).toContain('dir="ltr"');
  });
});
