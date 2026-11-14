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
