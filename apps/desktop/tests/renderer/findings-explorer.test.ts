import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import { AuditUiProvider } from '../../src/renderer/src/context/AuditUiContext.js';
import {
  FindingsExplorer,
  filterAndSortRecommendations,
} from '../../src/renderer/src/components/dashboard/FindingsExplorer.js';
import { adaptScanRunForViewModel } from '../../src/renderer/src/utils/reportViewModelAdapter.js';
import type { FindingDTO, ScanRunDTO, SiteDTO, VisualEvidenceEntryDTO } from '@auditor/shared';

const GENERIC_SITE: SiteDTO = {
  id: 'site-generic-c',
  projectId: 'proj-c',
  name: 'Plain Non-WP Site',
  baseUrl: 'https://plain.example.test',
  platformType: 'generic',
  environmentType: 'production',
  description: null,
  isArchived: false,
  createdAt: '2026-11-15T10:00:00.000Z',
  updatedAt: '2026-11-15T10:00:00.000Z',
};

const SCAN_C: ScanRunDTO = {
  id: 'scan-findings-c',
  siteId: GENERIC_SITE.id,
  scanType: 'full',
  status: 'completed',
  targetUrl: 'https://plain.example.test',
  startedAt: '2026-11-15T10:00:00.000Z',
  completedAt: '2026-11-15T10:02:00.000Z',
  cancelledAt: null,
  durationMs: 120000,
  config: { enableBrowserAudit: true },
  summary: {
    totalFindings: 4,
    criticalCount: 0,
    highCount: 2,
    mediumCount: 1,
    lowCount: 1,
    infoCount: 0,
    urlsCrawled: 5,
    pagesScanned: 5,
    crawlFailedPages: 0,
    browserPagesAudited: 3,
    browserCandidatesTotal: 3,
  },
  error: null,
  createdAt: '2026-11-15T10:00:00.000Z',
  updatedAt: '2026-11-15T10:02:00.000Z',
};

const FINDINGS_C: readonly FindingDTO[] = [
  {
    id: 'find-csp-1',
    scanRunId: SCAN_C.id,
    ruleId: 'SEC_HEADER_CSP_MISSING',
    category: 'security',
    title: 'Missing Content-Security-Policy Header',
    description: 'CSP header missing on home.',
    severity: 'high',
    confidence: 'confirmed',
    status: 'confirmed',
    targetUrl: 'https://plain.example.test/',
    evidence: { headerName: 'Content-Security-Policy' },
    remediation: 'Add CSP header.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP'],
    createdAt: '2026-11-15T10:01:00.000Z',
  },
  {
    id: 'find-csp-2',
    scanRunId: SCAN_C.id,
    ruleId: 'SEC_HEADER_CSP_MISSING',
    category: 'security',
    title: 'Missing Content-Security-Policy Header',
    description: 'CSP header missing on pricing.',
    severity: 'high',
    confidence: 'confirmed',
    status: 'confirmed',
    targetUrl: 'https://plain.example.test/pricing',
    evidence: { headerName: 'Content-Security-Policy' },
    remediation: 'Add CSP header.',
    references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP'],
    createdAt: '2026-11-15T10:01:02.000Z',
  },
  {
    id: 'find-overflow-1',
    scanRunId: SCAN_C.id,
    ruleId: 'RESPONSIVE_HORIZONTAL_OVERFLOW',
    category: 'responsive-design',
    title: 'Horizontal Overflow on Mobile',
    description: 'Container overflows viewport.',
    severity: 'medium',
    confidence: 'firm',
    status: 'confirmed',
    targetUrl: 'https://plain.example.test/pricing',
    evidence: {
      selector: '.pricing-grid-wrapper',
      screenshot: {
        id: 'shot-overflow-1',
        fileName: 'shot-overflow-1.png',
        viewportProfile: 'mobile',
        captureType: 'viewport',
      },
    },
    remediation: 'Fix overflow.',
    references: [],
    createdAt: '2026-11-15T10:01:05.000Z',
  },
  {
    id: 'find-a11y-1',
    scanRunId: SCAN_C.id,
    ruleId: 'a11y-color-contrast',
    category: 'accessibility',
    title: 'Color Contrast Needs Manual Review',
    description: 'Contrast against gradient.',
    severity: 'low',
    confidence: 'potential',
    status: 'needs_manual_review',
    targetUrl: 'https://plain.example.test/',
    evidence: { selector: '.hero-cta-button' },
    remediation: 'Increase contrast.',
    references: [],
    createdAt: '2026-11-15T10:01:10.000Z',
  },
];

