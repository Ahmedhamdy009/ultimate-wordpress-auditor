import { describe, expect, it } from 'vitest';
import {
  buildReportViewModel,
  consolidateFindings,
  type EnrichableFindingInput,
  type FindingDTO,
} from '../../src/index.js';

const SAMPLE_FINDINGS: readonly EnrichableFindingInput[] = [
  {
    id: 'f-sec-csp',
    ruleId: 'SEC_HEADER_CSP_MISSING',
    category: 'security',
    title: 'Missing Content-Security-Policy',
    description: 'No CSP header returned on main document.',
    severity: 'high',
    confidence: 'confirmed',
    status: 'confirmed',
    targetUrl: 'https://shop.example.com/',
    evidence: {
      headerName: 'Content-Security-Policy',
      headers: { server: 'nginx', 'cf-ray': 'abc-CAI' },
    },
  },
  {
    id: 'f-wp',
    ruleId: 'WP_DETECTED',
    category: 'wordpress',
    title: 'WordPress Detected',
    description: 'WordPress CMS markers found.',
    severity: 'info',
    confidence: 'confirmed',
    status: 'confirmed',
    targetUrl: 'https://shop.example.com/',
    evidence: {
      confidence: 'confirmed',
      version: '6.7.2',
      plugins: ['elementor-pro', 'woocommerce'],
      themes: ['hello-elementor'],
    },
  },
  {
    id: 'f-a11y',
    ruleId: 'a11y-color-contrast',
    category: 'accessibility',
    title: 'Insufficient Color Contrast',
    description: 'Contrast ratio 2.8:1 detected.',
    severity: 'medium',
    confidence: 'potential',
    status: 'needs_manual_review',
    targetUrl: 'https://shop.example.com/checkout',
    evidence: {
      nodes: [{ target: ['.checkout-submit-btn'] }],
      reviewReason: 'Gradient overlay background detected.',
    },
  },
];

