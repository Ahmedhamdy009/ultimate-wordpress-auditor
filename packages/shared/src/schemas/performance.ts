import { z } from 'zod';

/**
 * Metric rating classifications adhering to standard Web Vitals ranges.
 */
export const METRIC_RATINGS = ['good', 'needs_improvement', 'poor'] as const;
export type MetricRating = (typeof METRIC_RATINGS)[number];
export const MetricRatingSchema = z.enum(METRIC_RATINGS);

/**
 * LCP measurement completeness states to transparently identify whether an observation
 * was lifecycle-settled, artificially capped by timeout, unavailable, or interrupted.
 */
export const LCP_COMPLETENESS_STATES = [
  'complete',
  'capped',
  'unavailable',
  'interrupted',
] as const;
export type LcpCompletenessState = (typeof LCP_COMPLETENESS_STATES)[number];
export const LcpCompletenessStateSchema = z.enum(LCP_COMPLETENESS_STATES);

/**
 * Navigation Timing metrics extracted from PerformanceNavigationTiming.
 * Strictly distinguishes TTFB (transit + queue/wait) from pure server processing.
 */
export const NavigationTimingDataSchema = z.object({
  redirectDurationMs: z.number().min(0).nullable(),
  dnsLookupMs: z.number().min(0).nullable(),
  tcpConnectMs: z.number().min(0).nullable(),
  tlsHandshakeMs: z.number().min(0).nullable(),
  ttfbMs: z.number().min(0).nullable(),
  contentDownloadMs: z.number().min(0).nullable(),
  domInteractiveMs: z.number().min(0).nullable(),
  domContentLoadedMs: z.number().min(0).nullable(),
  loadEventMs: z.number().min(0).nullable(),
  transferSizeBytes: z.number().min(0).nullable(),
  encodedBodySizeBytes: z.number().min(0).nullable(),
  decodedBodySizeBytes: z.number().min(0).nullable(),
  serverProcessingMs: z.number().min(0).nullable(), // Isolated ONLY when Server-Timing header is available
  hasServerTiming: z.boolean(),
});
export type NavigationTimingData = z.infer<typeof NavigationTimingDataSchema>;

/**
 * Paint Timing metrics (First Paint and First Contentful Paint).
 */
export const PaintTimingDataSchema = z.object({
  firstPaintMs: z.number().min(0).nullable(),
  firstContentfulPaintMs: z.number().min(0).nullable(),
});
export type PaintTimingData = z.infer<typeof PaintTimingDataSchema>;

/**
 * Bounding box of a candidate element on screen.
 */
export const ElementBoundingRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type ElementBoundingRect = z.infer<typeof ElementBoundingRectSchema>;

/**
 * Largest Contentful Paint (LCP) candidate data.
 */
export const LcpCandidateDataSchema = z.object({
  elementSelector: z.string().nullable(),
  elementTagName: z.string().nullable(),
  elementUrl: z.string().nullable(),
  renderTimeMs: z.number().min(0).nullable(),
  loadTimeMs: z.number().min(0).nullable(),
  size: z.number().min(0).nullable(),
  boundingBox: ElementBoundingRectSchema.nullable(),
  completenessState: LcpCompletenessStateSchema,
  isCapped: z.boolean(),
  limitationNotice: z.string().nullable(),
});
export type LcpCandidateData = z.infer<typeof LcpCandidateDataSchema>;

/**
 * Total Blocking Time (TBT) metrics and long-task summary.
 * Quantifies empirical main-thread contention between FCP and page settle.
 */
export const TbtDataSchema = z.object({
  totalBlockingTimeMs: z.number().min(0).nullable(),
  longTasksCount: z.number().int().min(0),
  maxLongTaskDurationMs: z.number().min(0).nullable(),
  fcpTimeMs: z.number().min(0).nullable(),
  observationWindowMs: z.number().min(0).nullable(),
});
export type TbtData = z.infer<typeof TbtDataSchema>;

