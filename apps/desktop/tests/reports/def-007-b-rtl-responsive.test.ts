import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { discoverBrowser } from '../../src/main/browser/discovery.js';
import { generateHtmlReport } from '../../src/main/reports/html-generator.js';
import type { ReportModel } from '../../src/main/reports/types.js';
import type { ReportLocale, ReportViewMode } from '@auditor/shared';

const TINY_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function buildRichFixtureModel(locale: ReportLocale, viewMode: ReportViewMode): ReportModel {
  const longUrl =
    'https://arabic-store.example.com/wp-content/uploads/2026/very-long-unbroken-segment-with-many-subdirectories-for-testing-wrapping/product-catalog-item-9876543210';
  const longSelector =
    'html > body > div.site-wrapper > main#primary-content > section.featured-products-carousel > div.product-card-container:nth-child(4) > a.very-long-css-selector-class-name-without-spaces';

  return {
    reportId: 'rpt-def007b-12345678-90ab-cdef-1234-567890abcdef',
    title:
      locale === 'ar'
        ? 'تقرير الفحص الشامل لموقع متجر تجريبي طويل العنوان لاختبار التجاوب على الشاشات الصغيرة'
        : 'Comprehensive Website Audit Report for Long Title Mobile Responsiveness Verification',
    locale,
    viewMode,
    version: '0.1.7',
    generatedAt: '2026-11-18T12:00:00.000Z',
    site: {
      id: 'site-1',
      projectId: 'proj-1',
      name: locale === 'ar' ? 'متجر الاختبار الإلكتروني المتكامل' : 'Enterprise Test Storefront',
      baseUrl: 'https://arabic-store.example.com/',
      platformType: 'wordpress',
      environmentType: 'staging',
      description: 'Deterministic offline fixture site for DEF-007-B layout testing',
    },
    scanRun: {
      id: 'scan-def007b-12345678-90ab-cdef-1234-567890abcdef',
      siteId: 'site-1',
      scanType: 'full',
      status: 'completed',
      targetUrl: longUrl,
      startedAt: '2026-11-18T11:55:00.000Z',
      completedAt: '2026-11-18T11:59:30.000Z',
      cancelledAt: null,
      durationMs: 270_000,
      config: {
        maxPages: 25,
        enableBrowserAudit: true,
        viewportProfiles: ['small-mobile', 'mobile', 'tablet', 'desktop'],
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
      urlsCrawled: 12,
      crawlFailedPages: 1,
      pagesScanned: 11,
      pagesFailed: 1,
      browserPagesAudited: 8,
      browserFailedPages: 0,
      screenshotsCaptured: 2,
      staticModulesExecuted: 5,
      staticModulesTotal: 5,
      staticPagesAnalyzed: 11,
      runtimeAuditsCompleted: 8,
      viewportsCompleted: 32,
      accessibilityCandidatesTotal: 8,
      accessibilityAuditsCompleted: 8,
      layoutStabilityPagesCompleted: 8,
      browserCandidatesTotal: 8,
      browserCandidatesSkipped: 0,
      isPartialCoverage: false,
      coverageStatus: 'full',
      browserCoverageStatus: 'full',
      staticCoverageStatus: 'full',
      completedEngines: ['crawler', 'analyzers', 'browser'],
      performanceMetrics: {
        summary: {
          pagesMeasured: 8,
          metrics: {
            lcpMs: { median: 3200, p75: 3800, p95: 4200, rating: 'needs-improvement', sampleCount: 8 },
            cls: { median: 0.14, p75: 0.18, p95: 0.22, rating: 'needs-improvement', sampleCount: 8 },
            tbtMs: { median: 280, p75: 420, p95: 550, rating: 'needs-improvement', sampleCount: 8 },
            ttfbMs: { median: 620, p75: 800, p95: 1100, rating: 'good', sampleCount: 8 },
            fcpMs: { median: 1650, p75: 1900, p95: 2200, rating: 'good', sampleCount: 8 },
            domInteractiveMs: { median: 1200, p75: 1500, p95: 1800, rating: 'good', sampleCount: 8 },
            loadMs: { median: 3600, p75: 4100, p95: 4800, rating: 'needs-improvement', sampleCount: 8 },
          },
          resources: {
            totalRequestsMedian: 48,
            totalTransferSizeMedianBytes: 1_850_000,
            failedRequestsTotal: 2,
            thirdPartyRequestsMedian: 12,
            thirdPartyTransferSizeMedianBytes: 420_000,
          },
          bottlenecks: [
            {
              ruleId: 'PERF_LARGE_LCP_IMAGE',
              severity: 'high',
              title: 'Large unoptimized hero image delaying Largest Contentful Paint',
              description: 'The main hero image exceeds 900 KB and lacks explicit dimensions or preload.',
              category: 'performance',
              observedValueText: '3,200 ms',
              thresholdText: '2,500 ms',
            },
          ],
        },
        pages: [
          {
            url: longUrl,
            labMetrics: { lcpMs: 3200, cls: 0.14, tbtMs: 280, ttfbMs: 620 },
            resourceSummary: { totalRequests: 48, totalTransferSizeBytes: 1_850_000 },
          },
        ],
      },
    },
    summary: {
      totalFindings: 4,
      bySeverity: { critical: 1, high: 1, medium: 1, low: 1, info: 0 },
      byCategory: {
        security: 1,
        wordpress: 1,
        responsive: 1,
        accessibility: 1,
      },
      confirmedCount: 3,
      firmCount: 1,
      potentialCount: 0,
      pagesScanned: 11,
      pagesFailed: 1,
      browserPagesAudited: 8,
      screenshotsCaptured: 2,
      scanDurationMs: 270_000,
      scanStatus: 'completed',
      completedEngines: ['crawler', 'analyzers', 'browser'],
      browserCandidatesTotal: 8,
      browserCandidatesSkipped: 0,
      isPartialCoverage: false,
      coverageStatus: 'full',
      browserCoverageStatus: 'full',
      staticCoverageStatus: 'full',
      generatedAt: '2026-11-18T12:00:00.000Z',
    },
    findings: [
      {
        id: 'find-1',
        scanRunId: 'scan-def007b',
        ruleId: 'SEC_CSP_MISSING_DIRECTIVES',
        category: 'security',
        title: 'Missing Content-Security-Policy header on application responses',
        description:
          'No restrictive Content-Security-Policy header was detected on HTML documents, increasing exposure to cross-site scripting.',
        severity: 'critical',
        confidence: 'confirmed',
        status: 'open',
        targetUrl: longUrl,
        selector: longSelector,
        evidence: {
          headerName: 'content-security-policy',
          rawValue:
            'very-long-unbroken-token-value-without-spaces-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        },
        remediation:
          'Configure a strict Content-Security-Policy header limiting script-src and object-src origins.',
        references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP'],
        createdAt: '2026-11-18T11:58:00.000Z',
        screenshotAttachments: [
          {
            id: 'shot-1',
            pageUrl: longUrl,
            viewportId: 'small-mobile',
            viewportName: 'Small Mobile',
            viewportCategory: 'mobile',
            width: 360,
            height: 800,
            captureType: 'viewport',
            relativePath: 'screenshots/mobile.png',
            fileName: 'mobile.png',
            status: 'captured',
            dataUri: TINY_PNG_DATA_URI,
            isEmbedded: true,
          },
        ],
      },
      {
        id: 'find-2',
        scanRunId: 'scan-def007b',
        ruleId: 'WP_EXPOSED_REST_USERS',
        category: 'wordpress',
        title: 'WordPress REST API user enumeration endpoint publicly accessible',
        description: 'The /wp-json/wp/v2/users endpoint returned author metadata without authentication.',
        severity: 'high',
        confidence: 'confirmed',
        status: 'open',
        targetUrl: `${longUrl}/wp-json/wp/v2/users`,
        selector: null,
        evidence: {
          endpoint: '/wp-json/wp/v2/users',
          statusCode: 200,
        },
        remediation: 'Restrict unauthenticated access to wp/v2/users or disable user enumeration.',
        references: null,
        createdAt: '2026-11-18T11:58:10.000Z',
      },
      {
        id: 'find-3',
        scanRunId: 'scan-def007b',
        ruleId: 'RESP_HORIZONTAL_OVERFLOW',
        category: 'responsive',
        title: 'Horizontal overflow detected on mobile viewport (390px)',
        description: 'Elements exceed the mobile viewport width by 42px.',
        severity: 'medium',
        confidence: 'confirmed',
        status: 'open',
        targetUrl: longUrl,
        selector: longSelector,
        evidence: {
          viewportId: 'mobile',
          viewportName: 'Mobile 390',
          viewportWidth: 390,
          overflowPx: 42,
        },
        remediation: 'Constrain wide containers with max-width: 100% and box-sizing: border-box.',
        references: null,
        createdAt: '2026-11-18T11:58:20.000Z',
      },
      {
        id: 'find-4',
        scanRunId: 'scan-def007b',
        ruleId: 'A11Y_LOW_CONTRAST',
        category: 'accessibility',
        title: 'Insufficient text color contrast ratio on navigation links',
        description: 'Contrast ratio measured at 2.8:1 (WCAG AA requires 4.5:1 for normal text).',
        severity: 'low',
        confidence: 'firm',
        status: 'open',
        targetUrl: longUrl,
        selector: 'nav.main-menu > ul > li > a.nav-link',
        evidence: {
          contrastRatio: '2.8:1',
        },
        remediation: 'Increase foreground-to-background contrast to at least 4.5:1.',
        references: null,
        createdAt: '2026-11-18T11:58:30.000Z',
      },
    ],
    visualEvidenceGallery: [
      {
        id: 'shot-1',
        pageUrl: longUrl,
        viewportId: 'small-mobile',
        viewportName: 'Small Mobile',
        viewportCategory: 'mobile',
        width: 360,
        height: 800,
        captureType: 'viewport',
        relativePath: 'screenshots/mobile.png',
        fileName: 'mobile.png',
        status: 'captured',
        dataUri: TINY_PNG_DATA_URI,
        isEmbedded: true,
        findingIds: ['find-1', 'find-3'],
      },
      {
        id: 'shot-2',
        pageUrl: 'https://arabic-store.example.com/',
        viewportId: 'desktop',
        viewportName: 'Desktop',
        viewportCategory: 'desktop',
        width: 1440,
        height: 900,
        captureType: 'viewport',
        relativePath: 'screenshots/desktop.png',
        fileName: 'desktop.png',
        status: 'captured',
        dataUri: TINY_PNG_DATA_URI,
        isEmbedded: true,
        findingIds: [],
      },
    ],
  };
}

describe('DEF-007-B: Actual Browser Viewport & RTL/LTR Overflow Verification', () => {
  let browser: Browser;

  const locales: ReportLocale[] = ['ar', 'en'];
  const viewModes: ReportViewMode[] = ['simple', 'technical', 'dual'];
  const viewports = [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-360', width: 360, height: 800 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ];

  beforeAll(async () => {
    const discovered = await discoverBrowser();
    browser = await chromium.launch({
      headless: true,
      executablePath: discovered.executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }, 30000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('verifies ZERO unintended horizontal page overflow and verifies layout invariants across all (Locale × ViewMode × Viewport) combinations', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const measurements: Array<{
      locale: string;
      viewMode: string;
      viewport: string;
      scrollWidth: number;
      clientWidth: number;
      overflowPx: number;
      offendingElements: Array<{ tag: string; className: string; scrollW: number; clientW: number; rectRight: number; rectLeft: number }>;
    }> = [];

    try {
      for (const locale of locales) {
        for (const viewMode of viewModes) {
          const model = buildRichFixtureModel(locale, viewMode);
          const html = generateHtmlReport(model);
          await page.setContent(html, { waitUntil: 'domcontentloaded' });

          for (const vp of viewports) {
            await page.setViewportSize({ width: vp.width, height: vp.height });

            const result = await page.evaluate(() => {
              const docEl = document.documentElement;
              const bodyEl = document.body;
              const clientWidth = docEl.clientWidth;
              const scrollWidth = docEl.scrollWidth;
              const dir = bodyEl.getAttribute('dir');

              // Check view mode radio visibility contracts
              const simpleEls = document.querySelectorAll('.audience-simple');
              const techEls = document.querySelectorAll('.audience-technical');
              let visibleSimple = 0;
              let visibleTech = 0;
              simpleEls.forEach(el => {
                if (getComputedStyle(el).display !== 'none') visibleSimple++;
              });
              techEls.forEach(el => {
                if (getComputedStyle(el).display !== 'none') visibleTech++;
              });

              // Inspect nested elements for horizontal overflow outside viewport bounds
              const offenders: Array<{
                tag: string;
                className: string;
                scrollW: number;
                clientW: number;
                rectRight: number;
                rectLeft: number;
              }> = [];

              const allEls = document.querySelectorAll('body *');
              allEls.forEach(el => {
                const style = getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return;
                // Scrollable pre/code blocks with overflow-x: auto are intentionally horizontally scrollable within their box,
                // so check bounding rect against viewport instead of internal scrollWidth for overflow-x: auto elements
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;

                if (rect.right > clientWidth + 1 || rect.left < -1) {
                  offenders.push({
                    tag: el.tagName.toLowerCase(),
                    className: typeof el.className === 'string' ? el.className : '',
                    scrollW: (el as HTMLElement).scrollWidth,
                    clientW: (el as HTMLElement).clientWidth,
                    rectRight: Math.round(rect.right * 100) / 100,
                    rectLeft: Math.round(rect.left * 100) / 100,
                  });
                }
              });

              // Verify no unintended clipping on Arabic/English headings, labels, and badges
              const clippedTexts: Array<{ tag: string; className: string; scrollW: number; clientW: number }> = [];
              const textSelectors =
                '.report-main-title, .section-title, .finding-title, .triad-value, .chart-card-title, .chart-row-label, .chart-row-value, .meta-label, .vm-tab, .badge, .status-badge';
              document.querySelectorAll(textSelectors).forEach(el => {
                const st = getComputedStyle(el);
                if (st.display === 'none' || st.visibility === 'hidden') return;
                const htmlEl = el as HTMLElement;
                if (htmlEl.clientWidth > 0 && htmlEl.scrollWidth > htmlEl.clientWidth + 2) {
                  clippedTexts.push({
                    tag: htmlEl.tagName.toLowerCase(),
                    className: typeof htmlEl.className === 'string' ? htmlEl.className : '',
                    scrollW: htmlEl.scrollWidth,
                    clientW: htmlEl.clientWidth,
                  });
                }
              });

              // Verify 7 charts are rendered
              const chartCards = document.querySelectorAll('.chart-card').length;

              return {
                dir,
                clientWidth,
                scrollWidth,
                overflowPx: Math.max(0, scrollWidth - clientWidth),
                visibleSimple,
                visibleTech,
                chartCards,
                clippedTexts,
                offenders: offenders.slice(0, 15),
              };
            });

            expect(result.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
            expect(result.chartCards).toBe(7);
            expect(result.clippedTexts).toEqual([]);

            if (viewMode === 'simple') {
              expect(result.visibleSimple).toBeGreaterThan(0);
              expect(result.visibleTech).toBe(0);
            } else if (viewMode === 'technical') {
              expect(result.visibleTech).toBeGreaterThan(0);
              expect(result.visibleSimple).toBe(0);
            } else {
              expect(result.visibleSimple).toBeGreaterThan(0);
              expect(result.visibleTech).toBeGreaterThan(0);
            }

            measurements.push({
              locale,
              viewMode,
              viewport: `${vp.width}x${vp.height}`,
              scrollWidth: result.scrollWidth,
              clientWidth: result.clientWidth,
              overflowPx: result.overflowPx,
              offendingElements: result.offenders,
            });
          }
        }
      }
    } finally {
      await context.close();
    }

    const failures = measurements.filter(
      m => m.scrollWidth > m.clientWidth || m.offendingElements.length > 0,
    );
    if (failures.length > 0) {
      console.error('OVERFLOW FAILURES DETECTED:', JSON.stringify(failures, null, 2));
    }
    console.info(
      'DEF-007-B VIEWPORT MEASUREMENTS:',
      JSON.stringify(
        measurements.map(m => ({
          locale: m.locale,
          viewMode: m.viewMode,
          viewport: m.viewport,
          scrollWidth: m.scrollWidth,
          clientWidth: m.clientWidth,
          overflowPx: m.overflowPx,
        })),
      ),
    );
    expect(measurements).toHaveLength(24);
    expect(failures).toEqual([]);
  }, 60000);

  it('verifies interactive pure-CSS view-mode switching preserves DOM evidence and print media renders cleanly in Arabic RTL', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    try {
      const model = buildRichFixtureModel('ar', 'simple');
      const html = generateHtmlReport(model);
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      // Initially Simple mode: technical nodes exist in DOM (never deleted), hidden by CSS
      const initialCounts = await page.evaluate(() => ({
        techDomCount: document.querySelectorAll('.audience-technical').length,
        techVisibleCount: Array.from(document.querySelectorAll('.audience-technical')).filter(
          el => getComputedStyle(el).display !== 'none',
        ).length,
        simpleVisibleCount: Array.from(document.querySelectorAll('.audience-simple')).filter(
          el => getComputedStyle(el).display !== 'none',
        ).length,
      }));
      expect(initialCounts.techDomCount).toBeGreaterThan(0);
      expect(initialCounts.techVisibleCount).toBe(0);
      expect(initialCounts.simpleVisibleCount).toBeGreaterThan(0);

      // Click Technical tab label (zero JS)
      await page.click('.vm-tab-technical');
      const techCounts = await page.evaluate(() => ({
        techVisibleCount: Array.from(document.querySelectorAll('.audience-technical')).filter(
          el => getComputedStyle(el).display !== 'none',
        ).length,
        simpleVisibleCount: Array.from(document.querySelectorAll('.audience-simple')).filter(
          el => getComputedStyle(el).display !== 'none',
        ).length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(techCounts.techVisibleCount).toBe(initialCounts.techDomCount);
      expect(techCounts.simpleVisibleCount).toBe(0);
      expect(techCounts.scrollWidth).toBeLessThanOrEqual(techCounts.clientWidth);

      // Click Dual tab label (zero JS)
      await page.click('.vm-tab-dual');
      const dualCounts = await page.evaluate(() => ({
        techVisibleCount: Array.from(document.querySelectorAll('.audience-technical')).filter(
          el => getComputedStyle(el).display !== 'none',
        ).length,
        simpleVisibleCount: Array.from(document.querySelectorAll('.audience-simple')).filter(
          el => getComputedStyle(el).display !== 'none',
        ).length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(dualCounts.techVisibleCount).toBe(initialCounts.techDomCount);
      expect(dualCounts.simpleVisibleCount).toBeGreaterThan(0);
      expect(dualCounts.scrollWidth).toBeLessThanOrEqual(dualCounts.clientWidth);

      // Emulate print media at 768x1024 and verify no-print hides switcher bar and layout has zero overflow
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.emulateMedia({ media: 'print' });
      const printResult = await page.evaluate(() => ({
        switcherDisplay: getComputedStyle(document.querySelector('.vm-switcher-bar')!).display,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(printResult.switcherDisplay).toBe('none');
      expect(printResult.scrollWidth).toBeLessThanOrEqual(printResult.clientWidth);
    } finally {
      await context.close();
    }
  }, 30000);
});