describe('Bilingual Report View-Models (EN/AR, Simple/Technical/Dual)', () => {
  it('generates full English LTR and Arabic RTL view-models with zero translation fallbacks and LTR technical isolation', () => {
    const baseInput = {
      generatedAt: '2026-05-01T10:00:00.000Z',
      site: {
        id: 'site-1',
        name: 'Shop Demo',
        baseUrl: 'https://shop.example.com',
        platformType: 'wordpress',
        environmentType: 'staging',
      },
      scanRun: {
        id: 'run-1',
        scanType: 'full',
        status: 'completed',
        targetUrl: 'https://shop.example.com',
        urlsCrawled: 10,
        pagesScanned: 10,
        crawlFailedPages: 0,
        staticPagesExpected: 10,
        staticPagesCompleted: 10,
        browserPagesAudited: 5,
        browserCandidatesTotal: 5,
        browserFailedPages: 0,
        a11yPagesExpected: 5,
        a11yPagesCompleted: 5,
        clsPagesExpected: 5,
        clsPagesCompleted: 5,
      },
      findings: SAMPLE_FINDINGS,
    };

    const enVm = buildReportViewModel({ ...baseInput, locale: 'en', viewMode: 'dual' });
    const arVm = buildReportViewModel({ ...baseInput, locale: 'ar', viewMode: 'dual' });

    expect(enVm.locale).toBe('en');
    expect(enVm.direction).toBe('ltr');
    expect(enVm.localizationMeta.fallbackTranslationCount).toBe(0);

    expect(arVm.locale).toBe('ar');
    expect(arVm.direction).toBe('rtl');
    expect(arVm.technicalTextDirection).toBe('ltr');
    expect(arVm.localizationMeta.fallbackTranslationCount).toBe(0);

    // Technical selectors, headers, URLs, ruleIds, and snippets remain untranslated & identical across locales
    expect(arVm.recommendations.map(r => r.ruleId)).toEqual(
      enVm.recommendations.map(r => r.ruleId),
    );

    const arContrast = arVm.recommendations.find(r => r.ruleId === 'a11y-color-contrast')!;
    const enContrast = enVm.recommendations.find(r => r.ruleId === 'a11y-color-contrast')!;
    expect(arContrast.exactLocation.selectors).toEqual(['.checkout-submit-btn']);
    expect(arContrast.exactLocation.selectors).toEqual(enContrast.exactLocation.selectors);
    expect(arContrast.technicalTextDirection).toBe('ltr');
    expect(arContrast.effectiveCauseConfidence).toBe('needs_manual_review');
    expect(arContrast.confirmedCauses).toEqual([]);

    const arCsp = arVm.recommendations.find(r => r.ruleId === 'SEC_HEADER_CSP_MISSING')!;
    expect(arCsp.codeExamples.length).toBeGreaterThan(0);
    expect(arCsp.codeExamples[0].direction).toBe('ltr');
    expect(arCsp.codeExamples[0].snippet).toContain('Content-Security-Policy-Report-Only');
  });

  it('switches cleanly across simple, technical, and dual modes without dropping raw findings or evidence', () => {
    const input = {
      generatedAt: '2026-05-01T10:00:00.000Z',
      site: { name: 'Demo', baseUrl: 'https://shop.example.com', platformType: 'wordpress' },
      scanRun: {
        status: 'completed',
        urlsCrawled: 4,
        pagesScanned: 4,
        crawlFailedPages: 0,
      },
      findings: SAMPLE_FINDINGS,
    };

    const simpleVm = buildReportViewModel({ ...input, locale: 'en', viewMode: 'simple' });
    const techVm = buildReportViewModel({ ...input, locale: 'en', viewMode: 'technical' });
    const dualVm = buildReportViewModel({ ...input, locale: 'en', viewMode: 'dual' });

    const sCsp = simpleVm.recommendations.find(r => r.ruleId === 'SEC_HEADER_CSP_MISSING')!;
    const tCsp = techVm.recommendations.find(r => r.ruleId === 'SEC_HEADER_CSP_MISSING')!;
    const dCsp = dualVm.recommendations.find(r => r.ruleId === 'SEC_HEADER_CSP_MISSING')!;

    expect(sCsp.problem.simpleText).toBeDefined();
    expect(sCsp.problem.technicalText).toBeUndefined();
    expect(sCsp.technicalDetailsVisibility).toBe('collapsed');

    expect(tCsp.problem.technicalText).toBeDefined();
    expect(tCsp.problem.simpleText).toBeUndefined();
    expect(tCsp.technicalDetailsVisibility).toBe('expanded');

    expect(dCsp.problem.simpleText).toBe(sCsp.problem.simpleText);
    expect(dCsp.problem.technicalText).toBe(tCsp.problem.technicalText);

    // Crucial integrity invariant: Simple mode never mutates, deletes, or weakens preserved raw evidence or severity/confidence
    expect(sCsp.preservedOriginalFinding).toEqual(tCsp.preservedOriginalFinding);
    expect(sCsp.exactLocation).toEqual(tCsp.exactLocation);
    expect(sCsp.severity).toBe('high');
    expect(sCsp.originalConfidence).toBe('confirmed');
  });

  it('supports consolidated findings, historical incomplete scans, and deterministic repeated output', () => {
    const now = '2026-05-01T12:00:00.000Z';
    const rawFindingRows: FindingDTO[] = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        scanRunId: '00000000-0000-4000-8000-000000000099',
        ruleId: 'SEO_TITLE_MISSING',
        category: 'seo',
        title: 'Missing Title',
        description: 'Page title missing',
        severity: 'high',
        confidence: 'confirmed',
        status: 'active',
        targetUrl: 'https://legacy.example.com/p1',
        evidence: null,
        remediation: 'Add title',
        references: [],
        createdAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        scanRunId: '00000000-0000-4000-8000-000000000099',
        ruleId: 'SEO_TITLE_MISSING',
        category: 'seo',
        title: 'Missing Title',
        description: 'Page title missing',
        severity: 'high',
        confidence: 'confirmed',
        status: 'active',
        targetUrl: 'https://legacy.example.com/p2',
        evidence: null,
        remediation: 'Add title',
        references: [],
        createdAt: now,
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        scanRunId: '00000000-0000-4000-8000-000000000099',
        ruleId: 'SYS_BROWSER_UNAVAILABLE',
        category: 'system',
        title: 'Browser Unavailable',
        description: 'Playwright browser launch failed',
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://legacy.example.com/',
        evidence: null,
        remediation: null,
        references: [],
        createdAt: now,
      },
    ];

    const consolidated = consolidateFindings(rawFindingRows);
    const vm1 = buildReportViewModel({
      locale: 'ar',
      viewMode: 'dual',
      generatedAt: now,
      site: { name: 'Legacy', baseUrl: 'https://legacy.example.com' },
      scanRun: {
        status: 'completed_partial',
        // Historical omission of urlsCrawled / crawlFailedPages
        pagesScanned: 2,
        pagesFailed: 1,
        isPartialAudit: true,
      },
      findings: consolidated,
    });
    const vm2 = buildReportViewModel({
      locale: 'ar',
      viewMode: 'dual',
      generatedAt: now,
      site: { name: 'Legacy', baseUrl: 'https://legacy.example.com' },
      scanRun: {
        status: 'completed_partial',
        pagesScanned: 2,
        pagesFailed: 1,
        isPartialAudit: true,
      },
      findings: consolidated,
    });

    expect(vm1).toEqual(vm2);
    expect(vm1.localizationMeta.fallbackTranslationCount).toBe(0);
    expect(vm1.executiveSummary.totalRawFindings).toBe(3);
    expect(vm1.executiveSummary.uniqueRecommendationsCount).toBe(2);
    expect(vm1.executiveSummary.deduplicatedCount).toBe(1);
    const titleRec = vm1.recommendations.find(r => r.ruleId === 'SEO_TITLE_MISSING')!;
    expect(titleRec.occurrenceCount).toBe(2);
    expect(titleRec.exactLocation.urls).toEqual([
      'https://legacy.example.com/p1',
      'https://legacy.example.com/p2',
    ]);
    expect(vm1.healthOverview.telemetryReasons.length).toBeGreaterThan(0);
  });
});
