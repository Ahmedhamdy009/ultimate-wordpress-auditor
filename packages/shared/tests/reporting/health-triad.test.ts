import { describe, expect, it } from 'vitest';
import {
  classifyHealthBand,
  evaluateAuditConfidence,
  evaluateAuditCoverage,
  evaluateAuditHealthTriad,
  evaluateExecutedCheckEligibility,
  hasActiveConfirmedCriticalFinding,
  resolveEffectiveFindingClassification,
  type HealthAnalyticsFindingInput,
} from '../../src/index.js';

function makeFinding(
  overrides: Partial<HealthAnalyticsFindingInput> = {},
): HealthAnalyticsFindingInput {
  return {
    id: overrides.id ?? 'f-1',
    ruleId: overrides.ruleId ?? 'SEC_HSTS_MISSING',
    category: overrides.category ?? 'security_headers',
    severity: overrides.severity ?? 'medium',
    confidence: overrides.confidence ?? 'confirmed',
    status: overrides.status ?? 'active',
    targetUrl: overrides.targetUrl ?? 'https://example.com/',
    ...overrides,
  };
}

describe('Health Index, D2–D4 Independence, Audit Confidence & Health Band Precedence', () => {
  describe('Eligibility Gate (hasEligibleExecutedChecks)', () => {
    it('returns null HealthIndex and insufficient_evidence when completed engines have 0 checks and only SYS_BROWSER_UNAVAILABLE', () => {
      const triad = evaluateAuditHealthTriad({
        scanType: 'full',
        scanStatus: 'completed',
        config: { enableBrowserAudit: true },
        completedEngines: ['crawler', 'analyzers', 'browser'],
        summary: {
          urlsCrawled: 0,
          pagesScanned: 0,
          crawlFailedPages: 0,
          staticPagesAnalyzed: 0,
          staticModulesExecuted: 0,
          browserPagesAudited: 0,
          viewportsCompleted: 0,
          screenshotsCaptured: 0,
        },
        findings: [
          makeFinding({
            ruleId: 'SYS_BROWSER_UNAVAILABLE',
            category: 'system',
            severity: 'critical',
            confidence: 'confirmed',
            status: 'confirmed',
          }),
        ],
      });
      expect(triad.healthBreakdown.hasEligibleExecutedChecks).toBe(false);
      expect(triad.healthIndex).toBeNull();
      expect(triad.healthBand.bandId).toBe('insufficient_evidence');
      expect(triad.coverage.auditCoverage).toBe(0);
      expect(triad.confidence.confidenceBand).toBe('insufficient');
    });

    it('retains valid HealthIndex when pagesScanned = 0 yet valid target HTTP/TLS/robots findings exist', () => {
      const triad = evaluateAuditHealthTriad({
        scanType: 'full',
        scanStatus: 'completed',
        config: { enableBrowserAudit: false },
        completedEngines: ['crawler', 'analyzers'],
        summary: {
          urlsCrawled: 1,
          pagesScanned: 0,
          crawlFailedPages: 1,
          staticModulesExecuted: 2,
          staticModulesTotal: 5,
        },
        findings: [
          makeFinding({
            ruleId: 'HTTP_MAIN_DOCUMENT_5XX',
            category: 'http',
            severity: 'high',
            confidence: 'confirmed',
            status: 'active',
          }),
        ],
      });
      expect(triad.healthBreakdown.hasEligibleExecutedChecks).toBe(true);
      expect(triad.healthIndex).toBe(90);
      // full + !enableBrowserAudit caps healthy at provisional_incomplete_scan
      expect(triad.healthBand.bandId).toBe('provisional_incomplete_scan');
      expect(triad.healthBand.isProvisional).toBe(true);
    });
  });

  describe('Finding Confidence Precedence & Anti-Promotion Guard', () => {
    it('enforces Priority 1 excluded_lifecycle (0.0), Priority 2 provisional (0.5), Priority 3 confirmed_or_firm (1.0)', () => {
      expect(resolveEffectiveFindingClassification('fixed', 'confirmed')).toEqual({
        classification: 'excluded_lifecycle',
        multiplier: 0,
      });
      expect(resolveEffectiveFindingClassification('resolved', 'high')).toEqual({
        classification: 'excluded_lifecycle',
        multiplier: 0,
      });
      expect(resolveEffectiveFindingClassification('false_positive', 'confirmed')).toEqual({
        classification: 'excluded_lifecycle',
        multiplier: 0,
      });
      expect(resolveEffectiveFindingClassification('ignored', 'confirmed')).toEqual({
        classification: 'excluded_lifecycle',
        multiplier: 0,
      });
      expect(resolveEffectiveFindingClassification('accepted_risk', 'firm')).toEqual({
        classification: 'excluded_lifecycle',
        multiplier: 0,
      });

      // Contradictory confirmed/potential and needs_manual_review/confirmed MUST stay provisional (0.5)
      expect(resolveEffectiveFindingClassification('confirmed', 'potential').multiplier).toBe(0.5);
      expect(resolveEffectiveFindingClassification('active', null).multiplier).toBe(0.5);
      expect(resolveEffectiveFindingClassification('active', '').multiplier).toBe(0.5);
      expect(
        resolveEffectiveFindingClassification('needs_manual_review', 'confirmed').multiplier,
      ).toBe(0.5);
      expect(resolveEffectiveFindingClassification('potential', 'confirmed').multiplier).toBe(0.5);

      // Priority 3: active/confirmed/retest_required + confirmed/firm/high
      expect(resolveEffectiveFindingClassification('active', 'confirmed')).toEqual({
        classification: 'confirmed_or_firm',
        multiplier: 1,
      });
      expect(resolveEffectiveFindingClassification('retest_required', 'firm')).toEqual({
        classification: 'confirmed_or_firm',
        multiplier: 1,
      });
      expect(resolveEffectiveFindingClassification('confirmed', 'high')).toEqual({
        classification: 'confirmed_or_firm',
        multiplier: 1,
      });
    });

    it('excludes SYS_* and system findings from hasActiveConfirmedCriticalFinding()', () => {
      expect(
        hasActiveConfirmedCriticalFinding([
          makeFinding({
            ruleId: 'SYS_BROWSER_UNAVAILABLE',
            category: 'system',
            severity: 'critical',
            status: 'confirmed',
            confidence: 'confirmed',
          }),
        ]),
      ).toBe(false);

      expect(
        hasActiveConfirmedCriticalFinding([
          makeFinding({
            ruleId: 'SEC_SQL_ERROR_DISCLOSURE',
            category: 'security',
            severity: 'critical',
            status: 'active',
            confidence: 'confirmed',
          }),
        ]),
      ).toBe(true);
    });
  });

  describe('Health Index Breadth Multiplier, Category Caps & Lab Vitals Anti-Double-Counting', () => {
    it('scales affected-page breadth monotonically up to 1.5x rule cap and raises category cap from 40 to 60 on critical', () => {
      const repeatedFindings = Array.from({ length: 10 }, (_, idx) =>
        makeFinding({
          id: `h-${idx}`,
          ruleId: 'SEO_IMG_ALT_MISSING',
          category: 'technical-seo',
          severity: 'high',
          confidence: 'confirmed',
          status: 'active',
          targetUrl: `https://example.com/page-${idx}`,
        }),
      );
      const singlePage = evaluateAuditHealthTriad({
        scanType: 'seo',
        config: { enableBrowserAudit: false },
        summary: {
          urlsCrawled: 10,
          pagesScanned: 10,
          crawlFailedPages: 0,
          staticModulesExecuted: 3,
          staticModulesTotal: 3,
        },
        findings: [repeatedFindings[0]!],
      });
      const multiPage = evaluateAuditHealthTriad({
        scanType: 'seo',
        config: { enableBrowserAudit: false },
        summary: {
          urlsCrawled: 10,
          pagesScanned: 10,
          crawlFailedPages: 0,
          staticModulesExecuted: 3,
          staticModulesTotal: 3,
        },
        findings: repeatedFindings,
      });
      expect(singlePage.healthBreakdown.confirmedDeductionPoints).toBe(10);
      expect(multiPage.healthBreakdown.confirmedDeductionPoints).toBe(15); // 10 * 1.5x breadth cap

      // Many distinct rules in one category hit the 40 cap (or 60 when confirmed critical present)
      const capTestHighOnly = evaluateAuditHealthTriad({
        scanType: 'seo',
        config: { enableBrowserAudit: false },
        summary: {
          urlsCrawled: 10,
          pagesScanned: 10,
          crawlFailedPages: 0,
          staticModulesExecuted: 3,
          staticModulesTotal: 3,
        },
        findings: Array.from({ length: 6 }, (_, i) =>
          makeFinding({
            id: `cap-${i}`,
            ruleId: `SEO_RULE_${i}`,
            category: 'technical-seo',
            severity: 'high',
            confidence: 'confirmed',
            status: 'active',
          }),
        ),
      });
      expect(capTestHighOnly.healthBreakdown.totalDeductionPoints).toBe(40);
      expect(capTestHighOnly.healthBreakdown.categoryPenalties['technical-seo']).toBe(40);

      const capTestWithCritical = evaluateAuditHealthTriad({
        scanType: 'seo',
        config: { enableBrowserAudit: false },
        summary: {
          urlsCrawled: 10,
          pagesScanned: 10,
          crawlFailedPages: 0,
          staticModulesExecuted: 3,
          staticModulesTotal: 3,
        },
        findings: [
          makeFinding({
            id: 'cap-crit',
            ruleId: 'SEO_CRITICAL_BLOCKER',
            category: 'technical-seo',
            severity: 'critical',
            confidence: 'confirmed',
            status: 'active',
          }),
          ...Array.from({ length: 5 }, (_, i) =>
            makeFinding({
              id: `cap-c-${i}`,
              ruleId: `SEO_RULE_${i}`,
              category: 'technical-seo',
              severity: 'high',
              confidence: 'confirmed',
              status: 'active',
            }),
          ),
        ],
      });
      expect(capTestWithCritical.healthBreakdown.totalDeductionPoints).toBe(60);
      expect(capTestWithCritical.healthBreakdown.categoryPenalties['technical-seo']).toBe(60);
    });

    it('avoids double counting lab vitals when matching PERF_LAB_* finding is already present', () => {
      const perfSummary = {
        labMetrics: { ttfbMs: 2500, fcpMs: 1200, lcpMs: 4500, cls: 0.05, tbtMs: 100 },
      };
      const withoutPerfFindings = evaluateAuditHealthTriad({
        scanType: 'performance',
        config: { enableBrowserAudit: true },
        summary: {
          urlsCrawled: 1,
          pagesScanned: 1,
          crawlFailedPages: 0,
          browserCandidatesTotal: 1,
          browserPagesAudited: 1,
          layoutStabilityPagesCompleted: 1,
          performanceMetrics: perfSummary,
        },
        findings: [],
      });
      // Fallback deducts 5 for poor TTFB + 5 for poor LCP = 10
      expect(withoutPerfFindings.healthBreakdown.fallbackLabPenaltyPoints).toBe(10);

      const withMatchingLcpFinding = evaluateAuditHealthTriad({
        scanType: 'performance',
        config: { enableBrowserAudit: true },
        summary: {
          urlsCrawled: 1,
          pagesScanned: 1,
          crawlFailedPages: 0,
          browserCandidatesTotal: 1,
          browserPagesAudited: 1,
          layoutStabilityPagesCompleted: 1,
          performanceMetrics: perfSummary,
        },
        findings: [
          makeFinding({
            ruleId: 'PERF_LAB_SLOW_LCP',
            category: 'performance',
            severity: 'high',
            confidence: 'confirmed',
            status: 'active',
          }),
        ],
      });
      // Only TTFB fallback remains (5 pts); LCP not double counted
      expect(withMatchingLcpFinding.healthBreakdown.fallbackLabPenaltyPoints).toBe(5);
    });
  });

  describe('D3 Accessibility & D4 Layout Stability Independence', () => {
    it('evaluates D3 accessibility strictly at 0/5, 2/5 (never promoted to 1.0), and 5/5 independently of runtimeAuditsCompleted', () => {
      const base = {
        scanType: 'accessibility' as const,
        scanStatus: 'completed' as const,
        config: {
          enableBrowserAudit: true,
          auditModules: { runtimeErrors: false, accessibility: true },
        },
      };
      const cov0 = evaluateAuditCoverage({
        ...base,
        summary: {
          urlsCrawled: 5,
          pagesScanned: 5,
          crawlFailedPages: 0,
          browserCandidatesTotal: 5,
          browserPagesAudited: 5,
          accessibilityCandidatesTotal: 5,
          accessibilityAuditsCompleted: 0,
        },
      });
      expect(cov0.dimensions.find(d => d.dimension === 'd3')?.ratio).toBe(0);

      const cov2 = evaluateAuditCoverage({
        ...base,
        summary: {
          urlsCrawled: 5,
          pagesScanned: 5,
          crawlFailedPages: 0,
          browserCandidatesTotal: 5,
          browserPagesAudited: 5,
          accessibilityCandidatesTotal: 5,
          accessibilityAuditsCompleted: 2,
        },
      });
      expect(cov2.dimensions.find(d => d.dimension === 'd3')?.ratio).toBeCloseTo(0.4, 6);

      const cov5 = evaluateAuditCoverage({
        ...base,
        summary: {
          urlsCrawled: 5,
          pagesScanned: 5,
          crawlFailedPages: 0,
          browserCandidatesTotal: 5,
          browserPagesAudited: 5,
          accessibilityCandidatesTotal: 5,
          accessibilityAuditsCompleted: 5,
        },
      });
      expect(cov5.dimensions.find(d => d.dimension === 'd3')?.ratio).toBe(1);
    });

    it('marks accessibility not_applicable without penalty when disabled in config', () => {
      const cov = evaluateAuditCoverage({
        scanType: 'full',
        config: {
          enableBrowserAudit: true,
          auditModules: { runtimeErrors: true, accessibility: false },
        },
        summary: {
          urlsCrawled: 3,
          pagesScanned: 3,
          crawlFailedPages: 0,
          browserCandidatesTotal: 3,
          browserPagesAudited: 3,
          runtimeAuditsCompleted: 3,
          accessibilityCandidatesTotal: 0,
          accessibilityAuditsCompleted: 0,
        },
      });
      const d3 = cov.dimensions.find(d => d.dimension === 'd3')!;
      expect(d3.status).toBe('exact');
      expect(d3.ratio).toBe(1);
      expect(d3.modules?.accessibility.status).toBe('not_applicable');
    });

    it('NEVER infers D4 layoutStability from viewportsCompleted or screenshotsCaptured when CLS is absent', () => {
      const cov = evaluateAuditCoverage({
        scanType: 'full',
        config: {
          enableBrowserAudit: true,
          auditModules: {
            networkResources: false,
            responsiveLayout: false,
            layoutStability: true,
            screenshots: false,
          },
        },
        summary: {
          urlsCrawled: 2,
          pagesScanned: 2,
          crawlFailedPages: 0,
          browserCandidatesTotal: 2,
          browserPagesAudited: 2,
          viewportsCompleted: 16,
          screenshotsCaptured: 16,
          layoutStabilityPagesCompleted: 0,
          performanceMetrics: { labMetrics: { cls: null } },
        },
      });
      const d4 = cov.dimensions.find(d => d.dimension === 'd4')!;
      expect(d4.ratio).toBe(0);
      expect(d4.modules?.layoutStability.ratio).toBe(0);
    });

    it('scores screenshot-only scan at 100% D4 coverage without penalizing missing Web Vitals', () => {
      const cov = evaluateAuditCoverage({
        scanType: 'full',
        config: {
          enableBrowserAudit: true,
          auditModules: {
            http: true,
            wordpress: false,
            securityHeaders: false,
            cookies: false,
            seo: false,
            runtimeErrors: true,
            accessibility: false,
            networkResources: false,
            responsiveLayout: false,
            layoutStability: false,
            screenshots: true,
          },
        },
        summary: {
          urlsCrawled: 2,
          pagesScanned: 2,
          crawlFailedPages: 0,
          staticModulesExecuted: 1,
          staticModulesTotal: 1,
          browserCandidatesTotal: 2,
          browserPagesAudited: 2,
          runtimeAuditsCompleted: 2,
          pageScreenshots: [
            { pageUrl: 'https://example.com/', viewportProfileId: 'desktop', status: 'captured' },
            {
              pageUrl: 'https://example.com/about',
              viewportProfileId: 'desktop',
              status: 'captured',
            },
          ],
        },
      });
      expect(cov.dimensions.find(d => d.dimension === 'd4')?.ratio).toBe(1);
      expect(cov.auditCoverage).toBe(100);
    });

    it('does not double count browserFailedPages in Confidence or D3/D4', () => {
      const input = {
        scanType: 'accessibility' as const,
        scanStatus: 'completed' as const,
        config: {
          enableBrowserAudit: true,
          auditModules: { runtimeErrors: false, accessibility: true },
        },
        summary: {
          urlsCrawled: 5,
          pagesScanned: 5,
          crawlFailedPages: 0,
          browserFailedPages: 3, // already reflected in 2/5 completed!
          browserCandidatesTotal: 5,
          browserPagesAudited: 2,
          accessibilityCandidatesTotal: 5,
          accessibilityAuditsCompleted: 2,
        },
      };
      const inputZeroDiag = {
        ...input,
        summary: { ...input.summary, browserFailedPages: 0 },
      };
      const triadWith = evaluateAuditHealthTriad(input);
      const triadWithout = evaluateAuditHealthTriad(inputZeroDiag);
      expect(triadWith.coverage.auditCoverage).toBe(triadWithout.coverage.auditCoverage);
      expect(triadWith.confidence.auditConfidence).toBe(triadWithout.confidence.auditConfidence);
    });
  });

  describe('Audit Confidence Non-Negative Deductions & Partial Ceiling', () => {
    it('satisfies exact approved regression vectors (60, 50, 100, 0) and moderate ceiling on partial scans', () => {
      const elig = evaluateExecutedCheckEligibility({
        summary: { pagesScanned: 1 },
      });
      const cov50 = evaluateAuditCoverage({
        scanType: 'quick',
        config: { enableBrowserAudit: false },
        summary: {
          urlsCrawled: 2,
          pagesScanned: 2,
          crawlFailedPages: 0,
          staticModulesExecuted: 0,
          staticModulesTotal: 2,
        },
      });
      // coverageDeduction = round((100 - 40)*0.4) = 24; let's test direct 50% coverage -> deduction 20
      const fakeCov50 = {
        ...cov50,
        auditCoverage: 50,
        isPartialCoverage: true,
        coverageStatus: 'partial' as const,
      };
      const resA = evaluateAuditConfidence(
        {
          scanStatus: 'failed',
          config: { enableBrowserAudit: false },
          summary: { urlsCrawled: 2, pagesScanned: 2 },
        },
        fakeCov50,
        elig,
      );
      expect(resA.deductions.coverageDeduction).toBe(20);
      expect(resA.deductions.interruptionDeduction).toBe(20);
      expect(resA.auditConfidence).toBe(60);
      expect(resA.confidenceBand).toBe('moderate');

      // Browser degradation adds 10 -> 50 -> 'low'
      const resB = evaluateAuditConfidence(
        {
          scanStatus: 'failed',
          config: { enableBrowserAudit: false },
          summary: { urlsCrawled: 2, pagesScanned: 2 },
          findings: [makeFinding({ ruleId: 'SYS_BROWSER_UNAVAILABLE', category: 'system' })],
        },
        fakeCov50,
        evaluateExecutedCheckEligibility({
          summary: { pagesScanned: 2 },
          findings: [makeFinding({ ruleId: 'SYS_BROWSER_UNAVAILABLE', category: 'system' })],
        }),
      );
      expect(resB.deductions.browserDegradationDeduction).toBe(10);
      expect(resB.auditConfidence).toBe(50);
      expect(resB.confidenceBand).toBe('low');

      // Perfect 100
      const cov100 = {
        ...cov50,
        auditCoverage: 100,
        isPartialCoverage: false,
        coverageStatus: 'full' as const,
      };
      const resC = evaluateAuditConfidence(
        {
          scanStatus: 'completed',
          config: { enableBrowserAudit: false },
          summary: { urlsCrawled: 2, pagesScanned: 2 },
        },
        cov100,
        elig,
      );
      expect(resC.auditConfidence).toBe(100);
      expect(resC.confidenceBand).toBe('high');

      // Partial ceiling: score 90 capped to moderate when coverageStatus === 'partial'
      const covPartial80 = {
        ...cov50,
        auditCoverage: 80,
        isPartialCoverage: true,
        coverageStatus: 'partial' as const,
      };
      const resCap = evaluateAuditConfidence(
        {
          scanStatus: 'completed',
          config: { enableBrowserAudit: false },
          summary: { urlsCrawled: 2, pagesScanned: 2 },
        },
        covPartial80,
        elig,
      );
      expect(resCap.auditConfidence).toBe(92);
      expect(resCap.confidenceBand).toBe('moderate');
    });
  });

  describe('Canonical HEALTH_BANDS Precedence Matrix (Mandatory Overlapping Cases a–d)', () => {
    it('Case a: auditCoverage = 0 + active confirmed critical finding -> action_required (isProvisional: true)', () => {
      const band = classifyHealthBand({
        hasActiveConfirmedCriticalFinding: true,
        hasEligibleExecutedChecks: true,
        healthIndex: 82,
        auditCoverage: 0,
        auditConfidence: 0,
        isPartialAudit: false,
        isPartialCoverage: true,
        scanType: 'full',
        enableBrowserAudit: false,
      });
      expect(band.bandId).toBe('action_required');
      expect(band.isProvisional).toBe(true);
    });

    it('Case b: auditCoverage = 0 + no critical finding: <65 -> issues_detected; >=65 -> insufficient_evidence', () => {
      const b1 = classifyHealthBand({
        hasActiveConfirmedCriticalFinding: false,
        hasEligibleExecutedChecks: true,
        healthIndex: 50,
        auditCoverage: 0,
        auditConfidence: 0,
        isPartialAudit: false,
        isPartialCoverage: true,
      });
      expect(b1.bandId).toBe('issues_detected');
      expect(b1.isProvisional).toBe(true);

      const b2 = classifyHealthBand({
        hasActiveConfirmedCriticalFinding: false,
        hasEligibleExecutedChecks: true,
        healthIndex: 85,
        auditCoverage: 0,
        auditConfidence: 0,
        isPartialAudit: false,
        isPartialCoverage: true,
      });
      expect(b2.bandId).toBe('insufficient_evidence');
      expect(b2.isProvisional).toBe(true);
    });

    it('Case c: !hasEligibleExecutedChecks (healthIndex = null) -> insufficient_evidence', () => {
      const band = classifyHealthBand({
        hasActiveConfirmedCriticalFinding: false,
        hasEligibleExecutedChecks: false,
        healthIndex: null,
        auditCoverage: 0,
        auditConfidence: 0,
        isPartialAudit: true,
        isPartialCoverage: true,
      });
      expect(band.bandId).toBe('insufficient_evidence');
      expect(band.isProvisional).toBe(true);
    });

    it('Case d: partial coverage (60%) + high HealthIndex (92) -> provisional_incomplete_scan (never Healthy)', () => {
      const band = classifyHealthBand({
        hasActiveConfirmedCriticalFinding: false,
        hasEligibleExecutedChecks: true,
        healthIndex: 92,
        auditCoverage: 60,
        auditConfidence: 70,
        isPartialAudit: false,
        isPartialCoverage: true,
        scanType: 'full',
        enableBrowserAudit: true,
      });
      expect(band.bandId).toBe('provisional_incomplete_scan');
      expect(band.isProvisional).toBe(true);
    });

    it('complete & confident scan promotes to healthy (>= 85) and needs_attention (65..84)', () => {
      expect(
        classifyHealthBand({
          hasActiveConfirmedCriticalFinding: false,
          hasEligibleExecutedChecks: true,
          healthIndex: 91,
          auditCoverage: 100,
          auditConfidence: 100,
          isPartialAudit: false,
          isPartialCoverage: false,
          scanType: 'full',
          enableBrowserAudit: true,
        }).bandId,
      ).toBe('healthy');

      expect(
        classifyHealthBand({
          hasActiveConfirmedCriticalFinding: false,
          hasEligibleExecutedChecks: true,
          healthIndex: 75,
          auditCoverage: 100,
          auditConfidence: 95,
          isPartialAudit: false,
          isPartialCoverage: false,
          scanType: 'full',
          enableBrowserAudit: true,
        }).bandId,
      ).toBe('needs_attention');
    });

    it('handles pre-7.4 historical scan records cleanly with labeled approximations and finite bounded ratios', () => {
      const triad = evaluateAuditHealthTriad({
        scanType: 'full',
        scanStatus: 'completed',
        config: { enableBrowserAudit: true },
        completedEngines: ['crawler', 'analyzers', 'browser'],
        summary: {
          pagesScanned: 4,
          pagesFailed: 1,
          staticCoverageStatus: 'partial',
          browserPagesAudited: 2,
          screenshotsCaptured: 2,
        },
        findings: [
          makeFinding({
            ruleId: 'a11y-color-contrast',
            category: 'accessibility',
            severity: 'high',
            confidence: 'confirmed',
            status: 'active',
          }),
        ],
      });

      expect(triad.healthIndex).not.toBeNull();
      expect(triad.coverage.coverageApproximated).toBe(true);
      expect(triad.coverage.coverageApproximationReasons).toContain(
        'd1_historical_mixed_pages_failed',
      );
      expect(triad.coverage.coverageApproximationReasons).toContain(
        'd2_historical_partial_static_approximated',
      );
      expect(triad.coverage.coverageApproximationReasons).toContain(
        'd3_historical_runtime_from_browser_pages',
      );
      for (const dim of triad.coverage.dimensions) {
        expect(Number.isFinite(dim.ratio)).toBe(true);
        expect(dim.ratio).toBeGreaterThanOrEqual(0);
        expect(dim.ratio).toBeLessThanOrEqual(1);
      }
      expect(triad.healthBand.bandId).not.toBe('healthy');
    });

    it('reflects partial browser sample (2/10 pages) honestly in D3, D4, auditCoverage, and confidence while excluding disabled modules', () => {
      const triad = evaluateAuditHealthTriad({
        scanType: 'full',
        scanStatus: 'completed',
        config: {
          maxPages: 10,
          maxBrowserPages: 2,
          enableBrowserAudit: true,
          captureScreenshots: false,
          auditModules: {
            http: true,
            wordpress: true,
            securityHeaders: true,
            cookies: true,
            seo: true,
            runtimeErrors: true,
            networkResources: true,
            responsiveLayout: true,
            layoutStability: false,
            screenshots: false,
            accessibility: true,
          },
        },
        completedEngines: ['crawler', 'analyzers', 'browser'],
        summary: {
          urlsCrawled: 10,
          pagesScanned: 10,
          crawlFailedPages: 0,
          nonHtmlPages: 0,
          staticModulesExecuted: 5,
          staticModulesTotal: 5,
          staticPagesAnalyzed: 10,
          browserCandidatesTotal: 2,
          browserCandidatesSkipped: 0,
          browserPagesAudited: 2,
          runtimeAuditsCompleted: 2,
          accessibilityCandidatesTotal: 2,
          accessibilityAuditsCompleted: 2,
          viewportsCompleted: 16,
          layoutStabilityPagesCompleted: 0,
          screenshotsCaptured: 0,
          performanceMetrics: {
            labMetrics: { ttfbMs: 63, fcpMs: 1064, lcpMs: 1064, cls: null, tbtMs: 11 },
            resourceSummary: { totalResources: 10 },
            pages: [
              {
                labMetrics: { ttfbMs: 63, fcpMs: 1064, lcpMs: 1064, cls: null, tbtMs: 11 },
                resourceSummary: { totalResources: 10 },
              },
              {
                labMetrics: { ttfbMs: 59, fcpMs: 620, lcpMs: 620, cls: null, tbtMs: 0 },
                resourceSummary: { totalResources: 10 },
              },
            ],
          },
        },
        findings: [],
      });

      const d1 = triad.coverage.dimensions.find(d => d.dimension === 'd1')!;
      const d2 = triad.coverage.dimensions.find(d => d.dimension === 'd2')!;
      const d3 = triad.coverage.dimensions.find(d => d.dimension === 'd3')!;
      const d4 = triad.coverage.dimensions.find(d => d.dimension === 'd4')!;

      expect(d1.percent).toBe(100);
      expect(d2.percent).toBe(100);
      expect(d3.percent).toBe(20);
      expect(d3.status).toBe('exact');
      expect(d3.reasonCodes).toContain('browser_coverage_partial_subset');
      expect(d4.percent).toBe(20);
      expect(d4.status).toBe('exact');
      expect(d4.reasonCodes).toContain('browser_coverage_partial_subset');
      expect(triad.coverage.applicableD4Modules).toEqual(['networkResources', 'responsiveLayout']);
      expect(triad.coverage.coverageApproximated).toBe(false);
      // Weighted: (20*1 + 30*1 + 25*0.2 + 25*0.2) / 100 = 60%
      expect(triad.coverage.auditCoverage).toBe(60);
      expect(triad.coverage.coverageStatus).toBe('partial');
      expect(triad.coverage.isPartialCoverage).toBe(true);
      // 40% missing coverage -> 16 pt coverage deduction -> 84 confidence, capped at moderate
      expect(triad.confidence.deductions.coverageDeduction).toBe(16);
      expect(triad.confidence.auditConfidence).toBe(84);
      expect(triad.confidence.confidenceBand).toBe('moderate');
    });
  });
});
