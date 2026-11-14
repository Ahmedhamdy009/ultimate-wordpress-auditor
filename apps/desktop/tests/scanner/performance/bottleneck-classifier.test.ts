import { describe, it, expect } from 'vitest';
import type { AnalyzedImage, AnalyzedResource, UnifiedPerformanceEvidence } from '@auditor/shared';
import { BottleneckClassifier } from '../../../src/main/scanner/performance/bottleneck-classifier.js';

describe('BottleneckClassifier', () => {
  const classifier = new BottleneckClassifier();

  const createMockResource = (overrides: Partial<AnalyzedResource> = {}): AnalyzedResource => ({
    url: 'https://example.com/asset.js',
    initiatorType: 'script',
    resourceType: 'script',
    startTimeMs: 10,
    durationMs: 80,
    responseEndMs: 90,
    transferSizeBytes: 50_000,
    encodedBodySizeBytes: 50_000,
    decodedBodySizeBytes: 120_000,
    contentLengthBytes: 50_000,
    timingAllowedByTao: true,
    corsAllowed: true,
    transferState: 'transferred',
    timingPhases: null,
    httpStatus: 200,
    contentEncoding: 'gzip',
    contentType: 'application/javascript',
    isRenderBlocking: false,
    renderBlockingReason: null,
    ...overrides,
  });

  const createMockImage = (overrides: Partial<AnalyzedImage> = {}): AnalyzedImage => ({
    elementSelector: 'img.hero',
    currentSrc: 'https://example.com/hero.jpg',
    originalSrc: 'https://example.com/hero.jpg',
    naturalWidth: 800,
    naturalHeight: 600,
    renderedWidth: 800,
    renderedHeight: 600,
    dpr: 1,
    effectiveWidthPixels: 800,
    effectiveHeightPixels: 600,
    sourcePhysicalWidth: 800,
    sourcePhysicalHeight: 600,
    densityDescriptor: 1,
    isOversized: false,
    oversizedFactor: null,
    format: 'jpeg',
    isSvg: false,
    isAboveTheFold: true,
    ...overrides,
  });

  const createBaseEvidence = (
    overrides: Partial<UnifiedPerformanceEvidence> = {},
  ): UnifiedPerformanceEvidence => ({
    pageUrl: 'https://example.com/test-page',
    auditedAt: new Date().toISOString(),
    labMetrics: {
      url: 'https://example.com/test-page',
      timestamp: Date.now(),
      ttfbMs: 150,
      fcpMs: 800,
      lcpMs: 1200,
      tbtMs: 50,
      cls: 0.02,
      navigationTiming: {
        dnsLookupMs: 20,
        tcpConnectMs: 30,
        tlsHandshakeMs: 40,
        requestTransitMs: 10,
        serverProcessingMs: 50,
        responseTransferMs: 20,
        domInteractiveMs: 500,
        domContentLoadedMs: 700,
        loadEventMs: 1100,
      },
      clsDetails: {
        rawCls: 0.02,
        totalShiftsCount: 1,
        maxSingleShiftValue: 0.02,
        shifts: [],
      },
      lcpDetails: null,
      tbtDetails: {
        rawTbt: 50,
        longTasksCount: 1,
        maxLongTaskDurationMs: 65,
        totalLongTasksDurationMs: 65,
        longTasks: [],
      },
    },
    resourceSummary: {
      totalTransferSizeBytes: 500_000,
      totalEncodedSizeBytes: 500_000,
      totalDecodedSizeBytes: 800_000,
      scriptsCount: 3,
      stylesheetsCount: 2,
      imagesCount: 4,
      fontsCount: 1,
      otherCount: 0,
      renderBlockingCssCount: 0,
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
    resources: [],
    images: [],
    renderBlockingResources: [],
    uncompressedAssets: [],
    largeJavaScriptAssets: [],
    largeStylesheetAssets: [],
    oversizedImages: [],
    lcpImageCandidate: null,
    completenessState: {
      lcpState: 'complete',
      isLcpCapped: false,
      tbtCalculated: true,
      navigationTimingAvailable: true,
      resourceBufferLimitReached: false,
    },
    limitations: [],
    ...overrides,
  });

  describe('SERVER_LATENCY Classification', () => {
    it('does not trigger when TTFB is within normal threshold (<= 800ms)', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          ttfbMs: 450,
        },
      });

      const diagnoses = classifier.classify(evidence);
      const serverDiagnosis = diagnoses.find(d => d.classification === 'SERVER_LATENCY');
      expect(serverDiagnosis).toBeUndefined();
    });

    it('triggers Potential confidence with medium severity for TTFB between 800ms and 1800ms', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          ttfbMs: 1200,
        },
      });

      const diagnoses = classifier.classify(evidence);
      const serverDiagnosis = diagnoses.find(d => d.classification === 'SERVER_LATENCY');
      expect(serverDiagnosis).toBeDefined();
      expect(serverDiagnosis!.confidence).toBe('potential');
      expect(serverDiagnosis!.causality).toBe('correlational');
      expect(serverDiagnosis!.severity).toBe('medium');
      expect(serverDiagnosis!.supportingEvidence.observedValue).toBe(1200);
      expect(serverDiagnosis!.supportingEvidence.thresholdValue).toBe(800);
    });

    it('triggers High severity with Potential confidence when TTFB > 1800ms (severity/confidence independence)', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          ttfbMs: 2500,
        },
      });

      const diagnoses = classifier.classify(evidence);
      const serverDiagnosis = diagnoses.find(d => d.classification === 'SERVER_LATENCY');
      expect(serverDiagnosis).toBeDefined();
      expect(serverDiagnosis!.severity).toBe('high');
      expect(serverDiagnosis!.confidence).toBe('potential'); // Confidence remains potential despite high severity
      expect(serverDiagnosis!.causality).toBe('correlational');
      expect(serverDiagnosis!.supportingEvidence.limitations).toContain(
        'Without Server-Timing headers, internal database query or application runtime cannot be definitively proven.',
      );
    });
  });

  describe('RENDER_BLOCKING_RESOURCES Classification', () => {
    it('does not trigger when there are no render-blocking resources', () => {
      const evidence = createBaseEvidence({
        resources: [createMockResource({ isRenderBlocking: false })],
      });

      const diagnoses = classifier.classify(evidence);
      const rbDiagnosis = diagnoses.find(d => d.classification === 'RENDER_BLOCKING_RESOURCES');
      expect(rbDiagnosis).toBeUndefined();
    });

    it('triggers Confirmed confidence and causal causality when FCP > 1800ms and blocking resources contribute heavily', () => {
      const res1 = createMockResource({
        url: 'https://example.com/blocking-theme.css',
        resourceType: 'stylesheet',
        durationMs: 800,
        isRenderBlocking: true,
      });
      const res2 = createMockResource({
        url: 'https://example.com/blocking-head.js',
        resourceType: 'script',
        durationMs: 600,
        isRenderBlocking: true,
      });

      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          fcpMs: 2600, // delay is 800ms
        },
        resources: [res1, res2],
        renderBlockingResources: [res1, res2],
      });

      const diagnoses = classifier.classify(evidence);
      const rbDiagnosis = diagnoses.find(d => d.classification === 'RENDER_BLOCKING_RESOURCES');
      expect(rbDiagnosis).toBeDefined();
      expect(rbDiagnosis!.causality).toBe('causal');
      expect(rbDiagnosis!.confidence).toBe('confirmed');
      expect(rbDiagnosis!.supportingEvidence.relatedMeasurements.blockingResourcesCount).toBe(2);
    });

    it('triggers Potential confidence and correlational causality when FCP is fast (<= 1800ms)', () => {
      const res = createMockResource({
        url: 'https://example.com/blocking-style.css',
        durationMs: 150,
        isRenderBlocking: true,
      });

      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          fcpMs: 1200, // Fast FCP despite blocking resource
        },
        resources: [res],
        renderBlockingResources: [res],
      });

      const diagnoses = classifier.classify(evidence);
      const rbDiagnosis = diagnoses.find(d => d.classification === 'RENDER_BLOCKING_RESOURCES');
      expect(rbDiagnosis).toBeDefined();
      expect(rbDiagnosis!.causality).toBe('correlational');
      expect(rbDiagnosis!.confidence).toBe('potential');
    });
  });

  describe('HEAVY_ASSET_PAYLOAD Classification', () => {
    it('triggers medium severity when total bytes exceed 3MB', () => {
      const evidence = createBaseEvidence({
        resourceSummary: {
          ...createBaseEvidence().resourceSummary!,
          totalTransferSizeBytes: 3_500_000,
        },
      });

      const diagnoses = classifier.classify(evidence);
      const heavyDiagnosis = diagnoses.find(d => d.classification === 'HEAVY_ASSET_PAYLOAD');
      expect(heavyDiagnosis).toBeDefined();
      expect(heavyDiagnosis!.severity).toBe('medium');
      expect(heavyDiagnosis!.confidence).toBe('confirmed');
      expect(heavyDiagnosis!.causality).toBe('causal');
    });

    it('triggers high severity when total bytes exceed 5MB', () => {
      const evidence = createBaseEvidence({
        resourceSummary: {
          ...createBaseEvidence().resourceSummary!,
          totalTransferSizeBytes: 6_000_000,
        },
      });

      const diagnoses = classifier.classify(evidence);
      const heavyDiagnosis = diagnoses.find(d => d.classification === 'HEAVY_ASSET_PAYLOAD');
      expect(heavyDiagnosis).toBeDefined();
      expect(heavyDiagnosis!.severity).toBe('high');
    });

    it('triggers when an individual asset exceeds 1MB even if total is below 3MB', () => {
      const giantResource = createMockResource({
        url: 'https://example.com/giant-bundle.js',
        transferSizeBytes: 1_200_000,
      });

      const evidence = createBaseEvidence({
        resourceSummary: {
          ...createBaseEvidence().resourceSummary!,
          totalTransferSizeBytes: 1_800_000,
        },
        resources: [giantResource],
      });

      const diagnoses = classifier.classify(evidence);
      const heavyDiagnosis = diagnoses.find(d => d.classification === 'HEAVY_ASSET_PAYLOAD');
      expect(heavyDiagnosis).toBeDefined();
    });
  });

  describe('MAIN_THREAD_EXECUTION Classification', () => {
    it('triggers confirmed causal diagnosis when TBT exceeds 200ms', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          tbtMs: 350,
          tbtDetails: {
            rawTbt: 350,
            longTasksCount: 4,
            maxLongTaskDurationMs: 140,
            totalLongTasksDurationMs: 550,
            longTasks: [],
          },
        },
      });

      const diagnoses = classifier.classify(evidence);
      const tbtDiagnosis = diagnoses.find(d => d.classification === 'MAIN_THREAD_EXECUTION');
      expect(tbtDiagnosis).toBeDefined();
      expect(tbtDiagnosis!.severity).toBe('medium');
      expect(tbtDiagnosis!.confidence).toBe('confirmed');
      expect(tbtDiagnosis!.causality).toBe('causal');
      expect(tbtDiagnosis!.supportingEvidence.observedValue).toBe(350);
    });

    it('escalates to high severity when TBT exceeds 600ms', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          tbtMs: 850,
        },
      });

      const diagnoses = classifier.classify(evidence);
      const tbtDiagnosis = diagnoses.find(d => d.classification === 'MAIN_THREAD_EXECUTION');
      expect(tbtDiagnosis).toBeDefined();
      expect(tbtDiagnosis!.severity).toBe('high');
      expect(tbtDiagnosis!.confidence).toBe('confirmed');
    });

    it('triggers when a single long task exceeds 500ms even if aggregate TBT was low', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          tbtMs: 150,
          tbtDetails: {
            rawTbt: 150,
            longTasksCount: 1,
            maxLongTaskDurationMs: 550,
            totalLongTasksDurationMs: 550,
            longTasks: [],
          },
        },
      });

      const diagnoses = classifier.classify(evidence);
      const tbtDiagnosis = diagnoses.find(d => d.classification === 'MAIN_THREAD_EXECUTION');
      expect(tbtDiagnosis).toBeDefined();
    });
  });

  describe('LAYOUT_INSTABILITY Classification', () => {
    it('triggers confirmed causal diagnosis when CLS > 0.1', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          cls: 0.18,
          clsDetails: {
            rawCls: 0.18,
            totalShiftsCount: 3,
            maxSingleShiftValue: 0.12,
            shifts: [],
          },
        },
      });

      const diagnoses = classifier.classify(evidence);
      const clsDiagnosis = diagnoses.find(d => d.classification === 'LAYOUT_INSTABILITY');
      expect(clsDiagnosis).toBeDefined();
      expect(clsDiagnosis!.severity).toBe('medium');
      expect(clsDiagnosis!.confidence).toBe('confirmed');
      expect(clsDiagnosis!.causality).toBe('causal');
      expect(clsDiagnosis!.supportingEvidence.observedValue).toBe(0.18);
    });

    it('escalates to high severity when CLS > 0.25', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          cls: 0.42,
        },
      });

      const diagnoses = classifier.classify(evidence);
      const clsDiagnosis = diagnoses.find(d => d.classification === 'LAYOUT_INSTABILITY');
      expect(clsDiagnosis).toBeDefined();
      expect(clsDiagnosis!.severity).toBe('high');
    });
  });

  describe('LCP_RESOURCE_DELAY Classification', () => {
    it('triggers confirmed causal diagnosis when slow LCP is tied to heavy LCP image', () => {
      const lcpImage = createMockImage({
        currentSrc: 'https://example.com/hero.jpg',
        isLcpCandidate: true,
      });

      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          lcpMs: 3400,
          lcpDetails: {
            renderTimeMs: 3400,
            loadTimeMs: 2400,
            sizeBytes: 800_000,
            elementSelector: 'img.hero',
            elementUrl: 'https://example.com/hero.jpg',
            elementTagName: 'img',
          },
        },
        images: [lcpImage],
        lcpImageCandidate: lcpImage,
      });

      const diagnoses = classifier.classify(evidence);
      const lcpDiagnosis = diagnoses.find(d => d.classification === 'LCP_RESOURCE_DELAY');
      expect(lcpDiagnosis).toBeDefined();
      expect(lcpDiagnosis!.confidence).toBe('confirmed');
      expect(lcpDiagnosis!.causality).toBe('causal');
      expect(lcpDiagnosis!.severity).toBe('medium');
    });

    it('triggers correlational causality when LCP is slow without identifiable heavy LCP asset', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          lcpMs: 3100,
          lcpDetails: {
            renderTimeMs: 3100,
            loadTimeMs: null,
            sizeBytes: null,
            elementSelector: 'div.text-block > h1',
            elementUrl: null,
            elementTagName: 'h1',
          },
        },
      });

      const diagnoses = classifier.classify(evidence);
      const lcpDiagnosis = diagnoses.find(d => d.classification === 'LCP_RESOURCE_DELAY');
      expect(lcpDiagnosis).toBeDefined();
      expect(lcpDiagnosis!.confidence).toBe('potential');
      expect(lcpDiagnosis!.causality).toBe('correlational');
    });

    it('includes capped notice when LCP observation was capped at 5000ms ceiling', () => {
      const evidence = createBaseEvidence({
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          lcpMs: 5000,
        },
        completenessState: {
          ...createBaseEvidence().completenessState,
          isLcpCapped: true,
          lcpState: 'capped',
        },
      });

      const diagnoses = classifier.classify(evidence);
      const lcpDiagnosis = diagnoses.find(d => d.classification === 'LCP_RESOURCE_DELAY');
      expect(lcpDiagnosis).toBeDefined();
      expect(lcpDiagnosis!.description).toContain('5,000ms deadline ceiling');
      expect(lcpDiagnosis!.supportingEvidence.limitations).toContain(
        'LCP observation was capped by the 5,000ms ceiling prior to complete lifecycle settlement.',
      );
    });
  });

  describe('UNCOMPRESSED_ASSETS Classification', () => {
    it('triggers confirmed diagnosis with low severity for single uncompressed text resource', () => {
      const uncompressedRes = createMockResource({
        url: 'https://example.com/app.js',
        transferSizeBytes: 45_000,
        contentEncoding: null, // Uncompressed
      });

      const evidence = createBaseEvidence({
        resources: [uncompressedRes],
        uncompressedAssets: [uncompressedRes],
      });

      const diagnoses = classifier.classify(evidence);
      const uncompDiagnosis = diagnoses.find(d => d.classification === 'UNCOMPRESSED_ASSETS');
      expect(uncompDiagnosis).toBeDefined();
      expect(uncompDiagnosis!.confidence).toBe('confirmed');
      expect(uncompDiagnosis!.causality).toBe('causal');
      expect(uncompDiagnosis!.severity).toBe('low');
    });

    it('escalates to medium severity when more than 3 uncompressed text assets exist', () => {
      const uncompressedList = [1, 2, 3, 4].map(idx =>
        createMockResource({
          url: `https://example.com/asset-${idx}.js`,
          transferSizeBytes: 30_000,
          contentEncoding: null,
        }),
      );

      const evidence = createBaseEvidence({
        resources: uncompressedList,
        uncompressedAssets: uncompressedList,
      });

      const diagnoses = classifier.classify(evidence);
      const uncompDiagnosis = diagnoses.find(d => d.classification === 'UNCOMPRESSED_ASSETS');
      expect(uncompDiagnosis).toBeDefined();
      expect(uncompDiagnosis!.severity).toBe('medium');
    });
  });

  describe('OVERSIZED_IMAGES Classification', () => {
    it('triggers confirmed diagnosis with low severity (proves Low severity with Confirmed confidence)', () => {
      const oversizedImg = createMockImage({
        currentSrc: 'https://example.com/oversized.jpg',
        elementSelector: 'img.sidebar-thumb',
        renderedWidth: 150,
        renderedHeight: 150,
        naturalWidth: 1200,
        naturalHeight: 1200,
        isOversized: true,
      });

      const evidence = createBaseEvidence({
        images: [oversizedImg],
        oversizedImages: [oversizedImg],
      });

      const diagnoses = classifier.classify(evidence);
      const imgDiagnosis = diagnoses.find(d => d.classification === 'OVERSIZED_IMAGES');
      expect(imgDiagnosis).toBeDefined();
      expect(imgDiagnosis!.confidence).toBe('confirmed');
      expect(imgDiagnosis!.causality).toBe('causal');
      expect(imgDiagnosis!.severity).toBe('low'); // Severity and confidence independence demonstrated
    });
  });

  describe('Missing, Restricted, and Limiting Metrics', () => {
    it('handles null and missing metrics safely without crashing or fabricating measurements', () => {
      const emptyEvidence: UnifiedPerformanceEvidence = {
        pageUrl: 'https://example.com/blank',
        auditedAt: new Date().toISOString(),
        labMetrics: null,
        resourceSummary: null,
        resources: [],
        images: [],
        renderBlockingResources: [],
        uncompressedAssets: [],
        largeJavaScriptAssets: [],
        largeStylesheetAssets: [],
        oversizedImages: [],
        lcpImageCandidate: null,
        completenessState: {
          lcpState: 'unavailable',
          isLcpCapped: false,
          tbtCalculated: false,
          navigationTimingAvailable: false,
          resourceBufferLimitReached: false,
        },
        limitations: ['Network restricted', 'Observer unavailable'],
      };

      const diagnoses = classifier.classify(emptyEvidence);
      expect(diagnoses).toHaveLength(0);
    });

    it('records resource buffer limitation notice in supporting evidence when buffer was reached', () => {
      const evidence = createBaseEvidence({
        resourceSummary: {
          ...createBaseEvidence().resourceSummary!,
          totalTransferSizeBytes: 3_500_000,
          resourceBufferLimitReached: true,
        },
        completenessState: {
          ...createBaseEvidence().completenessState,
          resourceBufferLimitReached: true,
        },
      });

      const diagnoses = classifier.classify(evidence);
      const heavyDiagnosis = diagnoses.find(d => d.classification === 'HEAVY_ASSET_PAYLOAD');
      expect(heavyDiagnosis).toBeDefined();
      expect(heavyDiagnosis!.supportingEvidence.limitations).toContain(
        'Resource timing buffer was saturated during crawl; total resource count may be capped.',
      );
    });
  });

  describe('URL Redaction & toFindings Conversion', () => {
    it('redacts sensitive query params in target URL and resource URLs', () => {
      const sensitiveUrl = 'https://example.com/dashboard?token=secret12345&user=admin';
      const evidence = createBaseEvidence({
        pageUrl: sensitiveUrl,
        labMetrics: {
          ...createBaseEvidence().labMetrics!,
          ttfbMs: 1500,
        },
      });

      const diagnoses = classifier.classify(evidence);
      expect(diagnoses[0].targetUrl).not.toContain('secret12345');
      expect(decodeURIComponent(diagnoses[0].targetUrl)).toContain('token=[REDACTED]');

      const findings = classifier.toFindings(diagnoses, 'scan-run-123');
      expect(findings).toHaveLength(1);
      expect(findings[0].scanRunId).toBe('scan-run-123');
      expect(findings[0].ruleId).toBe('PERF_BOTTLENECK_DIAGNOSIS');
      expect((findings[0].evidence as Record<string, unknown>).classification).toBe(
        'SERVER_LATENCY',
      );
      expect(decodeURIComponent(findings[0].targetUrl)).toContain('token=[REDACTED]');
      expect(findings[0].evidence).toHaveProperty('provenance', 'bottleneck_classifier');
      expect(findings[0].references).toContain('https://web.dev/articles/ttfb');
    });
  });
});
