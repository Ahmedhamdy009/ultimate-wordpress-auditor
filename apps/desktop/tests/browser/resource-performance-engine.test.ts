import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserManager } from '../../src/main/browser/manager.js';
import {
  analyzeResourcePerformance,
  evaluateMediaCondition,
  parseCssLengthToPixels,
  parseEffectiveSourceSize,
  parseSrcsetDescriptorForUrl,
  ResourcePerformanceEngine,
} from '../../src/main/browser/resource-performance-engine.js';
import type {
  CapturedNetworkResource,
  RawDomHeadElementEntry,
  RawDomImageEntry,
  RawResourceAuditData,
  RawResourceTimingEntry,
} from '../../src/main/browser/resource-performance-types.js';
import type { ResourceCategory } from '../../src/main/browser/runtime-types.js';

describe('ResourcePerformanceEngine Suite (Batch 7.3.2)', () => {
  const createBaseRawData = (
    overrides: Partial<RawResourceAuditData> = {},
  ): RawResourceAuditData => ({
    pageUrl: 'https://example.com/page',
    pageOrigin: 'https://example.com',
    dpr: 1,
    viewportWidth: 1440,
    viewportHeight: 900,
    resourceEntries: [],
    images: [],
    headElements: [],
    backgroundImages: [],
    bufferLimitReached: false,
    ...overrides,
  });

  const createBaseTimingEntry = (
    overrides: Partial<RawResourceTimingEntry> = {},
  ): RawResourceTimingEntry => ({
    name: 'https://example.com/assets/app.js',
    initiatorType: 'script',
    startTime: 100,
    duration: 150,
    responseEnd: 250,
    transferSize: 45000,
    encodedBodySize: 44000,
    decodedBodySize: 120000,
    domainLookupStart: 100,
    domainLookupEnd: 115,
    connectStart: 115,
    secureConnectionStart: 125,
    connectEnd: 140,
    requestStart: 145,
    responseStart: 190,
    workerStart: 0,
    ...overrides,
  });

  const createBaseNetworkRecord = (
    overrides: Partial<CapturedNetworkResource> = {},
  ): CapturedNetworkResource => ({
    id: 'net-1',
    url: 'https://example.com/assets/app.js',
    method: 'GET',
    resourceType: 'script',
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'content-encoding': 'gzip',
    },
    isNavigationRequest: false,
    isMainFrame: true,
    timestamp: Date.now(),
    isAborted: false,
    isBlocked: false,
    isFirstParty: true,
    ...overrides,
  });

  describe('1. Same-Origin Resource Timing & Metric Extraction', () => {
    it('computes accurate W3C timing arithmetic and preserves size metrics', () => {
      const timing = createBaseTimingEntry();
      const netRecord = createBaseNetworkRecord();
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources).toHaveLength(1);
      const res = result.resources[0];
      expect(res.url).toBe('https://example.com/assets/app.js');
      expect(res.transferState).toBe('transferred');
      expect(res.transferSizeBytes).toBe(45000);
      expect(res.encodedBodySizeBytes).toBe(44000);
      expect(res.decodedBodySizeBytes).toBe(120000);
      expect(res.httpStatus).toBe(200);
      expect(res.contentEncoding).toBe('gzip');

      // Timing breakdown
      expect(res.timingPhases).not.toBeNull();
      expect(res.timingPhases?.dnsLookupMs).toBe(15);
      expect(res.timingPhases?.tcpConnectMs).toBe(25);
      expect(res.timingPhases?.tlsHandshakeMs).toBe(15);
      expect(res.timingPhases?.ttfbMs).toBe(45);
      expect(res.timingPhases?.contentDownloadMs).toBe(60);
    });
  });

  describe('2. Cross-Origin Timing-Allow-Origin (TAO) vs CORS Restrictions', () => {
    it('Case A (Same-Origin): provides full access to timing phases and transfer sizes', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/assets/app.js',
        transferSize: 45000,
        encodedBodySize: 44000,
        decodedBodySize: 120000,
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://example.com/assets/app.js',
        headers: {
          'content-type': 'application/javascript',
        },
      });
      const raw = createBaseRawData({
        pageOrigin: 'https://example.com',
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources).toHaveLength(1);
      const res = result.resources[0];
      expect(res.timingAllowedByTao).toBe(true);
      expect(res.corsAllowed).toBe(true);
      expect(res.transferState).toBe('transferred');
      expect(res.transferSizeBytes).toBe(45000);
      expect(res.timingPhases).not.toBeNull();
      expect(result.summary.taoRestrictedCount).toBe(0);
      expect(result.summary.opaqueCrossOriginCount).toBe(0);
    });

    it('Case B (Cross-Origin + TAO + CORS): provides full access to timing phases and sizes', () => {
      const timing = createBaseTimingEntry({
        name: 'https://cdn.thirdparty.com/fonts.css',
        initiatorType: 'link',
        transferSize: 12500,
        encodedBodySize: 12000,
        decodedBodySize: 30000,
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://cdn.thirdparty.com/fonts.css',
        headers: {
          'content-type': 'text/css',
          'access-control-allow-origin': '*',
          'timing-allow-origin': '*',
        },
      });
      const raw = createBaseRawData({
        pageOrigin: 'https://example.com',
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources).toHaveLength(1);
      const res = result.resources[0];
      expect(res.timingAllowedByTao).toBe(true);
      expect(res.corsAllowed).toBe(true);
      expect(res.transferState).toBe('transferred');
      expect(res.transferSizeBytes).toBe(12500);
      expect(res.timingPhases).not.toBeNull();
      expect(result.summary.taoRestrictedCount).toBe(0);
      expect(result.summary.opaqueCrossOriginCount).toBe(0);
    });

    it('Case C (Cross-Origin + CORS without TAO): timing and wire sizes masked to null, contentLengthBytes preserved', () => {
      // In Case C: W3C Resource Timing masks transferSize, encodedBodySize, decodedBodySize, and timestamps to 0
      const timing = createBaseTimingEntry({
        name: 'https://api.thirdparty.com/data.json',
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 0,
        domainLookupStart: 0,
        domainLookupEnd: 0,
        connectStart: 0,
        connectEnd: 0,
        requestStart: 0,
        responseStart: 0,
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://api.thirdparty.com/data.json',
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*', // Valid CORS
          'content-length': '28400', // HTTP header preserved
          // Deliberately NO Timing-Allow-Origin
        },
      });
      const raw = createBaseRawData({
        pageOrigin: 'https://example.com',
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources).toHaveLength(1);
      const res = result.resources[0];
      expect(res.timingAllowedByTao).toBe(false);
      expect(res.corsAllowed).toBe(true);
      expect(res.transferState).toBe('tao_restricted');
      // Crucial requirement: masked 0s from Resource Timing must NOT be interpreted as 0 bytes
      expect(res.transferSizeBytes).toBeNull();
      expect(res.encodedBodySizeBytes).toBeNull();
      expect(res.decodedBodySizeBytes).toBeNull();
      expect(res.timingPhases).toBeNull();
      // Genuine HTTP header Content-Length must be preserved
      expect(res.contentLengthBytes).toBe(28400);
      expect(result.summary.taoRestrictedCount).toBe(1);
      expect(result.summary.opaqueCrossOriginCount).toBe(0);
    });

    it('Case D (Cross-Origin without CORS and without TAO): classified as opaque_cross_origin with null sizes', () => {
      // In Case D: Neither CORS nor TAO allowed; resource is opaque
      const timing = createBaseTimingEntry({
        name: 'https://cdn.external.com/tracking.js',
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 0,
        domainLookupStart: 0,
        domainLookupEnd: 0,
        connectStart: 0,
        connectEnd: 0,
        requestStart: 0,
        responseStart: 0,
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://cdn.external.com/tracking.js',
        headers: {
          'content-type': 'application/javascript',
          // Neither Access-Control-Allow-Origin nor Timing-Allow-Origin
        },
      });
      const raw = createBaseRawData({
        pageOrigin: 'https://example.com',
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources).toHaveLength(1);
      const res = result.resources[0];
      expect(res.timingAllowedByTao).toBe(false);
      expect(res.corsAllowed).toBe(false);
      expect(res.transferState).toBe('opaque_cross_origin');
      expect(res.transferSizeBytes).toBeNull();
      expect(res.encodedBodySizeBytes).toBeNull();
      expect(res.decodedBodySizeBytes).toBeNull();
      expect(res.timingPhases).toBeNull();
      expect(result.summary.taoRestrictedCount).toBe(0);
      expect(result.summary.opaqueCrossOriginCount).toBe(1);
    });
  });

  describe('3. Cached-Resource Ambiguity & Explicit Zero-Byte Handling', () => {
    it('does NOT treat transferSize === 0 alone as proof of cache when evidence is insufficient', () => {
      const timing = createBaseTimingEntry({
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 15000,
      });
      const netRecord = createBaseNetworkRecord({
        status: 200,
        headers: {
          'content-type': 'application/javascript',
          // No cache hit header, status 200, no Content-Length: 0
        },
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources[0].transferState).toBe('unknown');
      expect(result.resources[0].transferSizeBytes).toBeNull();
    });

    it('confirms cached state when HTTP status is 304 Not Modified', () => {
      const timing = createBaseTimingEntry({
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 50000,
      });
      const netRecord = createBaseNetworkRecord({
        status: 304,
        headers: {
          etag: '"abc123xyz"',
        },
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources[0].transferState).toBe('cached');
      expect(result.resources[0].transferSizeBytes).toBe(0);
      expect(result.summary.cachedCount).toBe(1);
    });

    it('confirms cached state when explicit X-Cache: HIT header is present', () => {
      const timing = createBaseTimingEntry({
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 25000,
      });
      const netRecord = createBaseNetworkRecord({
        status: 200,
        headers: {
          'x-cache': 'HIT from cloudfront',
        },
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources[0].transferState).toBe('cached');
      expect(result.resources[0].transferSizeBytes).toBe(0);
    });

    it('confirms zero_byte state when HTTP status is 204 No Content', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/api/ping',
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 0,
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://example.com/api/ping',
        status: 204,
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources[0].transferState).toBe('zero_byte');
      expect(result.resources[0].transferSizeBytes).toBe(0);
      expect(result.resources[0].encodedBodySizeBytes).toBe(0);
      expect(result.summary.zeroByteCount).toBe(1);
    });

    it('confirms zero_byte state when Content-Length is explicitly 0', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/beacon',
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 0,
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://example.com/beacon',
        status: 200,
        headers: {
          'content-length': '0',
        },
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      expect(result.resources[0].transferState).toBe('zero_byte');
      expect(result.resources[0].transferSizeBytes).toBe(0);
    });
  });

  describe('4. Transport Compression Analysis', () => {
    it('flags uncompressed text asset exceeding 10 KiB as PERF_RES_UNCOMPRESSED_ASSET', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/styles/bundle.css',
        initiatorType: 'link',
        transferSize: 45000, // ~44 KiB > 10 KiB threshold
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://example.com/styles/bundle.css',
        headers: {
          'content-type': 'text/css; charset=utf-8',
          // No content-encoding header
        },
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      const uncompressed = result.findings.find(f => f.ruleId === 'PERF_RES_UNCOMPRESSED_ASSET');
      expect(uncompressed).toBeDefined();
      expect(uncompressed?.severity).toBe('medium');
      expect(uncompressed?.evidence?.contentType).toContain('text/css');
      expect(result.summary.uncompressedAssetsCount).toBe(1);
    });

    it('does NOT flag compressible asset when Content-Encoding is gzip or br', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/scripts/vendor.js',
        transferSize: 85000,
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://example.com/scripts/vendor.js',
        headers: {
          'content-type': 'application/javascript',
          'content-encoding': 'br',
        },
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      const uncompressed = result.findings.find(f => f.ruleId === 'PERF_RES_UNCOMPRESSED_ASSET');
      expect(uncompressed).toBeUndefined();
      expect(result.summary.uncompressedAssetsCount).toBe(0);
    });

    it('does NOT flag compressible asset under 10 KiB', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/small.css',
        transferSize: 4096, // 4 KiB
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://example.com/small.css',
        headers: {
          'content-type': 'text/css',
        },
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      const uncompressed = result.findings.find(f => f.ruleId === 'PERF_RES_UNCOMPRESSED_ASSET');
      expect(uncompressed).toBeUndefined();
    });

    it('does NOT flag non-compressible assets like JPEG or WebP', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/photo.jpg',
        initiatorType: 'img',
        transferSize: 500000, // 500 KiB
      });
      const netRecord = createBaseNetworkRecord({
        url: 'https://example.com/photo.jpg',
        headers: {
          'content-type': 'image/jpeg',
        },
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw, [netRecord]);

      const uncompressed = result.findings.find(f => f.ruleId === 'PERF_RES_UNCOMPRESSED_ASSET');
      expect(uncompressed).toBeUndefined();
    });
  });

  describe('5. Render-Blocking Stylesheets & Scripts', () => {
    it('detects synchronous <link rel="stylesheet"> in <head> as PERF_RES_RENDER_BLOCKING_CSS', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/theme.css',
        initiatorType: 'link',
        duration: 250,
      });
      const headLink: RawDomHeadElementEntry = {
        tagName: 'link',
        url: 'https://example.com/theme.css',
        rel: 'stylesheet',
        media: 'all',
        mediaMatches: true,
        disabled: false,
        selector: '#theme-style',
      };
      const raw = createBaseRawData({
        resourceEntries: [timing],
        headElements: [headLink],
      });

      const result = analyzeResourcePerformance(raw);

      const blockingCss = result.findings.find(f => f.ruleId === 'PERF_RES_RENDER_BLOCKING_CSS');
      expect(blockingCss).toBeDefined();
      expect(blockingCss?.severity).toBe('medium');
      expect(result.summary.renderBlockingCssCount).toBe(1);
      expect(result.resources[0].isRenderBlocking).toBe(true);
    });

    it('does NOT flag stylesheet with media="print" as render-blocking', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/print.css',
        initiatorType: 'link',
      });
      const headLink: RawDomHeadElementEntry = {
        tagName: 'link',
        url: 'https://example.com/print.css',
        rel: 'stylesheet',
        media: 'print',
        mediaMatches: false, // Print media does not match standard screen
        disabled: false,
      };
      const raw = createBaseRawData({
        resourceEntries: [timing],
        headElements: [headLink],
      });

      const result = analyzeResourcePerformance(raw);

      const blockingCss = result.findings.find(f => f.ruleId === 'PERF_RES_RENDER_BLOCKING_CSS');
      expect(blockingCss).toBeUndefined();
      expect(result.resources[0].isRenderBlocking).toBe(false);
    });

    it('detects synchronous <script> in <head> as PERF_RES_RENDER_BLOCKING_JS', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/main.js',
        initiatorType: 'script',
        duration: 320,
      });
      const headScript: RawDomHeadElementEntry = {
        tagName: 'script',
        url: 'https://example.com/main.js',
        async: false,
        defer: false,
        type: 'text/javascript',
        selector: 'script[src="main.js"]',
      };
      const raw = createBaseRawData({
        resourceEntries: [timing],
        headElements: [headScript],
      });

      const result = analyzeResourcePerformance(raw);

      const blockingJs = result.findings.find(f => f.ruleId === 'PERF_RES_RENDER_BLOCKING_JS');
      expect(blockingJs).toBeDefined();
      expect(result.summary.renderBlockingJsCount).toBe(1);
      expect(result.resources[0].isRenderBlocking).toBe(true);
    });

    it('does NOT flag script with defer, async, or type="module" as render-blocking', () => {
      const headScripts: RawDomHeadElementEntry[] = [
        {
          tagName: 'script',
          url: 'https://example.com/async.js',
          async: true,
          defer: false,
        },
        {
          tagName: 'script',
          url: 'https://example.com/defer.js',
          async: false,
          defer: true,
        },
        {
          tagName: 'script',
          url: 'https://example.com/module.js',
          async: false,
          defer: false,
          type: 'module',
        },
      ];
      const raw = createBaseRawData({
        headElements: headScripts,
        resourceEntries: headScripts.map(s =>
          createBaseTimingEntry({ name: s.url, initiatorType: 'script' }),
        ),
      });

      const result = analyzeResourcePerformance(raw);

      const blockingJs = result.findings.find(f => f.ruleId === 'PERF_RES_RENDER_BLOCKING_JS');
      expect(blockingJs).toBeUndefined();
      expect(result.summary.renderBlockingJsCount).toBe(0);
    });
  });

  describe('6. Large JavaScript & Stylesheet Payload Analysis', () => {
    it('flags JavaScript exceeding 250 KiB transferred as PERF_RES_LARGE_JAVASCRIPT', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/huge-bundle.js',
        initiatorType: 'script',
        transferSize: 300000, // 300 KiB > 250 KiB
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw);

      const largeJs = result.findings.find(f => f.ruleId === 'PERF_RES_LARGE_JAVASCRIPT');
      expect(largeJs).toBeDefined();
      expect(largeJs?.severity).toBe('info');
    });

    it('flags Stylesheet exceeding 100 KiB transferred as PERF_RES_LARGE_STYLESHEET', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/huge-theme.css',
        initiatorType: 'link',
        transferSize: 150000, // 150 KiB > 100 KiB
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw);

      const largeCss = result.findings.find(f => f.ruleId === 'PERF_RES_LARGE_STYLESHEET');
      expect(largeCss).toBeDefined();
      expect(largeCss?.severity).toBe('info');
    });
  });

  describe('7. Image Analysis: currentSrc, DPR Calibration & Oversized Detection', () => {
    const createBaseImage = (overrides: Partial<RawDomImageEntry> = {}): RawDomImageEntry => ({
      selector: '#hero-img',
      currentSrc: 'https://example.com/images/hero-1200.jpg',
      src: 'https://example.com/images/hero-fallback.jpg',
      naturalWidth: 2400,
      naturalHeight: 1600,
      renderedWidth: 400,
      renderedHeight: 300,
      loading: 'eager',
      boundingBox: { x: 50, y: 100, width: 400, height: 300 },
      isSvg: false,
      ...overrides,
    });

    it('uses currentSrc and calibrates for Device Pixel Ratio with 1.5x safety margin', () => {
      // DPR = 2. Rendered width = 400 CSS px.
      // Target physical pixels = 400 * 2 = 800 px.
      // Safety margin 1.5x = 800 * 1.5 = 1200 px.
      // Intrinsic width = 2400 px > 1200 px -> Oversized!
      const img = createBaseImage();
      const raw = createBaseRawData({
        dpr: 2,
        images: [img],
      });

      const result = analyzeResourcePerformance(raw);

      expect(result.images).toHaveLength(1);
      const analyzedImg = result.images[0];
      expect(analyzedImg.currentSrc).toBe('https://example.com/images/hero-1200.jpg');
      expect(analyzedImg.originalSrc).toBe('https://example.com/images/hero-fallback.jpg');
      expect(analyzedImg.dpr).toBe(2);
      expect(analyzedImg.effectiveWidthPixels).toBe(800);
      expect(analyzedImg.effectiveHeightPixels).toBe(600);
      expect(analyzedImg.isOversized).toBe(true);
      expect(analyzedImg.oversizedFactor).toBe(3.0); // 2400 / 800 = 3.0

      const finding = result.findings.find(f => f.ruleId === 'PERF_RES_OVERSIZED_IMAGE');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('low');
      expect(result.summary.oversizedImagesCount).toBe(1);
    });

    it('does NOT flag image when natural dimensions stay within 1.5x DPR requirements', () => {
      // DPR = 2. Rendered width = 400 CSS px. Target = 800 px.
      // Intrinsic width = 1000 px <= 1200 px (1.5x safety threshold). Not oversized!
      const img = createBaseImage({
        naturalWidth: 1000,
        naturalHeight: 750,
      });
      const raw = createBaseRawData({
        dpr: 2,
        images: [img],
      });

      const result = analyzeResourcePerformance(raw);

      expect(result.images[0].isOversized).toBe(false);
      const finding = result.findings.find(f => f.ruleId === 'PERF_RES_OVERSIZED_IMAGE');
      expect(finding).toBeUndefined();
    });

    it('strictly EXCLUDES SVG images from oversized image rules', () => {
      const svgImg = createBaseImage({
        currentSrc: 'https://example.com/vector-logo.svg',
        naturalWidth: 5000,
        naturalHeight: 5000,
        renderedWidth: 100,
        renderedHeight: 100,
        isSvg: true,
      });
      const raw = createBaseRawData({
        images: [svgImg],
      });

      const result = analyzeResourcePerformance(raw);

      expect(result.images[0].isSvg).toBe(true);
      expect(result.images[0].isOversized).toBe(false);
      const finding = result.findings.find(f => f.ruleId === 'PERF_RES_OVERSIZED_IMAGE');
      expect(finding).toBeUndefined();
    });

    it('handles responsive srcset with 1x, 2x, and 3x density descriptors', () => {
      // 1x candidate
      const img1x = createBaseImage({
        currentSrc: 'https://example.com/images/card-1x.jpg',
        src: 'https://example.com/images/card-fallback.jpg',
        srcset:
          'https://example.com/images/card-1x.jpg 1x, https://example.com/images/card-2x.jpg 2x, https://example.com/images/card-3x.jpg 3x',
        naturalWidth: 600,
        naturalHeight: 400,
        renderedWidth: 400,
        renderedHeight: 267,
      });
      const raw1x = createBaseRawData({ dpr: 1, images: [img1x] });
      const res1x = analyzeResourcePerformance(raw1x);
      expect(res1x.images[0].densityDescriptor).toBe(1.0);
      expect(res1x.images[0].sourcePhysicalWidth).toBe(600); // 600 * 1

      // 2x candidate
      const img2x = createBaseImage({
        currentSrc: 'https://example.com/images/card-2x.jpg',
        src: 'https://example.com/images/card-fallback.jpg',
        srcset:
          'https://example.com/images/card-1x.jpg 1x, https://example.com/images/card-2x.jpg 2x, https://example.com/images/card-3x.jpg 3x',
        naturalWidth: 600,
        naturalHeight: 400,
        renderedWidth: 200,
        renderedHeight: 133,
      });
      const raw2x = createBaseRawData({ dpr: 2, images: [img2x] });
      const res2x = analyzeResourcePerformance(raw2x);
      expect(res2x.images[0].densityDescriptor).toBe(2.0);
      expect(res2x.images[0].sourcePhysicalWidth).toBe(1200); // 600 * 2
      expect(res2x.images[0].effectiveWidthPixels).toBe(400); // 200 * 2
      expect(res2x.images[0].isOversized).toBe(true);
      expect(res2x.images[0].oversizedFactor).toBe(3.0); // 1200 / 400 = 3.0

      // 3x candidate
      const img3x = createBaseImage({
        currentSrc: 'https://example.com/images/card-3x.jpg',
        src: 'https://example.com/images/card-fallback.jpg',
        srcset:
          'https://example.com/images/card-1x.jpg 1x, https://example.com/images/card-2x.jpg 2x, https://example.com/images/card-3x.jpg 3x',
        naturalWidth: 600,
        naturalHeight: 400,
        renderedWidth: 600,
        renderedHeight: 400,
      });
      const raw3x = createBaseRawData({ dpr: 3, images: [img3x] });
      const res3x = analyzeResourcePerformance(raw3x);
      expect(res3x.images[0].densityDescriptor).toBe(3.0);
      expect(res3x.images[0].sourcePhysicalWidth).toBe(1800); // 600 * 3
      expect(res3x.images[0].effectiveWidthPixels).toBe(1800); // 600 * 3
      expect(res3x.images[0].isOversized).toBe(false); // 1800 <= 1800 * 1.5
    });

    it('handles width descriptor 800w with 400px source size', () => {
      // candidateWidth = 800w, sizes = 400px.
      // effectiveDensity = 800 / 400 = 2.0.
      // In DOM: naturalWidth = 400 CSS px.
      // sourcePhysicalWidth = 400 * 2.0 = 800 physical px.
      const img = createBaseImage({
        currentSrc: 'https://example.com/images/thumb-800.jpg',
        src: 'https://example.com/images/thumb-fallback.jpg',
        srcset: 'https://example.com/images/thumb-800.jpg 800w',
        sizes: '400px',
        naturalWidth: 400,
        naturalHeight: 300,
        renderedWidth: 200, // Displayed small: 200 CSS px
        renderedHeight: 150,
      });

      // At DPR 1: required = 200 px, threshold = 200 * 1.5 = 300 px.
      // 800 > 300 -> Oversized!
      const rawDpr1 = createBaseRawData({ dpr: 1, images: [img] });
      const resDpr1 = analyzeResourcePerformance(rawDpr1);
      expect(resDpr1.images[0].sourcePhysicalWidth).toBe(800);
      expect(resDpr1.images[0].densityDescriptor).toBe(2.0);
      expect(resDpr1.images[0].effectiveWidthPixels).toBe(200);
      expect(resDpr1.images[0].isOversized).toBe(true);
      expect(resDpr1.images[0].oversizedFactor).toBe(4.0); // 800 / 200

      // At DPR 2: rendered at 400 CSS px -> required = 800 px.
      // Threshold = 800 * 1.5 = 1200 px. 800 <= 1200 -> Not oversized!
      const imgFullDisplay = createBaseImage({
        ...img,
        renderedWidth: 400,
        renderedHeight: 300,
      });
      const rawDpr2 = createBaseRawData({ dpr: 2, images: [imgFullDisplay] });
      const resDpr2 = analyzeResourcePerformance(rawDpr2);
      expect(resDpr2.images[0].sourcePhysicalWidth).toBe(800);
      expect(resDpr2.images[0].effectiveWidthPixels).toBe(800);
      expect(resDpr2.images[0].isOversized).toBe(false);
    });

    it('handles width descriptor 1600w with 800px source size', () => {
      // candidateWidth = 1600w, sizes = 800px.
      // effectiveDensity = 1600 / 800 = 2.0.
      // In DOM: naturalWidth = 800 CSS px.
      // sourcePhysicalWidth = 800 * 2.0 = 1600 physical px.
      const img = createBaseImage({
        currentSrc: 'https://example.com/images/banner-1600.jpg',
        src: 'https://example.com/images/banner-fallback.jpg',
        srcset:
          'https://example.com/images/banner-800.jpg 800w, https://example.com/images/banner-1600.jpg 1600w',
        sizes: '800px',
        naturalWidth: 800,
        naturalHeight: 400,
        renderedWidth: 300, // Displayed at 300 CSS px
        renderedHeight: 150,
      });

      // At DPR 1: required = 300 px, threshold = 450 px.
      // 1600 > 450 -> Oversized!
      const rawDpr1 = createBaseRawData({ dpr: 1, images: [img] });
      const resDpr1 = analyzeResourcePerformance(rawDpr1);
      expect(resDpr1.images[0].sourcePhysicalWidth).toBe(1600);
      expect(resDpr1.images[0].densityDescriptor).toBe(2.0);
      expect(resDpr1.images[0].effectiveWidthPixels).toBe(300);
      expect(resDpr1.images[0].isOversized).toBe(true);
      expect(resDpr1.images[0].oversizedFactor).toBeCloseTo(5.33, 2);

      // At DPR 2 with renderedWidth = 800 CSS px: required = 1600 px.
      // Threshold = 2400 px. 1600 <= 2400 -> Not oversized!
      const imgWide = createBaseImage({
        ...img,
        renderedWidth: 800,
        renderedHeight: 400,
      });
      const rawDpr2 = createBaseRawData({ dpr: 2, images: [imgWide] });
      const resDpr2 = analyzeResourcePerformance(rawDpr2);
      expect(resDpr2.images[0].sourcePhysicalWidth).toBe(1600);
      expect(resDpr2.images[0].effectiveWidthPixels).toBe(1600);
      expect(resDpr2.images[0].isOversized).toBe(false);
    });

    it('handles width descriptors with responsive sizes (media conditions)', () => {
      // sizes="(max-width: 600px) 400px, 800px"
      const responsiveSizes = '(max-width: 600px) 400px, 800px';

      // 1. Mobile viewport (500px): matches (max-width: 600px) -> effectiveSourceSize = 400px.
      // candidate = 800w. effectiveDensity = 800 / 400 = 2.0.
      const imgMobile = createBaseImage({
        currentSrc: 'https://example.com/images/banner-800.jpg',
        src: 'https://example.com/images/banner-fallback.jpg',
        srcset:
          'https://example.com/images/banner-800.jpg 800w, https://example.com/images/banner-1600.jpg 1600w',
        sizes: responsiveSizes,
        naturalWidth: 400,
        naturalHeight: 200,
        renderedWidth: 350,
        renderedHeight: 175,
      });
      const rawMobile = createBaseRawData({
        viewportWidth: 500,
        dpr: 1,
        images: [imgMobile],
      });
      const resMobile = analyzeResourcePerformance(rawMobile);
      expect(resMobile.images[0].densityDescriptor).toBe(2.0);
      expect(resMobile.images[0].sourcePhysicalWidth).toBe(800); // 400 * 2.0

      // 2. Desktop viewport (1200px): misses (max-width: 600px) -> falls back to 800px.
      // candidate = 1600w. effectiveDensity = 1600 / 800 = 2.0.
      const imgDesktop = createBaseImage({
        currentSrc: 'https://example.com/images/banner-1600.jpg',
        src: 'https://example.com/images/banner-fallback.jpg',
        srcset:
          'https://example.com/images/banner-800.jpg 800w, https://example.com/images/banner-1600.jpg 1600w',
        sizes: responsiveSizes,
        naturalWidth: 800,
        naturalHeight: 400,
        renderedWidth: 750,
        renderedHeight: 375,
      });
      const rawDesktop = createBaseRawData({
        viewportWidth: 1200,
        dpr: 1,
        images: [imgDesktop],
      });
      const resDesktop = analyzeResourcePerformance(rawDesktop);
      expect(resDesktop.images[0].densityDescriptor).toBe(2.0);
      expect(resDesktop.images[0].sourcePhysicalWidth).toBe(1600); // 800 * 2.0
    });

    it('evaluates oversized image detection across DPR 1, DPR 2, and DPR 3', () => {
      // Source image bitmap is 1500 physical px wide. Rendered at 400 CSS px.
      const img = createBaseImage({
        currentSrc: 'https://example.com/images/product-1500.jpg',
        naturalWidth: 1500,
        naturalHeight: 1000,
        renderedWidth: 400,
        renderedHeight: 267,
      });

      // DPR 1: required = 400 * 1 = 400 px. Threshold = 400 * 1.5 = 600 px.
      // 1500 > 600 -> Oversized (3.75x)!
      const resDpr1 = analyzeResourcePerformance(createBaseRawData({ dpr: 1, images: [img] }));
      expect(resDpr1.images[0].effectiveWidthPixels).toBe(400);
      expect(resDpr1.images[0].isOversized).toBe(true);
      expect(resDpr1.images[0].oversizedFactor).toBe(3.75);

      // DPR 2: required = 400 * 2 = 800 px. Threshold = 800 * 1.5 = 1200 px.
      // 1500 > 1200 -> Oversized (1.88x)!
      const resDpr2 = analyzeResourcePerformance(createBaseRawData({ dpr: 2, images: [img] }));
      expect(resDpr2.images[0].effectiveWidthPixels).toBe(800);
      expect(resDpr2.images[0].isOversized).toBe(true);
      expect(resDpr2.images[0].oversizedFactor).toBe(1.88);

      // DPR 3: required = 400 * 3 = 1200 px. Threshold = 1200 * 1.5 = 1800 px.
      // 1500 <= 1800 -> Crisp display on Retina 3x, NOT oversized!
      const resDpr3 = analyzeResourcePerformance(createBaseRawData({ dpr: 3, images: [img] }));
      expect(resDpr3.images[0].effectiveWidthPixels).toBe(1200);
      expect(resDpr3.images[0].isOversized).toBe(false);
      expect(resDpr3.images[0].oversizedFactor).toBeNull();
    });

    it('handles case where browser-selected candidate differs from fallback src', () => {
      const img = createBaseImage({
        currentSrc: 'https://example.com/images/card-2x.jpg',
        src: 'https://example.com/images/fallback-default.jpg', // Differing fallback
        srcset:
          'https://example.com/images/card-1x.jpg 1x, https://example.com/images/card-2x.jpg 2x',
        naturalWidth: 600,
        naturalHeight: 400,
        renderedWidth: 300,
        renderedHeight: 200,
      });
      const raw = createBaseRawData({ dpr: 2, images: [img] });
      const result = analyzeResourcePerformance(raw);

      const analyzed = result.images[0];
      // Current selected candidate is used for analysis
      expect(analyzed.currentSrc).toBe('https://example.com/images/card-2x.jpg');
      expect(analyzed.originalSrc).toBe('https://example.com/images/fallback-default.jpg');
      expect(analyzed.densityDescriptor).toBe(2.0);
      expect(analyzed.sourcePhysicalWidth).toBe(1200); // 600 * 2.0
    });

    it('preserves null sourcePhysicalWidth when sizes is missing or ambiguous', () => {
      // 1. Missing sizes attribute
      const imgMissingSizes = createBaseImage({
        currentSrc: 'https://example.com/images/banner-1600.jpg',
        srcset: 'https://example.com/images/banner-1600.jpg 1600w',
        sizes: null, // Omitted
        naturalWidth: 800,
        naturalHeight: 400,
        renderedWidth: 200,
        renderedHeight: 100,
      });
      const resMissing = analyzeResourcePerformance(
        createBaseRawData({ images: [imgMissingSizes] }),
      );
      expect(resMissing.images[0].sourcePhysicalWidth).toBeNull();
      expect(resMissing.images[0].densityDescriptor).toBeNull();
      expect(resMissing.images[0].isOversized).toBe(false);
      expect(
        resMissing.findings.find(f => f.ruleId === 'PERF_RES_OVERSIZED_IMAGE'),
      ).toBeUndefined();

      // 2. Ambiguous / unresolvable calc() sizes
      const imgAmbiguousSizes = createBaseImage({
        currentSrc: 'https://example.com/images/banner-1600.jpg',
        srcset: 'https://example.com/images/banner-1600.jpg 1600w',
        sizes: 'calc(100vw - 32px)', // Cannot be deterministically resolved
        naturalWidth: 800,
        naturalHeight: 400,
        renderedWidth: 200,
        renderedHeight: 100,
      });
      const resAmbiguous = analyzeResourcePerformance(
        createBaseRawData({ images: [imgAmbiguousSizes] }),
      );
      expect(resAmbiguous.images[0].sourcePhysicalWidth).toBeNull();
      expect(resAmbiguous.images[0].densityDescriptor).toBeNull();
      expect(resAmbiguous.images[0].isOversized).toBe(false);
      expect(
        resAmbiguous.findings.find(f => f.ruleId === 'PERF_RES_OVERSIZED_IMAGE'),
      ).toBeUndefined();
    });

    it('preserves null sourcePhysicalWidth for complex <picture> elements', () => {
      const pictureImg = createBaseImage({
        currentSrc: 'https://example.com/images/hero-art-directed.jpg',
        hasPictureParent: true, // Inside <picture>
        srcset: 'https://example.com/images/hero-art-directed.jpg 1600w',
        sizes: '800px',
        naturalWidth: 800,
        naturalHeight: 400,
        renderedWidth: 200,
        renderedHeight: 100,
      });
      const result = analyzeResourcePerformance(createBaseRawData({ images: [pictureImg] }));

      expect(result.images[0].sourcePhysicalWidth).toBeNull();
      expect(result.images[0].densityDescriptor).toBeNull();
      expect(result.images[0].isOversized).toBe(false);
      expect(result.findings.find(f => f.ruleId === 'PERF_RES_OVERSIZED_IMAGE')).toBeUndefined();
    });

    it('preserves null sourcePhysicalWidth when natural dimensions are 0 (e.g. broken or unloaded image)', () => {
      const brokenImg = createBaseImage({
        naturalWidth: 0,
        naturalHeight: 0,
        renderedWidth: 200,
        renderedHeight: 200,
      });
      const raw = createBaseRawData({
        images: [brokenImg],
      });

      const result = analyzeResourcePerformance(raw);

      const analyzed = result.images[0];
      expect(analyzed.sourcePhysicalWidth).toBeNull();
      expect(analyzed.sourcePhysicalHeight).toBeNull();
      expect(analyzed.isOversized).toBe(false);
      // Crucial: do not emit false confirmed finding
      const finding = result.findings.find(f => f.ruleId === 'PERF_RES_OVERSIZED_IMAGE');
      expect(finding).toBeUndefined();
    });

    it('unit test: parseSrcsetDescriptorForUrl parses density and width descriptors accurately', () => {
      const srcset =
        'https://example.com/small.jpg 1x, https://example.com/medium.jpg 2x, https://example.com/large.jpg 3x, /hero-800.jpg 800w, fallback.jpg';

      expect(parseSrcsetDescriptorForUrl(srcset, 'https://example.com/small.jpg')).toEqual({
        type: 'density',
        value: 1,
      });
      expect(parseSrcsetDescriptorForUrl(srcset, 'https://example.com/medium.jpg')).toEqual({
        type: 'density',
        value: 2,
      });
      expect(parseSrcsetDescriptorForUrl(srcset, 'https://example.com/large.jpg')).toEqual({
        type: 'density',
        value: 3,
      });
      expect(parseSrcsetDescriptorForUrl(srcset, 'https://example.com/hero-800.jpg')).toEqual({
        type: 'width',
        value: 800,
      });
      // Entry without descriptor defaults to 1x
      expect(parseSrcsetDescriptorForUrl(srcset, 'https://example.com/fallback.jpg')).toEqual({
        type: 'density',
        value: 1.0,
      });

      // Returns null for non-matching or empty
      expect(parseSrcsetDescriptorForUrl(srcset, 'https://example.com/nonexistent.jpg')).toBeNull();
      expect(parseSrcsetDescriptorForUrl(null, 'https://example.com/pic.jpg')).toBeNull();
      expect(parseSrcsetDescriptorForUrl('', 'https://example.com/pic.jpg')).toBeNull();
    });

    it('unit test: evaluateMediaCondition, parseCssLengthToPixels, and parseEffectiveSourceSize', () => {
      // 1. evaluateMediaCondition
      expect(evaluateMediaCondition('(max-width: 600px)', 500)).toBe(true);
      expect(evaluateMediaCondition('(max-width: 600px)', 700)).toBe(false);
      expect(evaluateMediaCondition('(min-width: 768px)', 800)).toBe(true);
      expect(evaluateMediaCondition('(min-width: 768px)', 700)).toBe(false);
      expect(evaluateMediaCondition('(min-width: 50em)', 800)).toBe(true); // 50 * 16 = 800
      expect(evaluateMediaCondition('(min-width: 50em)', 750)).toBe(false);
      expect(evaluateMediaCondition('(orientation: portrait)', 800)).toBe(false); // Unknown

      // 2. parseCssLengthToPixels
      expect(parseCssLengthToPixels('800px', 1440)).toBe(800);
      expect(parseCssLengthToPixels('50vw', 1440)).toBe(720);
      expect(parseCssLengthToPixels('2.5rem', 1440)).toBe(40);
      expect(parseCssLengthToPixels('800', 1440)).toBe(800);
      expect(parseCssLengthToPixels('calc(100vw - 32px)', 1440)).toBeNull();
      expect(parseCssLengthToPixels('', 1440)).toBeNull();

      // 3. parseEffectiveSourceSize
      expect(parseEffectiveSourceSize('800px', 1440)).toBe(800);
      expect(parseEffectiveSourceSize('(max-width: 600px) 400px, 800px', 500)).toBe(400);
      expect(parseEffectiveSourceSize('(max-width: 600px) 400px, 800px', 700)).toBe(800);
      expect(parseEffectiveSourceSize(null, 1440)).toBeNull();
      expect(parseEffectiveSourceSize('', 1440)).toBeNull();
      expect(parseEffectiveSourceSize('calc(100% - 20px)', 1440)).toBeNull();
    });
  });

  describe('8. LCP Image & Above-the-Fold Lazy Loading Anti-Pattern', () => {
    it('flags above-the-fold image with loading="lazy" as PERF_LCP_IMG_LAZY_LOADED', () => {
      const heroImg: RawDomImageEntry = {
        selector: '#hero-banner',
        currentSrc: 'https://example.com/hero.png',
        src: 'https://example.com/hero.png',
        naturalWidth: 800,
        naturalHeight: 400,
        renderedWidth: 800,
        renderedHeight: 400,
        loading: 'lazy', // Anti-pattern!
        boundingBox: { x: 0, y: 50, width: 800, height: 400 }, // in initial 900px viewport
        isSvg: false,
      };
      const raw = createBaseRawData({
        viewportHeight: 900,
        images: [heroImg],
      });

      const result = analyzeResourcePerformance(raw);

      expect(result.images[0].isAboveTheFold).toBe(true);
      expect(result.images[0].isLazyLoadedAboveTheFold).toBe(true);

      const antiPatternFinding = result.findings.find(f => f.ruleId === 'PERF_LCP_IMG_LAZY_LOADED');
      expect(antiPatternFinding).toBeDefined();
      expect(antiPatternFinding?.severity).toBe('medium');
      expect(result.summary.lazyLoadedAboveTheFoldImagesCount).toBe(1);
    });

    it('flags LCP candidate with loading="lazy" as PERF_LCP_IMG_LAZY_LOADED even if bounding rect is ambiguous', () => {
      const lcpImg: RawDomImageEntry = {
        selector: '#lcp-image',
        currentSrc: 'https://example.com/lcp-target.webp',
        src: 'https://example.com/lcp-target.webp',
        naturalWidth: 600,
        naturalHeight: 400,
        renderedWidth: 600,
        renderedHeight: 400,
        loading: 'lazy',
        boundingBox: null,
        isSvg: false,
      };
      const raw = createBaseRawData({
        images: [lcpImg],
      });

      const result = analyzeResourcePerformance(raw, [], {
        lcpUrl: 'https://example.com/lcp-target.webp',
      });

      expect(result.images[0].isLcpCandidate).toBe(true);
      expect(result.images[0].isLazyLoadedAboveTheFold).toBe(true);

      const antiPatternFinding = result.findings.find(f => f.ruleId === 'PERF_LCP_IMG_LAZY_LOADED');
      expect(antiPatternFinding).toBeDefined();
    });

    it('does NOT flag below-the-fold image with loading="lazy"', () => {
      const footerImg: RawDomImageEntry = {
        selector: '#footer-sponsor',
        currentSrc: 'https://example.com/sponsor.png',
        src: 'https://example.com/sponsor.png',
        naturalWidth: 300,
        naturalHeight: 100,
        renderedWidth: 300,
        renderedHeight: 100,
        loading: 'lazy', // Good practice for below the fold!
        boundingBox: { x: 0, y: 1500, width: 300, height: 100 }, // Far below 900px fold
        isSvg: false,
      };
      const raw = createBaseRawData({
        viewportHeight: 900,
        images: [footerImg],
      });

      const result = analyzeResourcePerformance(raw);

      expect(result.images[0].isAboveTheFold).toBe(false);
      expect(result.images[0].isLazyLoadedAboveTheFold).toBe(false);

      const antiPatternFinding = result.findings.find(f => f.ruleId === 'PERF_LCP_IMG_LAZY_LOADED');
      expect(antiPatternFinding).toBeUndefined();
    });
  });

  describe('9. CSS Background Images & Measurable Dimensions', () => {
    it('captures background images exceeding 100px width/height and checks fold position', () => {
      const raw = createBaseRawData({
        viewportHeight: 900,
        backgroundImages: [
          {
            selector: '.hero-section',
            url: 'https://example.com/bg-hero.jpg',
            renderedWidth: 1440,
            renderedHeight: 600,
            boundingBox: { x: 0, y: 0, width: 1440, height: 600 },
          },
          {
            selector: '.footer-section',
            url: 'https://example.com/bg-footer.png',
            renderedWidth: 1440,
            renderedHeight: 400,
            boundingBox: { x: 0, y: 1800, width: 1440, height: 400 },
          },
        ],
      });

      const result = analyzeResourcePerformance(raw);

      expect(result.images).toHaveLength(2);
      expect(result.images[0].isBackground).toBe(true);
      expect(result.images[0].isAboveTheFold).toBe(true);
      expect(result.images[0].naturalWidth).toBeNull(); // Missing natural dims remains null

      expect(result.images[1].isBackground).toBe(true);
      expect(result.images[1].isAboveTheFold).toBe(false);
    });
  });

  describe('10. Sensitive Data Redaction & Buffer Limit Handling', () => {
    it('redacts tokens and sensitive query parameters from resource URLs in findings and models', () => {
      const timing = createBaseTimingEntry({
        name: 'https://example.com/api/user.js?token=secret12345&apiKey=private_key_abc',
        initiatorType: 'script',
        transferSize: 350000,
      });
      const raw = createBaseRawData({
        resourceEntries: [timing],
      });

      const result = analyzeResourcePerformance(raw);

      expect(result.resources[0].url).not.toContain('secret12345');
      expect(decodeURIComponent(result.resources[0].url)).toContain('[REDACTED]');

      const largeFinding = result.findings.find(f => f.ruleId === 'PERF_RES_LARGE_JAVASCRIPT');
      expect(largeFinding?.targetUrl).not.toContain('secret12345');
      expect(decodeURIComponent(largeFinding?.targetUrl || '')).toContain('[REDACTED]');
    });

    it('preserves bufferLimitReached indicator in summary', () => {
      const raw = createBaseRawData({
        bufferLimitReached: true,
      });

      const result = analyzeResourcePerformance(raw);

      expect(result.summary.resourceBufferLimitReached).toBe(true);
    });
  });

  function createTestPng(width: number, height: number): Buffer {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 0;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const scanline = Buffer.alloc(width + 1, 0);
    const raw = Buffer.concat(Array(height).fill(scanline));
    const idat = zlib.deflateSync(raw);

    const makeChunk = (type: string, data: Buffer) => {
      const chunk = Buffer.alloc(8 + data.length + 4);
      chunk.writeUInt32BE(data.length, 0);
      chunk.write(type, 4, 4, 'ascii');
      data.copy(chunk, 8);
      const crc = zlib.crc32(chunk.subarray(4, 8 + data.length));
      chunk.writeUInt32BE(crc >>> 0, 8 + data.length);
      return chunk;
    };

    return Buffer.concat([
      signature,
      makeChunk('IHDR', ihdr),
      makeChunk('IDAT', idat),
      makeChunk('IEND', Buffer.alloc(0)),
    ]);
  }

  describe('11. Real Chromium Browser End-to-End Integration Test', () => {
    let server: http.Server;
    let serverUrl: string;
    let crossOriginServer: http.Server;
    let crossOriginUrl: string;
    let browserManager: BrowserManager;

    beforeAll(async () => {
      crossOriginServer = http.createServer((req, res) => {
        const url = req.url || '/';

        if (url === '/cross-tao-cors.js') {
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Access-Control-Allow-Origin': '*',
            'Timing-Allow-Origin': '*',
          });
          res.end('console.log("cross-tao-cors");');
          return;
        }

        if (url === '/cross-cors-notao.js') {
          const body =
            '/* cross-origin cors allowed but timing masked */   console.log("cross-cors-notao");';
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': Buffer.byteLength(body).toString(),
            // No Timing-Allow-Origin
          });
          res.end(body);
          return;
        }

        if (url === '/cross-opaque.js') {
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            // No ACAO, No TAO
          });
          res.end('console.log("cross-opaque");');
          return;
        }

        if (url === '/responsive-2x.png') {
          const transparentPng = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            'base64',
          );
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Access-Control-Allow-Origin': '*',
            'Timing-Allow-Origin': '*',
          });
          res.end(transparentPng);
          return;
        }

        if (url === '/responsive-w.png') {
          const pngBuf = createTestPng(400, 300);
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Access-Control-Allow-Origin': '*',
            'Timing-Allow-Origin': '*',
          });
          res.end(pngBuf);
          return;
        }

        res.writeHead(404);
        res.end();
      });

      await new Promise<void>(resolve => {
        crossOriginServer.listen(0, '127.0.0.1', () => resolve());
      });
      const crossAddr = crossOriginServer.address() as AddressInfo;
      crossOriginUrl = `http://127.0.0.1:${crossAddr.port}`;

      server = http.createServer((req, res) => {
        const url = req.url || '/';

        if (url === '/style.css') {
          res.writeHead(200, {
            'Content-Type': 'text/css',
            'Timing-Allow-Origin': '*',
          });
          res.end('body { margin: 0; background: #fff; }');
          return;
        }

        if (url === '/sync.js') {
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Timing-Allow-Origin': '*',
          });
          res.end('console.log("sync script loaded");');
          return;
        }

        if (url === '/uncompressed.js') {
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Timing-Allow-Origin': '*',
            // Deliberately no content-encoding and > 10 KiB
          });
          // Repeat comment to exceed 10 KiB
          const largeBody = '/* Large uncompressed script */\n'.repeat(500);
          res.end(largeBody);
          return;
        }

        if (url === '/test-image.png') {
          // Serve 1x1 transparent png with 200 OK
          const transparentPng = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            'base64',
          );
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Timing-Allow-Origin': '*',
          });
          res.end(transparentPng);
          return;
        }

        if (url === '/' || url === '/index.html') {
          // Main HTML document
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>Resource Engine Live Test</title>
                <link rel="stylesheet" href="/style.css">
                <script src="/sync.js"></script>
                <script src="/uncompressed.js"></script>
                <!-- Cross-origin subresources for Empirical Verification -->
                <script src="${crossOriginUrl}/cross-tao-cors.js"></script>
                <script src="${crossOriginUrl}/cross-cors-notao.js"></script>
                <script src="${crossOriginUrl}/cross-opaque.js"></script>
              </head>
              <body>
                <h1>Resource Performance Test</h1>
                <img id="hero" src="/test-image.png" width="1" height="1" loading="lazy" style="width:1px;height:1px;">
                <img id="responsive-2x" srcset="${crossOriginUrl}/responsive-2x.png 2x" src="${crossOriginUrl}/responsive-2x.png" width="1" height="1" style="width:1px;height:1px;">
                <img id="responsive-w" srcset="${crossOriginUrl}/responsive-w.png 800w" sizes="400px" src="${crossOriginUrl}/responsive-w.png" width="400" height="300" style="width:400px;height:300px;">
              </body>
            </html>
          `);
          return;
        }

        res.writeHead(404);
        res.end();
      });

      await new Promise<void>(resolve => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const addr = server.address() as AddressInfo;
      serverUrl = `http://127.0.0.1:${addr.port}`;

      browserManager = new BrowserManager({
        headless: true,
        scopePolicy: {
          authorizedOrigin: serverUrl,
          thirdPartyPolicy: 'ALLOW_PUBLIC_SUBRESOURCES',
        },
        testHooks: {
          allowLoopbackInTests: true,
        },
      });
      await browserManager.launch();
    });

    afterAll(async () => {
      if (browserManager) {
        await browserManager.close().catch(() => {});
      }
      await new Promise<void>(resolve => {
        crossOriginServer?.close(() => resolve());
      });
      await new Promise<void>(resolve => {
        server?.close(() => resolve());
      });
    });

    it('collects and audits live resources from a real Chromium session including TAO/CORS & responsive images', async () => {
      const managedPage = await browserManager.acquirePage({
        scopePolicy: {
          authorizedOrigin: serverUrl,
          thirdPartyPolicy: 'ALLOW_PUBLIC_SUBRESOURCES',
        },
      });

      try {
        const capturedNetwork: CapturedNetworkResource[] = [];

        managedPage.page.on('response', response => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(response.headers())) {
            headers[k] = v;
          }
          capturedNetwork.push({
            id: `net-${Date.now()}-${Math.random()}`,
            url: response.url(),
            method: response.request().method(),
            resourceType: response.request().resourceType() as ResourceCategory,
            status: response.status(),
            headers: headers,
            isNavigationRequest: response.request().isNavigationRequest(),
            isMainFrame: true,
            timestamp: Date.now(),
            isAborted: false,
            isBlocked: false,
            isFirstParty: response.url().startsWith(serverUrl),
          });
        });

        await managedPage.page.goto(serverUrl, { waitUntil: 'load' });

        const engine = new ResourcePerformanceEngine();
        const result = await engine.auditPage(managedPage.page, capturedNetwork, {
          authorizedOrigin: serverUrl,
        });

        expect(result.resources.length).toBeGreaterThanOrEqual(6);
        expect(result.summary.totalResources).toBeGreaterThanOrEqual(6);

        // Render-blocking CSS detection
        const blockingCss = result.findings.find(f => f.ruleId === 'PERF_RES_RENDER_BLOCKING_CSS');
        expect(blockingCss).toBeDefined();

        // Render-blocking JS detection
        const blockingJs = result.findings.find(f => f.ruleId === 'PERF_RES_RENDER_BLOCKING_JS');
        expect(blockingJs).toBeDefined();

        // Uncompressed asset detection (> 10 KiB)
        const uncompressed = result.findings.find(f => f.ruleId === 'PERF_RES_UNCOMPRESSED_ASSET');
        expect(uncompressed).toBeDefined();

        // Above-the-fold lazy-loaded image anti-pattern
        const lazyAboveFold = result.findings.find(f => f.ruleId === 'PERF_LCP_IMG_LAZY_LOADED');
        expect(lazyAboveFold).toBeDefined();

        // Verification of Case B: Cross-Origin + TAO + CORS
        const caseBRes = result.resources.find(r => r.url.includes('/cross-tao-cors.js'));
        expect(caseBRes).toBeDefined();
        expect(caseBRes?.timingAllowedByTao).toBe(true);
        expect(caseBRes?.corsAllowed).toBe(true);
        expect(caseBRes?.transferState).toBe('transferred');
        expect(caseBRes?.transferSizeBytes).toBeGreaterThan(0);

        // Verification of Case C: Cross-Origin + CORS without TAO
        const caseCRes = result.resources.find(r => r.url.includes('/cross-cors-notao.js'));
        expect(caseCRes).toBeDefined();
        expect(caseCRes?.timingAllowedByTao).toBe(false);
        expect(caseCRes?.corsAllowed).toBe(true);
        expect(caseCRes?.transferState).toBe('tao_restricted');
        // Masked by browser to 0 -> treated as null by engine
        expect(caseCRes?.transferSizeBytes).toBeNull();
        expect(caseCRes?.timingPhases).toBeNull();
        expect(caseCRes?.contentLengthBytes).toBe(84);

        // Verification of Case D: Cross-Origin without CORS and without TAO
        const caseDRes = result.resources.find(r => r.url.includes('/cross-opaque.js'));
        expect(caseDRes).toBeDefined();
        expect(caseDRes?.timingAllowedByTao).toBe(false);
        expect(caseDRes?.corsAllowed).toBe(false);
        expect(caseDRes?.transferState).toBe('opaque_cross_origin');
        expect(caseDRes?.transferSizeBytes).toBeNull();

        // Verification of Responsive Image with 2x descriptor
        const responsiveImg = result.images.find(
          img =>
            img.currentSrc.includes('/responsive-2x.png') &&
            img.elementSelector === '#responsive-2x',
        );
        expect(responsiveImg).toBeDefined();
        expect(responsiveImg?.densityDescriptor).toBe(2);

        // Verification of Responsive Image with width descriptor & sizes (800w / 400px = 2.0)
        const responsiveWImg = result.images.find(img => img.elementSelector === '#responsive-w');
        expect(responsiveWImg).toBeDefined();
        expect(responsiveWImg?.densityDescriptor).toBe(2.0);
        expect(responsiveWImg?.sourcePhysicalWidth).toBe(400); // naturalWidth (200 CSS px) * 2.0 = 400 physical px
      } finally {
        await managedPage.release();
      }
    });

    it('handles aborted signal gracefully without unhandled rejection', async () => {
      const managedPage = await browserManager.acquirePage();
      try {
        const controller = new AbortController();
        controller.abort();

        const engine = new ResourcePerformanceEngine();
        const result = await engine.auditPage(managedPage.page, [], {
          signal: controller.signal,
        });

        expect(result.summary.totalResources).toBe(0);
        expect(result.resources).toHaveLength(0);
      } finally {
        await managedPage.release();
      }
    });
  });
});