/**
 * Cumulative Layout Shift (CLS) session window metrics.
 * Unified with layout stability collector.
 */
export const ClsDataSchema = z.object({
  sessionWindowCls: z.number().min(0).nullable(),
  rawCls: z.number().min(0).nullable(),
  totalShiftsCount: z.number().int().min(0),
  sessionWindowsCount: z.number().int().min(0),
  maxSingleShiftValue: z.number().min(0).nullable(),
});
export type ClsData = z.infer<typeof ClsDataSchema>;

/**
 * Comprehensive Lab Web Vitals and timing metrics collected during an automated browser audit.
 * Missing or unsupported metrics remain strictly null.
 */
export const LabWebVitalsMetricsSchema = z.object({
  ttfbMs: z.number().min(0).nullable(),
  fcpMs: z.number().min(0).nullable(),
  lcpMs: z.number().min(0).nullable(),
  cls: z.number().min(0).nullable(),
  tbtMs: z.number().min(0).nullable(),
  inp: z.null(), // Fundamentally null in lab sessions
  inpStatus: z.literal('unsupported_in_lab'),
  navigationTiming: NavigationTimingDataSchema.nullable(),
  paintTiming: PaintTimingDataSchema.nullable(),
  lcpDetails: LcpCandidateDataSchema.nullable(),
  tbtDetails: TbtDataSchema.nullable(),
  clsDetails: ClsDataSchema.nullable(),
  methodologyNotice: z.string(),
});
export type LabWebVitalsMetrics = z.infer<typeof LabWebVitalsMetricsSchema>;

/**
 * Official Web Vitals threshold definitions.
 */
export const WEB_VITALS_THRESHOLDS = Object.freeze({
  ttfb: {
    goodMaxMs: 800,
    needsImprovementMaxMs: 1800,
  },
  fcp: {
    goodMaxMs: 1800,
    needsImprovementMaxMs: 3000,
  },
  lcp: {
    goodMaxMs: 2500,
    needsImprovementMaxMs: 4000,
  },
  cls: {
    goodMax: 0.1,
    needsImprovementMax: 0.25,
  },
  tbt: {
    goodMaxMs: 200,
    needsImprovementMaxMs: 600,
  },
});

/**
 * Helper to evaluate a metric value against standard thresholds.
 */
export function rateWebVitalMetric(
  metric: 'ttfb' | 'fcp' | 'lcp' | 'cls' | 'tbt',
  value: number | null | undefined,
): MetricRating | null {
  if (value === null || value === undefined || isNaN(value)) {
    return null;
  }
  const threshold = WEB_VITALS_THRESHOLDS[metric];
  if (metric === 'cls') {
    if (value <= (threshold as { goodMax: number }).goodMax) return 'good';
    if (value <= (threshold as { needsImprovementMax: number }).needsImprovementMax)
      return 'needs_improvement';
    return 'poor';
  }
  const t = threshold as { goodMaxMs: number; needsImprovementMaxMs: number };
  if (value <= t.goodMaxMs) return 'good';
  if (value <= t.needsImprovementMaxMs) return 'needs_improvement';
  return 'poor';
}

/**
 * Resource transfer classification state.
 * Strictly distinguishes transferred, cached, TAO-restricted, zero-byte, opaque cross-origin, and unknown.
 */
export const RESOURCE_TRANSFER_STATES = [
  'transferred',
  'cached',
  'tao_restricted',
  'zero_byte',
  'opaque_cross_origin',
  'unknown',
] as const;
export type ResourceTransferState = (typeof RESOURCE_TRANSFER_STATES)[number];
export const ResourceTransferStateSchema = z.enum(RESOURCE_TRANSFER_STATES);

/**
 * Detailed timing breakdown for a resource request (all in milliseconds).
 * Missing or TAO-restricted fields remain strictly null.
 */
