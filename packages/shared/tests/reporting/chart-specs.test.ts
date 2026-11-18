import { describe, expect, it } from 'vitest';
import {
  buildAssetBreakdownChart,
  buildAuditChartSuite,
  buildBottleneckSummaryChart,
  buildCategoryBreakdownChart,
  buildLabVitalsChart,
  buildSeverityDistributionChart,
  buildTopAffectedPagesChart,
  extractDetectedStack,
  type HealthAnalyticsFindingInput,
} from '../../src/index.js';

function finding(
  overrides: Partial<HealthAnalyticsFindingInput> = {},
): HealthAnalyticsFindingInput {
  return {
    id: overrides.id ?? 'id-1',
    ruleId: overrides.ruleId ?? 'SEO_META_DESCRIPTION_MISSING',
    category: overrides.category ?? 'seo',
    severity: overrides.severity ?? 'medium',
    confidence: overrides.confidence ?? 'confirmed',
    status: overrides.status ?? 'active',
    targetUrl: overrides.targetUrl ?? 'https://example.com/',
    ...overrides,
  };
}

describe('Chart Specifications & Evidence-Gated Stack Detection', () => {
  describe('Deterministic Severity, Category & Top Affected Pages Charts', () => {
    it('excludes SYS_* and lifecycle-resolved findings from target-site chart buckets while reporting excluded counts', () => {
      const findings = [
        finding({
          id: '1',
          severity: 'critical',
          ruleId: 'SEC_EXPOSED_ENV',
          category: 'security',
          targetUrl: 'https://example.com/a',
        }),
        finding({
          id: '2',
          severity: 'high',
          ruleId: 'SEO_TITLE_MISSING',
          category: 'seo',
          targetUrl: 'https://example.com/b',
        }),
        finding({
          id: '3',
          severity: 'high',
          ruleId: 'SEO_CANONICAL_MISSING',
          category: 'seo',
          targetUrl: 'https://example.com/a',
        }),
        finding({
          id: '4',
          severity: 'critical',
          ruleId: 'SYS_BROWSER_UNAVAILABLE',
          category: 'system',
          targetUrl: 'https://example.com/',
        }),
        finding({
          id: '5',
          severity: 'high',
          ruleId: 'SEC_OLD_ISSUE',
          category: 'security',
          status: 'fixed',
          targetUrl: 'https://example.com/c',
        }),
      ];

      const sev = buildSeverityDistributionChart(findings);
      expect(sev.totalItems).toBe(3);
      expect(sev.excludedSystemFindingsCount).toBe(1);
      expect(sev.excludedLifecycleFindingsCount).toBe(1);
      expect(sev.excludedCount).toBe(2);
      expect(sev.items.find(i => i.severity === 'critical')?.totalCount).toBe(1);
      expect(sev.items.find(i => i.severity === 'high')?.totalCount).toBe(2);
      expect(sev.items.every(i => Number.isFinite(i.bar.width) && i.bar.width >= 0)).toBe(true);

      const cat = buildCategoryBreakdownChart(findings);
      expect(cat.items[0]?.categoryId).toBe('technical-seo');
      expect(cat.items[0]?.activeCount).toBe(2);
      expect(cat.items[1]?.categoryId).toBe('security');
      expect(cat.items[1]?.activeCount).toBe(1);

      const pages = buildTopAffectedPagesChart({ findings });
      expect(pages.items[0]?.targetUrl).toBe('https://example.com/a'); // critical(18)+high(10)=28
      expect(pages.items[0]?.normalizedRatio).toBe(1);
      expect(pages.items[1]?.targetUrl).toBe('https://example.com/b');
      expect(pages.items[1]?.normalizedRatio).toBeLessThan(1);
    });

    it('produces byte-for-byte deterministic output regardless of input ordering', () => {
      const f1 = finding({
        id: 'a',
        targetUrl: 'https://example.com/z',
        ruleId: 'R1',
        severity: 'high',
      });
      const f2 = finding({
        id: 'b',
        targetUrl: 'https://example.com/a',
        ruleId: 'R2',
        severity: 'high',
      });
      const suite1 = buildAuditChartSuite({
        scanType: 'full',
        config: { enableBrowserAudit: false },
        summary: {
          urlsCrawled: 2,
          pagesScanned: 2,
          crawlFailedPages: 0,
          staticModulesExecuted: 2,
          staticModulesTotal: 2,
        },
        findings: [f1, f2],
      });
      const suite2 = buildAuditChartSuite({
        scanType: 'full',
        config: { enableBrowserAudit: false },
        summary: {
          urlsCrawled: 2,
          pagesScanned: 2,
          crawlFailedPages: 0,
          staticModulesExecuted: 2,
          staticModulesTotal: 2,
        },
        findings: [f2, f1],
      });
      expect(suite1.topAffectedPages).toEqual(suite2.topAffectedPages);
      expect(suite1.categoryBreakdown).toEqual(suite2.categoryBreakdown);
      expect(suite1.severityDistribution).toEqual(suite2.severityDistribution);
    });
  });

  describe('Lab Vitals Chart & INP Exclusion', () => {
    it('surfaces INP explicitly as excluded/unsupported_in_lab and handles missing vitals honestly without fabricating 0s', () => {
      const chart = buildLabVitalsChart({
        summary: {
          performanceMetrics: {
            labMetrics: {
              ttfbMs: 420,
              fcpMs: null,
              lcpMs: 3100,
              cls: 0.04,
              tbtMs: 250,
              isLcpCapped: true,
            },
          },
        },
        findings: [],
      });

      const inp = chart.items.find(i => i.metric === 'inp');
      expect(inp?.status).toBe('excluded');
      expect(inp?.rating).toBe('unsupported_in_lab');
      expect(inp?.value).toBeNull();
      expect(inp?.reasonCode).toBe('unsupported_in_lab_requires_field_crux');

      const fcp = chart.items.find(i => i.metric === 'fcp');
      expect(fcp?.status).toBe('unavailable');
      expect(fcp?.value).toBeNull();

      const lcp = chart.items.find(i => i.metric === 'lcp');
      expect(lcp?.status).toBe('approximated');
      expect(lcp?.isCapped).toBe(true);
      expect(chart.status).toBe('partial');
    });

    it('returns unavailable status when zero lab metrics exist', () => {
      const chart = buildLabVitalsChart({ summary: {}, findings: [] });
      expect(chart.status).toBe('unavailable');
      expect(chart.hasMeasuredVitals).toBe(false);
    });
  });

  describe('Asset Breakdown Chart (New Bytes vs Historical Counts-Only)', () => {
    it('renders normalized byte shares when summary.resourceBytesByType exists', () => {
      const chart = buildAssetBreakdownChart({
        summary: {
          resourceBytesByType: {
            document: 50_000,
            script: 300_000,
            stylesheet: 100_000,
            image: 500_000,
            font: 40_000,
            other: 10_000,
            totalBytes: 1_000_000,
          },
        },
        findings: [],
      });
      expect(chart.status).toBe('measured');
      expect(chart.mode).toBe('bytes_by_type');
      expect(chart.totalBytes).toBe(1_000_000);
      expect(chart.items[0]?.bucket).toBe('image');
      expect(chart.items[0]?.percent).toBe(50);

      const partialChart = buildAssetBreakdownChart({
        summary: {
          resourceBytesByType: {
            script: 250_000,
            totalBytes: 250_000,
            isPartial: true,
          },
        },
        findings: [],
      });
      expect(partialChart.status).toBe('partial');
      expect(partialChart.mode).toBe('bytes_by_type');
      expect(partialChart.items.find(i => i.bucket === 'font')?.bytes).toBe(0);
    });

    it('degrades historical scans without resourceBytesByType to counts_and_flagged_only with null bytes', () => {
      const chart = buildAssetBreakdownChart({
        summary: {
          performanceMetrics: {
            resources: {
              totalResources: 20,
              scriptsCount: 10,
              stylesheetsCount: 4,
              imagesCount: 6,
              totalTransferSizeBytes: 512000,
            },
          },
        },
        findings: [finding({ ruleId: 'PERF_LARGE_JS', category: 'performance' })],
      });
      expect(chart.status).toBe('partial');
      expect(chart.mode).toBe('counts_and_flagged_only');
      expect(chart.reasonCodes).toContain('counts_and_flagged_only_missing_resource_bytes_by_type');
      expect(chart.items.every(i => i.bytes === null)).toBe(true);
      expect(chart.flaggedHeavyAssetsCount).toBe(1);
    });
  });

  describe('Bottleneck Summary Chart', () => {
    it('surfaces unavailable cleanly when performance telemetry is missing', () => {
      const chart = buildBottleneckSummaryChart({ summary: {}, findings: [] });
      expect(chart.status).toBe('unavailable');
      expect(chart.items).toEqual([]);
    });
  });

  describe('extractDetectedStack() Evidence Gating', () => {
    it('keeps WordPress, Elementor, WooCommerce, CDN, and Cache false when non-WP target has no markers', () => {
      const stack = extractDetectedStack({
        sitePlatformType: 'generic_web',
        findings: [
          finding({
            ruleId: 'SEC_HSTS_MISSING',
            category: 'security_headers',
            evidence: { headers: { server: 'nginx/1.24' } },
          }),
        ],
      });
      expect(stack.isWordPress).toBe(false);
      expect(stack.isElementor).toBe(false);
      expect(stack.isElementorPro).toBe(false);
      expect(stack.isWooCommerce).toBe(false);
      expect(stack.serverHints).toContain('nginx');
      expect(stack.cdnOrCacheHints).toEqual([]);
    });

    it('distinguishes Elementor Free vs Elementor Pro strictly from observed evidence', () => {
      const freeOnly = extractDetectedStack({
        sitePlatformType: 'wordpress',
        findings: [
          finding({
            ruleId: 'WP_DETECTED',
            category: 'wordpress',
            evidence: {
              plugins: ['elementor'],
              assetUrl:
                'https://example.com/wp-content/plugins/elementor/assets/css/frontend.min.css',
              headers: { 'cf-ray': '12345abc', 'x-litespeed-cache': 'hit' },
            },
          }),
        ],
      });
      expect(freeOnly.isWordPress).toBe(true);
      expect(freeOnly.isElementor).toBe(true);
      expect(freeOnly.isElementorPro).toBe(false);
      expect(freeOnly.isWooCommerce).toBe(false);
      expect(freeOnly.cdnOrCacheHints).toContain('cloudflare');
      expect(freeOnly.cdnOrCacheHints).toContain('litespeed');

      const withPro = extractDetectedStack({
        sitePlatformType: 'wordpress',
        findings: [
          finding({
            ruleId: 'WP_DETECTED',
            category: 'wordpress',
            evidence: {
              plugins: ['elementor', 'elementor-pro', 'woocommerce'],
            },
          }),
        ],
      });
      expect(withPro.isElementor).toBe(true);
      expect(withPro.isElementorPro).toBe(true);
      expect(withPro.isWooCommerce).toBe(true);
    });
  });

  describe('Coverage Dimensions Chart Status on Partial Browser Sampling', () => {
    it('marks coverageDimensions chart as partial when browser audit covers only a sampled subset of crawled pages', () => {
      const suite = buildAuditChartSuite({
        scanType: 'full',
        scanStatus: 'completed',
        config: {
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
        summary: {
          urlsCrawled: 10,
          pagesScanned: 10,
          crawlFailedPages: 0,
          staticModulesExecuted: 5,
          staticModulesTotal: 5,
          browserCandidatesTotal: 2,
          browserPagesAudited: 2,
          runtimeAuditsCompleted: 2,
          accessibilityCandidatesTotal: 2,
          accessibilityAuditsCompleted: 2,
          viewportsCompleted: 16,
          layoutStabilityPagesCompleted: 0,
          performanceMetrics: {
            pages: [
              { labMetrics: { cls: null }, resourceSummary: { totalResources: 5 } },
              { labMetrics: { cls: null }, resourceSummary: { totalResources: 5 } },
            ],
          },
        },
        findings: [],
      });

      expect(suite.coverageDimensions.status).toBe('partial');
      expect(suite.coverageDimensions.auditCoverage).toBe(60);
    });
  });
});
