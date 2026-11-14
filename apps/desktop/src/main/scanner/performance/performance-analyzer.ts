import type { Page } from 'playwright-core';
import type {
  AnalyzedImage,
  CreateFindingRequest,
  LabWebVitalsMetrics,
  ResourcePerformanceResult,
  UnifiedPerformanceEvidence,
} from '@auditor/shared';
import { rateWebVitalMetric, WEB_VITALS_THRESHOLDS } from '@auditor/shared';
import { PerformanceCollector } from '../../browser/performance-collector.js';
import { redactUrl } from '../../browser/redactor.js';
import { ResourcePerformanceEngine } from '../../browser/resource-performance-engine.js';
import type { CapturedNetworkResource } from '../../browser/runtime-types.js';
import type { AnalyzerFinding } from '../analyzers/types.js';
import { BottleneckClassifier } from './bottleneck-classifier.js';
import type {
  PerformanceAuditorOptions,
  PerformanceAuditResult,
  UnifiedEvidenceBuildInput,
} from './types.js';

/**
 * Builds a UnifiedPerformanceEvidence record from lab collector and resource performance results,
 * preserving strict nullability, provenance, and completeness state.
 */
export function buildUnifiedPerformanceEvidence(
  input: UnifiedEvidenceBuildInput,
): UnifiedPerformanceEvidence {
  const pageUrl = redactUrl(input.pageUrl);
  const labMetrics = input.labMetrics;
  const resourceResult = input.resourceResult;

  const resources = resourceResult?.resources ?? [];
  const images = resourceResult?.images ?? [];

  const renderBlockingResources = resources.filter(r => r.isRenderBlocking);
  const uncompressedAssets = resources.filter(
    r =>
      r.transferState === 'transferred' &&
      r.contentEncoding === null &&
      (r.transferSizeBytes ?? r.encodedBodySizeBytes ?? 0) > 10240 &&
      Boolean(
        r.contentType &&
        /^(?:text\/|application\/(?:javascript|x-javascript|json|xml)|image\/svg\+xml)/i.test(
          r.contentType,
        ),
      ),
  );

  const largeJavaScriptAssets = resources.filter(
    r =>
      r.resourceType === 'script' &&
      ((r.transferSizeBytes !== null && r.transferSizeBytes > 256000) ||
        (r.decodedBodySizeBytes !== null && r.decodedBodySizeBytes > 512000)),
  );

  const largeStylesheetAssets = resources.filter(
    r =>
      r.resourceType === 'stylesheet' &&
      ((r.transferSizeBytes !== null && r.transferSizeBytes > 102400) ||
        (r.decodedBodySizeBytes !== null && r.decodedBodySizeBytes > 204800)),
  );

  const oversizedImages = images.filter(img => img.isOversized);

  // Match LCP candidate image if available
  let lcpImageCandidate: AnalyzedImage | null = null;
  const lcpUrl = labMetrics?.lcpDetails?.elementUrl;
  const lcpSelector = labMetrics?.lcpDetails?.elementSelector;

  if (lcpUrl || lcpSelector) {
    const matched = images.find(
      img =>
        (lcpUrl && (img.currentSrc === lcpUrl || img.originalSrc === lcpUrl)) ||
        (lcpSelector && img.elementSelector === lcpSelector),
    );
    if (matched) {
      lcpImageCandidate = matched;
    }
  }

  const limitations: string[] = [];
  if (input.limitations) {
    limitations.push(...input.limitations);
  }

  const isLcpCapped =
    input.completenessState?.isLcpCapped ?? labMetrics?.lcpDetails?.isCapped ?? false;
  const lcpState =
    input.completenessState?.lcpState ??
    labMetrics?.lcpDetails?.completenessState ??
    (labMetrics?.lcpMs !== null ? 'complete' : 'unavailable');

  if (isLcpCapped) {
    limitations.push(
      'Largest Contentful Paint observation was capped by the 5,000ms deadline ceiling.',
    );
  }
  if (lcpState === 'unavailable') {
    limitations.push('No valid LCP candidate was recorded by the browser engine.');
  } else if (lcpState === 'interrupted') {
    limitations.push('Measurement was interrupted prior to settlement.');
  }

  const resourceBufferLimitReached =
    input.completenessState?.resourceBufferLimitReached ??
    resourceResult?.summary?.resourceBufferLimitReached ??
    false;

  if (resourceBufferLimitReached) {
    limitations.push(
      'Resource Timing buffer limit (500 entries) reached; some subresource entries may have been truncated.',
    );
  }

  return {
    pageUrl,
    auditedAt: new Date().toISOString(),
    labMetrics,
    resourceSummary: resourceResult?.summary ?? null,
    resources,
    images,
    renderBlockingResources,
    uncompressedAssets,
    largeJavaScriptAssets,
    largeStylesheetAssets,
    oversizedImages,
    lcpImageCandidate,
    completenessState: {
      lcpState,
      isLcpCapped,
      tbtCalculated: input.completenessState?.tbtCalculated ?? labMetrics?.tbtMs !== null,
      navigationTimingAvailable:
        input.completenessState?.navigationTimingAvailable ?? Boolean(labMetrics?.navigationTiming),
      resourceBufferLimitReached,
    },
    limitations,
  };
}