export const ResourceTimingPhaseDataSchema = z.object({
  dnsLookupMs: z.number().min(0).nullable(),
  tcpConnectMs: z.number().min(0).nullable(),
  tlsHandshakeMs: z.number().min(0).nullable(),
  ttfbMs: z.number().min(0).nullable(),
  contentDownloadMs: z.number().min(0).nullable(),
  workerDurationMs: z.number().min(0).nullable(),
});
export type ResourceTimingPhaseData = z.infer<typeof ResourceTimingPhaseDataSchema>;

/**
 * Analyzed individual network resource entry.
 */
export const AnalyzedResourceSchema = z.object({
  url: z.string(),
  initiatorType: z.string(),
  resourceType: z.string(),
  startTimeMs: z.number().min(0),
  durationMs: z.number().min(0),
  responseEndMs: z.number().min(0),
  transferSizeBytes: z.number().min(0).nullable(),
  encodedBodySizeBytes: z.number().min(0).nullable(),
  decodedBodySizeBytes: z.number().min(0).nullable(),
  contentLengthBytes: z.number().min(0).nullable(),
  timingAllowedByTao: z.boolean(),
  corsAllowed: z.boolean(),
  transferState: ResourceTransferStateSchema,
  timingPhases: ResourceTimingPhaseDataSchema.nullable(),
  httpStatus: z.number().int().nullable(),
  contentEncoding: z.string().nullable(),
  contentType: z.string().nullable(),
  isRenderBlocking: z.boolean(),
  renderBlockingReason: z.string().nullable(),
});
export type AnalyzedResource = z.infer<typeof AnalyzedResourceSchema>;

/**
 * Analyzed DOM or CSS image element with layout, physical pixel reconstruction, and DPR calibration.
 * Note: naturalWidth and naturalHeight represent density-corrected CSS pixels per the HTML specification,
 * while sourcePhysicalWidth and sourcePhysicalHeight represent the resolved physical bitmap pixels.
 */
export const AnalyzedImageSchema = z.object({
  elementSelector: z.string().nullable(),
  currentSrc: z.string(),
  originalSrc: z.string().nullable(),
  naturalWidth: z.number().int().min(0).nullable(), // In CSS px per HTML spec
  naturalHeight: z.number().int().min(0).nullable(), // In CSS px per HTML spec
  renderedWidth: z.number().min(0).nullable(), // In CSS px
  renderedHeight: z.number().min(0).nullable(), // In CSS px
  dpr: z.number().positive(),
  effectiveWidthPixels: z.number().min(0).nullable(), // Target physical px = round(renderedWidth * dpr)
  effectiveHeightPixels: z.number().min(0).nullable(), // Target physical px = round(renderedHeight * dpr)
  sourcePhysicalWidth: z.number().int().min(0).nullable(), // Raw physical bitmap width (resolved)
  sourcePhysicalHeight: z.number().int().min(0).nullable(), // Raw physical bitmap height (resolved)
  densityDescriptor: z.number().min(0).nullable(), // Resolved density descriptor (e.g. 1.0, 2.0)
  isOversized: z.boolean(),
  oversizedFactor: z.number().min(1).nullable(),
  format: z.string(),
  isSvg: z.boolean(),
  isAboveTheFold: z.boolean(),
  isLcpCandidate: z.boolean(),
  loadingAttribute: z.string().nullable(),
  isLazyLoadedAboveTheFold: z.boolean(),
  isBackground: z.boolean(),
  boundingBox: ElementBoundingRectSchema.nullable(),
});
export type AnalyzedImage = z.infer<typeof AnalyzedImageSchema>;

/**
 * Aggregate summary metrics across all page resources.
 */
