import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { rateWebVitalMetric } from '@auditor/shared';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { PerformanceCollector } from '../../src/main/browser/performance-collector.js';
import {
  LAYOUT_SHIFT_INIT_SCRIPT,
  LayoutShiftCollector,
} from '../../src/main/browser/layout-shift-collector.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';
import type {
  RawLcpEntry,
  RawLayoutShiftEntry,
  RawLongTaskEntry,
  RawNavigationEntry,
  RawPaintEntry,
  RawPerformanceData,
} from '../../src/main/browser/performance-types.js';

describe('PerformanceCollector & Lab Web Vitals Suite (Batch 7.3.1)', () => {
  const collector = new PerformanceCollector({
    settleTimeoutMs: 100,
    maxCeilingMs: 3000,
  });

  describe('1. Threshold Evaluation (rateWebVitalMetric)', () => {
    it('evaluates TTFB thresholds correctly (800ms / 1800ms)', () => {
      expect(rateWebVitalMetric('ttfb', 500)).toBe('good');
      expect(rateWebVitalMetric('ttfb', 800)).toBe('good');
      expect(rateWebVitalMetric('ttfb', 801)).toBe('needs_improvement');
      expect(rateWebVitalMetric('ttfb', 1800)).toBe('needs_improvement');
      expect(rateWebVitalMetric('ttfb', 1801)).toBe('poor');
      expect(rateWebVitalMetric('ttfb', null)).toBeNull();
      expect(rateWebVitalMetric('ttfb', undefined)).toBeNull();
    });

    it('evaluates FCP thresholds correctly (1800ms / 3000ms)', () => {
      expect(rateWebVitalMetric('fcp', 1200)).toBe('good');
      expect(rateWebVitalMetric('fcp', 1800)).toBe('good');
      expect(rateWebVitalMetric('fcp', 1801)).toBe('needs_improvement');
      expect(rateWebVitalMetric('fcp', 3000)).toBe('needs_improvement');
      expect(rateWebVitalMetric('fcp', 3500)).toBe('poor');
      expect(rateWebVitalMetric('fcp', null)).toBeNull();
    });

    it('evaluates LCP thresholds correctly (2500ms / 4000ms)', () => {
      expect(rateWebVitalMetric('lcp', 2000)).toBe('good');
      expect(rateWebVitalMetric('lcp', 2500)).toBe('good');
      expect(rateWebVitalMetric('lcp', 2501)).toBe('needs_improvement');
      expect(rateWebVitalMetric('lcp', 4000)).toBe('needs_improvement');
      expect(rateWebVitalMetric('lcp', 4001)).toBe('poor');
      expect(rateWebVitalMetric('lcp', null)).toBeNull();
    });

    it('evaluates CLS thresholds correctly (0.10 / 0.25)', () => {
      expect(rateWebVitalMetric('cls', 0.05)).toBe('good');
      expect(rateWebVitalMetric('cls', 0.1)).toBe('good');
      expect(rateWebVitalMetric('cls', 0.101)).toBe('needs_improvement');
      expect(rateWebVitalMetric('cls', 0.25)).toBe('needs_improvement');
      expect(rateWebVitalMetric('cls', 0.251)).toBe('poor');
      expect(rateWebVitalMetric('cls', null)).toBeNull();
    });

    it('evaluates TBT thresholds correctly (200ms / 600ms)', () => {
      expect(rateWebVitalMetric('tbt', 150)).toBe('good');
      expect(rateWebVitalMetric('tbt', 200)).toBe('good');
      expect(rateWebVitalMetric('tbt', 201)).toBe('needs_improvement');
      expect(rateWebVitalMetric('tbt', 600)).toBe('needs_improvement');
      expect(rateWebVitalMetric('tbt', 650)).toBe('poor');
      expect(rateWebVitalMetric('tbt', null)).toBeNull();
    });
  });

  describe('2. Navigation Timing Processing & Server-Timing Separation', () => {
    const createBaseNav = (overrides: Partial<RawNavigationEntry> = {}): RawNavigationEntry => ({
      startTime: 0,
      redirectStart: 0,
      redirectEnd: 0,
      domainLookupStart: 10,
      domainLookupEnd: 25,
      connectStart: 25,
      secureConnectionStart: 35,
      connectEnd: 60,
      requestStart: 65,
      responseStart: 250,
      responseEnd: 310,
      domInteractive: 450,
      domContentLoadedEventStart: 480,
      domContentLoadedEventEnd: 500,
      loadEventStart: 520,
      loadEventEnd: 550,
      transferSize: 15420,
      encodedBodySize: 15000,
      decodedBodySize: 45000,
      serverTiming: [],
      ...overrides,
    });

    it('accurately computes W3C timing arithmetic', () => {
      const rawNav = createBaseNav();
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: rawNav,
        paints: [],
        lcpCandidates: [],
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: 550,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      const nav = result.metrics.navigationTiming;

      expect(nav).not.toBeNull();
      expect(nav?.dnsLookupMs).toBe(15); // 25 - 10
      expect(nav?.tcpConnectMs).toBe(35); // 60 - 25
      expect(nav?.tlsHandshakeMs).toBe(25); // 60 - 35
      expect(nav?.ttfbMs).toBe(185); // 250 - 65
      expect(nav?.contentDownloadMs).toBe(60); // 310 - 250
      expect(nav?.domInteractiveMs).toBe(450);
      expect(nav?.domContentLoadedMs).toBe(500);
      expect(nav?.loadEventMs).toBe(550);
      expect(nav?.hasServerTiming).toBe(false);
      expect(nav?.serverProcessingMs).toBeNull();
      expect(result.metrics.ttfbMs).toBe(185);
    });

    it('isolates pure server processing time when Server-Timing is available', () => {
      const rawNav = createBaseNav({
        serverTiming: [
          { name: 'db', duration: 45.2, description: 'Database Query' },
          { name: 'app', duration: 32.5, description: 'App Render' },
        ],
      });
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: rawNav,
        paints: [],
        lcpCandidates: [],
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: 550,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.navigationTiming?.hasServerTiming).toBe(true);
      expect(result.metrics.navigationTiming?.serverProcessingMs).toBe(78); // 45.2 + 32.5 rounded
    });

    it('parses Server-Timing header string passed directly from response headers', () => {
      const rawNav = createBaseNav();
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: rawNav,
        paints: [],
        lcpCandidates: [],
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: 550,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(
        rawData,
        { serverTimingHeader: 'app;dur=65.4;desc="Controller"' },
        Date.now(),
        5000,
      );
      expect(result.metrics.navigationTiming?.hasServerTiming).toBe(true);
      expect(result.metrics.navigationTiming?.serverProcessingMs).toBe(65);
    });

    it('preserves null for navigationTiming when navigation entry is missing', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: false,
          paintTiming: false,
          lcp: false,
          layoutShift: false,
          longtask: false,
        },
        navigation: null,
        paints: [],
        lcpCandidates: [],
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: null,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.navigationTiming).toBeNull();
      expect(result.metrics.ttfbMs).toBeNull();
      expect(result.completeness.navigationTimingAvailable).toBe(false);
    });
  });

  describe('3. Paint Timing Processing', () => {
    it('extracts first-paint and first-contentful-paint accurately', () => {
      const paints: RawPaintEntry[] = [
        { name: 'first-paint', startTime: 120.4 },
        { name: 'first-contentful-paint', startTime: 235.8 },
      ];
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints,
        lcpCandidates: [],
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: null,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.paintTiming?.firstPaintMs).toBe(120);
      expect(result.metrics.paintTiming?.firstContentfulPaintMs).toBe(236);
      expect(result.metrics.fcpMs).toBe(236);
    });

    it('preserves null when paint timing entries are absent', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: [],
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: null,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.paintTiming).toBeNull();
      expect(result.metrics.fcpMs).toBeNull();
    });
  });

  describe('4. Largest Contentful Paint (LCP) & Completeness States', () => {
    const candidates: RawLcpEntry[] = [
      {
        startTime: 300,
        loadTime: 280,
        renderTime: 320,
        size: 5000,
        tagName: 'p',
        selector: 'p.hero-text',
        boundingBox: { x: 20, y: 50, width: 400, height: 100 },
      },
      {
        startTime: 650,
        loadTime: 620,
        renderTime: 680,
        size: 45000,
        tagName: 'img',
        selector: 'img#hero-banner',
        url: 'https://example.com/banner.jpg',
        boundingBox: { x: 0, y: 0, width: 1200, height: 400 },
      },
    ];

    it('selects the last candidate before cutoff and marks completeness as complete when load has fired', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: candidates,
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: 800,
        nowMs: 2000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000, 1000);
      expect(result.metrics.lcpMs).toBe(680);
      expect(result.metrics.lcpDetails?.elementSelector).toBe('img#hero-banner');
      expect(result.metrics.lcpDetails?.elementTagName).toBe('img');
      expect(result.metrics.lcpDetails?.elementUrl).toBe('https://example.com/banner.jpg');
      expect(result.metrics.lcpDetails?.renderTimeMs).toBe(680);
      expect(result.metrics.lcpDetails?.size).toBe(45000);
      expect(result.completeness.lcpState).toBe('complete');
      expect(result.completeness.isLcpCapped).toBe(false);
    });

    it('marks LCP as capped when ceiling is reached before load has settled', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: candidates,
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: null, // Load never fired before cutoff
        nowMs: 5000, // Ceiling reached
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.lcpMs).toBe(680); // Preserves value
      expect(result.completeness.lcpState).toBe('capped');
      expect(result.completeness.isLcpCapped).toBe(true);
      expect(result.metrics.lcpDetails?.isCapped).toBe(true);
      expect(result.metrics.lcpDetails?.limitationNotice).toContain('capped');
    });

    it('marks LCP as unavailable when no candidate is recorded (never returns 0)', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: [],
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: 1000,
        nowMs: 2000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.lcpMs).toBeNull();
      expect(result.metrics.lcpDetails).toBeNull();
      expect(result.completeness.lcpState).toBe('unavailable');
    });

    it('marks LCP as capped when options.isTimedOut is true, preserving observed candidate', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: candidates,
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: 800,
        nowMs: 1200,
      };

      const result = collector.processRawPerformanceData(
        rawData,
        { isTimedOut: true },
        Date.now(),
        5000,
      );
      expect(result.metrics.lcpMs).toBe(680);
      expect(result.completeness.lcpState).toBe('capped');
      expect(result.completeness.isLcpCapped).toBe(true);
      expect(result.metrics.lcpDetails?.isCapped).toBe(true);
      expect(result.metrics.lcpDetails?.limitationNotice).toContain('capped');
    });

    it('marks LCP as interrupted when options.isInterrupted is true, preserving candidate', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: candidates,
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: 800,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(
        rawData,
        { isInterrupted: true },
        Date.now(),
        5000,
      );
      expect(result.metrics.lcpMs).toBe(680);
      expect(result.completeness.lcpState).toBe('interrupted');
      expect(result.metrics.lcpDetails?.completenessState).toBe('interrupted');
      expect(result.metrics.lcpDetails?.limitationNotice).toContain('interrupted');
    });

    it('returns null and interrupted state when interrupted without candidates', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: [],
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: null,
        nowMs: 500,
      };

      const result = collector.processRawPerformanceData(
        rawData,
        { isInterrupted: true },
        Date.now(),
        5000,
      );
      expect(result.metrics.lcpMs).toBeNull();
      expect(result.metrics.lcpDetails).toBeNull();
      expect(result.completeness.lcpState).toBe('interrupted');
    });

    it('marks LCP as complete when visibility transitions to hidden (hiddenAtMs is set per W3C)', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: candidates,
        layoutShifts: [],
        longTasks: [],
        isHidden: true,
        hiddenAtMs: 450,
        loadFiredAtMs: null,
        nowMs: 1200,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      // Candidate 2 (680ms) rendered after hiddenAtMs (450ms) and is excluded; Candidate 1 (320ms) is selected
      expect(result.metrics.lcpMs).toBe(320);
      expect(result.metrics.lcpDetails?.elementSelector).toBe('p.hero-text');
      expect(result.completeness.lcpState).toBe('complete');
      expect(result.completeness.isLcpCapped).toBe(false);
      expect(result.metrics.lcpDetails?.completenessState).toBe('complete');
      expect(result.metrics.lcpDetails?.limitationNotice).toContain('visibility');
    });

    it('marks LCP as capped when loadFiredAtMs is null and hiddenAtMs is null even if under ceiling', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: candidates,
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: null, // load never fired
        nowMs: 1500, // under 5000 ceiling
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.lcpMs).toBe(680);
      expect(result.completeness.lcpState).toBe('capped');
      expect(result.completeness.isLcpCapped).toBe(true);
      expect(result.metrics.lcpDetails?.isCapped).toBe(true);
      expect(result.metrics.lcpDetails?.limitationNotice).toContain('capped');
    });

    it('captures a newer LCP candidate appearing AFTER the load event and marks measurement complete when settled', () => {
      const lateCandidates: RawLcpEntry[] = [
        {
          startTime: 300,
          loadTime: 280,
          renderTime: 320,
          size: 5000,
          tagName: 'p',
          selector: 'p.hero-text',
        },
        // Candidate appearing AFTER load event (load at 600ms, candidate at 1100ms)
        {
          startTime: 1100,
          loadTime: 1050,
          renderTime: 1120,
          size: 80000,
          tagName: 'img',
          selector: 'img#delayed-hero',
          url: 'https://example.com/delayed.webp',
        },
      ];

      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: lateCandidates,
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        inputAtMs: null,
        loadFiredAtMs: 600, // Load fired at 600ms
        nowMs: 1800, // Settled after load + 1000ms (1600ms)
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000, 1000);
      expect(result.metrics.lcpMs).toBe(1120);
      expect(result.metrics.lcpDetails?.elementSelector).toBe('img#delayed-hero');
      expect(result.metrics.lcpDetails?.elementTagName).toBe('img');
      expect(result.metrics.lcpDetails?.elementUrl).toBe('https://example.com/delayed.webp');
      expect(result.completeness.lcpState).toBe('complete');
      expect(result.completeness.isLcpCapped).toBe(false);
      expect(result.metrics.lcpDetails?.isCapped).toBe(false);
    });

    it('marks LCP as capped when observation concludes before post-load settle window completes', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: candidates,
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        inputAtMs: null,
        loadFiredAtMs: 800,
        nowMs: 1200, // 1200ms < 800 + 1000ms = 1800ms required for settling
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000, 1000);
      expect(result.metrics.lcpMs).toBe(680); // Preserves observed candidate
      expect(result.completeness.lcpState).toBe('capped');
      expect(result.completeness.isLcpCapped).toBe(true);
      expect(result.metrics.lcpDetails?.isCapped).toBe(true);
      expect(result.metrics.lcpDetails?.limitationNotice).toContain('settling window');
    });

    it('terminates LCP observation upon first user input cutoff per W3C specification', () => {
      const candidatesWithInput: RawLcpEntry[] = [
        {
          startTime: 200,
          loadTime: 180,
          renderTime: 220,
          size: 15000,
          tagName: 'h1',
          selector: 'h1#title',
        },
        // Rendered AFTER user input cutoff (input at 500ms, entry at 700ms)
        {
          startTime: 700,
          loadTime: 650,
          renderTime: 720,
          size: 90000,
          tagName: 'img',
          selector: 'img#user-triggered',
        },
      ];

      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: candidatesWithInput,
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        inputAtMs: 500, // User tapped / typed at 500ms
        loadFiredAtMs: 800,
        nowMs: 1500,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000, 1000);
      // Entry after 500ms must be excluded per W3C spec!
      expect(result.metrics.lcpMs).toBe(220);
      expect(result.metrics.lcpDetails?.elementSelector).toBe('h1#title');
      expect(result.completeness.lcpState).toBe('complete');
      expect(result.completeness.isLcpCapped).toBe(false);
      expect(result.metrics.lcpDetails?.limitationNotice).toContain('user interaction');
    });
  });

  describe('5. Total Blocking Time (TBT) Calculation', () => {
    it('sums (duration - 50ms) for tasks >= 50ms occurring strictly after FCP', () => {
      const fcpMs = 200;
      const longTasks: RawLongTaskEntry[] = [
        // Before FCP: must be excluded from TBT
        { startTime: 50, duration: 80, name: 'self' },
        // After FCP: duration > 50 -> 120 - 50 = 70ms blocking
        { startTime: 250, duration: 120, name: 'self' },
        // After FCP: duration <= 50 -> 0ms blocking
        { startTime: 400, duration: 45, name: 'self' },
        // After FCP: duration > 50 -> 90 - 50 = 40ms blocking
        { startTime: 500, duration: 90, name: 'self' },
      ];

      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [{ name: 'first-contentful-paint', startTime: fcpMs }],
        lcpCandidates: [],
        layoutShifts: [],
        longTasks,
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: 800,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.tbtMs).toBe(110); // 70 + 40
      expect(result.metrics.tbtDetails?.longTasksCount).toBe(2);
      expect(result.metrics.tbtDetails?.maxLongTaskDurationMs).toBe(120);
      expect(result.metrics.tbtDetails?.fcpTimeMs).toBe(200);
      expect(result.completeness.tbtCalculated).toBe(true);
    });

    it('returns null for TBT when FCP is missing', () => {
      const longTasks: RawLongTaskEntry[] = [{ startTime: 100, duration: 150, name: 'self' }];
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [], // No FCP
        lcpCandidates: [],
        layoutShifts: [],
        longTasks,
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: 500,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.tbtMs).toBeNull();
      expect(result.metrics.tbtDetails).toBeNull();
      expect(result.completeness.tbtCalculated).toBe(false);
    });
  });

  describe('6. Cumulative Layout Shift (CLS) Session Window Algorithm', () => {
    it('aggregates shifts within the same 5000ms session window (<1000ms gap)', () => {
      const shifts: RawLayoutShiftEntry[] = [
        { value: 0.05, startTime: 100, hadRecentInput: false },
        { value: 0.08, startTime: 600, hadRecentInput: false }, // 500ms gap -> same window (0.13)
        { value: 0.02, startTime: 2500, hadRecentInput: false }, // 1900ms gap -> new window (0.02)
      ];

      const clsData = collector.calculateSessionWindowCls(shifts);
      expect(clsData.sessionWindowCls).toBe(0.13);
      expect(clsData.rawCls).toBe(0.15);
      expect(clsData.totalShiftsCount).toBe(3);
      expect(clsData.sessionWindowsCount).toBe(2);
      expect(clsData.maxSingleShiftValue).toBe(0.08);
    });

    it('excludes shifts with hadRecentInput === true from session window score', () => {
      const shifts: RawLayoutShiftEntry[] = [
        { value: 0.05, startTime: 100, hadRecentInput: false },
        { value: 0.2, startTime: 300, hadRecentInput: true }, // User input shift excluded
      ];

      const clsData = collector.calculateSessionWindowCls(shifts);
      expect(clsData.sessionWindowCls).toBe(0.05);
      expect(clsData.rawCls).toBe(0.25);
    });
  });

  describe('7. INP Boundary & Methodology Disclosure', () => {
    it('strictly reports INP as null with unsupported_in_lab status', () => {
      const rawData: RawPerformanceData = {
        supported: {
          navigationTiming: true,
          paintTiming: true,
          lcp: true,
          layoutShift: true,
          longtask: true,
        },
        navigation: null,
        paints: [],
        lcpCandidates: [],
        layoutShifts: [],
        longTasks: [],
        isHidden: false,
        hiddenAtMs: null,
        loadFiredAtMs: null,
        nowMs: 1000,
      };

      const result = collector.processRawPerformanceData(rawData, {}, Date.now(), 5000);
      expect(result.metrics.inp).toBeNull();
      expect(result.metrics.inpStatus).toBe('unsupported_in_lab');
      expect(result.metrics.methodologyNotice).toContain('Empirical lab observation');
      expect(result.metrics.methodologyNotice).toContain(
        'INP is an interaction-driven field metric',
      );
    });
  });

  describe('8. Real Chromium Session End-to-End Verification', () => {
    let server: http.Server;
    let serverPort: number;
    let browserManager: BrowserManager;

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.url === '/cls') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head><title>CLS Unification Test</title></head>
              <body>
                <div id="shift-box" style="height: 50px; background: red;">Top Box</div>
                <script>
                  setTimeout(() => {
                    var el = document.createElement('div');
                    el.style.height = '100px';
                    el.style.background = 'blue';
                    document.body.insertBefore(el, document.getElementById('shift-box'));
                  }, 50);
                </script>
              </body>
            </html>
          `);
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Server-Timing': 'app;dur=25.4;desc="TestServer"',
        });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Performance Test Page</title>
              <style>
                body { margin: 0; font-family: sans-serif; }
                #hero { font-size: 32px; padding: 40px; background: #e0f7fa; }
                .spacer { height: 100px; }
              </style>
            </head>
            <body>
              <h1 id="hero">Largest Contentful Paint Hero Title</h1>
              <div class="spacer"></div>
              <p id="content">Body content rendering here.</p>
              <script>
                // Simulate a slight long-task contention on main thread
                var start = performance.now();
                while (performance.now() - start < 65) {
                  // busy wait 65ms
                }
              </script>
            </body>
          </html>
        `);
      });

      await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', () => {
          serverPort = (server.address() as { port: number }).port;
          resolve();
        });
      });

      browserManager = new BrowserManager({
        headless: true,
        maxConcurrentPages: 1,
        scopePolicy: {
          authorizedOrigin: `http://127.0.0.1:${serverPort}`,
          thirdPartyPolicy: 'SAME_ORIGIN_ONLY',
        },
        testHooks: {
          lookupFn: async () => [{ address: '127.0.0.1', family: 4 }],
          allowLoopbackInTests: true,
        },
      });

      await browserManager.launch();
    });

    afterAll(async () => {
      if (browserManager) {
        await browserManager.close().catch(() => {});
      }
      if (server) {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('collects empirical Navigation, Paint, LCP, and Long-Task metrics from real Chromium', async () => {
      const pageHandle = await browserManager.acquirePage();
      try {
        const liveCollector = new PerformanceCollector({ settleTimeoutMs: 600 });
        await liveCollector.installScript(pageHandle.page);

        await pageHandle.page.goto(`http://127.0.0.1:${serverPort}/`, {
          waitUntil: 'load',
          timeout: 10000,
        });

        const collection = await liveCollector.collectMetrics(pageHandle.page, {
          serverTimingHeader: 'app;dur=25.4;desc="TestServer"',
        });

        expect(collection.metrics.ttfbMs).not.toBeNull();
        expect(collection.metrics.ttfbMs).toBeGreaterThan(0);
        expect(collection.metrics.navigationTiming).not.toBeNull();
        expect(collection.metrics.navigationTiming?.serverProcessingMs).toBe(25);

        // FCP
        expect(collection.metrics.fcpMs).not.toBeNull();
        expect(collection.metrics.fcpMs).toBeGreaterThan(0);

        // LCP candidate
        expect(collection.metrics.lcpMs).not.toBeNull();
        expect(collection.metrics.lcpDetails).not.toBeNull();
        expect(collection.metrics.lcpDetails?.elementTagName).toBe('h1');
        expect(collection.metrics.lcpDetails?.elementSelector).toBe('#hero');
        expect(collection.completeness.lcpState).toBe('complete');

        // TBT
        expect(collection.metrics.tbtMs).not.toBeNull();
        expect(collection.completeness.tbtCalculated).toBe(true);

        // INP
        expect(collection.metrics.inp).toBeNull();
        expect(collection.metrics.inpStatus).toBe('unsupported_in_lab');
      } finally {
        await pageHandle.release();
      }
    });

    describe('9. CLS Observer Unification & In-Browser Lifecycle', () => {
      it('prevents duplicate observers when PERFORMANCE_INIT_SCRIPT is registered first', async () => {
        const pageHandle = await browserManager.acquirePage();
        try {
          const perfCollector = new PerformanceCollector({ settleTimeoutMs: 150 });
          await perfCollector.installScript(pageHandle.page);
          await pageHandle.page.addInitScript(LAYOUT_SHIFT_INIT_SCRIPT);

          await pageHandle.page.goto(`http://127.0.0.1:${serverPort}/cls`, { waitUntil: 'load' });

          const observerInfo = await pageHandle.page.evaluate(() => {
            const win = window as unknown as Record<string, unknown>;
            const perf = win.__auditorPerformance as { layoutShifts?: unknown[] } | undefined;
            const shifts = win.__auditorLayoutShifts as unknown[] | undefined;
            return {
              hasPerf: Boolean(win.__auditorPerformance),
              hasShiftObs: Boolean(win.__auditorLayoutShiftObserver),
              shiftArrayLen: Array.isArray(shifts) ? shifts.length : -1,
              isSameArray: perf?.layoutShifts === shifts,
            };
          });

          expect(observerInfo.hasPerf).toBe(true);
          expect(observerInfo.hasShiftObs).toBe(true);
          expect(observerInfo.isSameArray).toBe(true);

          const collection = await perfCollector.collectMetrics(pageHandle.page);
          expect(collection.metrics.cls).not.toBeNull();
        } finally {
          await pageHandle.release();
        }
      });

      it('prevents duplicate observers when LAYOUT_SHIFT_INIT_SCRIPT is registered first', async () => {
        const pageHandle = await browserManager.acquirePage();
        try {
          await pageHandle.page.addInitScript(LAYOUT_SHIFT_INIT_SCRIPT);
          const perfCollector = new PerformanceCollector({ settleTimeoutMs: 150 });
          await perfCollector.installScript(pageHandle.page);

          await pageHandle.page.goto(`http://127.0.0.1:${serverPort}/cls`, { waitUntil: 'load' });

          const observerInfo = await pageHandle.page.evaluate(() => {
            const win = window as unknown as Record<string, unknown>;
            const perf = win.__auditorPerformance as { layoutShifts?: unknown[] } | undefined;
            const shifts = win.__auditorLayoutShifts as unknown[] | undefined;
            return {
              hasPerf: Boolean(win.__auditorPerformance),
              hasShiftObs: Boolean(win.__auditorLayoutShiftObserver),
              isSameArray: perf?.layoutShifts === shifts,
            };
          });

          expect(observerInfo.hasPerf).toBe(true);
          expect(observerInfo.hasShiftObs).toBe(true);
          expect(observerInfo.isSameArray).toBe(true);
        } finally {
          await pageHandle.release();
        }
      });

      it('gracefully handles collection interruption when signal is aborted', async () => {
        const pageHandle = await browserManager.acquirePage();
        try {
          const perfCollector = new PerformanceCollector({ settleTimeoutMs: 100 });
          await perfCollector.installScript(pageHandle.page);
          await pageHandle.page.goto(`http://127.0.0.1:${serverPort}/cls`, { waitUntil: 'load' });

          const controller = new AbortController();
          controller.abort();

          const collection = await perfCollector.collectMetrics(pageHandle.page, {
            signal: controller.signal,
          });

          expect(collection.completeness.lcpState).toBe('interrupted');
          expect(collection.metrics.lcpMs).toBeNull();
          expect(collection.metrics.fcpMs).toBeNull();
          expect(collection.metrics.ttfbMs).toBeNull();
        } finally {
          await pageHandle.release();
        }
      });

      it('gracefully handles collection when page is prematurely closed', async () => {
        const pageHandle = await browserManager.acquirePage();
        const perfCollector = new PerformanceCollector({ settleTimeoutMs: 100 });
        await perfCollector.installScript(pageHandle.page);
        await pageHandle.page.goto(`http://127.0.0.1:${serverPort}/`, { waitUntil: 'load' });

        // Close page before collecting
        await pageHandle.page.close();

        const collection = await perfCollector.collectMetrics(pageHandle.page);
        expect(collection.completeness.lcpState).toBe('interrupted');
        expect(collection.metrics.lcpMs).toBeNull();
        expect(collection.metrics.ttfbMs).toBeNull();

        await pageHandle.release();
      });

      it('ensures PerformanceCollector executing before LayoutShiftCollector does not prematurely terminate observation', async () => {
        const pageHandle = await browserManager.acquirePage();
        try {
          const perfCollector = new PerformanceCollector({ settleTimeoutMs: 100 });
          const layoutCollector = new LayoutShiftCollector({ layoutShiftTimeoutMs: 100 });

          await perfCollector.installScript(pageHandle.page);
          await layoutCollector.installScript(pageHandle.page);

          await pageHandle.page.goto(`http://127.0.0.1:${serverPort}/cls`, { waitUntil: 'load' });

          // 1. PerformanceCollector collects first
          const perfResult = await perfCollector.collectMetrics(pageHandle.page);
          expect(perfResult.metrics.cls).not.toBeNull();

          // 2. Introduce another layout shift on the page
          await pageHandle.page.evaluate(() => {
            const el = document.createElement('div');
            el.style.height = '120px';
            el.style.background = 'green';
            document.body.insertBefore(el, document.getElementById('shift-box'));
          });

          // 3. LayoutShiftCollector collects second
          const layoutResult = await layoutCollector.collectMetrics(
            pageHandle.page,
            DEFAULT_VIEWPORT_PROFILES[0],
            `http://127.0.0.1:${serverPort}/`,
          );

          // LayoutShiftCollector must still receive the layout shifts without premature disconnect
          expect(layoutResult.metrics.isSupported).toBe(true);
          expect(layoutResult.metrics.totalShiftsRecorded).toBeGreaterThan(0);
          expect(layoutResult.metrics.sessionWindowCLS).toBeGreaterThan(0);
        } finally {
          await pageHandle.release();
        }
      });

      it('ensures LayoutShiftCollector executing before PerformanceCollector does not prematurely terminate observation', async () => {
        const pageHandle = await browserManager.acquirePage();
        try {
          const layoutCollector = new LayoutShiftCollector({ layoutShiftTimeoutMs: 100 });
          const perfCollector = new PerformanceCollector({ settleTimeoutMs: 100 });

          await layoutCollector.installScript(pageHandle.page);
          await perfCollector.installScript(pageHandle.page);

          await pageHandle.page.goto(`http://127.0.0.1:${serverPort}/cls`, { waitUntil: 'load' });

          // 1. LayoutShiftCollector collects first
          const layoutResult = await layoutCollector.collectMetrics(
            pageHandle.page,
            DEFAULT_VIEWPORT_PROFILES[0],
            `http://127.0.0.1:${serverPort}/`,
          );
          expect(layoutResult.metrics.isSupported).toBe(true);

          // 2. Introduce another layout shift on the page
          await pageHandle.page.evaluate(() => {
            const el = document.createElement('div');
            el.style.height = '150px';
            el.style.background = 'yellow';
            document.body.insertBefore(el, document.getElementById('shift-box'));
          });

          // 3. PerformanceCollector collects second
          const perfResult = await perfCollector.collectMetrics(pageHandle.page);

          // PerformanceCollector must still receive all layout shifts without premature termination
          expect(perfResult.metrics.cls).not.toBeNull();
          expect(perfResult.metrics.clsDetails?.totalShiftsCount).toBeGreaterThan(0);
        } finally {
          await pageHandle.release();
        }
      });
    });
  });
});
