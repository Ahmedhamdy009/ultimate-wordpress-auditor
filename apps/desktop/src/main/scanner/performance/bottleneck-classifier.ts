import type {
  AnalyzedResource,
  BottleneckDiagnosis,
  CreateFindingRequest,
  UnifiedPerformanceEvidence,
} from '@auditor/shared';
import { BOTTLENECK_THRESHOLDS } from '@auditor/shared';
import { redactUrl } from '../../browser/redactor.js';

export class BottleneckClassifier {
  /**
   * Evaluates unified performance evidence using deterministic rules to diagnose
   * performance bottlenecks, strictly distinguishing causal proof from correlation.
   */
  public classify(evidence: UnifiedPerformanceEvidence): readonly BottleneckDiagnosis[] {
    const diagnoses: BottleneckDiagnosis[] = [];
    const pageUrl = redactUrl(evidence.pageUrl);

    // 1. Server Response / Initial Document Latency (SERVER_LATENCY)
    const ttfb = evidence.labMetrics?.ttfbMs;
    if (typeof ttfb === 'number' && ttfb > BOTTLENECK_THRESHOLDS.serverLatencyTtfbMs) {
      const isSevere = ttfb > BOTTLENECK_THRESHOLDS.serverLatencySevereTtfbMs;
      diagnoses.push({
        classification: 'SERVER_LATENCY',
        confidence: 'potential', // Always potential: cannot isolate origin processing without Server-Timing
        status: 'potential',
        causality: 'correlational',
        severity: isSevere ? 'high' : 'medium', // Severity independent of confidence
        title: `Elevated Time to First Byte (${ttfb}ms)`,
        description: `Initial document response latency (${ttfb}ms) exceeded the recommended threshold of ${BOTTLENECK_THRESHOLDS.serverLatencyTtfbMs}ms. This introduces unavoidable delay into the critical rendering path.`,
        targetUrl: pageUrl,
        supportingEvidence: {
          primaryMetricName: 'ttfbMs',
          observedValue: ttfb,
          thresholdValue: BOTTLENECK_THRESHOLDS.serverLatencyTtfbMs,
          unit: 'ms',
          causality: 'correlational',
          limitations: [
            'TTFB includes DNS lookup, TCP connect, TLS handshake, request transit, proxy delay, and origin response time.',
            'Without Server-Timing headers, internal database query or application runtime cannot be definitively proven.',
          ],
          relatedMeasurements: {
            dnsLookupMs: evidence.labMetrics?.navigationTiming?.dnsLookupMs ?? null,
            tcpConnectMs: evidence.labMetrics?.navigationTiming?.tcpConnectMs ?? null,
            tlsHandshakeMs: evidence.labMetrics?.navigationTiming?.tlsHandshakeMs ?? null,
            hasServerTiming: evidence.labMetrics?.navigationTiming?.hasServerTiming ?? false,
            serverProcessingMs: evidence.labMetrics?.navigationTiming?.serverProcessingMs ?? null,
          },
        },
        inferenceRationale:
          'TTFB reflects cumulative transit and server queuing latency. While an elevated TTFB delays all downstream assets, origin execution cannot be isolated without server-side instrumentation.',
        limitationsNotice:
          'TTFB was measured from within a local Chromium lab session via Navigation Timing. Server-side script execution time was not directly isolated.',
        remediation:
          'Investigate backend database query latency, implement full-page server caching, enable object caching (Redis/Memcached), and deploy a CDN edge cache.',
        references: ['https://web.dev/articles/ttfb'],
      });
    }

    // 2. Render-Blocking Resources (RENDER_BLOCKING_RESOURCES)
    const blockingResources =
      evidence.renderBlockingResources && evidence.renderBlockingResources.length > 0
        ? evidence.renderBlockingResources
        : (evidence.resources ?? []).filter(r => r.isRenderBlocking);
    if (blockingResources.length > 0) {
      const fcp = evidence.labMetrics?.fcpMs;
      const totalBlockingDuration = blockingResources.reduce(
        (acc: number, r: AnalyzedResource) => acc + r.durationMs,
        0,
      );
      const isFcpSlow = typeof fcp === 'number' && fcp > BOTTLENECK_THRESHOLDS.renderBlockingFcpMs;

      // Causal proof requires: slow FCP, at least 2 blocking resources, and blocking duration >= 50% of FCP
      const isCausal =
        isFcpSlow &&
        blockingResources.length >= 2 &&
        totalBlockingDuration >= fcp * BOTTLENECK_THRESHOLDS.renderBlockingDurationRatio;

      const affectedUrls = blockingResources.map((r: AnalyzedResource) => redactUrl(r.url));
      const blockingCss = blockingResources.filter(
        (r: AnalyzedResource) => r.resourceType === 'stylesheet',
      );
      const blockingJs = blockingResources.filter(
        (r: AnalyzedResource) => r.resourceType === 'script',
      );

      diagnoses.push({
        classification: 'RENDER_BLOCKING_RESOURCES',
        confidence: isCausal ? 'confirmed' : 'potential',
        status: isCausal ? 'confirmed' : 'potential',
        causality: isCausal ? 'causal' : 'correlational',
        severity: isFcpSlow && (fcp > 3000 || blockingResources.length >= 4) ? 'high' : 'medium',
        title: `${blockingResources.length} Render-Blocking Resource(s) Delaying First Paint`,
        description: `Found ${blockingResources.length} synchronous resource(s) (${blockingCss.length} CSS, ${blockingJs.length} JS) in the document <head> halting the HTML parser and delaying First Contentful Paint.`,
        targetUrl: pageUrl,
        supportingEvidence: {
          primaryMetricName: 'renderBlockingResourceCount',
          observedValue: blockingResources.length,
          thresholdValue: 0,
          unit: 'resources',
          causality: isCausal ? 'causal' : 'correlational',
          limitations: [
            'Evaluated from parser-blocking <link rel="stylesheet"> and <script> elements in <head>.',
            'Cross-origin resources without Timing-Allow-Origin may have masked duration values.',
          ],
          relatedMeasurements: {
            blockingResourcesCount: blockingResources.length,
            fcpMs: fcp,
            totalBlockingDurationMs: totalBlockingDuration,
            renderBlockingCssCount: blockingCss.length,
            renderBlockingJsCount: blockingJs.length,
            affectedResourceUrls: affectedUrls,
            isCriticalPathBlocked: isCausal,
          },
        },
        inferenceRationale: isCausal
          ? 'Resource Timing entries prove synchronous head resources accounted for the majority of FCP delay, halting document rendering.'
          : 'Render-blocking resources were detected in document head. While parser-blocking, available timing telemetry shows they accounted for less than 50% of FCP delay or timings were masked.',
        limitationsNotice:
          'Critical path render delay was determined from DOM head structure and Resource Timing entries in a single lab pass.',
        remediation:
          'Inline critical path CSS, load secondary stylesheets asynchronously with media="print" or rel="preload", and apply defer or async to all script tags in <head>.',
        references: ['https://web.dev/articles/render-blocking-resources'],
      });
    }

    // 3. Heavy Asset Payload (HEAVY_ASSET_PAYLOAD)
    const totalTransfer =
      evidence.resourceSummary?.totalTransferSizeBytes ??
      (evidence.resources ?? []).reduce(
        (sum: number, r: AnalyzedResource) => sum + (r.transferSizeBytes ?? 0),
        0,
      );
    const resources = evidence.resources ?? [];
    const maxResource = resources.reduce(
      (max: number, r: AnalyzedResource) => Math.max(max, r.transferSizeBytes ?? 0),
      0,
    );

    const isTotalHeavy =
      typeof totalTransfer === 'number' &&
      totalTransfer > BOTTLENECK_THRESHOLDS.heavyAssetPayloadTotalBytes;
    const isSingleHeavy = maxResource > BOTTLENECK_THRESHOLDS.heavyAssetPayloadSingleBytes;

    if (isTotalHeavy || isSingleHeavy) {
      const isSevere =
        (typeof totalTransfer === 'number' &&
          totalTransfer > BOTTLENECK_THRESHOLDS.heavyAssetPayloadSevereTotalBytes) ||
        maxResource > BOTTLENECK_THRESHOLDS.heavyAssetPayloadSevereSingleBytes;

      const topHeavyResources = [...resources]
        .filter(r => (r.transferSizeBytes ?? 0) > 256000)
        .sort((a, b) => (b.transferSizeBytes ?? 0) - (a.transferSizeBytes ?? 0))
        .slice(0, 5)
        .map(r => ({
          url: redactUrl(r.url),
          resourceType: r.resourceType,
          transferSizeBytes: r.transferSizeBytes,
        }));

      diagnoses.push({
        classification: 'HEAVY_ASSET_PAYLOAD',
        confidence: 'confirmed',
        status: 'confirmed',
        causality: 'causal',
        severity: isSevere ? 'high' : 'medium',
        title: `Heavy Page Asset Payload (${Math.round((totalTransfer ?? maxResource) / 1024)} KiB)`,
        description: `Page transfer size (${Math.round((totalTransfer ?? maxResource) / 1024)} KiB) exceeds recommended budgets, increasing transit time, cellular data consumption, and memory footprint.`,
        targetUrl: pageUrl,
        supportingEvidence: {
          primaryMetricName: 'totalTransferSizeBytes',
          observedValue: totalTransfer ?? maxResource,
          thresholdValue: BOTTLENECK_THRESHOLDS.heavyAssetPayloadTotalBytes,
          unit: 'bytes',
          causality: 'causal',
          limitations: [
            'Based on uncached network transfer bytes observed during the automated session.',
            'Does not account for warm browser caching on subsequent visits.',
            ...(evidence.completenessState?.resourceBufferLimitReached
              ? [
                  'Resource timing buffer was saturated during crawl; total resource count may be capped.',
                ]
              : []),
          ],
          relatedMeasurements: {
            totalTransferSizeBytes: totalTransfer,
            totalEncodedSizeBytes: evidence.resourceSummary?.totalEncodedSizeBytes,
            totalDecodedSizeBytes: evidence.resourceSummary?.totalDecodedSizeBytes,
            topHeavyResources,
          },
        },
        inferenceRationale:
          'High network byte weight directly increases transmission duration over band-constrained mobile networks.',
        limitationsNotice:
          'Evaluated over a single uncached crawl pass through the local proxy server.',
        remediation:
          'Code-split JavaScript bundles, purge unused CSS, compress images into modern AVIF/WebP formats, and enable HTTP compression.',
        references: ['https://web.dev/articles/total-byte-weight'],
      });
    }

    // 4. Main-Thread Blocking / CPU Contention (MAIN_THREAD_EXECUTION)
    const tbt = evidence.labMetrics?.tbtMs ?? null;
    const longTasksCount = evidence.labMetrics?.tbtDetails?.longTasksCount ?? 0;
    const maxLongTask = evidence.labMetrics?.tbtDetails?.maxLongTaskDurationMs ?? 0;

    if (
      (typeof tbt === 'number' && tbt > BOTTLENECK_THRESHOLDS.mainThreadTbtMs) ||
      (maxLongTask !== null && maxLongTask > 500)
    ) {
      const isSevere = typeof tbt === 'number' && tbt > BOTTLENECK_THRESHOLDS.mainThreadTbtSevereMs;
      diagnoses.push({
        classification: 'MAIN_THREAD_EXECUTION',
        confidence: 'confirmed',
        status: 'confirmed',
        causality: 'causal',
        severity: isSevere ? 'high' : 'medium',
        title: `High Total Blocking Time (${tbt ?? maxLongTask}ms)`,
        description: `Main execution thread was blocked for ${tbt ?? maxLongTask}ms between First Contentful Paint and page settle, with ${longTasksCount} long task(s) exceeding 50ms.`,
        targetUrl: pageUrl,
        supportingEvidence: {
          primaryMetricName: 'tbtMs',
          observedValue: tbt ?? maxLongTask,
          thresholdValue: BOTTLENECK_THRESHOLDS.mainThreadTbtMs,
          unit: 'ms',
          causality: 'causal',
          limitations: [
            'TBT measures long tasks between FCP and settle in an automated, non-interactive lab run.',
            'Does not measure discrete user interaction responsiveness (INP is field-only).',
          ],
          relatedMeasurements: {
            tbtMs: tbt,
            longTasksCount,
            maxLongTaskDurationMs: maxLongTask,
            fcpMs: evidence.labMetrics?.fcpMs,
            scriptsCount: evidence.resourceSummary?.scriptsCount,
          },
        },
        inferenceRationale:
          'Long tasks exceeding 50ms monopolize the Chromium main thread, preventing user interactions from being handled in a timely manner.',
        limitationsNotice:
          'Lab TBT measures non-interactive page settlement tasks; real user responsiveness requires discrete Interaction to Next Paint (INP) field data.',
        remediation:
          'Break up heavy script execution using scheduler.yield() or setTimeout(), reduce JavaScript bundle parse and compile overhead, and defer non-critical modules.',
        references: ['https://web.dev/articles/tbt'],
      });
    }

    // 5. Layout Instability (LAYOUT_INSTABILITY)
    const cls = evidence.labMetrics?.cls;
    if (typeof cls === 'number' && cls > BOTTLENECK_THRESHOLDS.layoutInstabilityCls) {
      const isSevere = cls > BOTTLENECK_THRESHOLDS.layoutInstabilitySevereCls;
      diagnoses.push({
        classification: 'LAYOUT_INSTABILITY',
        confidence: 'confirmed',
        status: 'confirmed',
        causality: 'causal',
        severity: isSevere ? 'high' : 'medium',
        title: `Significant Cumulative Layout Shift (${cls})`,
        description: `Page observed Cumulative Layout Shift score of ${cls}, exceeding the stability threshold of ${BOTTLENECK_THRESHOLDS.layoutInstabilityCls}. Elements shifted unexpectedly during page load without recent user interaction.`,
        targetUrl: pageUrl,
        supportingEvidence: {
          primaryMetricName: 'cls',
          observedValue: cls,
          thresholdValue: BOTTLENECK_THRESHOLDS.layoutInstabilityCls,
          unit: 'score',
          causality: 'causal',
          limitations: [
            'Measured over the automated session window duration.',
            'Does not evaluate shifts triggered during continuous user scrolling or post-load interactions.',
          ],
          relatedMeasurements: {
            clsScore: cls,
            rawCls: evidence.labMetrics?.clsDetails?.rawCls,
            shiftsCount: evidence.labMetrics?.clsDetails?.totalShiftsCount,
            maxSingleShift: evidence.labMetrics?.clsDetails?.maxSingleShiftValue,
          },
        },
        inferenceRationale:
          'LayoutShift observations recorded DOM elements shifting coordinates without user input, displacing content.',
        limitationsNotice: 'Evaluated over the automated session window algorithm in Chromium.',
        remediation:
          'Set explicit width and height or aspect-ratio on images, reserve space for dynamic ads/embeds, and avoid injecting content above existing elements.',
        references: ['https://web.dev/articles/cls'],
      });
    }

    // 6. Largest Contentful Paint Delay (LCP_RESOURCE_DELAY)
    const lcp = evidence.labMetrics?.lcpMs;
    if (typeof lcp === 'number' && lcp > BOTTLENECK_THRESHOLDS.lcpResourceDelayMs) {
      const isSevere = lcp > BOTTLENECK_THRESHOLDS.lcpResourceDelaySevereMs;
      const lcpImage =
        evidence.lcpImageCandidate ??
        (evidence.images ?? []).find(
          img =>
            img.isLcpCandidate ||
            (typeof evidence.labMetrics?.lcpDetails?.elementUrl === 'string' &&
              img.currentSrc === evidence.labMetrics.lcpDetails.elementUrl),
        ) ??
        null;
      const isCapped = evidence.completenessState.isLcpCapped;

      let isCausal = false;
      let causalRationale =
        'Elevated LCP latency was observed. While the render time exceeds recommended thresholds, supporting telemetry cannot isolate a single asset as the sole cause (e.g. text element or combined network queue delays).';

      if (lcpImage) {
        if (
          evidence.labMetrics?.lcpDetails?.loadTimeMs &&
          evidence.labMetrics.lcpDetails.loadTimeMs >
            lcp * BOTTLENECK_THRESHOLDS.lcpResourceLoadRatio
        ) {
          isCausal = true;
          causalRationale =
            'Resource Timing evidence proves image transfer consumed over 50% of the total duration to Largest Contentful Paint.';
        }
      }

      diagnoses.push({
        classification: 'LCP_RESOURCE_DELAY',
        confidence: isCausal ? 'confirmed' : 'potential',
        status: isCausal ? 'confirmed' : 'potential',
        causality: isCausal ? 'causal' : 'correlational',
        severity: isSevere ? 'high' : 'medium',
        title: `Slow Largest Contentful Paint (${lcp}ms)`,
        description: `Largest Contentful Paint took ${lcp}ms, exceeding the recommended ceiling of ${BOTTLENECK_THRESHOLDS.lcpResourceDelayMs}ms.${isCapped ? ' (Note: LCP observation was capped by the 5,000ms deadline ceiling).' : ''}`,
        targetUrl: pageUrl,
        supportingEvidence: {
          primaryMetricName: 'lcpMs',
          observedValue: lcp,
          thresholdValue: BOTTLENECK_THRESHOLDS.lcpResourceDelayMs,
          unit: 'ms',
          causality: isCausal ? 'causal' : 'correlational',
          limitations: [
            isCapped
              ? 'LCP observation was capped by the 5,000ms ceiling prior to complete lifecycle settlement.'
              : 'Observation settled cleanly under automated crawl conditions.',
            'Automated crawl does not simulate continuous human user scrolling or interaction.',
          ],
          relatedMeasurements: {
            lcpMs: lcp,
            isCapped,
            completenessState: evidence.completenessState.lcpState,
            elementSelector: evidence.labMetrics?.lcpDetails?.elementSelector ?? null,
            elementTagName: evidence.labMetrics?.lcpDetails?.elementTagName ?? null,
            elementUrl: evidence.labMetrics?.lcpDetails?.elementUrl
              ? redactUrl(evidence.labMetrics.lcpDetails.elementUrl)
              : null,
            renderTimeMs: evidence.labMetrics?.lcpDetails?.renderTimeMs ?? null,
            loadTimeMs: evidence.labMetrics?.lcpDetails?.loadTimeMs ?? null,
            isAboveTheFold: lcpImage?.isAboveTheFold ?? false,
          },
        },
        inferenceRationale: causalRationale,
        limitationsNotice: isCapped
          ? 'Observation was capped by the 5,000ms ceiling before page settle. The candidate represents the largest paint observed before deadline.'
          : 'Observed under automated Chromium crawl conditions.',
        remediation:
          'Preload the LCP hero image with <link rel="preload" as="image" fetchpriority="high">, remove loading="lazy" from hero images, and compress image payloads.',
        references: ['https://web.dev/articles/optimize-lcp'],
      });
    }

    // 7. Uncompressed Text Assets (UNCOMPRESSED_ASSETS)
    const uncompressed =
      evidence.uncompressedAssets && evidence.uncompressedAssets.length > 0
        ? evidence.uncompressedAssets
        : (evidence.resources ?? []).filter(
            r =>
              r.contentEncoding === null &&
              (r.transferSizeBytes ?? r.encodedBodySizeBytes ?? 0) > 10240,
          );
    if (uncompressed.length > 0) {
      const totalUncompressedBytes = uncompressed.reduce(
        (sum, r) => sum + (r.transferSizeBytes ?? r.encodedBodySizeBytes ?? 0),
        0,
      );

      const isMedium =
        uncompressed.length > 3 ||
        totalUncompressedBytes > BOTTLENECK_THRESHOLDS.uncompressedAssetsCombinedBytes;
      diagnoses.push({
        classification: 'UNCOMPRESSED_ASSETS',
        confidence: 'confirmed',
        status: 'confirmed',
        causality: 'causal',
        severity: isMedium ? 'medium' : 'low',
        title: `${uncompressed.length} Compressible Text Asset(s) Served Uncompressed (${Math.round(totalUncompressedBytes / 1024)} KiB)`,
        description: `Found ${uncompressed.length} compressible text asset(s) transferred without Brotli or Gzip HTTP compression, transferring ${Math.round(totalUncompressedBytes / 1024)} KiB unnecessarily over the wire.`,
        targetUrl: pageUrl,
        supportingEvidence: {
          primaryMetricName: 'uncompressedAssetsCount',
          observedValue: uncompressed.length,
          thresholdValue: 0,
          unit: 'assets',
          causality: 'causal',
          limitations: [
            'Content-Encoding verified from HTTP response headers during network interception.',
          ],
          relatedMeasurements: {
            uncompressedCount: uncompressed.length,
            totalUncompressedBytes,
            sampleUrls: uncompressed.slice(0, 5).map(r => redactUrl(r.url)),
          },
        },
        inferenceRationale:
          'Text-based assets transferred without Brotli/Gzip consume 3x to 5x more bandwidth, directly prolonging download times.',
        limitationsNotice:
          'Verified via Playwright network response headers during live proxy transit.',
        remediation:
          'Enable Brotli or Gzip compression for all text MIME types (HTML, CSS, JS, SVG, JSON) on your web server or reverse proxy.',
        references: [
          'https://web.dev/articles/optimizing-content-efficiency-encoding-and-transfer-size',
        ],
      });
    }

    // 8. Oversized Raster Images (OVERSIZED_IMAGES)
    const oversized =
      evidence.oversizedImages && evidence.oversizedImages.length > 0
        ? evidence.oversizedImages
        : (evidence.images ?? []).filter(img => img.isOversized);
    if (oversized.length > 0) {
      diagnoses.push({
        classification: 'OVERSIZED_IMAGES',
        confidence: 'confirmed',
        status: 'confirmed',
        causality: 'causal',
        severity: oversized.length > 3 ? 'medium' : 'low', // Low severity with Confirmed confidence!
        title: `${oversized.length} Image(s) Served Significantly Larger than Display Size`,
        description: `Found ${oversized.length} raster image(s) where intrinsic source resolution exceeds the required physical display pixels by more than 1.5x at the active screen DPR.`,
        targetUrl: pageUrl,
        supportingEvidence: {
          primaryMetricName: 'oversizedImagesCount',
          observedValue: oversized.length,
          thresholdValue: 0,
          unit: 'images',
          causality: 'causal',
          limitations: [
            'Calibrated against the active viewport display dimensions and screen device pixel ratio (DPR).',
            'SVGs are strictly excluded from dimension checks.',
          ],
          relatedMeasurements: {
            oversizedCount: oversized.length,
            sampleImages: oversized.slice(0, 5).map(img => ({
              selector: img.elementSelector,
              src: redactUrl(img.currentSrc),
              renderedWidthCss: img.renderedWidth,
              renderedHeightCss: img.renderedHeight,
              dpr: img.dpr,
              effectiveWidthPixels: img.effectiveWidthPixels,
              effectiveHeightPixels: img.effectiveHeightPixels,
              sourcePhysicalWidth: img.sourcePhysicalWidth,
              sourcePhysicalHeight: img.sourcePhysicalHeight,
              oversizedFactor: img.oversizedFactor,
            })),
          },
        },
        inferenceRationale:
          'Serving high-resolution desktop images to smaller containers wastes bandwidth and GPU memory.',
        limitationsNotice: 'Evaluated against current viewport profile display dimensions and DPR.',
        remediation:
          'Implement responsive image variants using srcset and sizes, or utilize an image CDN for dynamic resizing.',
        references: ['https://web.dev/articles/serve-responsive-images'],
      });
    }

    return diagnoses;
  }