export const ResourceSummaryMetricsSchema = z.object({
  totalResources: z.number().int().min(0),
  totalTransferSizeBytes: z.number().min(0).nullable(),
  totalEncodedSizeBytes: z.number().min(0).nullable(),
  totalDecodedSizeBytes: z.number().min(0).nullable(),
  scriptsCount: z.number().int().min(0),
  stylesheetsCount: z.number().int().min(0),
  imagesCount: z.number().int().min(0),
  fontsCount: z.number().int().min(0),
  otherCount: z.number().int().min(0),
  renderBlockingCssCount: z.number().int().min(0),
  renderBlockingJsCount: z.number().int().min(0),
  uncompressedAssetsCount: z.number().int().min(0),
  oversizedImagesCount: z.number().int().min(0),
  lazyLoadedAboveTheFoldImagesCount: z.number().int().min(0),
  taoRestrictedCount: z.number().int().min(0),
  opaqueCrossOriginCount: z.number().int().min(0),
  cachedCount: z.number().int().min(0),
  zeroByteCount: z.number().int().min(0),
  resourceBufferLimitReached: z.boolean(),
});
export type ResourceSummaryMetrics = z.infer<typeof ResourceSummaryMetricsSchema>;

/**
 * Complete result produced by ResourcePerformanceEngine.
 */
export const ResourcePerformanceResultSchema = z.object({
  summary: ResourceSummaryMetricsSchema,
  resources: z.array(AnalyzedResourceSchema),
  images: z.array(AnalyzedImageSchema),
  findings: z.array(z.any()),
});
export type ResourcePerformanceResult = z.infer<typeof ResourcePerformanceResultSchema>;

/**
 * Resource and asset performance threshold definitions.
 */
export const RESOURCE_PERFORMANCE_THRESHOLDS = Object.freeze({
  compressionMinSizeBytes: 10240, // 10 KiB
  largeJavaScriptBytes: 256000, // 250 KiB transferred
  largeJavaScriptDecodedBytes: 512000, // 500 KiB decoded
  largeStylesheetBytes: 102400, // 100 KiB transferred
  largeStylesheetDecodedBytes: 204800, // 200 KiB decoded
  oversizedImageSafetyMultiplier: 1.5,
  oversizedImageMinPixelDelta: 50,
  maxResourceBuffer: 500,
});

/**
 * Standard diagnostic bottleneck classifications for web performance.
 */
export const BOTTLENECK_CLASSIFICATIONS = [
  'SERVER_LATENCY',
  'RENDER_BLOCKING_RESOURCES',
  'RENDER_BLOCKING_CSS',
  'RENDER_BLOCKING_JS',
  'HEAVY_ASSET_PAYLOAD',
  'EXCESSIVE_JAVASCRIPT',
  'EXCESSIVE_CSS',
  'MAIN_THREAD_EXECUTION',
  'LAYOUT_INSTABILITY',
  'LCP_RESOURCE_DELAY',
  'UNCOMPRESSED_ASSETS',
  'OVERSIZED_IMAGES',
] as const;
export type BottleneckClassification = (typeof BOTTLENECK_CLASSIFICATIONS)[number];
export const BottleneckClassificationSchema = z.enum(BOTTLENECK_CLASSIFICATIONS);

/**
 * Causality classification strictly distinguishing empirically proven causal bottlenecks
 * from correlational indicators where full causation cannot be proven without deeper telemetry.
 */
export const CAUSALITY_TYPES = ['causal', 'correlational'] as const;
export type CausalityType = (typeof CAUSALITY_TYPES)[number];
export const CausalityTypeSchema = z.enum(CAUSALITY_TYPES);

/**
 * Supporting evidence structure for an individual bottleneck diagnosis.
 */
export const BottleneckSupportingEvidenceSchema = z.object({
  primaryMetricName: z.string(),
  observedValue: z.number().nullable(),
  thresholdValue: z.number(),
  unit: z.string(),
  causality: CausalityTypeSchema,
  limitations: z.array(z.string()),
  relatedMeasurements: z.record(z.string(), z.unknown()),
});
export type BottleneckSupportingEvidence = z.infer<typeof BottleneckSupportingEvidenceSchema>;

/**
 * Evidence-based bottleneck diagnosis model.
 * Enforces independence between severity (impact) and confidence (certainty).
 */