const VISUAL_EVIDENCE_C: Readonly<Record<string, VisualEvidenceEntryDTO>> = {
  'shot-overflow-1.png': {
    fileName: 'shot-overflow-1.png',
    byteLength: 12_288,
    embedded: true,
    mimeType: 'image/png',
    dataUri:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    viewport: 'mobile',
    captureType: 'viewport',
    pageUrl: 'https://plain.example.test/pricing',
  },
};

describe('Phase 7.4.4 Part C — Interactive Findings & Recommendations Explorer', () => {
  it('consolidates repeated findings without duplicates and preserves original IDs, evidence, and screenshots', () => {
    const vm = adaptScanRunForViewModel({
      scanRun: SCAN_C,
      site: GENERIC_SITE,
      findings: FINDINGS_C,
      locale: 'en',
      viewMode: 'dual',
    });

    // Two SEC_HEADER_CSP_MISSING findings consolidate into 1 recommendation card with occurrenceCount=2
    expect(vm.recommendations).toHaveLength(3);
    const cspRec = vm.recommendations.find(r => r.ruleId === 'SEC_HEADER_CSP_MISSING')!;
    expect(cspRec.occurrenceCount).toBe(2);
    expect(cspRec.preservedOriginalFinding.findingIds).toEqual(['find-csp-1', 'find-csp-2']);
    // Evidence-gated: non-WordPress site must NOT receive WordPress/Elementor/WooCommerce guidance
    expect(cspRec.platformGuidance).toHaveLength(0);

    const allIds = vm.recommendations.map(r => r.recommendationId);
    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(FindingsExplorer, {
          viewModel: vm,
          visualEvidence: VISUAL_EVIDENCE_C,
          initialExpandedIds: allIds,
        }),
      ),
    );

    expect(html).toContain('data-testid="findings-explorer"');
    expect(html).toContain('SEC_HEADER_CSP_MISSING');
    expect(html).toContain('find-csp-1, find-csp-2');
    expect(html).toContain('.pricing-grid-wrapper');
    expect(html).toContain('.hero-cta-button');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('Open Full Preview');
    // Strictly no auto-remediation
    expect(html.toLowerCase()).not.toContain('auto-fix');
    expect(html.toLowerCase()).not.toContain('apply fix automatically');
  });

  it('filters, searches, and sorts recommendations without mutating original view-model array or objects', () => {
    const vm = adaptScanRunForViewModel({
      scanRun: SCAN_C,
      site: GENERIC_SITE,
      findings: FINDINGS_C,
      locale: 'en',
      viewMode: 'dual',
    });

    const snapshotBefore = JSON.stringify(vm.recommendations);

    // Search by CSS selector
    const bySelector = filterAndSortRecommendations(vm.recommendations, {
      searchQuery: '.hero-cta-button',
      severityFilter: 'all',
      categoryFilter: 'all',
      classificationFilter: 'all',
      hasScreenshotOnly: false,
      sortBy: 'severity_desc',
    });
    expect(bySelector).toHaveLength(1);
    expect(bySelector[0].ruleId).toBe('a11y-color-contrast');

    // Filter by hasScreenshotOnly
    const withScreenshot = filterAndSortRecommendations(vm.recommendations, {
      searchQuery: '',
      severityFilter: 'all',
      categoryFilter: 'all',
      classificationFilter: 'all',
      hasScreenshotOnly: true,
      sortBy: 'severity_desc',
    });
    expect(withScreenshot).toHaveLength(1);
    expect(withScreenshot[0].ruleId).toBe('RESPONSIVE_HORIZONTAL_OVERFLOW');

    // Filter by needs_manual_review
    const manualReview = filterAndSortRecommendations(vm.recommendations, {
      searchQuery: '',
      severityFilter: 'all',
      categoryFilter: 'all',
      classificationFilter: 'needs_manual_review',
      hasScreenshotOnly: false,
      sortBy: 'severity_desc',
    });
    expect(manualReview).toHaveLength(1);
    expect(manualReview[0].originalStatus).toBe('needs_manual_review');

    // Sort by severity ascending
    const sevAsc = filterAndSortRecommendations(vm.recommendations, {
      searchQuery: '',
      severityFilter: 'all',
      categoryFilter: 'all',
      classificationFilter: 'all',
      hasScreenshotOnly: false,
      sortBy: 'severity_asc',
    });
    expect(sevAsc.map(r => r.severity)).toEqual(['low', 'medium', 'high']);

    // Original recommendations remain completely unmutated
    expect(JSON.stringify(vm.recommendations)).toBe(snapshotBefore);
  });

  it('respects Simple vs Technical vs Dual audience modes without deleting underlying evidence', () => {
    const simpleVm = adaptScanRunForViewModel({
      scanRun: SCAN_C,
      site: GENERIC_SITE,
      findings: FINDINGS_C,
      locale: 'en',
      viewMode: 'simple',
    });
    const techVm = adaptScanRunForViewModel({
      scanRun: SCAN_C,
      site: GENERIC_SITE,
      findings: FINDINGS_C,
      locale: 'en',
      viewMode: 'technical',
    });

    const simpleIds = simpleVm.recommendations.map(r => r.recommendationId);
    const simpleHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'simple' },
        React.createElement(FindingsExplorer, {
          viewModel: simpleVm,
          visualEvidence: VISUAL_EVIDENCE_C,
          initialExpandedIds: simpleIds,
        }),
      ),
    );

    // Simple hides technical raw evidence & code blocks & CSS selectors
    expect(simpleHtml).not.toContain('data-testid="technical-code-examples"');
    expect(simpleHtml).not.toContain('technical-raw-evidence-');
    expect(simpleHtml).not.toContain('.pricing-grid-wrapper');
    // Underlying preservedOriginalFinding stays intact in simpleVm
    expect(simpleVm.recommendations[0].preservedOriginalFinding.findingIds.length).toBeGreaterThan(
      0,
    );

    const techIds = techVm.recommendations.map(r => r.recommendationId);
    const techHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'technical' },
        React.createElement(FindingsExplorer, {
          viewModel: techVm,
          visualEvidence: VISUAL_EVIDENCE_C,
          initialExpandedIds: techIds,
        }),
      ),
    );

    expect(techHtml).toContain('technical-raw-evidence-');
    expect(techHtml).toContain('SEC_HEADER_CSP_MISSING');
    expect(techHtml).toContain('.pricing-grid-wrapper');
  });

  it('renders unavailable screenshot fallback honestly when screenshot file is missing on disk', () => {
    const vm = adaptScanRunForViewModel({
      scanRun: SCAN_C,
      site: GENERIC_SITE,
      findings: FINDINGS_C,
      locale: 'en',
      viewMode: 'dual',
    });
    const allIds = vm.recommendations.map(r => r.recommendationId);

    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(FindingsExplorer, {
          viewModel: vm,
          visualEvidence: {
            'shot-overflow-1.png': {
              fileName: 'shot-overflow-1.png',
              byteLength: 0,
              embedded: false,
              omittedReason: 'Visual preview unavailable: screenshot file missing on disk.',
            },
          },
          initialExpandedIds: allIds,
        }),
      ),
    );

    expect(html).toContain('Visual preview unavailable: screenshot file missing on disk.');
    expect(html).not.toContain('data:image/png;base64,');
  });

  it('renders Arabic RTL FindingsExplorer with LTR technical identifier isolation', () => {
    const arVm = adaptScanRunForViewModel({
      scanRun: SCAN_C,
      site: GENERIC_SITE,
      findings: FINDINGS_C,
      locale: 'ar',
      viewMode: 'dual',
    });
    const allIds = arVm.recommendations.map(r => r.recommendationId);

    const arHtml = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'ar', initialViewMode: 'dual' },
        React.createElement(FindingsExplorer, {
          viewModel: arVm,
          visualEvidence: VISUAL_EVIDENCE_C,
          initialExpandedIds: allIds,
        }),
      ),
    );

    expect(arHtml).toContain('dir="rtl"');
    expect(arHtml).toContain('lang="ar"');
    expect(arHtml).toContain('الملاحظات وإرشادات المعالجة العملية');
    expect(arHtml).toContain('خطوات المعالجة المرتبة');
    expect(arHtml).toContain('dir="ltr"');
  });
});