  /**
   * Converts bottleneck diagnoses into standard CreateFindingRequest objects.
   */
  public toFindings(
    diagnoses: readonly BottleneckDiagnosis[],
    scanRunId: string,
  ): CreateFindingRequest[] {
    return diagnoses.map(d => ({
      scanRunId,
      ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
      category:
        d.classification === 'LAYOUT_INSTABILITY' ? 'layout-stability' : 'static-performance',
      title: d.title,
      description: d.description,
      severity: d.severity,
      confidence: d.confidence,
      status: d.status,
      targetUrl: d.targetUrl,
      evidence: {
        classification: d.classification,
        causality: d.causality,
        confidence: d.confidence,
        severity: d.severity,
        primaryMetricName: d.supportingEvidence.primaryMetricName,
        observedValue: d.supportingEvidence.observedValue,
        thresholdValue: d.supportingEvidence.thresholdValue,
        unit: d.supportingEvidence.unit,
        limitations: d.supportingEvidence.limitations,
        relatedMeasurements: d.supportingEvidence.relatedMeasurements,
        inferenceRationale: d.inferenceRationale,
        limitationsNotice: d.limitationsNotice,
        provenance: 'bottleneck_classifier',
      },
      remediation: d.remediation,
      references: [...d.references],
    }));
  }
}