export const BottleneckDiagnosisSchema = z.object({
  classification: BottleneckClassificationSchema,
  confidence: z.enum(['confirmed', 'potential']),
  status: z.enum(['confirmed', 'potential']),
  causality: CausalityTypeSchema,
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string(),
  description: z.string(),
  targetUrl: z.string(),
  supportingEvidence: BottleneckSupportingEvidenceSchema,
  inferenceRationale: z.string(),
  limitationsNotice: z.string(),
  remediation: z.string(),
  references: z.array(z.string()),
});
export type BottleneckDiagnosis = z.infer<typeof BottleneckDiagnosisSchema>;

/**
 * Unified Performance Evidence model combining timing, resource, layout,
 * and completeness telemetry into a coherent evidence structure with provenance.
 */
export const UnifiedPerformanceEvidenceSchema = z.object({
  pageUrl: z.string(),
  auditedAt: z.string(),
  labMetrics: LabWebVitalsMetricsSchema.nullable(),
  resourceSummary: ResourceSummaryMetricsSchema.nullable(),
  resources: z.array(AnalyzedResourceSchema),
  images: z.array(AnalyzedImageSchema),
  renderBlockingResources: z.array(AnalyzedResourceSchema),
  uncompressedAssets: z.array(AnalyzedResourceSchema),
  largeJavaScriptAssets: z.array(AnalyzedResourceSchema),
  largeStylesheetAssets: z.array(AnalyzedResourceSchema),
  oversizedImages: z.array(AnalyzedImageSchema),
  lcpImageCandidate: AnalyzedImageSchema.nullable(),
  completenessState: z.object({
    lcpState: LcpCompletenessStateSchema,
    isLcpCapped: z.boolean(),
    tbtCalculated: z.boolean(),
    navigationTimingAvailable: z.boolean(),
    resourceBufferLimitReached: z.boolean(),
  }),
  limitations: z.array(z.string()),
});
export type UnifiedPerformanceEvidence = z.infer<typeof UnifiedPerformanceEvidenceSchema>;

/**
 * Bottleneck classification threshold definitions.
 */
export const BOTTLENECK_THRESHOLDS = Object.freeze({
  serverLatencyTtfbMs: 800,
  serverLatencySevereTtfbMs: 1800,
  renderBlockingFcpMs: 1800,
  renderBlockingDurationRatio: 0.5,
  heavyAssetPayloadTotalBytes: 3145728, // 3 MiB
  heavyAssetPayloadSevereTotalBytes: 5242880, // 5 MiB
  heavyAssetPayloadSingleBytes: 1048576, // 1 MiB
  heavyAssetPayloadSevereSingleBytes: 2097152, // 2 MiB
  mainThreadTbtMs: 200,
  mainThreadTbtSevereMs: 600,
  mainThreadLongTaskTotalMs: 1000,
  layoutInstabilityCls: 0.1,
  layoutInstabilitySevereCls: 0.25,
  lcpResourceDelayMs: 2500,
  lcpResourceDelaySevereMs: 4000,
  lcpResourceLoadRatio: 0.5,
  uncompressedAssetsCombinedBytes: 102400, // 100 KiB
});

/**
 * Authoritative laboratory context disclaimer.
 * Strictly communicates that automated Chromium measurements evaluate baseline rendering mechanics
 * under controlled laboratory conditions and do not represent field RUM / CrUX data.
 */
export const LABORATORY_CONTEXT_DISCLAIMER =
  'Laboratory observations captured in an automated Chromium browser session. Single-pass lab tests measure baseline rendering mechanics and resource bottlenecks in isolation, and do not represent Chrome User Experience Report (CrUX) field data. Interaction to Next Paint (INP) requires real user interaction and is fundamentally unsupported in synthetic lab audits.';