/**
 * Evaluates Web Vitals thresholds and emits specific lab metric findings.
 */
export function generateLabMetricFindings(
  metrics: LabWebVitalsMetrics | null,
  pageUrl: string,
  scanRunId: string,
): CreateFindingRequest[] {
  if (!metrics) return [];
  const findings: CreateFindingRequest[] = [];
  const cleanUrl = redactUrl(pageUrl);

  // 1. Slow TTFB Finding (Potential confidence)
  if (typeof metrics.ttfbMs === 'number' && metrics.ttfbMs > WEB_VITALS_THRESHOLDS.ttfb.goodMaxMs) {
    const rating = rateWebVitalMetric('ttfb', metrics.ttfbMs);
    const isSevere = rating === 'poor';
    findings.push({
      scanRunId,
      ruleId: 'PERF_LAB_SLOW_TTFB',
      category: 'static-performance',
      title: `Slow Time to First Byte (${metrics.ttfbMs}ms)`,
      description: `Initial document response latency (TTFB: ${metrics.ttfbMs}ms) exceeds the recommended threshold of ${WEB_VITALS_THRESHOLDS.ttfb.goodMaxMs}ms. This introduces unavoidable delay into the critical rendering path.`,
      severity: isSevere ? 'high' : 'medium',
      confidence: 'potential', // Always potential: cannot isolate origin processing without Server-Timing
      status: 'potential',
      targetUrl: cleanUrl,
      evidence: {
        metric: 'ttfb',
        observedValueMs: metrics.ttfbMs,
        thresholdMs: WEB_VITALS_THRESHOLDS.ttfb.goodMaxMs,
        rating,
        dnsLookupMs: metrics.navigationTiming?.dnsLookupMs ?? null,
        tcpConnectMs: metrics.navigationTiming?.tcpConnectMs ?? null,
        tlsHandshakeMs: metrics.navigationTiming?.tlsHandshakeMs ?? null,
        hasServerTiming: metrics.navigationTiming?.hasServerTiming ?? false,
        serverProcessingMs: metrics.navigationTiming?.serverProcessingMs ?? null,
        provenance: 'lab_collector',
        limitationNotice:
          'TTFB includes DNS, TCP, TLS, and network transit time. Server execution time is not isolated without Server-Timing.',
      },
      remediation:
        'Improve server response time by implementing page caching, optimizing database queries, and utilizing a Content Delivery Network (CDN).',
      references: ['https://web.dev/articles/ttfb'],
    });
  }

  // 2. Slow FCP Finding (Confirmed confidence)
  if (typeof metrics.fcpMs === 'number' && metrics.fcpMs > WEB_VITALS_THRESHOLDS.fcp.goodMaxMs) {
    const rating = rateWebVitalMetric('fcp', metrics.fcpMs);
    const isSevere = rating === 'poor';
    findings.push({
      scanRunId,
      ruleId: 'PERF_LAB_SLOW_FCP',
      category: 'static-performance',
      title: `Slow First Contentful Paint (${metrics.fcpMs}ms)`,
      description: `The page took ${metrics.fcpMs}ms to render the first contentful DOM element, exceeding the recommended budget of ${WEB_VITALS_THRESHOLDS.fcp.goodMaxMs}ms.`,
      severity: isSevere ? 'high' : 'medium',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: cleanUrl,
      evidence: {
        metric: 'fcp',
        observedValueMs: metrics.fcpMs,
        thresholdMs: WEB_VITALS_THRESHOLDS.fcp.goodMaxMs,
        rating,
        firstPaintMs: metrics.paintTiming?.firstPaintMs ?? null,
        provenance: 'lab_collector',
      },
      remediation:
        'Eliminate render-blocking CSS and JavaScript, inline critical styles, and preload critical fonts.',
      references: ['https://web.dev/articles/fcp'],
    });
  }

  // 3. Slow LCP Finding (Confirmed confidence)
  if (typeof metrics.lcpMs === 'number' && metrics.lcpMs > WEB_VITALS_THRESHOLDS.lcp.goodMaxMs) {
    const rating = rateWebVitalMetric('lcp', metrics.lcpMs);
    const isSevere = rating === 'poor';
    const isCapped = metrics.lcpDetails?.isCapped ?? false;

    findings.push({
      scanRunId,
      ruleId: 'PERF_LAB_SLOW_LCP',
      category: 'static-performance',
      title: `Slow Largest Contentful Paint (${metrics.lcpMs}ms)`,
      description: `Largest Contentful Paint was observed at ${metrics.lcpMs}ms, exceeding the ${WEB_VITALS_THRESHOLDS.lcp.goodMaxMs}ms threshold.${isCapped ? ' (Note: LCP observation was capped by the 5,000ms deadline ceiling).' : ''}`,
      severity: isSevere ? 'high' : 'medium',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: cleanUrl,
      evidence: {
        metric: 'lcp',
        observedValueMs: metrics.lcpMs,
        thresholdMs: WEB_VITALS_THRESHOLDS.lcp.goodMaxMs,
        rating,
        isCapped,
        completenessState: metrics.lcpDetails?.completenessState ?? 'complete',
        elementSelector: metrics.lcpDetails?.elementSelector ?? null,
        elementTagName: metrics.lcpDetails?.elementTagName ?? null,
        elementUrl: metrics.lcpDetails?.elementUrl
          ? redactUrl(metrics.lcpDetails.elementUrl)
          : null,
        renderTimeMs: metrics.lcpDetails?.renderTimeMs ?? null,
        loadTimeMs: metrics.lcpDetails?.loadTimeMs ?? null,
        size: metrics.lcpDetails?.size ?? null,
        boundingBox: metrics.lcpDetails?.boundingBox ?? null,
        limitationNotice: metrics.lcpDetails?.limitationNotice ?? null,
        provenance: 'lab_collector',
      },
      remediation:
        'Optimize LCP resource load time: preload hero image, remove loading="lazy" from hero images, and optimize hero image format.',
      references: ['https://web.dev/articles/lcp'],
    });
  }

  // 4. High TBT Finding (Confirmed confidence)
  if (typeof metrics.tbtMs === 'number' && metrics.tbtMs > WEB_VITALS_THRESHOLDS.tbt.goodMaxMs) {
    const rating = rateWebVitalMetric('tbt', metrics.tbtMs);
    const isSevere = rating === 'poor';
    findings.push({
      scanRunId,
      ruleId: 'PERF_LAB_HIGH_TBT',
      category: 'static-performance',
      title: `High Total Blocking Time (${metrics.tbtMs}ms)`,
      description: `Total main-thread blocking time between FCP and settle was ${metrics.tbtMs}ms, exceeding the ${WEB_VITALS_THRESHOLDS.tbt.goodMaxMs}ms threshold. Long-running JavaScript tasks prevent the page from responding quickly to user input.`,
      severity: isSevere ? 'high' : 'medium',
      confidence: 'confirmed',
      status: 'confirmed',
      targetUrl: cleanUrl,
      evidence: {
        metric: 'tbt',
        observedValueMs: metrics.tbtMs,
        thresholdMs: WEB_VITALS_THRESHOLDS.tbt.goodMaxMs,
        rating,
        longTasksCount: metrics.tbtDetails?.longTasksCount ?? 0,
        maxLongTaskDurationMs: metrics.tbtDetails?.maxLongTaskDurationMs ?? null,
        fcpTimeMs: metrics.tbtDetails?.fcpTimeMs ?? null,
        observationWindowMs: metrics.tbtDetails?.observationWindowMs ?? null,
        provenance: 'lab_collector',
      },
      remediation:
        'Split large JavaScript bundles, defer non-essential scripts, and break up long tasks (>50ms) using scheduler.yield().',
      references: ['https://web.dev/articles/tbt'],
    });
  }

  return findings;
}

