import { describe, expect, it } from 'vitest';
import { evaluateD1CrawlCoverage, evaluateAuditCoverage, isValidCount } from '../../src/index.js';

describe('D1 Crawl & Reachability Decision Matrix & Safe Counter Validation', () => {
  describe('isValidCount()', () => {
    it('accepts safe non-negative integers including 0 and Number.MAX_SAFE_INTEGER', () => {
      expect(isValidCount(0)).toBe(true);
      expect(isValidCount(1)).toBe(true);
      expect(isValidCount(42)).toBe(true);
      expect(isValidCount(Number.MAX_SAFE_INTEGER)).toBe(true);
    });

    it('rejects negatives, floats, non-finite numbers, > MAX_SAFE_INTEGER, and non-numbers', () => {
      expect(isValidCount(-1)).toBe(false);
      expect(isValidCount(-0.5)).toBe(false);
      expect(isValidCount(2.5)).toBe(false);
      expect(isValidCount(Number.NaN)).toBe(false);
      expect(isValidCount(Number.POSITIVE_INFINITY)).toBe(false);
      expect(isValidCount(Number.NEGATIVE_INFINITY)).toBe(false);
      expect(isValidCount(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
      expect(isValidCount('10')).toBe(false);
      expect(isValidCount(null)).toBe(false);
      expect(isValidCount(undefined)).toBe(false);
    });
  });

  describe('Step 0A Primary Counter Sanity Guard', () => {
    const invalidValues: unknown[] = [
      -1,
      2.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    it.each(invalidValues)(
      'rejects invalid primary counter (%p) in urlsCrawled/pagesScanned/crawlFailedPages before arithmetic',
      bad => {
        for (const field of ['urlsCrawled', 'pagesScanned', 'crawlFailedPages'] as const) {
          const summary: Record<string, unknown> = {
            urlsCrawled: 10,
            pagesScanned: 8,
            crawlFailedPages: 2,
            [field]: bad,
          };
          const res = evaluateD1CrawlCoverage({ summary });
          expect(res.status).toBe('unavailable');
          expect(res.ratio).toBe(0);
          expect(res.coverageApproximated).toBe(true);
          expect(res.reasonCodes).toContain('d1_crawl_telemetry_invalid_count');
          expect(res.pathUsed).toBe('invalid_count');
        }
      },
    );

    it('rejects null if passed explicitly for a primary counter as non-valid raw telemetry vs undefined', () => {
      // Note: undefined means missing counter; negative/NaN/float fail isValidCount
      const res = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: 10,
          pagesScanned: 10.1,
          crawlFailedPages: 0,
        },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_crawl_telemetry_invalid_count']);
    });
  });

  describe('Path 1 — All Three Authoritative Counters Present (urlsCrawled, pagesScanned, crawlFailedPages)', () => {
    it('handles zero-attempt 0 / 0 / 0 as unavailable with ratio 0 and not approximated', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { urlsCrawled: 0, pagesScanned: 0, crawlFailedPages: 0 },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(false);
      expect(res.reasonCodes).toEqual([]);
      expect(res.pathUsed).toBe('path1_exact_triple');
    });

    it('handles exact equality urlsCrawled === pagesScanned + crawlFailedPages', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { urlsCrawled: 10, pagesScanned: 8, crawlFailedPages: 2 },
      });
      expect(res.status).toBe('exact');
      expect(res.ratio).toBeCloseTo(0.8, 6);
      expect(res.coverageApproximated).toBe(false);
      expect(res.reasonCodes).toEqual([]);
    });

    it('handles Disagreement Case A (urlsCrawled > sum) as approximated with conservative denominator', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { urlsCrawled: 10, pagesScanned: 6, crawlFailedPages: 2 },
      });
      expect(res.status).toBe('approximated');
      expect(res.ratio).toBeCloseTo(0.6, 6);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_crawl_telemetry_mismatch_attempts_gt_outcomes']);
    });

    it('handles Disagreement Case B (sum > urlsCrawled) as unavailable with ratio 0', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { urlsCrawled: 5, pagesScanned: 4, crawlFailedPages: 3 },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_crawl_telemetry_mismatch_outcomes_exceed_attempts']);
    });

    it('handles urlsCrawled = 0 with positive outcomes as mismatch unavailable', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { urlsCrawled: 0, pagesScanned: 1, crawlFailedPages: 0 },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_crawl_telemetry_mismatch_outcomes_exceed_attempts']);
    });

    it('rejects derived sum overflowing Number.MAX_SAFE_INTEGER before comparing with urlsCrawled or classifying exact', () => {
      const res = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: Number.MAX_SAFE_INTEGER,
          pagesScanned: Number.MAX_SAFE_INTEGER,
          crawlFailedPages: 1,
        },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_crawl_telemetry_invalid_count']);
    });

    it('accepts derived sum strictly equal to Number.MAX_SAFE_INTEGER', () => {
      const res = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: Number.MAX_SAFE_INTEGER,
          pagesScanned: Number.MAX_SAFE_INTEGER - 1,
          crawlFailedPages: 1,
        },
      });
      expect(res.status).toBe('exact');
      expect(res.coverageApproximated).toBe(false);
      expect(res.ratio).toBeGreaterThan(0.999);
      expect(res.ratio).toBeLessThanOrEqual(1);
    });

    it('isolates browserFailedPages completely from Path 1 D1 numerator, denominator, and status', () => {
      const res = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: 10,
          pagesScanned: 8,
          crawlFailedPages: 2,
          browserFailedPages: 5,
        },
      });
      expect(res.status).toBe('exact');
      expect(res.ratio).toBeCloseTo(0.8, 6);
      expect(res.coverageApproximated).toBe(false);
    });
  });

  describe('Path 2 — Pre-7.4 Scan With urlsCrawled & pagesScanned Present, crawlFailedPages undefined', () => {
    it('step 1: rejects invalid historical pagesFailed BEFORE zero-attempt or scanned > urls checks', () => {
      const res = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: 10,
          pagesScanned: 12,
          pagesFailed: -1,
        },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_crawl_telemetry_invalid_count']);
    });

    it('step 2: handles 0 / 0 zero-attempt cleanly', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { urlsCrawled: 0, pagesScanned: 0, pagesFailed: 0 },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(false);
    });

    it('step 3: rejects pagesScanned > urlsCrawled BEFORE general approximated/full-success branch', () => {
      const res1 = evaluateD1CrawlCoverage({
        summary: { urlsCrawled: 5, pagesScanned: 7 },
      });
      expect(res1.status).toBe('unavailable');
      expect(res1.ratio).toBe(0);
      expect(res1.coverageApproximated).toBe(true);
      expect(res1.reasonCodes).toEqual(['d1_crawl_telemetry_mismatch_outcomes_exceed_attempts']);

      const res2 = evaluateD1CrawlCoverage({
        summary: { urlsCrawled: 0, pagesScanned: 3, pagesFailed: 0 },
      });
      expect(res2.status).toBe('unavailable');
      expect(res2.ratio).toBe(0);
      expect(res2.coverageApproximated).toBe(true);
      expect(res2.reasonCodes).toEqual(['d1_crawl_telemetry_mismatch_outcomes_exceed_attempts']);
    });

    it('step 4: classifies exact 1.0 ONLY when urlsCrawled > 0, pagesScanned === urlsCrawled, and (pagesFailed ?? 0) === 0 (ignoring browserFailedPages)', () => {
      const res = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: 10,
          pagesScanned: 10,
          pagesFailed: 0,
          browserFailedPages: 3,
        },
      });
      expect(res.status).toBe('exact');
      expect(res.ratio).toBe(1);
      expect(res.coverageApproximated).toBe(false);
    });

    it('step 5: classifies partial/positive pagesFailed as approximated without promoting browserFailedPages into failure penalty', () => {
      const res = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: 10,
          pagesScanned: 7,
          pagesFailed: 3,
        },
      });
      expect(res.status).toBe('approximated');
      expect(res.ratio).toBeCloseTo(0.7, 6);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_historical_missing_crawl_failed_split']);

      // Edge case: scanned === urlsCrawled while historical pagesFailed > 0 (e.g. mixed browser failure)
      const resMixed = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: 10,
          pagesScanned: 10,
          pagesFailed: 2,
        },
      });
      expect(resMixed.status).toBe('approximated');
      expect(resMixed.ratio).toBe(1);
      expect(resMixed.coverageApproximated).toBe(true);
      expect(resMixed.reasonCodes).toEqual(['d1_historical_missing_crawl_failed_split']);
    });
  });

  describe('Path 3 — urlsCrawled undefined, pagesScanned & crawlFailedPages Present (Matrix Row 4)', () => {
    it('computes exact ratio when derived sum is safe and > 0', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { pagesScanned: 8, crawlFailedPages: 2 },
      });
      expect(res.status).toBe('exact');
      expect(res.ratio).toBeCloseTo(0.8, 6);
      expect(res.coverageApproximated).toBe(false);
    });

    it('returns unavailable when 0 + 0 === 0', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { pagesScanned: 0, crawlFailedPages: 0 },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(false);
    });

    it('accepts derived sum === Number.MAX_SAFE_INTEGER and rejects overflow > Number.MAX_SAFE_INTEGER', () => {
      const ok = evaluateD1CrawlCoverage({
        summary: { pagesScanned: Number.MAX_SAFE_INTEGER, crawlFailedPages: 0 },
      });
      expect(ok.status).toBe('exact');
      expect(ok.ratio).toBe(1);
      expect(ok.coverageApproximated).toBe(false);

      const overflow = evaluateD1CrawlCoverage({
        summary: { pagesScanned: Number.MAX_SAFE_INTEGER, crawlFailedPages: 10 },
      });
      expect(overflow.status).toBe('unavailable');
      expect(overflow.ratio).toBe(0);
      expect(overflow.coverageApproximated).toBe(true);
      expect(overflow.reasonCodes).toEqual(['d1_crawl_telemetry_invalid_count']);
    });
  });

  describe('Missing pagesScanned Rows (Matrix Rows 3, 6, 7, 8)', () => {
    it('Row 3 (Case A): urlsCrawled=10, pagesScanned=undefined, crawlFailedPages=2 never infers 8', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { urlsCrawled: 10, crawlFailedPages: 2 },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_missing_pages_scanned_numerator']);
    });

    it('Row 6: urlsCrawled only -> unavailable', () => {
      const res = evaluateD1CrawlCoverage({ summary: { urlsCrawled: 10 } });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_missing_pages_scanned_numerator']);
    });

    it('Row 7: crawlFailedPages only -> unavailable', () => {
      const res = evaluateD1CrawlCoverage({ summary: { crawlFailedPages: 2 } });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_missing_pages_scanned_numerator']);
    });

    it('Row 8: all counters undefined -> unavailable (d1_missing_denominator_units)', () => {
      const res = evaluateD1CrawlCoverage({ summary: {} });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_missing_denominator_units']);
    });
  });

  describe('Path 4 — Historical Fallback Cases (H1, H2a, H2b, H2c) & Step 0B Regression Guards', () => {
    it('Case B1: pagesScanned=8 with NO errorDetails.pagesFailed and NO pagesFailed never infers 0 failures', () => {
      const res = evaluateD1CrawlCoverage({
        summary: { pagesScanned: 8 },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_missing_denominator_units']);
    });

    it('H1 (browser disabled, no browser findings/engine): uses crawler-only historical pagesFailed as exact', () => {
      const res = evaluateD1CrawlCoverage({
        scanStatus: 'completed',
        config: { enableBrowserAudit: false },
        completedEngines: ['crawler', 'analyzers'],
        summary: { pagesScanned: 8, pagesFailed: 2, browserPagesAudited: 0 },
        findings: [],
      });
      expect(res.status).toBe('exact');
      expect(res.ratio).toBeCloseTo(0.8, 6);
      expect(res.coverageApproximated).toBe(false);
      expect(res.pathUsed).toBe('path4_h1_crawler_only_proven');
    });

    it('H1 (non-completed scan with valid errorDetails.pagesFailed): proves crawler-only failures', () => {
      const res = evaluateD1CrawlCoverage({
        scanStatus: 'failed',
        config: { enableBrowserAudit: true },
        summary: { pagesScanned: 6, pagesFailed: 99 },
        errorDetails: { pagesFailed: 2 },
      });
      expect(res.status).toBe('exact');
      expect(res.ratio).toBeCloseTo(0.75, 6);
      expect(res.coverageApproximated).toBe(false);
    });

    it('CRITICAL INVARIANT: browserPagesAudited === 0 alone NEVER proves H1 crawler-only failures', () => {
      const res = evaluateD1CrawlCoverage({
        scanStatus: 'completed',
        config: { enableBrowserAudit: true },
        completedEngines: ['crawler', 'analyzers', 'browser'],
        summary: { pagesScanned: 8, pagesFailed: 2, browserPagesAudited: 0 },
      });
      expect(res.status).toBe('approximated');
      expect(res.ratio).toBeCloseTo(0.8, 6);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_historical_mixed_pages_failed']);
      expect(res.pathUsed).toBe('path4_h2_mixed_or_missing');
    });

    it('H2b: pagesScanned > 0 and mixed pagesFailed === 0 -> approximated 1.0 with d1_historical_missing_urls_crawled', () => {
      const res = evaluateD1CrawlCoverage({
        scanStatus: 'completed',
        config: { enableBrowserAudit: true },
        summary: { pagesScanned: 5, pagesFailed: 0 },
      });
      expect(res.status).toBe('approximated');
      expect(res.ratio).toBe(1);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_historical_missing_urls_crawled']);
    });

    it('H2c: pagesScanned === 0 with explicit valid summary.pagesFailed >= 0 -> unavailable with ratio 0', () => {
      const res = evaluateD1CrawlCoverage({
        scanStatus: 'completed',
        config: { enableBrowserAudit: true },
        summary: { pagesScanned: 0, pagesFailed: 4 },
      });
      expect(res.status).toBe('unavailable');
      expect(res.ratio).toBe(0);
      expect(res.coverageApproximated).toBe(true);
      expect(res.reasonCodes).toEqual(['d1_missing_denominator_units']);
    });

    it('Step 0B Regressions: rejects negative, fractional, NaN, Infinity, -Infinity, and MAX_SAFE_INTEGER+1 in errorDetails.pagesFailed BEFORE arithmetic', () => {
      const badCounters = [
        -1,
        -5, // 8 + (-5) = 3 > 0 must NOT bypass Step 0B!
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ];
      for (const bad of badCounters) {
        const res = evaluateD1CrawlCoverage({
          scanStatus: 'failed',
          summary: { pagesScanned: 8 },
          errorDetails: { pagesFailed: bad },
        });
        expect(res.status).toBe('unavailable');
        expect(res.ratio).toBe(0);
        expect(res.coverageApproximated).toBe(true);
        expect(res.reasonCodes).toEqual(['d1_crawl_telemetry_invalid_count']);
      }
    });

    it('rejects Path 4 H1 & H2 derived-sum overflow past Number.MAX_SAFE_INTEGER', () => {
      const h1Overflow = evaluateD1CrawlCoverage({
        scanStatus: 'cancelled',
        summary: { pagesScanned: Number.MAX_SAFE_INTEGER },
        errorDetails: { pagesFailed: 1 },
      });
      expect(h1Overflow.status).toBe('unavailable');
      expect(h1Overflow.ratio).toBe(0);
      expect(h1Overflow.coverageApproximated).toBe(true);
      expect(h1Overflow.reasonCodes).toEqual(['d1_crawl_telemetry_invalid_count']);

      const h2Overflow = evaluateD1CrawlCoverage({
        scanStatus: 'completed',
        config: { enableBrowserAudit: true },
        summary: { pagesScanned: Number.MAX_SAFE_INTEGER, pagesFailed: 1 },
      });
      expect(h2Overflow.status).toBe('unavailable');
      expect(h2Overflow.ratio).toBe(0);
      expect(h2Overflow.coverageApproximated).toBe(true);
      expect(h2Overflow.reasonCodes).toEqual(['d1_crawl_telemetry_invalid_count']);
    });

    it('feeds finite bounded [0, 1] D1 ratios cleanly into evaluateAuditCoverage()', () => {
      const cov = evaluateAuditCoverage({
        scanType: 'quick',
        config: { enableBrowserAudit: false },
        completedEngines: ['crawler', 'analyzers'],
        summary: {
          urlsCrawled: 10,
          pagesScanned: 8,
          crawlFailedPages: 2,
          browserFailedPages: 99,
          staticModulesExecuted: 4,
          staticModulesTotal: 4,
        },
      });
      const d1 = cov.dimensions.find(d => d.dimension === 'd1')!;
      expect(d1.ratio).toBeCloseTo(0.8, 6);
      expect(d1.status).toBe('exact');
      // Weighted: (20*0.8 + 30*1.0) / 50 = 46/50 = 92%
      expect(cov.auditCoverage).toBe(92);
      expect(Number.isFinite(cov.auditCoverage)).toBe(true);
    });

    it('accounts for nonHtmlPages in D1 without penalizing HTML crawl reachability ratio (DEF-007-A)', () => {
      const exactWithNonHtml = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: 7,
          pagesScanned: 4,
          crawlFailedPages: 1,
          nonHtmlPages: 2,
        },
      });
      expect(exactWithNonHtml.status).toBe('exact');
      expect(exactWithNonHtml.coverageApproximated).toBe(false);
      // 4 / (7 - 2) = 4 / 5 = 0.8
      expect(exactWithNonHtml.ratio).toBeCloseTo(0.8, 6);

      const onlyNonHtml = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: 2,
          pagesScanned: 0,
          crawlFailedPages: 0,
          nonHtmlPages: 2,
        },
      });
      expect(onlyNonHtml.status).toBe('unavailable');
      expect(onlyNonHtml.ratio).toBe(0);
      expect(onlyNonHtml.coverageApproximated).toBe(false);

      const invalidNonHtml = evaluateD1CrawlCoverage({
        summary: {
          urlsCrawled: 5,
          pagesScanned: 4,
          crawlFailedPages: 1,
          nonHtmlPages: -1,
        },
      });
      expect(invalidNonHtml.status).toBe('unavailable');
      expect(invalidNonHtml.reasonCodes).toEqual(['d1_crawl_telemetry_invalid_count']);
    });
  });
});