export interface ExtractedPerformanceVital {
  readonly name: 'ttfb' | 'fcp' | 'lcp' | 'cls' | 'tbt';
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly rating: 'good' | 'needs_improvement' | 'poor' | 'unavailable';
  readonly targetLabel: string;
  readonly isCapped?: boolean;
  readonly elementUrl?: string | null;
  readonly elementSelector?: string | null;
  readonly limitationNotice?: string | null;
}

export interface ExtractedPerformanceResourceSummary {
  readonly totalResources?: number;
  readonly totalTransferSizeBytes?: number;
  readonly totalEncodedSizeBytes?: number;
  readonly totalDecodedSizeBytes?: number;
  readonly renderBlockingCount?: number;
  readonly scriptsCount?: number;
  readonly stylesheetsCount?: number;
  readonly imagesCount?: number;
  readonly oversizedImagesCount?: number;
  readonly uncompressedAssetsCount?: number;
}

export interface ExtractedBottleneckEntry {
  readonly ruleId: string;
  readonly title: string;
  readonly classification: string;
  readonly causality: 'causal' | 'correlational';
  readonly severity: string;
  readonly confidence: string;
  readonly observedValueText?: string;
  readonly thresholdText?: string;
  readonly limitationsNotice?: string;
}

export interface ExtractedPerformanceSummary {
  readonly ttfb: ExtractedPerformanceVital;
  readonly fcp: ExtractedPerformanceVital;
  readonly lcp: ExtractedPerformanceVital;
  readonly cls: ExtractedPerformanceVital;
  readonly tbt: ExtractedPerformanceVital;
  readonly hasAnyData: boolean;
  readonly hasMeasuredVitals: boolean;
  readonly resources: ExtractedPerformanceResourceSummary | null;
  readonly bottleneckDiagnoses: readonly ExtractedBottleneckEntry[];
  readonly bottleneckDiagnosesCount: number;
}

/**
 * Extracts and consolidates laboratory performance metrics, Web Vitals ratings,
 * and bottleneck diagnoses from scan run summary metadata and/or finding evidence.
 *
 * Designed for unified consumption across HTML reports, JSON exports, and the React UI.
 * Gracefully returns null for legacy/historical scans with zero performance data.
 */