/**
 * Consolidates findings across lab collector, resource engine, and bottleneck classifier,
 * preventing duplication while preserving all source evidence, affected resources, and provenance.
 */
export function consolidatePerformanceFindings(
  labFindings: readonly CreateFindingRequest[],
  resourceFindings: readonly AnalyzerFinding[],
  bottleneckFindings: readonly CreateFindingRequest[],
  scanRunId: string,
): CreateFindingRequest[] {
  const consolidated: CreateFindingRequest[] = [];
  const seenKeys = new Set<string>();

  const allCandidateFindings = [
    ...labFindings,
    ...resourceFindings.map(rf => ({
      scanRunId,
      ruleId: rf.ruleId,
      category: rf.category ?? 'static-performance',
      title: rf.title,
      description: rf.description,
      severity: rf.severity,
      confidence: rf.confidence ?? 'confirmed',
      status: rf.status ?? 'confirmed',
      targetUrl: rf.targetUrl,
      evidence: {
        ...(typeof rf.evidence === 'object' && rf.evidence !== null
          ? rf.evidence
          : { raw: rf.evidence }),
        provenance: 'resource_engine',
      },
      remediation: rf.remediation ?? null,
      references: rf.references ? [...rf.references] : [],
    })),
    ...bottleneckFindings,
  ];

  for (const f of allCandidateFindings) {
    const ev = (f.evidence ?? {}) as Record<string, unknown>;
    const selector = typeof ev.selector === 'string' ? ev.selector : '';
    const detail =
      typeof ev.classification === 'string'
        ? ev.classification
        : typeof ev.url === 'string'
          ? ev.url
          : '';
    const key = `${f.ruleId}::${f.targetUrl}::${selector}::${detail}`;

    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      consolidated.push(f);
    }
  }

  return consolidated;
}

