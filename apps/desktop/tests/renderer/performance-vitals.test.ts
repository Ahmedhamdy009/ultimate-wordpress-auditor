import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import { PerformanceVitalsView } from '../../src/renderer/src/components/views/PerformanceVitalsView.js';
import type { FindingDTO, ScanRunDTO } from '@auditor/shared';

describe('PerformanceVitalsView Component', () => {
  it('returns null/empty for historical scans without performance metrics or findings', () => {
    const historicalScan: ScanRunDTO = {
      id: 'scan-hist-1',
      siteId: 'site-1',
      scanType: 'full',
      status: 'completed',
      targetUrl: 'https://example.test/',
      startedAt: '2026-11-01T10:00:00Z',
      completedAt: '2026-11-01T10:02:00Z',
      cancelledAt: null,
      durationMs: 120000,
      config: {},
      summary: {
        totalFindings: 0,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
      },
      error: null,
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T10:02:00Z',
    };

    const html = renderComponentToHtml(
      React.createElement(PerformanceVitalsView, {
        scanRun: historicalScan,
        findings: [],
      }),
    );

    expect(html).toBe('');
  });

  it('renders Web Vitals 5-tile grid, ratings, and lab context disclaimer when metrics are present', () => {
    const scanWithMetrics: ScanRunDTO = {
      id: 'scan-perf-1',
      siteId: 'site-1',
      scanType: 'full',
      status: 'completed',
      targetUrl: 'https://example.test/',
      startedAt: '2026-11-14T10:00:00Z',
      completedAt: '2026-11-14T10:01:00Z',
      cancelledAt: null,
      durationMs: 60000,
      config: {},
      summary: {
        totalFindings: 1,
        criticalCount: 0,
        highCount: 1,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
        performanceMetrics: {
          labMetrics: {
            ttfbMs: 350,
            fcpMs: 1400,
            lcpMs: 3200,
            cls: 0.04,
            tbtMs: 120,
            isLcpCapped: true,
          },
          resourceSummary: {
            totalResources: 32,
            totalTransferSizeBytes: 1250000,
            renderBlockingCount: 2,
            scriptsCount: 12,
            stylesheetsCount: 6,
            imagesCount: 10,
            oversizedImagesCount: 1,
            uncompressedAssetsCount: 2,
          },
        },
      },
      error: null,
      createdAt: '2026-11-14T10:00:00Z',
      updatedAt: '2026-11-14T10:01:00Z',
    };

    const perfFindings: FindingDTO[] = [
      {
        id: 'f-1',
        scanRunId: 'scan-perf-1',
        ruleId: 'PERF_BOTTLENECK_DIAGNOSIS',
        category: 'static-performance',
        title: 'Server Latency Bottleneck',
        description: 'High response latency',
        severity: 'high',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: 'https://example.test/',
        evidence: {
          classification: 'SERVER_LATENCY',
          causality: 'causal',
          primaryMetricName: 'TTFB',
          observedValue: 850,
          thresholdValue: 800,
          unit: 'ms',
          limitationsNotice: 'Isolated network environment.',
        },
        remediation: 'Enable page cache',
        references: [],
        createdAt: '2026-11-14T10:00:30Z',
      },
    ];

    const html = renderComponentToHtml(
      React.createElement(PerformanceVitalsView, {
        scanRun: scanWithMetrics,
        findings: perfFindings,
      }),
    );

    // Card and Header
    expect(html).toContain('Laboratory Web Vitals &amp; Performance Diagnostics');
    expect(html).toContain('AUTOMATED CHROMIUM SESSION');

    // Disclaimer
    expect(html).toContain('Laboratory Context &amp; Methodology Disclaimer');
    expect(html).toContain('Interaction to Next Paint (INP)');

    // 5 Vitals tiles
    expect(html).toContain('Time to First Byte (TTFB)');
    expect(html).toContain('350 ms');
    expect(html).toContain('GOOD');

    expect(html).toContain('First Contentful Paint (FCP)');
    expect(html).toContain('1400 ms');

    expect(html).toContain('Largest Contentful Paint (LCP)');
    expect(html).toContain('3200 ms');
    expect(html).toContain('NEEDS IMPROVEMENT');
    expect(html).toContain('Capped by 5,000ms deadline ceiling');

    expect(html).toContain('Cumulative Layout Shift (CLS)');
    expect(html).toContain('0.040');

    expect(html).toContain('Total Blocking Time (TBT)');
    expect(html).toContain('120 ms');

    // Resources
    expect(html).toContain('Page Resource &amp; Asset Metrics');
    expect(html).toContain('1221 KB'); // 1250000 / 1024
    expect(html).toContain('12 / 6'); // scripts / stylesheets

    // Bottlenecks list
    expect(html).toContain('Diagnosed Bottlenecks (1)');
    expect(html).toContain('SERVER_LATENCY');
    expect(html).toContain('Causal (Proven Cause)');
    expect(html).toContain('Isolated network environment.');
  });
});
