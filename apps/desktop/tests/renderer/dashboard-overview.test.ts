import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderComponentToHtml, renderTestHook } from '../helpers/react-test-harness.js';
import { AuditUiProvider } from '../../src/renderer/src/context/AuditUiContext.js';
import {
  ExecutiveSummaryCard,
  CoverageDimensionsPanel,
} from '../../src/renderer/src/components/dashboard/index.js';
import { OverviewView } from '../../src/renderer/src/components/views/OverviewView.js';
import { ScansView } from '../../src/renderer/src/components/views/ScansView.js';
import { useScans } from '../../src/renderer/src/hooks/useScans.js';
import {
  adaptScanRunForViewModel,
  extractDimensionTelemetryCounts,
} from '../../src/renderer/src/utils/reportViewModelAdapter.js';
import {
  evaluateAuditHealthTriad,
  type AppSystemInfoResponse,
  type FindingDTO,
  type ProjectDTO,
  type ScanRunDTO,
  type SiteDTO,
} from '@auditor/shared';

const MOCK_SYSTEM_INFO: AppSystemInfoResponse = {
  appVersion: '0.1.7',
  electronVersion: '44.10.2',
  chromeVersion: '152.0.7977.169',
  nodeVersion: '24.22.2',
  platform: 'win32',
  arch: 'x64',
};

const MOCK_PROJECT: ProjectDTO = {
  id: 'proj-744a',
  name: 'Client Storefront',
  description: null,
  isArchived: false,
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
};

const MOCK_SITE: SiteDTO = {
  id: 'site-744a',
  projectId: MOCK_PROJECT.id,
  name: 'Acme WP Shop',
  baseUrl: 'https://shop.example.test',
  platformType: 'wordpress',
  environmentType: 'staging',
  description: null,
  isArchived: false,
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
};

const FULL_SCAN: ScanRunDTO = {
  id: 'scan-full-744a',
  siteId: MOCK_SITE.id,
  scanType: 'full',
  status: 'completed',
  targetUrl: 'https://shop.example.test',
  startedAt: '2026-11-15T10:00:00.000Z',
  completedAt: '2026-11-15T10:02:00.000Z',
  cancelledAt: null,
  durationMs: 120000,
  config: {
    maxPages: 25,
    maxDepth: 3,
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
    totalFindings: 2,
    criticalCount: 0,
    highCount: 1,
    mediumCount: 0,
    lowCount: 0,
    infoCount: 1,
    urlsCrawled: 10,
    pagesScanned: 10,
    crawlFailedPages: 0,
    staticModulesExecuted: 5,
    staticModulesTotal: 5,
    browserPagesAudited: 5,
    browserCandidatesTotal: 5,
    runtimeAuditsCompleted: 5,
    accessibilityCandidatesTotal: 5,
    accessibilityAuditsCompleted: 5,
    layoutStabilityPagesCompleted: 5,
    screenshotsCaptured: 5,
    coverageStatus: 'full',
    isPartialCoverage: false,
  },
  error: null,
  createdAt: '2026-11-15T10:00:00.000Z',
  updatedAt: '2026-11-15T10:02:00.000Z',
};

const SAMPLE_FINDINGS: readonly FindingDTO[] = [
  {
    id: 'find-csp-1',
    scanRunId: FULL_SCAN.id,
    ruleId: 'SEC_HEADER_CSP_MISSING',
    category: 'security',
    title: 'Missing Content-Security-Policy Header',
    description: 'CSP header is absent.',
    severity: 'high',
    confidence: 'confirmed',
    status: 'confirmed',
    targetUrl: 'https://shop.example.test/',
    evidence: { headerName: 'Content-Security-Policy', headers: { server: 'nginx' } },
    remediation: 'Add CSP header.',
    references: [],
    createdAt: '2026-11-15T10:01:00.000Z',
  },
  {
    id: 'find-wp-1',
    scanRunId: FULL_SCAN.id,
    ruleId: 'WP_DETECTED',
    category: 'wordpress',
    title: 'WordPress Detected',
    description: 'WordPress 6.7.2 with Elementor Pro & WooCommerce detected.',
    severity: 'info',
    confidence: 'confirmed',
    status: 'confirmed',
    targetUrl: 'https://shop.example.test/',
    evidence: {
      confidence: 'confirmed',
      version: '6.7.2',
      plugins: ['elementor-pro', 'woocommerce'],
      themes: ['hello-elementor'],
    },
    remediation: null,
    references: [],
    createdAt: '2026-11-15T10:01:05.000Z',
  },
];