/**
 * Coordinated Performance Auditor facade executing lab collection, resource analysis,
 * unified evidence assembly, and bottleneck classification in a single browser pass.
 */
export class PerformanceAuditor {
  private readonly collector: PerformanceCollector;
  private readonly resourceEngine: ResourcePerformanceEngine;
  private readonly classifier: BottleneckClassifier;

  constructor(options?: {
    collector?: PerformanceCollector;
    resourceEngine?: ResourcePerformanceEngine;
    classifier?: BottleneckClassifier;
  }) {
    this.collector = options?.collector ?? new PerformanceCollector();
    this.resourceEngine = options?.resourceEngine ?? new ResourcePerformanceEngine();
    this.classifier = options?.classifier ?? new BottleneckClassifier();
  }

  /**
   * Registers the unified in-browser init script before page navigation.
   */
  public async install(page: Page): Promise<void> {
    await this.collector.installScript(page);
  }

  /**
   * Executes performance audit on the settled page. Reuses existing page session.
   */
  public async audit(
    page: Page,
    pageUrl: string,
    networkRecords: readonly CapturedNetworkResource[] = [],
    options: PerformanceAuditorOptions = {},
  ): Promise<PerformanceAuditResult> {
    const startTime = Date.now();
    const scanRunId = options.scanRunId ?? '00000000-0000-0000-0000-000000000000';
    const isClosed = typeof page?.isClosed === 'function' ? page.isClosed() : false;
    const canEvaluate = typeof page?.evaluate === 'function';

    if (options.signal?.aborted || isClosed || !canEvaluate) {
      const emptyEvidence = buildUnifiedPerformanceEvidence({
        pageUrl,
        labMetrics: null,
        resourceResult: null,
        completenessState: {
          lcpState: options.signal?.aborted || isClosed ? 'interrupted' : 'unavailable',
        },
        limitations: [
          options.signal?.aborted || isClosed
            ? 'Measurement was cancelled or browser was closed prematurely.'
            : 'Page evaluation API is unavailable in current runtime environment.',
        ],
      });
      return {
        pageUrl: redactUrl(pageUrl),
        evidence: emptyEvidence,
        diagnoses: [],
        labMetrics: null,
        resourceSummary: null,
        findings: [],
        durationMs: Date.now() - startTime,
      };
    }

    // 1. Collect Lab Web Vitals and timing metrics
    let labResult = null;
    try {
      labResult = await this.collector.collectMetrics(page, {
        signal: options.signal,
        settleTimeoutMs: options.settleTimeoutMs ?? 500,
        maxCeilingMs: options.maxCeilingMs ?? 5000,
      });
    } catch {
      // In case of timeout or failure, proceed with partial metrics
    }

    // 2. Audit page resources and images
    let resourceResult: ResourcePerformanceResult | null = null;
    try {
      resourceResult = await this.resourceEngine.auditPage(page, networkRecords, {
        signal: options.signal,
        maxResources: options.maxResources ?? 500,
        maxImages: options.maxImages ?? 100,
        lcpUrl: labResult?.metrics.lcpDetails?.elementUrl ?? undefined,
        lcpSelector: labResult?.metrics.lcpDetails?.elementSelector ?? undefined,
      });
    } catch {
      // In case of failure, proceed with empty resource result
    }

    // 3. Assemble Unified Performance Evidence Model
    const evidence = buildUnifiedPerformanceEvidence({
      pageUrl,
      labMetrics: labResult?.metrics ?? null,
      resourceResult,
      completenessState: {
        lcpState: labResult?.completeness.lcpState ?? 'unavailable',
        isLcpCapped: labResult?.completeness.isLcpCapped ?? false,
        tbtCalculated: labResult?.completeness.tbtCalculated ?? false,
        navigationTimingAvailable: labResult?.completeness.navigationTimingAvailable ?? false,
        resourceBufferLimitReached: resourceResult?.summary.resourceBufferLimitReached ?? false,
      },
    });

    // 4. Run Bottleneck Classification Engine
    const diagnoses = this.classifier.classify(evidence);
    const bottleneckFindings = this.classifier.toFindings(diagnoses, scanRunId);

    // 5. Generate Lab Metric Findings
    const labFindings = generateLabMetricFindings(evidence.labMetrics, pageUrl, scanRunId);

    // 6. Consolidate All Findings
    const resourceFindings = resourceResult?.findings ?? [];
    const consolidatedFindings = consolidatePerformanceFindings(
      labFindings,
      resourceFindings,
      bottleneckFindings,
      scanRunId,
    );

    return {
      pageUrl: redactUrl(pageUrl),
      evidence,
      diagnoses,
      labMetrics: evidence.labMetrics,
      resourceSummary: evidence.resourceSummary,
      findings: consolidatedFindings,
      durationMs: Date.now() - startTime,
    };
  }
}