export function extractPerformanceSummary(
  summaryMetrics?: Record<string, unknown> | null,
  findings?:
    | readonly {
        ruleId: string;
        category?: string;
        title?: string;
        severity?: string;
        confidence?: string;
        evidence?: Record<string, unknown> | string | null;
      }[]
    | null,
): ExtractedPerformanceSummary | null {
  const lab = (summaryMetrics?.labMetrics as Record<string, unknown> | undefined | null) ?? null;
  const res =
    (summaryMetrics?.resourceSummary as Record<string, unknown> | undefined | null) ?? null;

  // Initialize Web Vitals defaults (unavailable / null)
  let ttfbVal: number | null = typeof lab?.ttfbMs === 'number' ? lab.ttfbMs : null;
  let fcpVal: number | null = typeof lab?.fcpMs === 'number' ? lab.fcpMs : null;
  let lcpVal: number | null = typeof lab?.lcpMs === 'number' ? lab.lcpMs : null;
  let clsVal: number | null = typeof lab?.cls === 'number' ? lab.cls : null;
  let tbtVal: number | null = typeof lab?.tbtMs === 'number' ? lab.tbtMs : null;
  let isLcpCapped = Boolean(lab?.isLcpCapped);
  let lcpElementUrl = typeof lab?.lcpElementUrl === 'string' ? lab.lcpElementUrl : null;
  let lcpElementSelector =
    typeof lab?.lcpElementSelector === 'string' ? lab.lcpElementSelector : null;

  const bottleneckDiagnoses: ExtractedBottleneckEntry[] = [];
  let hasPerfFinding = false;

  if (findings && Array.isArray(findings)) {
    for (const f of findings) {
      if (
        f.ruleId.startsWith('PERF_') ||
        f.category === 'static-performance' ||
        f.category === 'layout-stability'
      ) {
        hasPerfFinding = true;
      }

      const ev =
        typeof f.evidence === 'object' && f.evidence !== null
          ? (f.evidence as Record<string, unknown>)
          : null;

      if (f.ruleId === 'PERF_BOTTLENECK_DIAGNOSIS' && ev) {
        const causality: 'causal' | 'correlational' =
          ev.causality === 'causal' ? 'causal' : 'correlational';
        const classification =
          typeof ev.classification === 'string' ? ev.classification : 'UNKNOWN';
        const observedValText =
          ev.observedValue !== undefined && ev.observedValue !== null
            ? `${ev.observedValue}${ev.unit ? ` ${ev.unit}` : ''}`
            : undefined;
        const thresholdText =
          ev.thresholdValue !== undefined && ev.thresholdValue !== null
            ? `${ev.thresholdValue}${ev.unit ? ` ${ev.unit}` : ''}`
            : undefined;
        const limitationsNotice =
          typeof ev.limitationsNotice === 'string' ? ev.limitationsNotice : undefined;

        bottleneckDiagnoses.push({
          ruleId: f.ruleId,
          title: f.title ?? classification,
          classification,
          causality,
          severity: f.severity ?? 'medium',
          confidence: f.confidence ?? 'confirmed',
          observedValueText: observedValText,
          thresholdText,
          limitationsNotice,
        });

        // Fallback vitals extraction from bottleneck evidence if missing from lab summary
        if (
          ev.primaryMetricName === 'TTFB' &&
          ttfbVal === null &&
          typeof ev.observedValue === 'number'
        ) {
          ttfbVal = ev.observedValue;
        } else if (
          ev.primaryMetricName === 'FCP' &&
          fcpVal === null &&
          typeof ev.observedValue === 'number'
        ) {
          fcpVal = ev.observedValue;
        } else if (
          ev.primaryMetricName === 'LCP' &&
          lcpVal === null &&
          typeof ev.observedValue === 'number'
        ) {
          lcpVal = ev.observedValue;
        } else if (
          ev.primaryMetricName === 'CLS' &&
          clsVal === null &&
          typeof ev.observedValue === 'number'
        ) {
          clsVal = ev.observedValue;
        } else if (
          ev.primaryMetricName === 'TBT' &&
          tbtVal === null &&
          typeof ev.observedValue === 'number'
        ) {
          tbtVal = ev.observedValue;
        }
      }

      // Fallback extraction from individual lab metric findings
      if (
        f.ruleId === 'PERF_LAB_SLOW_TTFB' &&
        ttfbVal === null &&
        typeof ev?.observedValueMs === 'number'
      ) {
        ttfbVal = ev.observedValueMs;
      }
      if (
        f.ruleId === 'PERF_LAB_SLOW_FCP' &&
        fcpVal === null &&
        typeof ev?.observedValueMs === 'number'
      ) {
        fcpVal = ev.observedValueMs;
      }
      if (
        f.ruleId === 'PERF_LAB_SLOW_LCP' &&
        lcpVal === null &&
        typeof ev?.observedValueMs === 'number'
      ) {
        lcpVal = ev.observedValueMs;
        if (ev.isCapped) isLcpCapped = true;
        if (typeof ev.elementUrl === 'string') lcpElementUrl = ev.elementUrl;
        if (typeof ev.elementSelector === 'string') lcpElementSelector = ev.elementSelector;
      }
      if (
        f.ruleId === 'PERF_LAB_HIGH_CLS' &&
        clsVal === null &&
        typeof ev?.observedValue === 'number'
      ) {
        clsVal = ev.observedValue;
      }
      if (
        f.ruleId === 'PERF_LAB_HIGH_TBT' &&
        tbtVal === null &&
        typeof ev?.observedValueMs === 'number'
      ) {
        tbtVal = ev.observedValueMs;
      }
    }
  }

  const hasMeasuredVitals =
    ttfbVal !== null || fcpVal !== null || lcpVal !== null || clsVal !== null || tbtVal !== null;
  const hasResources = res !== null && Object.keys(res).length > 0;
  const hasBottlenecks = bottleneckDiagnoses.length > 0;
  const hasAnyData = hasMeasuredVitals || hasResources || hasBottlenecks || hasPerfFinding;

  // Historical scan or static-only crawl without performance telemetry
  if (!hasAnyData) {
    return null;
  }

  const ttfbRating = rateWebVitalMetric('ttfb', ttfbVal) ?? 'unavailable';
  const fcpRating = rateWebVitalMetric('fcp', fcpVal) ?? 'unavailable';
  const lcpRating = rateWebVitalMetric('lcp', lcpVal) ?? 'unavailable';
  const clsRating = rateWebVitalMetric('cls', clsVal) ?? 'unavailable';
  const tbtRating = rateWebVitalMetric('tbt', tbtVal) ?? 'unavailable';

  return {
    ttfb: {
      name: 'ttfb',
      label: 'Time to First Byte (TTFB)',
      value: ttfbVal,
      unit: 'ms',
      rating: ttfbRating,
      targetLabel: '≤ 800 ms',
      limitationNotice:
        'TTFB measures network transit and initial document response. Server execution time is not isolated without Server-Timing headers.',
    },
    fcp: {
      name: 'fcp',
      label: 'First Contentful Paint (FCP)',
      value: fcpVal,
      unit: 'ms',
      rating: fcpRating,
      targetLabel: '≤ 1,800 ms',
    },
    lcp: {
      name: 'lcp',
      label: 'Largest Contentful Paint (LCP)',
      value: lcpVal,
      unit: 'ms',
      rating: lcpRating,
      targetLabel: '≤ 2,500 ms',
      isCapped: isLcpCapped,
      elementUrl: lcpElementUrl,
      elementSelector: lcpElementSelector,
    },
    cls: {
      name: 'cls',
      label: 'Cumulative Layout Shift (CLS)',
      value: clsVal,
      unit: '',
      rating: clsRating,
      targetLabel: '≤ 0.10',
    },
    tbt: {
      name: 'tbt',
      label: 'Total Blocking Time (TBT)',
      value: tbtVal,
      unit: 'ms',
      rating: tbtRating,
      targetLabel: '≤ 200 ms',
      limitationNotice:
        'TBT measures main-thread blocking time between FCP and settle. Lab proxy for interactivity; real user INP is field-only.',
    },
    hasAnyData: true,
    hasMeasuredVitals,
    resources: hasResources
      ? {
          totalResources: typeof res?.totalResources === 'number' ? res.totalResources : undefined,
          totalTransferSizeBytes:
            typeof res?.totalTransferSizeBytes === 'number'
              ? res.totalTransferSizeBytes
              : undefined,
          totalEncodedSizeBytes:
            typeof res?.totalEncodedSizeBytes === 'number' ? res.totalEncodedSizeBytes : undefined,
          totalDecodedSizeBytes:
            typeof res?.totalDecodedSizeBytes === 'number' ? res.totalDecodedSizeBytes : undefined,
          renderBlockingCount:
            typeof res?.renderBlockingCount === 'number' ? res.renderBlockingCount : undefined,
          scriptsCount: typeof res?.scriptsCount === 'number' ? res.scriptsCount : undefined,
          stylesheetsCount:
            typeof res?.stylesheetsCount === 'number' ? res.stylesheetsCount : undefined,
          imagesCount: typeof res?.imagesCount === 'number' ? res.imagesCount : undefined,
          oversizedImagesCount:
            typeof res?.oversizedImagesCount === 'number' ? res.oversizedImagesCount : undefined,
          uncompressedAssetsCount:
            typeof res?.uncompressedAssetsCount === 'number'
              ? res.uncompressedAssetsCount
              : undefined,
        }
      : null,
    bottleneckDiagnoses,
    bottleneckDiagnosesCount: bottleneckDiagnoses.length,
  };
}
