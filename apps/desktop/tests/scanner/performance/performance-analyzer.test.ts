import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright-core';
import type {
  AnalyzedImage,
  AnalyzedResource,
  CreateFindingRequest,
  LabWebVitalsMetrics,
  ResourcePerformanceResult,
} from '@auditor/shared';
import type { AnalyzerFinding } from '../../../src/main/scanner/analyzers/types.js';
import type { PerformanceCollector } from '../../../src/main/browser/performance-collector.js';
import type { ResourcePerformanceEngine } from '../../../src/main/browser/resource-performance-engine.js';
import {
  buildUnifiedPerformanceEvidence,
  generateLabMetricFindings,
  consolidatePerformanceFindings,
  PerformanceAuditor,
} from '../../../src/main/scanner/performance/performance-analyzer.js';

describe('PerformanceAnalyzer & Subsystem Orchestration', () => {
  const createMockResource = (overrides: Partial<AnalyzedResource> = {}): AnalyzedResource => ({
    url: 'https://example.com/styles.css',
    initiatorType: 'link',
    resourceType: 'stylesheet',
    startTimeMs: 10,
    durationMs: 90,
    responseEndMs: 100,
    transferSizeBytes: 40_000,
    encodedBodySizeBytes: 40_000,
    decodedBodySizeBytes: 95_000,
    contentLengthBytes: 40_000,
    timingAllowedByTao: true,
    corsAllowed: true,
    transferState: 'transferred',
    timingPhases: null,
    httpStatus: 200,
    contentEncoding: 'gzip',
    contentType: 'text/css',
    isRenderBlocking: true,
    renderBlockingReason: 'blocking-stylesheet-in-head',
    ...overrides,
  });

  const createMockImage = (overrides: Partial<AnalyzedImage> = {}): AnalyzedImage => ({
    elementSelector: 'img.hero-banner',
    currentSrc: 'https://example.com/hero.jpg',
    originalSrc: 'https://example.com/hero.jpg',
    naturalWidth: 1600,
    naturalHeight: 900,
    renderedWidth: 800,
    renderedHeight: 450,
    dpr: 1,
    effectiveWidthPixels: 800,
    effectiveHeightPixels: 450,
    sourcePhysicalWidth: 1600,
    sourcePhysicalHeight: 900,
    densityDescriptor: 1,
    isOversized: false,
    oversizedFactor: null,
    format: 'jpeg',
    isSvg: false,
    isAboveTheFold: true,
    ...overrides,
  });

  const createMockLabMetrics = (
    overrides: Partial<LabWebVitalsMetrics> = {},
  ): LabWebVitalsMetrics => ({
    url: 'https://example.com/page',
    timestamp: Date.now(),
    ttfbMs: 250,
    fcpMs: 900,
    lcpMs: 1400,
    tbtMs: 80,
    cls: 0.01,
    navigationTiming: {
      dnsLookupMs: 15,
      tcpConnectMs: 25,
      tlsHandshakeMs: 30,
      requestTransitMs: 10,
      serverProcessingMs: 170,
      responseTransferMs: 20,
      domInteractiveMs: 500,
      domContentLoadedMs: 700,
      loadEventMs: 1100,
    },
    clsDetails: {
      rawCls: 0.01,
      totalShiftsCount: 1,
      maxSingleShiftValue: 0.01,
      shifts: [],
    },
    lcpDetails: {
      renderTimeMs: 1400,
      loadTimeMs: 800,
      sizeBytes: 250_000,
      elementSelector: 'img.hero-banner',
      elementUrl: 'https://example.com/hero.jpg',
      elementTagName: 'img',
    },
    tbtDetails: {
      rawTbt: 80,
      longTasksCount: 1,
      maxLongTaskDurationMs: 80,
      totalLongTasksDurationMs: 80,
      longTasks: [],
    },
    ...overrides,
  });

  const createMockResourceResult = (
    overrides: Partial<ResourcePerformanceResult> = {},
  ): ResourcePerformanceResult => ({
    summary: {
      totalTransferSizeBytes: 650_000,
      totalEncodedSizeBytes: 650_000,
      totalDecodedSizeBytes: 1_200_000,
      scriptsCount: 3,
      stylesheetsCount: 2,
      imagesCount: 2,
      fontsCount: 1,
      otherCount: 0,
      renderBlockingCssCount: 1,
      renderBlockingJsCount: 0,
      uncompressedAssetsCount: 0,
      oversizedImagesCount: 0,
      lazyLoadedAboveTheFoldImagesCount: 0,
      taoRestrictedCount: 0,
      opaqueCrossOriginCount: 0,
      cachedCount: 0,
      zeroByteCount: 0,
      resourceBufferLimitReached: false,
    },
    resources: [createMockResource()],
    images: [createMockImage()],
    findings: [],
    ...overrides,
  });

  describe('buildUnifiedPerformanceEvidence', () => {
    it('constructs a unified evidence model combining lab and resource telemetry', () => {
      const evidence = buildUnifiedPerformanceEvidence({
        pageUrl: 'https://example.com/page?ref=campaign',
        labMetrics: createMockLabMetrics(),
        resourceResult: createMockResourceResult(),
        completenessState: {
          lcpState: 'complete',
          isLcpCapped: false,
          tbtCalculated: true,
          navigationTimingAvailable: true,
          resourceBufferLimitReached: false,
        },
      });

      expect(evidence.pageUrl).toContain('https://example.com/page');
      expect(evidence.labMetrics?.ttfbMs).toBe(250);
      expect(evidence.resourceSummary?.totalTransferSizeBytes).toBe(650_000);
      expect(evidence.renderBlockingResources).toHaveLength(1);
      expect(evidence.lcpImageCandidate).toBeDefined();
      expect(evidence.lcpImageCandidate?.currentSrc).toBe('https://example.com/hero.jpg');
      expect(evidence.completenessState.lcpState).toBe('complete');
    });

    it('filters uncompressed, large JS, and large CSS assets correctly', () => {
      const uncompressedCss = createMockResource({
        url: 'https://example.com/uncompressed.css',
        contentEncoding: null,
        contentType: 'text/css',
        transferSizeBytes: 25_000,
      });

      const largeScript = createMockResource({
        url: 'https://example.com/bundle.js',
        resourceType: 'script',
        transferSizeBytes: 300_000,
      });

      const largeCss = createMockResource({
        url: 'https://example.com/styles.css',
        resourceType: 'stylesheet',
        transferSizeBytes: 150_000,
      });

      const oversizedImg = createMockImage({
        currentSrc: 'https://example.com/large.jpg',
        isOversized: true,
      });

      const evidence = buildUnifiedPerformanceEvidence({
        pageUrl: 'https://example.com/page',
        labMetrics: createMockLabMetrics(),
        resourceResult: createMockResourceResult({
          resources: [uncompressedCss, largeScript, largeCss],
          images: [oversizedImg],
        }),
      });

      expect(evidence.uncompressedAssets).toHaveLength(1);
      expect(evidence.uncompressedAssets[0].url).toBe('https://example.com/uncompressed.css');
      expect(evidence.largeJavaScriptAssets).toHaveLength(1);
      expect(evidence.largeJavaScriptAssets[0].url).toBe('https://example.com/bundle.js');
      expect(evidence.largeStylesheetAssets).toHaveLength(1);
      expect(evidence.largeStylesheetAssets[0].url).toBe('https://example.com/styles.css');
      expect(evidence.oversizedImages).toHaveLength(1);
      expect(evidence.oversizedImages[0].currentSrc).toBe('https://example.com/large.jpg');
    });

    it('handles null lab metrics and null resource result without fabricating values', () => {
      const evidence = buildUnifiedPerformanceEvidence({
        pageUrl: 'https://example.com/empty',
        labMetrics: null,
        resourceResult: null,
        completenessState: {
          lcpState: 'unavailable',
        },
        limitations: ['Page was inaccessible', 'Navigation timed out'],
      });

      expect(evidence.labMetrics).toBeNull();
      expect(evidence.resourceSummary).toBeNull();
      expect(evidence.resources).toEqual([]);
      expect(evidence.images).toEqual([]);
      expect(evidence.renderBlockingResources).toEqual([]);
      expect(evidence.lcpImageCandidate).toBeNull();
      expect(evidence.completenessState.lcpState).toBe('unavailable');
      expect(evidence.limitations).toContain('Page was inaccessible');
    });
  });

  describe('generateLabMetricFindings', () => {
    it('generates findings for slow TTFB, FCP, LCP, and high TBT', () => {
      const slowMetrics = createMockLabMetrics({
        ttfbMs: 1200, // > 800ms
        fcpMs: 2200, // > 1800ms
        lcpMs: 3500, // > 2500ms
        tbtMs: 450, // > 200ms
      });

      const findings = generateLabMetricFindings(
        slowMetrics,
        'https://example.com/page',
        'scan-run-001',
      );

      expect(findings.some(f => f.ruleId === 'PERF_LAB_SLOW_TTFB')).toBe(true);
      expect(findings.some(f => f.ruleId === 'PERF_LAB_SLOW_FCP')).toBe(true);
      expect(findings.some(f => f.ruleId === 'PERF_LAB_SLOW_LCP')).toBe(true);
      expect(findings.some(f => f.ruleId === 'PERF_LAB_HIGH_TBT')).toBe(true);

      const ttfbFinding = findings.find(f => f.ruleId === 'PERF_LAB_SLOW_TTFB')!;
      expect(ttfbFinding.severity).toBe('medium');
      expect(ttfbFinding.confidence).toBe('potential'); // Correlational confidence
      expect(ttfbFinding.evidence).toHaveProperty('provenance', 'lab_collector');

      const lcpFinding = findings.find(f => f.ruleId === 'PERF_LAB_SLOW_LCP')!;
      expect(lcpFinding.severity).toBe('medium');
      expect(lcpFinding.confidence).toBe('confirmed');

      const tbtFinding = findings.find(f => f.ruleId === 'PERF_LAB_HIGH_TBT')!;
      expect(tbtFinding.confidence).toBe('confirmed');
    });

    it('escalates severity to high for severely degraded metrics', () => {
      const verySlowMetrics = createMockLabMetrics({
        ttfbMs: 2000, // > 1800ms
        lcpMs: 5000, // > 4000ms
        tbtMs: 800, // > 600ms
      });

      const findings = generateLabMetricFindings(
        verySlowMetrics,
        'https://example.com/page',
        'scan-run-001',
      );

      const ttfbFinding = findings.find(f => f.ruleId === 'PERF_LAB_SLOW_TTFB')!;
      expect(ttfbFinding.severity).toBe('high');
      expect(ttfbFinding.confidence).toBe('potential'); // Severity/confidence independent!

      const lcpFinding = findings.find(f => f.ruleId === 'PERF_LAB_SLOW_LCP')!;
      expect(lcpFinding.severity).toBe('high');

      const tbtFinding = findings.find(f => f.ruleId === 'PERF_LAB_HIGH_TBT')!;
      expect(tbtFinding.severity).toBe('high');
    });

    it('emits no findings when all metrics are within good thresholds', () => {
      const goodMetrics = createMockLabMetrics({
        ttfbMs: 200,
        fcpMs: 1000,
        lcpMs: 1800,
        tbtMs: 50,
      });

      const findings = generateLabMetricFindings(
        goodMetrics,
        'https://example.com/page',
        'scan-run-001',
      );
      expect(findings).toHaveLength(0);
    });

    it('handles null metrics safely', () => {
      const findings = generateLabMetricFindings(null, 'https://example.com/page', 'scan-run-001');
      expect(findings).toHaveLength(0);
    });
  });

  describe('consolidatePerformanceFindings', () => {
    it('consolidates lab, resource, and bottleneck findings while deduplicating identical keys', () => {
      const labFindings: CreateFindingRequest[] = [
        {
          scanRunId: 'scan-run-001',
          ruleId: 'PERF_LAB_SLOW_FCP',
          category: 'static-performance',
          title: 'Slow First Contentful Paint',
          description: 'FCP was 2200ms',
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page',
          evidence: { fcpMs: 2200, provenance: 'lab_collector' },
          remediation: null,
          references: [],
        },
      ];

      const resourceFindings: AnalyzerFinding[] = [
        {
          ruleId: 'PERF_RES_RENDER_BLOCKING_CSS',
          category: 'static-performance',
          title: 'Render-blocking CSS detected',
          description: 'Head stylesheet blocks render',
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page',
          evidence: { url: 'https://example.com/styles.css' },
          remediation: 'Defer stylesheet',
          references: ['https://web.dev/articles/render-blocking-resources'],
        },
      ];

      const bottleneckFindings: CreateFindingRequest[] = [
        {
          scanRunId: 'scan-run-001',
          ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
          category: 'static-performance',
          title: 'Render-blocking resources delaying FCP',
          description: 'Synchronous resources delay rendering',
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: 'https://example.com/page',
          evidence: {
            classification: 'RENDER_BLOCKING_RESOURCES',
            provenance: 'bottleneck_classifier',
          },
          remediation: null,
          references: [],
        },
      ];

      const consolidated = consolidatePerformanceFindings(
        labFindings,
        resourceFindings,
        bottleneckFindings,
        'scan-run-001',
      );

      expect(consolidated).toHaveLength(3);
      expect(consolidated[0].ruleId).toBe('PERF_LAB_SLOW_FCP');
      expect(consolidated[1].ruleId).toBe('PERF_RES_RENDER_BLOCKING_CSS');
      expect(consolidated[1].evidence).toHaveProperty('provenance', 'resource_engine');
      expect(consolidated[2].ruleId).toBe('PERF_BOTTLENECK_DIAGNOSIS');
    });

    it('deduplicates duplicate findings sharing the same ruleId, targetUrl, selector, and detail', () => {
      const duplicateFinding1: CreateFindingRequest = {
        scanRunId: 'scan-run-001',
        ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
        category: 'static-performance',
        title: 'High Server Latency',
        description: 'TTFB was high',
        severity: 'medium',
        confidence: 'potential',
        status: 'potential',
        targetUrl: 'https://example.com/page',
        evidence: { classification: 'SERVER_LATENCY' },
        remediation: null,
        references: [],
      };

      const duplicateFinding2: CreateFindingRequest = { ...duplicateFinding1 };

      const consolidated = consolidatePerformanceFindings(
        [],
        [],
        [duplicateFinding1, duplicateFinding2],
        'scan-run-001',
      );

      expect(consolidated).toHaveLength(1);
    });
  });

  describe('PerformanceAuditor Facade Class', () => {
    it('returns empty interrupted evidence immediately if abort signal is already aborted', async () => {
      const auditor = new PerformanceAuditor();
      const abortController = new AbortController();
      abortController.abort();

      const mockPage = {
        isClosed: () => false,
      } as unknown as Page;

      const result = await auditor.audit(mockPage, 'https://example.com/cancelled', [], {
        signal: abortController.signal,
      });

      expect(result.evidence.completenessState.lcpState).toBe('interrupted');
      expect(result.findings).toHaveLength(0);
      expect(result.diagnoses).toHaveLength(0);
      expect(result.evidence.limitations).toContain(
        'Measurement was cancelled or browser was closed prematurely.',
      );
    });

    it('returns empty interrupted evidence immediately if page is closed', async () => {
      const auditor = new PerformanceAuditor();
      const mockPage = {
        isClosed: () => true,
      } as unknown as Page;

      const result = await auditor.audit(mockPage, 'https://example.com/closed', []);

      expect(result.evidence.completenessState.lcpState).toBe('interrupted');
      expect(result.findings).toHaveLength(0);
    });

    it('isolates partial collector failure and proceeds gracefully with available data', async () => {
      const mockCollector = {
        installScript: vi.fn().mockResolvedValue(undefined),
        collectMetrics: vi.fn().mockRejectedValue(new Error('Collector timeout')),
      };

      const mockResourceEngine = {
        auditPage: vi.fn().mockResolvedValue(createMockResourceResult()),
      };

      const auditor = new PerformanceAuditor({
        collector: mockCollector as unknown as PerformanceCollector,
        resourceEngine: mockResourceEngine as unknown as ResourcePerformanceEngine,
      });

      const mockPage = {
        isClosed: () => false,
      } as unknown as Page;

      const result = await auditor.audit(mockPage, 'https://example.com/partial', []);

      expect(result.labMetrics).toBeNull();
      expect(result.resourceSummary).toBeDefined();
      expect(result.evidence.completenessState.lcpState).toBe('unavailable');
    });

    it('calls installScript on underlying collector during install', async () => {
      const mockCollector = {
        installScript: vi.fn().mockResolvedValue(undefined),
      };

      const auditor = new PerformanceAuditor({
        collector: mockCollector as unknown as PerformanceCollector,
      });

      const mockPage = {} as Page;
      await auditor.install(mockPage);

      expect(mockCollector.installScript).toHaveBeenCalledWith(mockPage);
    });
  });
});