describe('Phase 7.4.4 Part A — Dashboard Data Integration & Executive Overview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).electronAPI;
  });

  it('adapts persisted ScanRunDTO using shared evaluateAuditHealthTriad with zero duplicate calculations and strict scanRunId isolation', () => {
    const staleOtherScanFinding: FindingDTO = {
      ...SAMPLE_FINDINGS[0],
      id: 'stale-other-scan-finding',
      scanRunId: 'other-scan-id-999',
      ruleId: 'SEC_CRITICAL_STALE',
      severity: 'critical',
    };

    const vm = adaptScanRunForViewModel({
      scanRun: FULL_SCAN,
      site: MOCK_SITE,
      findings: [...SAMPLE_FINDINGS, staleOtherScanFinding],
      locale: 'en',
      viewMode: 'dual',
    });

    const directTriad = evaluateAuditHealthTriad({
      scanType: FULL_SCAN.scanType,
      scanStatus: FULL_SCAN.status,
      config: FULL_SCAN.config,
      summary: FULL_SCAN.summary,
      findings: SAMPLE_FINDINGS,
    });

    expect(vm.healthOverview.healthIndexScore).toBe(directTriad.healthIndex);
    expect(vm.healthOverview.coveragePercent).toBe(directTriad.coverage.auditCoverage);
    expect(vm.healthOverview.confidenceScore).toBe(directTriad.confidence.auditConfidence);
    expect(vm.healthOverview.healthBand).toBe(directTriad.healthBand.bandId);
    expect(vm.executiveSummary.totalRawFindings).toBe(2);
    expect(vm.detectedStack.isWordPress).toBe(true);
    expect(vm.detectedStack.isElementorPro).toBe(true);
    expect(vm.detectedStack.isWooCommerce).toBe(true);
  });

  it('renders ExecutiveSummaryCard & independent D1–D4 CoverageDimensionsPanel accurately in English and Arabic', () => {
    const enVm = adaptScanRunForViewModel({
      scanRun: FULL_SCAN,
      site: MOCK_SITE,
      findings: SAMPLE_FINDINGS,
      locale: 'en',
      viewMode: 'dual',
    });

    const enHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(ExecutiveSummaryCard, { viewModel: enVm }),
        React.createElement(CoverageDimensionsPanel, { viewModel: enVm, scanRun: FULL_SCAN }),
      ),
    );

    expect(enHtml).toContain('data-testid="executive-summary-dashboard"');
    expect(enHtml).toContain('data-testid="triad-health-index"');
    expect(enHtml).toContain(`${enVm.healthOverview.healthIndexScore}/100`);
    expect(enHtml).toContain(`${enVm.healthOverview.coveragePercent}%`);
    expect(enHtml).toContain(`${enVm.healthOverview.confidenceScore}%`);
    expect(enHtml).toContain('data-testid="coverage-dimension-d1"');
    expect(enHtml).toContain('data-testid="coverage-dimension-d2"');
    expect(enHtml).toContain('data-testid="coverage-dimension-d3"');
    expect(enHtml).toContain('data-testid="coverage-dimension-d4"');
    expect(enHtml).toContain('Elementor Pro');
    expect(enHtml).toContain('WooCommerce');
    expect(enHtml).toContain('hello-elementor');
    expect(enHtml).toContain('Measurement Scope &amp; Limitations');

    const arVm = adaptScanRunForViewModel({
      scanRun: FULL_SCAN,
      site: MOCK_SITE,
      findings: SAMPLE_FINDINGS,
      locale: 'ar',
      viewMode: 'dual',
    });

    const arHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'ar', initialViewMode: 'dual' },
        React.createElement(ExecutiveSummaryCard, { viewModel: arVm }),
        React.createElement(CoverageDimensionsPanel, { viewModel: arVm, scanRun: FULL_SCAN }),
      ),
    );

    expect(arHtml).toContain('dir="rtl"');
    expect(arHtml).toContain('lang="ar"');
    expect(arHtml).toContain('الملخص التنفيذي');
    expect(arHtml).toContain('تفصيل أبعاد التغطية');
    expect(arHtml).toContain('D1 — تغطية الزحف والوصول إلى الصفحات');
  });

  it('handles historical scans with missing telemetry safely without showing unexecuted checks as successful or assuming WordPress', () => {
    const genericSite: SiteDTO = {
      ...MOCK_SITE,
      id: 'site-generic',
      name: 'Plain Static Site',
      platformType: 'generic',
    };
    const historicalScan: ScanRunDTO = {
      id: 'scan-hist-missing',
      siteId: genericSite.id,
      scanType: 'full',
      status: 'cancelled',
      targetUrl: 'https://plain.example.test',
      startedAt: '2026-10-01T08:00:00.000Z',
      completedAt: null,
      cancelledAt: '2026-10-01T08:00:15.000Z',
      durationMs: 15000,
      config: {},
      summary: null,
      error: {
        code: 'ERR_SCAN_CANCELLED',
        message: 'Cancelled by user',
      },
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:15.000Z',
    };

    const vm = adaptScanRunForViewModel({
      scanRun: historicalScan,
      site: genericSite,
      findings: [],
      locale: 'en',
      viewMode: 'dual',
    });

    expect(vm.healthOverview.healthIndexScore).toBeNull();
    expect(vm.healthOverview.healthBand).toBe('insufficient_evidence');
    expect(vm.detectedStack.isWordPress).toBe(false);
    expect(vm.detectedStack.isElementor).toBe(false);
    expect(vm.detectedStack.isWooCommerce).toBe(false);

    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(ExecutiveSummaryCard, { viewModel: vm }),
        React.createElement(CoverageDimensionsPanel, { viewModel: vm, scanRun: historicalScan }),
      ),
    );

    expect(html).toContain('Unavailable');
    expect(html).toContain('Insufficient Evidence');
    expect(html).toContain('No CMS, page builder, or infrastructure stack markers were confirmed');
    expect(html).toContain('d1_missing_denominator_units');

    const d1Counts = extractDimensionTelemetryCounts(
      historicalScan,
      vm.healthOverview.dimensions[0],
    );
    expect(d1Counts.executed).toBeNull();
    expect(d1Counts.eligible).toBeNull();
  });

  it('prevents stale findings from appearing under another selected scan in useScans', async () => {
    const scanA = FULL_SCAN;
    const scanB: ScanRunDTO = {
      ...FULL_SCAN,
      id: 'scan-b-744a',
      targetUrl: 'https://other.example.test',
    };

    let resolveScanB!: (val: unknown) => void;
    const pendingScanBPromise = new Promise(resolve => {
      resolveScanB = resolve;
    });

    const listFindingsMock = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: { items: SAMPLE_FINDINGS, total: 2, limit: 500, offset: 0 },
      })
      .mockReturnValueOnce(pendingScanBPromise);

    const mockApi = {
      listScanRuns: vi.fn().mockResolvedValue({
        success: true,
        data: { items: [scanA, scanB], total: 2, limit: 50, offset: 0 },
      }),
      listFindings: listFindingsMock,
    };
    (globalThis as Record<string, unknown>).electronAPI = mockApi;

    const harness = await renderTestHook(() => useScans({ autoLoad: false }));
    await harness.mount();

    await harness.act(async () => {
      await harness.result.current.selectScan(scanA.id);
    });
    expect(harness.result.current.selectedScanId).toBe(scanA.id);
    expect(harness.result.current.findingsScanId).toBe(scanA.id);
    expect(harness.result.current.findings).toHaveLength(2);

    // Begin switching to scanB before scanB finishes loading
    let selectBPromise!: Promise<void>;
    await harness.act(async () => {
      selectBPromise = harness.result.current.selectScan(scanB.id);
    });

    // While scanB is loading, scanA findings MUST NOT remain visible under scanB
    expect(harness.result.current.selectedScanId).toBe(scanB.id);
    expect(harness.result.current.findings).toHaveLength(0);
    expect(harness.result.current.findingsScanId).toBeNull();

    await harness.act(async () => {
      resolveScanB({
        success: true,
        data: {
          items: [
            {
              ...SAMPLE_FINDINGS[0],
              id: 'find-scan-b-only',
              scanRunId: scanB.id,
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
        },
      });
      await selectBPromise;
    });

    expect(harness.result.current.findingsScanId).toBe(scanB.id);
    expect(harness.result.current.findings).toHaveLength(1);
    expect(harness.result.current.findings[0].id).toBe('find-scan-b-only');

    await harness.unmount();
  });

  it('renders ExecutiveSummaryCard and CoverageDimensionsPanel inside OverviewView and ScansView', () => {
    const overviewHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        null,
        React.createElement(OverviewView, {
          onNavigate: vi.fn(),
          systemInfo: MOCK_SYSTEM_INFO,
          initialProjects: [MOCK_PROJECT],
          initialSites: [MOCK_SITE],
          initialScans: [FULL_SCAN],
          initialSelectedScanFindings: SAMPLE_FINDINGS,
        }),
      ),
    );
    expect(overviewHtml).toContain('data-testid="executive-summary-dashboard"');
    expect(overviewHtml).toContain('data-testid="coverage-dimensions-panel"');

    const scansHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        null,
        React.createElement(ScansView, {
          initialScans: [FULL_SCAN],
          initialScanRunId: FULL_SCAN.id,
          initialSelectedScanFindings: SAMPLE_FINDINGS,
        }),
      ),
    );
    expect(scansHtml).toContain('data-testid="executive-summary-dashboard"');
    expect(scansHtml).toContain('data-testid="coverage-dimensions-panel"');
  });
});
