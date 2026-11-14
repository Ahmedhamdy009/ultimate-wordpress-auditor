import { describe, it, expect } from 'vitest';
import {
  extractPerformanceSummary,
  LABORATORY_CONTEXT_DISCLAIMER,
} from '../../src/schemas/performance.js';

describe('extractPerformanceSummary Suite', () => {
  it('returns null for historical scans without performance telemetry or findings', () => {
    const result = extractPerformanceSummary(null, []);
    expect(result).toBeNull();

    const result2 = extractPerformanceSummary(undefined, null);
    expect(result2).toBeNull();

    const result3 = extractPerformanceSummary({ totalFindings: 1 }, [
      { ruleId: 'SEC_HEADER', category: 'security' },
    ]);
    expect(result3).toBeNull();
  });

  it('correctly consolidates lab metrics from summary and rates them against standard thresholds', () => {
    const summaryMetrics = {
      labMetrics: {
        ttfbMs: 650, // good (<= 800)
        fcpMs: 2200, // needs_improvement (> 1800, <= 3000)
        lcpMs: 4500, // poor (> 4000)
        cls: 0.05, // good (<= 0.1)
        tbtMs: 150, // good (<= 200)
        isLcpCapped: true,
        lcpElementUrl: 'https://example.com/hero.webp',
        lcpElementSelector: 'header > img.hero',
      },
      resourceSummary: {
        totalResources: 30,
        totalTransferSizeBytes: 1048576,
        renderBlockingCount: 2,
        scriptsCount: 10,
        stylesheetsCount: 5,
        imagesCount: 12,
        oversizedImagesCount: 1,
        uncompressedAssetsCount: 2,
      },
    };

    const result = extractPerformanceSummary(summaryMetrics, []);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.hasAnyData).toBe(true);
    expect(result.hasMeasuredVitals).toBe(true);

    // TTFB
    expect(result.ttfb.value).toBe(650);
    expect(result.ttfb.unit).toBe('ms');
    expect(result.ttfb.rating).toBe('good');

    // FCP
    expect(result.fcp.value).toBe(2200);
    expect(result.fcp.rating).toBe('needs_improvement');

    // LCP
    expect(result.lcp.value).toBe(4500);
    expect(result.lcp.rating).toBe('poor');
    expect(result.lcp.isCapped).toBe(true);
    expect(result.lcp.elementUrl).toBe('https://example.com/hero.webp');
    expect(result.lcp.elementSelector).toBe('header > img.hero');

    // CLS
    expect(result.cls.value).toBe(0.05);
    expect(result.cls.rating).toBe('good');

    // TBT
    expect(result.tbt.value).toBe(150);
    expect(result.tbt.rating).toBe('good');

    // Resources
    expect(result.resources).toBeDefined();
    expect(result.resources?.totalResources).toBe(30);
    expect(result.resources?.totalTransferSizeBytes).toBe(1048576);
    expect(result.resources?.renderBlockingCount).toBe(2);
  });

  it('falls back to extracting observed vitals and diagnoses from findings when summary is absent', () => {
    const findings = [
      {
        ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
        category: 'static-performance',
        title: 'Server Latency Bottleneck',
        severity: 'high',
        confidence: 'confirmed',
        evidence: {
          classification: 'SERVER_LATENCY',
          causality: 'causal',
          primaryMetricName: 'TTFB',
          observedValue: 1200,
          thresholdValue: 800,
          unit: 'ms',
          limitationsNotice: 'Isolated in lab.',
        },
      },
      {
        ruleId: 'PERF_LAB_SLOW_LCP',
        category: 'static-performance',
        title: 'Slow Largest Contentful Paint',
        severity: 'medium',
        confidence: 'confirmed',
        evidence: {
          metric: 'lcp',
          observedValueMs: 3100,
          thresholdMs: 2500,
          isCapped: false,
          elementUrl: 'https://example.com/banner.png',
        },
      },
      {
        ruleId: 'PERF_LAB_HIGH_CLS',
        category: 'layout-stability',
        title: 'High Cumulative Layout Shift',
        severity: 'high',
        confidence: 'confirmed',
        evidence: {
          metric: 'cls',
          observedValue: 0.28,
        },
      },
    ];

    const result = extractPerformanceSummary(null, findings);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.ttfb.value).toBe(1200);
    expect(result.ttfb.rating).toBe('needs_improvement');
    expect(result.lcp.value).toBe(3100);
    expect(result.lcp.rating).toBe('needs_improvement');
    expect(result.cls.value).toBe(0.28);
    expect(result.cls.rating).toBe('poor');
    expect(result.tbt.value).toBeNull();
    expect(result.tbt.rating).toBe('unavailable');

    expect(result.bottleneckDiagnoses).toHaveLength(1);
    expect(result.bottleneckDiagnoses[0].classification).toBe('SERVER_LATENCY');
    expect(result.bottleneckDiagnoses[0].causality).toBe('causal');
    expect(result.bottleneckDiagnoses[0].observedValueText).toBe('1200 ms');
  });

  it('exposes authoritative laboratory context disclaimer', () => {
    expect(LABORATORY_CONTEXT_DISCLAIMER).toContain('Laboratory observations');
    expect(LABORATORY_CONTEXT_DISCLAIMER).toContain('Chromium browser session');
    expect(LABORATORY_CONTEXT_DISCLAIMER).toContain('Interaction to Next Paint (INP)');
  });
});
