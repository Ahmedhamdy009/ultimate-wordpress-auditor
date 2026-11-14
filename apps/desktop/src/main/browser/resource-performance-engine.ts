import type { Page } from 'playwright-core';
import type {
  AnalyzedImage,
  AnalyzedResource,
  ResourcePerformanceResult,
  ResourceSummaryMetrics,
  ResourceTimingPhaseData,
  ResourceTransferState,
} from '@auditor/shared';
import { RESOURCE_PERFORMANCE_THRESHOLDS } from '@auditor/shared';
import type { AnalyzerFinding } from '../scanner/analyzers/types.js';
import { redactUrl } from './redactor.js';
import type {
  CapturedNetworkResource,
  RawDomHeadElementEntry,
  RawResourceAuditData,
  ResourcePerformanceOptions,
} from './resource-performance-types.js';

export const RESOURCE_EXTRACTION_SCRIPT = `
(function() {
  try {
    var dpr = window.devicePixelRatio || 1;
    var vw = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 0) || 0;
    var vh = window.innerHeight || (document.documentElement ? document.documentElement.clientHeight : 0) || 0;
    var pageUrl = window.location.href;
    var pageOrigin = window.location.origin;

    // 1. Resource Timing
    var resourceEntries = [];
    var bufferLimitReached = false;
    if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
      var entries = performance.getEntriesByType('resource');
      if (entries.length >= 500) {
        bufferLimitReached = true;
      }
      for (var i = 0; i < entries.length; i++) {
        if (i >= 500) break;
        var r = entries[i];
        resourceEntries.push({
          name: r.name,
          initiatorType: r.initiatorType || 'other',
          startTime: r.startTime || 0,
          duration: r.duration || 0,
          responseEnd: r.responseEnd || 0,
          transferSize: typeof r.transferSize === 'number' ? r.transferSize : 0,
          encodedBodySize: typeof r.encodedBodySize === 'number' ? r.encodedBodySize : 0,
          decodedBodySize: typeof r.decodedBodySize === 'number' ? r.decodedBodySize : 0,
          domainLookupStart: r.domainLookupStart || 0,
          domainLookupEnd: r.domainLookupEnd || 0,
          connectStart: r.connectStart || 0,
          secureConnectionStart: r.secureConnectionStart || 0,
          connectEnd: r.connectEnd || 0,
          requestStart: r.requestStart || 0,
          responseStart: r.responseStart || 0,
          workerStart: r.workerStart || 0,
          nextHopProtocol: r.nextHopProtocol || undefined,
        });
      }
    }

    // 2. Head elements (Stylesheets & Scripts)
    var headElements = [];
    var head = document.head;
    if (head) {
      var links = head.querySelectorAll('link[rel~="stylesheet"]');
      for (var li = 0; li < links.length; li++) {
        var l = links[li];
        var href = l.href || l.getAttribute('href');
        if (href) {
          var media = l.getAttribute('media') || '';
          var mediaMatches = true;
          if (media && typeof window.matchMedia === 'function') {
            try {
              mediaMatches = window.matchMedia(media).matches;
            } catch (e) {
              mediaMatches = true;
            }
          }
          headElements.push({
            tagName: 'link',
            url: href,
            rel: 'stylesheet',
            media: media,
            mediaMatches: mediaMatches,
            disabled: Boolean(l.disabled),
            selector: l.id ? '#' + l.id : (l.className && typeof l.className === 'string' ? 'link.' + l.className.trim().split(/\\s+/)[0] : 'link[rel="stylesheet"]'),
          });
        }
      }

      var scripts = head.querySelectorAll('script[src]');
      for (var si = 0; si < scripts.length; si++) {
        var s = scripts[si];
        var src = s.src || s.getAttribute('src');
        if (src) {
          headElements.push({
            tagName: 'script',
            url: src,
            async: Boolean(s.async),
            defer: Boolean(s.defer),
            type: s.getAttribute('type') || '',
            selector: s.id ? '#' + s.id : (s.className && typeof s.className === 'string' ? 'script.' + s.className.trim().split(/\\s+/)[0] : 'script[src]'),
          });
        }
      }
    }

    // 3. DOM Images
    var images = [];
    var imgElements = document.querySelectorAll('img');
    for (var ii = 0; ii < imgElements.length; ii++) {
      if (images.length >= 100) break;
      var img = imgElements[ii];
      var currentSrc = img.currentSrc || img.src || '';
      if (!currentSrc) continue;

      var rect = null;
      var renderedW = 0;
      var renderedH = 0;
      try {
        var rRect = img.getBoundingClientRect();
        rect = {
          x: Math.round(rRect.x),
          y: Math.round(rRect.y),
          width: Math.round(rRect.width),
          height: Math.round(rRect.height),
        };
        renderedW = rRect.width;
        renderedH = rRect.height;
      } catch (rErr) {}

      var isSvg = false;
      var lowerSrc = currentSrc.toLowerCase();
      if (lowerSrc.endsWith('.svg') || lowerSrc.indexOf('.svg?') !== -1 || (img.tagName && img.tagName.toLowerCase() === 'svg')) {
        isSvg = true;
      }

      var imgSelector = null;
      if (img.id) {
        imgSelector = '#' + img.id;
      } else if (img.className && typeof img.className === 'string') {
        imgSelector = 'img.' + img.className.trim().split(/\\s+/)[0];
      } else {
        imgSelector = 'img';
      }

      var imgHasPicture = Boolean(img.parentElement && img.parentElement.tagName.toLowerCase() === 'picture');
      var imgSrcset = img.getAttribute('srcset') || null;
      var imgSizes = img.getAttribute('sizes') || null;

      // Extract raw physical pixel dimensions where determinable
      var sourcePhysW = null;
      var sourcePhysH = null;
      var densityDesc = null;

      if (!imgSrcset && !imgHasPicture && (img.naturalWidth || 0) > 0 && (img.naturalHeight || 0) > 0) {
        // Plain src image: intrinsic density is strictly 1.0 per HTML specification
        sourcePhysW = img.naturalWidth;
        sourcePhysH = img.naturalHeight;
        densityDesc = 1.0;
      }

      images.push({
        selector: imgSelector,
        currentSrc: currentSrc,
        src: img.getAttribute('src'),
        srcset: imgSrcset,
        sizes: imgSizes,
        hasPictureParent: imgHasPicture,
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        renderedWidth: Math.round(renderedW),
        renderedHeight: Math.round(renderedH),
        sourcePhysicalWidth: sourcePhysW,
        sourcePhysicalHeight: sourcePhysH,
        densityDescriptor: densityDesc,
        loading: img.getAttribute('loading'),
        boundingBox: rect,
        isSvg: isSvg,
      });
    }

    // 4. CSS Background Images
    var bgImages = [];
    var allElements = document.querySelectorAll('*');
    for (var bi = 0; bi < allElements.length; bi++) {
      if (bgImages.length >= 20) break;
      var el = allElements[bi];
      if (el.tagName === 'IMG' || el.tagName === 'SCRIPT' || el.tagName === 'LINK' || el.tagName === 'STYLE') continue;
      try {
        var cStyle = window.getComputedStyle(el);
        var bg = cStyle ? cStyle.backgroundImage : '';
        if (bg && bg !== 'none' && bg.indexOf('url(') !== -1) {
          var match = bg.match(/url\\(["']?([^"')]+)["']?\\)/i);
          if (match && match[1] && !match[1].startsWith('data:')) {
            var bRect = el.getBoundingClientRect();
            if (bRect.width >= 100 && bRect.height >= 100) {
              var bgSelector = el.id ? '#' + el.id : (el.className && typeof el.className === 'string' ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\\s+/)[0] : el.tagName.toLowerCase());
              bgImages.push({
                selector: bgSelector,
                url: match[1],
                renderedWidth: Math.round(bRect.width),
                renderedHeight: Math.round(bRect.height),
                boundingBox: {
                  x: Math.round(bRect.x),
                  y: Math.round(bRect.y),
                  width: Math.round(bRect.width),
                  height: Math.round(bRect.height),
                },
              });
            }
          }
        }
      } catch (bgErr) {}
    }

    return {
      pageUrl: pageUrl,
      pageOrigin: pageOrigin,
      dpr: dpr,
      viewportWidth: vw,
      viewportHeight: vh,
      resourceEntries: resourceEntries,
      images: images,
      headElements: headElements,
      backgroundImages: bgImages,
      bufferLimitReached: bufferLimitReached,
    };
  } catch (err) {
    return {
      pageUrl: typeof location !== 'undefined' ? location.href : '',
      pageOrigin: typeof location !== 'undefined' ? location.origin : '',
      dpr: 1,
      viewportWidth: 1440,
      viewportHeight: 900,
      resourceEntries: [],
      images: [],
      headElements: [],
      backgroundImages: [],
      bufferLimitReached: false,
    };
  }
})();
`;

const COMPRESSIBLE_MIME_PATTERNS = [
  /^text\//i,
  /^application\/(?:javascript|x-javascript|json|xml|xhtml\+xml)\b/i,
  /^image\/svg\+xml\b/i,
];

function isCompressibleContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const clean = contentType.split(';')[0].trim().toLowerCase();
  return COMPRESSIBLE_MIME_PATTERNS.some(p => p.test(clean));
}

function getHeaderCaseInsensitive(
  headers: Record<string, string> | undefined,
  headerName: string,
): string | null {
  if (!headers) return null;
  const lower = headerName.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return v;
    }
  }
  return null;
}

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.toLowerCase();
  } catch {
    return url.split('#')[0].toLowerCase();
  }
}

function determineImageFormat(url: string, contentType?: string | null): string {
  if (contentType) {
    const clean = contentType.split(';')[0].trim().toLowerCase();
    if (clean.includes('webp')) return 'webp';
    if (clean.includes('avif')) return 'avif';
    if (clean.includes('png')) return 'png';
    if (clean.includes('jpeg') || clean.includes('jpg')) return 'jpeg';
    if (clean.includes('gif')) return 'gif';
    if (clean.includes('svg')) return 'svg';
  }
  const cleanUrl = url.split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.webp')) return 'webp';
  if (cleanUrl.endsWith('.avif')) return 'avif';
  if (cleanUrl.endsWith('.png')) return 'png';
  if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg')) return 'jpeg';
  if (cleanUrl.endsWith('.gif')) return 'gif';
  if (cleanUrl.endsWith('.svg')) return 'svg';
  return 'unknown';
}

function isCacheEvidencePresent(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  const xCache = getHeaderCaseInsensitive(headers, 'x-cache');
  if (xCache && /hit/i.test(xCache)) return true;

  const cfCache = getHeaderCaseInsensitive(headers, 'cf-cache-status');
  if (cfCache && /hit/i.test(cfCache)) return true;

  const fastly = getHeaderCaseInsensitive(headers, 'x-served-by');
  if (fastly && /cache/i.test(fastly)) return true;

  const age = getHeaderCaseInsensitive(headers, 'age');
  const cacheControl = getHeaderCaseInsensitive(headers, 'cache-control');
  if (age && Number(age) > 0 && cacheControl && !cacheControl.includes('no-store')) {
    return true;
  }

  return false;
}

function cleanUrlPath(u: string): string {
  try {
    const parsed = new URL(u);
    return parsed.pathname.toLowerCase();
  } catch {
    return u.split('?')[0].split('#')[0].toLowerCase();
  }
}

function matchesCandidateUrl(currentSrc: string, candidateUrl: string): boolean {
  const curPath = cleanUrlPath(currentSrc);
  const candPath = cleanUrlPath(candidateUrl);

  if (curPath === candPath) return true;
  if (curPath.endsWith('/' + candPath.replace(/^\/+/, ''))) return true;
  if (candPath.endsWith('/' + curPath.replace(/^\/+/, ''))) return true;
  return false;
}

/**
 * Evaluates a media condition string (e.g. "(max-width: 600px)" or "(min-width: 768px)")
 * against the provided viewport width in CSS pixels.
 */
export function evaluateMediaCondition(mediaCondition: string, viewportWidth: number): boolean {
  const clean = mediaCondition.trim();
  const parenMatches = clean.match(/\([^)]+\)/g);
  if (!parenMatches || parenMatches.length === 0) {
    return false;
  }

  for (const condition of parenMatches) {
    const minMatch = condition.match(/\(min-width:\s*(\d+(?:\.\d+)?)(px|em|rem)?\)/i);
    if (minMatch) {
      let minVal = parseFloat(minMatch[1]);
      const unit = (minMatch[2] || 'px').toLowerCase();
      if (unit === 'em' || unit === 'rem') {
        minVal *= 16;
      }
      if (viewportWidth < minVal) {
        return false;
      }
      continue;
    }

    const maxMatch = condition.match(/\(max-width:\s*(\d+(?:\.\d+)?)(px|em|rem)?\)/i);
    if (maxMatch) {
      let maxVal = parseFloat(maxMatch[1]);
      const unit = (maxMatch[2] || 'px').toLowerCase();
      if (unit === 'em' || unit === 'rem') {
        maxVal *= 16;
      }
      if (viewportWidth > maxVal) {
        return false;
      }
      continue;
    }

    // Unrecognized media condition: treat conservatively as non-matching
    return false;
  }

  return true;
}

/**
 * Parses a CSS length string into CSS pixels.
 * Supports px, vw, rem, em, and plain numbers.
 * Returns null if the string is invalid, ambiguous, or calc().
 */
export function parseCssLengthToPixels(lengthStr: string, viewportWidth: number): number | null {
  const clean = lengthStr.trim().toLowerCase();
  if (!clean) return null;

  if (clean.endsWith('px')) {
    const val = parseFloat(clean.slice(0, -2));
    return isNaN(val) || val <= 0 ? null : Math.round(val);
  }
  if (clean.endsWith('vw')) {
    const val = parseFloat(clean.slice(0, -2));
    return isNaN(val) || val <= 0 ? null : Math.round((val / 100) * viewportWidth);
  }
  if (clean.endsWith('rem') || clean.endsWith('em')) {
    const val = parseFloat(clean.replace(/r?em$/, ''));
    return isNaN(val) || val <= 0 ? null : Math.round(val * 16);
  }
  if (/^\d+(\.\d+)?$/.test(clean)) {
    const val = parseFloat(clean);
    return isNaN(val) || val <= 0 ? null : Math.round(val);
  }

  return null;
}

/**
 * Parses the HTML `sizes` attribute and returns the effective source size in CSS pixels
 * for the given viewport width, per the HTML specification (§ 4.8.4.3.3).
 * If sizes is missing, empty, or ambiguous, returns null.
 */
export function parseEffectiveSourceSize(
  sizes: string | null | undefined,
  viewportWidth: number,
): number | null {
  if (!sizes || !sizes.trim()) return null;
  const entries = sizes.split(',');

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const lastParen = entry.lastIndexOf(')');
    let mediaCondition: string | null = null;
    let lengthPart = entry;

    if (lastParen !== -1 && entry.startsWith('(')) {
      mediaCondition = entry.slice(0, lastParen + 1).trim();
      lengthPart = entry.slice(lastParen + 1).trim();
    }

    if (mediaCondition) {
      if (!evaluateMediaCondition(mediaCondition, viewportWidth)) {
        continue;
      }
    }

    const parsedPx = parseCssLengthToPixels(lengthPart, viewportWidth);
    if (parsedPx !== null && parsedPx > 0) {
      return parsedPx;
    }
  }

  return null;
}

export interface SrcsetDescriptor {
  readonly type: 'density' | 'width';
  readonly value: number;
}

export function parseSrcsetDescriptorForUrl(
  srcset: string | null | undefined,
  currentSrc: string,
): SrcsetDescriptor | null {
  if (!srcset || !currentSrc) return null;
  const entries = srcset.split(',');
  const cleanCurrent = currentSrc.trim();

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const tokens = entry.split(/\s+/);
    if (tokens.length === 0) continue;
    const entryUrl = tokens[0].trim();
    const descriptor = tokens[1]?.trim().toLowerCase() || '';

    if (matchesCandidateUrl(cleanCurrent, entryUrl)) {
      if (descriptor.endsWith('x')) {
        const val = parseFloat(descriptor.slice(0, -1));
        if (!isNaN(val) && val > 0) {
          return { type: 'density', value: val };
        }
      } else if (descriptor.endsWith('w')) {
        const val = parseInt(descriptor.slice(0, -1), 10);
        if (!isNaN(val) && val > 0) {
          return { type: 'width', value: val };
        }
      }
      return { type: 'density', value: 1.0 };
    }
  }

  return null;
}

/**
 * Pure analysis engine: takes raw browser audit data and captured network records,
 * performs standards-compliant evaluations, and produces structured findings and summary metrics.
 */
export function analyzeResourcePerformance(
  raw: RawResourceAuditData,
  networkRecords: readonly CapturedNetworkResource[] = [],
  options: ResourcePerformanceOptions = {},
): ResourcePerformanceResult {
  const findings: AnalyzerFinding[] = [];
  const networkMap = new Map<string, CapturedNetworkResource>();

  for (const record of networkRecords) {
    networkMap.set(normalizeUrlKey(record.url), record);
  }

  // 1. Process Head Elements to identify render-blocking CSS and JS
  const headElementsMap = new Map<string, RawDomHeadElementEntry>();
  for (const h of raw.headElements) {
    headElementsMap.set(normalizeUrlKey(h.url), h);
  }

  // 2. Process Performance Resource Timing Entries
  const analyzedResources: AnalyzedResource[] = [];
  const seenResourceUrls = new Set<string>();

  let totalTransferBytes = 0;
  let hasValidTransferBytes = false;
  let totalEncodedBytes = 0;
  let hasValidEncodedBytes = false;
  let totalDecodedBytes = 0;
  let hasValidDecodedBytes = false;

  let scriptsCount = 0;
  let stylesheetsCount = 0;
  let imagesCount = 0;
  let fontsCount = 0;
  let otherCount = 0;
  let renderBlockingCssCount = 0;
  let renderBlockingJsCount = 0;
  let uncompressedAssetsCount = 0;
  let taoRestrictedCount = 0;
  let opaqueCrossOriginCount = 0;
  let cachedCount = 0;
  let zeroByteCount = 0;

  const maxRes = options.maxResources ?? 500;
  const pageOrigin = raw.pageOrigin.toLowerCase();

  for (let i = 0; i < raw.resourceEntries.length && analyzedResources.length < maxRes; i++) {
    const entry = raw.resourceEntries[i];
    const rawUrl = entry.name;
    const normKey = normalizeUrlKey(rawUrl);

    // Skip duplicates
    if (seenResourceUrls.has(normKey)) continue;
    seenResourceUrls.add(normKey);

    const netRecord = networkMap.get(normKey);
    const headMatch = headElementsMap.get(normKey);

    let isCrossOrigin: boolean;
    try {
      const resOrigin = new URL(rawUrl).origin.toLowerCase();
      isCrossOrigin = resOrigin !== pageOrigin;
    } catch {
      isCrossOrigin = false;
    }

    // Timing-Allow-Origin evaluation (governs browser timing allow check)
    let timingAllowedByTao = true;
    if (isCrossOrigin) {
      const taoHeader = netRecord?.headers
        ? getHeaderCaseInsensitive(netRecord.headers, 'timing-allow-origin')
        : null;
      if (!taoHeader) {
        timingAllowedByTao = false;
      } else {
        const cleanTao = taoHeader.trim().toLowerCase();
        timingAllowedByTao = cleanTao === '*' || cleanTao.includes(pageOrigin);
      }
    }

    // CORS evaluation (governs whether response is accessible to document)
    let corsAllowed = true;
    if (isCrossOrigin) {
      const corsHeader = netRecord?.headers
        ? getHeaderCaseInsensitive(netRecord.headers, 'access-control-allow-origin')
        : null;
      if (!corsHeader) {
        corsAllowed = false;
      } else {
        const cleanCors = corsHeader.trim().toLowerCase();
        corsAllowed = cleanCors === '*' || cleanCors.includes(pageOrigin);
      }
    }

    // Content-Length from verified response headers
    const contentLengthHeader = netRecord?.headers
      ? getHeaderCaseInsensitive(netRecord.headers, 'content-length')
      : null;
    const parsedContentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
    const contentLengthBytes =
      parsedContentLength !== null && !isNaN(parsedContentLength) && parsedContentLength >= 0
        ? parsedContentLength
        : null;

    // Determine Transfer State & Size Nullability
    let transferState: ResourceTransferState;
    let transferSizeBytes: number | null;
    let encodedBodySizeBytes: number | null;
    let decodedBodySizeBytes: number | null;
    let timingPhases: ResourceTimingPhaseData | null = null;

    if (!timingAllowedByTao) {
      // The browser timing-allow-check failed per W3C Resource Timing spec:
      // Timing phases and resource timing sizes are masked to 0 by browser security.
      if (!corsAllowed) {
        transferState = 'opaque_cross_origin';
        opaqueCrossOriginCount++;
      } else {
        transferState = 'tao_restricted';
        taoRestrictedCount++;
      }
      // Never reinterpret security-masked zeroes as actual measurements
      transferSizeBytes = null;
      encodedBodySizeBytes = null;
      decodedBodySizeBytes = null;
      timingPhases = null;
    } else if (entry.transferSize > 0) {
      // Confirmed on-the-wire transfer
      transferState = 'transferred';
      transferSizeBytes = entry.transferSize;
      encodedBodySizeBytes = entry.encodedBodySize > 0 ? entry.encodedBodySize : null;
      decodedBodySizeBytes = entry.decodedBodySize > 0 ? entry.decodedBodySize : null;

      totalTransferBytes += entry.transferSize;
      hasValidTransferBytes = true;
      if (entry.encodedBodySize > 0) {
        totalEncodedBytes += entry.encodedBodySize;
        hasValidEncodedBytes = true;
      }
      if (entry.decodedBodySize > 0) {
        totalDecodedBytes += entry.decodedBodySize;
        hasValidDecodedBytes = true;
      }

      // Timing phases calculation
      timingPhases = {
        dnsLookupMs:
          entry.domainLookupEnd > entry.domainLookupStart
            ? Math.round(entry.domainLookupEnd - entry.domainLookupStart)
            : null,
        tcpConnectMs:
          entry.connectEnd > entry.connectStart
            ? Math.round(entry.connectEnd - entry.connectStart)
            : null,
        tlsHandshakeMs:
          entry.secureConnectionStart > 0 && entry.connectEnd > entry.secureConnectionStart
            ? Math.round(entry.connectEnd - entry.secureConnectionStart)
            : null,
        ttfbMs:
          entry.responseStart > entry.requestStart
            ? Math.round(entry.responseStart - entry.requestStart)
            : null,
        contentDownloadMs:
          entry.responseEnd > entry.responseStart
            ? Math.round(entry.responseEnd - entry.responseStart)
            : null,
        workerDurationMs:
          entry.workerStart > 0 && entry.startTime > entry.workerStart
            ? Math.round(entry.startTime - entry.workerStart)
            : null,
      };
    } else {
      // Timing allowed, but transferSize === 0. Strict evidence check
      const httpStatus = netRecord?.status;

      if (httpStatus === 304 || isCacheEvidencePresent(netRecord?.headers)) {
        transferState = 'cached';
        cachedCount++;
        transferSizeBytes = 0;
        encodedBodySizeBytes = entry.encodedBodySize > 0 ? entry.encodedBodySize : null;
        decodedBodySizeBytes = entry.decodedBodySize > 0 ? entry.decodedBodySize : null;
      } else if (httpStatus === 204 || contentLengthBytes === 0) {
        transferState = 'zero_byte';
        zeroByteCount++;
        transferSizeBytes = 0;
        encodedBodySizeBytes = 0;
        decodedBodySizeBytes = 0;
      } else {
        // Insufficient evidence: must not guess or fabricate cache status
        transferState = 'unknown';
        transferSizeBytes = null;
        encodedBodySizeBytes = null;
        decodedBodySizeBytes = null;
        timingPhases = null;
      }
    }

    // Categorize resource type
    const initiator = entry.initiatorType.toLowerCase();
    const contentType = netRecord?.headers
      ? getHeaderCaseInsensitive(netRecord.headers, 'content-type')
      : null;
    let resCategory = 'other';

    if (initiator === 'script' || contentType?.includes('javascript') || rawUrl.endsWith('.js')) {
      resCategory = 'script';
      scriptsCount++;
    } else if (
      initiator === 'css' ||
      initiator === 'link' ||
      contentType?.includes('css') ||
      rawUrl.endsWith('.css')
    ) {
      resCategory = 'stylesheet';
      stylesheetsCount++;
    } else if (
      initiator === 'img' ||
      initiator === 'image' ||
      contentType?.includes('image') ||
      /\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/i.test(rawUrl.split('?')[0])
    ) {
      resCategory = 'image';
      imagesCount++;
    } else if (
      initiator === 'font' ||
      contentType?.includes('font') ||
      /\.(?:woff2?|ttf|otf|eot)$/i.test(rawUrl.split('?')[0])
    ) {
      resCategory = 'font';
      fontsCount++;
    } else {
      otherCount++;
    }

    // Render-Blocking analysis
    let isRenderBlocking = false;
    let renderBlockingReason: string | null = null;

    if (headMatch) {
      if (headMatch.tagName === 'link' && headMatch.rel === 'stylesheet') {
        if (!headMatch.disabled && headMatch.mediaMatches !== false) {
          isRenderBlocking = true;
          renderBlockingReason =
            'Synchronous stylesheet in <head> blocks layout and first paint until fetched and parsed.';
          renderBlockingCssCount++;

          findings.push({
            ruleId: 'PERF_RES_RENDER_BLOCKING_CSS',
            category: 'static-performance',
            title: 'Render-Blocking Stylesheet in Document Head',
            description: `The stylesheet at ${redactUrl(rawUrl)} is loaded synchronously in the document <head>. It blocks rendering and delays First Contentful Paint.`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: redactUrl(rawUrl),
            evidence: {
              url: redactUrl(rawUrl),
              selector: headMatch.selector,
              media: headMatch.media || 'all',
              durationMs: entry.duration > 0 ? Math.round(entry.duration) : null,
              transferSizeBytes: transferSizeBytes,
            },
            remediation:
              'Inline critical CSS required for above-the-fold content, and defer or asynchronously load non-critical stylesheets using rel="preload" with onload handler or media="print" toggles.',
            references: ['https://web.dev/articles/render-blocking-resources'],
          });
        }
      } else if (headMatch.tagName === 'script') {
        if (!headMatch.async && !headMatch.defer && headMatch.type !== 'module') {
          isRenderBlocking = true;
          renderBlockingReason =
            'Synchronous script in <head> halts the HTML parser until download and execution complete.';
          renderBlockingJsCount++;

          findings.push({
            ruleId: 'PERF_RES_RENDER_BLOCKING_JS',
            category: 'static-performance',
            title: 'Render-Blocking Synchronous Script in Document Head',
            description: `The script at ${redactUrl(rawUrl)} is declared in <head> without async, defer, or type="module" attributes, halting HTML document parsing.`,
            severity: 'medium',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: redactUrl(rawUrl),
            evidence: {
              url: redactUrl(rawUrl),
              selector: headMatch.selector,
              scriptType: headMatch.type || 'classic',
              durationMs: entry.duration > 0 ? Math.round(entry.duration) : null,
              transferSizeBytes: transferSizeBytes,
            },
            remediation:
              'Add defer, async, or type="module" attribute to head scripts to prevent HTML parser blocking.',
            references: ['https://web.dev/articles/render-blocking-resources'],
          });
        }
      }
    }

    // Transport Compression Analysis
    const contentEncoding = netRecord?.headers
      ? getHeaderCaseInsensitive(netRecord.headers, 'content-encoding')
      : null;
    const contentLengthVal = netRecord?.headers
      ? Number(getHeaderCaseInsensitive(netRecord.headers, 'content-length') || '0')
      : 0;
    const effectiveBodySize =
      transferSizeBytes ?? encodedBodySizeBytes ?? (contentLengthVal > 0 ? contentLengthVal : null);

    if (
      netRecord?.headers &&
      isCompressibleContentType(contentType) &&
      effectiveBodySize !== null &&
      effectiveBodySize > RESOURCE_PERFORMANCE_THRESHOLDS.compressionMinSizeBytes
    ) {
      const isCompressed =
        contentEncoding !== null &&
        /^(?:gzip|br|zstd|deflate)$/i.test(contentEncoding.trim().toLowerCase());
      if (!isCompressed) {
        uncompressedAssetsCount++;
        findings.push({
          ruleId: 'PERF_RES_UNCOMPRESSED_ASSET',
          category: 'static-performance',
          title: `Compressible Text Asset Transferred Without Compression (${Math.round(effectiveBodySize / 1024)} KiB)`,
          description: `The text asset at ${redactUrl(rawUrl)} (${contentType}) was transferred over the wire without modern HTTP compression (gzip, brotli, zstd), consuming unnecessary bandwidth.`,
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: redactUrl(rawUrl),
          evidence: {
            url: redactUrl(rawUrl),
            contentType: contentType,
            sizeBytes: effectiveBodySize,
            contentEncoding: contentEncoding,
            thresholdBytes: RESOURCE_PERFORMANCE_THRESHOLDS.compressionMinSizeBytes,
          },
          remediation:
            'Enable HTTP response compression (Brotli or Gzip) on your web server, reverse proxy, or CDN for all text-based assets.',
          references: [
            'https://web.dev/articles/optimizing-content-efficiency-encoding-and-transfer-size',
          ],
        });
      }
    }

    // Large JavaScript Check
    if (
      resCategory === 'script' &&
      ((transferSizeBytes !== null &&
        transferSizeBytes > RESOURCE_PERFORMANCE_THRESHOLDS.largeJavaScriptBytes) ||
        (decodedBodySizeBytes !== null &&
          decodedBodySizeBytes > RESOURCE_PERFORMANCE_THRESHOLDS.largeJavaScriptDecodedBytes))
    ) {
      findings.push({
        ruleId: 'PERF_RES_LARGE_JAVASCRIPT',
        category: 'static-performance',
        title: `Large JavaScript Asset Payload (${Math.round((transferSizeBytes ?? decodedBodySizeBytes ?? 0) / 1024)} KiB)`,
        description: `The JavaScript resource at ${redactUrl(rawUrl)} exceeds recommended bundle thresholds, increasing network transit and main-thread parse/compile time.`,
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: redactUrl(rawUrl),
        evidence: {
          url: redactUrl(rawUrl),
          transferSizeBytes: transferSizeBytes,
          decodedBodySizeBytes: decodedBodySizeBytes,
          thresholdBytes: RESOURCE_PERFORMANCE_THRESHOLDS.largeJavaScriptBytes,
        },
        remediation:
          'Code-split large JavaScript bundles, remove unused dependencies, and implement dynamic import() for deferred features.',
        references: ['https://web.dev/articles/reduce-javascript-payloads-with-code-splitting'],
      });
    }

    // Large Stylesheet Check
    if (
      resCategory === 'stylesheet' &&
      ((transferSizeBytes !== null &&
        transferSizeBytes > RESOURCE_PERFORMANCE_THRESHOLDS.largeStylesheetBytes) ||
        (decodedBodySizeBytes !== null &&
          decodedBodySizeBytes > RESOURCE_PERFORMANCE_THRESHOLDS.largeStylesheetDecodedBytes))
    ) {
      findings.push({
        ruleId: 'PERF_RES_LARGE_STYLESHEET',
        category: 'static-performance',
        title: `Large Stylesheet Payload (${Math.round((transferSizeBytes ?? decodedBodySizeBytes ?? 0) / 1024)} KiB)`,
        description: `The stylesheet at ${redactUrl(rawUrl)} exceeds recommended size thresholds, increasing critical-path rendering latency.`,
        severity: 'info',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: redactUrl(rawUrl),
        evidence: {
          url: redactUrl(rawUrl),
          transferSizeBytes: transferSizeBytes,
          decodedBodySizeBytes: decodedBodySizeBytes,
          thresholdBytes: RESOURCE_PERFORMANCE_THRESHOLDS.largeStylesheetBytes,
        },
        remediation:
          'Purge unused CSS classes, modularize stylesheets, and remove redundant utility frameworks.',
        references: ['https://web.dev/articles/defer-non-critical-css'],
      });
    }

    analyzedResources.push({
      url: redactUrl(rawUrl),
      initiatorType: entry.initiatorType,
      resourceType: resCategory,
      startTimeMs: Math.round(entry.startTime),
      durationMs: Math.round(entry.duration),
      responseEndMs: Math.round(entry.responseEnd),
      transferSizeBytes: transferSizeBytes,
      encodedBodySizeBytes: encodedBodySizeBytes,
      decodedBodySizeBytes: decodedBodySizeBytes,
      contentLengthBytes: contentLengthBytes,
      timingAllowedByTao: timingAllowedByTao,
      corsAllowed: corsAllowed,
      transferState: transferState,
      timingPhases: timingPhases,
      httpStatus: netRecord?.status ?? null,
      contentEncoding: contentEncoding,
      contentType: contentType,
      isRenderBlocking: isRenderBlocking,
      renderBlockingReason: renderBlockingReason,
    });
  }

  // 3. Process DOM Images (DPR-calibrated sizing, oversized detection, lazy loading anti-pattern)
  const analyzedImages: AnalyzedImage[] = [];
  const maxImgs = options.maxImages ?? 100;
  const dpr = Math.max(1, raw.dpr || 1);
  let oversizedImagesCount = 0;
  let lazyLoadedAboveTheFoldCount = 0;

  for (let j = 0; j < raw.images.length && analyzedImages.length < maxImgs; j++) {
    const img = raw.images[j];
    const currentSrc = img.currentSrc;
    const format = determineImageFormat(currentSrc);
    const isSvg = img.isSvg || format === 'svg';

    // 1. Rendered display dimensions in CSS px
    const renderedW = img.renderedWidth > 0 ? img.renderedWidth : null;
    const renderedH = img.renderedHeight > 0 ? img.renderedHeight : null;

    // 2. Intrinsic dimensions in CSS px per HTML specification (§ 4.8.4.3.4)
    const naturalW = img.naturalWidth > 0 ? img.naturalWidth : null;
    const naturalH = img.naturalHeight > 0 ? img.naturalHeight : null;

    // 3. Required physical pixels for crisp rendering at current screen DPR
    const requiredPhysicalW = renderedW !== null ? Math.round(renderedW * dpr) : null;
    const requiredPhysicalH = renderedH !== null ? Math.round(renderedH * dpr) : null;

    // 4. Resolve source physical bitmap resolution
    let sourcePhysicalW = img.sourcePhysicalWidth ?? null;
    let sourcePhysicalH = img.sourcePhysicalHeight ?? null;
    let densityDescriptor = img.densityDescriptor ?? null;

    if (sourcePhysicalW === null && naturalW !== null && naturalH !== null) {
      if (!img.srcset && !img.hasPictureParent) {
        // Ordinary src image: intrinsic density is strictly 1.0 per HTML spec (§ 4.8.4.3.4)
        sourcePhysicalW = naturalW;
        sourcePhysicalH = naturalH;
        densityDescriptor = 1.0;
      } else if (img.srcset && !img.hasPictureParent) {
        const desc = parseSrcsetDescriptorForUrl(img.srcset, currentSrc);
        if (desc) {
          if (desc.type === 'density') {
            densityDescriptor = desc.value;
            sourcePhysicalW = Math.round(naturalW * desc.value);
            sourcePhysicalH = Math.round(naturalH * desc.value);
          } else if (desc.type === 'width') {
            const effectiveSourceSize = parseEffectiveSourceSize(img.sizes, raw.viewportWidth);
            if (effectiveSourceSize !== null && effectiveSourceSize > 0) {
              const effectiveDensity = desc.value / effectiveSourceSize;
              sourcePhysicalW = Math.round(naturalW * effectiveDensity);
              sourcePhysicalH = Math.round(naturalH * effectiveDensity);
              densityDescriptor = Number(effectiveDensity.toFixed(2));
            } else {
              // Missing or ambiguous source-size information: preserve null, do not guess
              sourcePhysicalW = null;
              sourcePhysicalH = null;
              densityDescriptor = null;
            }
          }
        }
      } else if (img.hasPictureParent) {
        // Complex picture element with <source> elements / media queries:
        // Intrinsic source candidate mapping cannot be unambiguously determined without layout-level selection proof;
        // preserve null to avoid false positive oversized findings.
        sourcePhysicalW = null;
        sourcePhysicalH = null;
        densityDescriptor = null;
      }
    }

    // Viewport position: Above the fold check
    const isAboveTheFold = Boolean(
      img.boundingBox &&
      img.boundingBox.y < raw.viewportHeight &&
      img.boundingBox.y + img.boundingBox.height > 0 &&
      renderedW !== null &&
      renderedW > 0 &&
      renderedH !== null &&
      renderedH > 0,
    );

    // LCP candidate check
    let isLcpCandidate = false;
    if (options.lcpUrl && (currentSrc === options.lcpUrl || img.src === options.lcpUrl)) {
      isLcpCandidate = true;
    }
    if (options.lcpSelector && img.selector && img.selector === options.lcpSelector) {
      isLcpCandidate = true;
    }

    // Lazy loading anti-pattern check
    const isLazy = img.loading?.trim().toLowerCase() === 'lazy';
    const isLazyLoadedAboveTheFold = isLazy && (isAboveTheFold || isLcpCandidate);

    if (isLazyLoadedAboveTheFold) {
      lazyLoadedAboveTheFoldCount++;
      findings.push({
        ruleId: 'PERF_LCP_IMG_LAZY_LOADED',
        category: 'static-performance',
        title: 'Above-the-Fold / LCP Image Has Lazy Loading Attribute',
        description: `The image at ${redactUrl(currentSrc)} is rendered within the initial viewport (or serves as the LCP element) but specifies loading="lazy". Browsers defer loading lazy images until layout passes conclude, severely delaying First Contentful Paint and Largest Contentful Paint.`,
        severity: 'medium',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: redactUrl(currentSrc),
        evidence: {
          selector: img.selector,
          currentSrc: redactUrl(currentSrc),
          isAboveTheFold: isAboveTheFold,
          isLcpCandidate: isLcpCandidate,
          loadingAttribute: img.loading,
          boundingBox: img.boundingBox,
        },
        remediation:
          'Remove loading="lazy" (or set loading="eager" and fetchpriority="high") for hero and above-the-fold images.',
        references: ['https://web.dev/articles/lcp-lazy-loading'],
      });
    }

    // Oversized Image Check (SVGs strictly excluded)
    // Dimensionally correct comparison: Physical Source Pixels vs Required Display Physical Pixels
    let isOversized = false;
    let oversizedFactor: number | null = null;

    if (
      !isSvg &&
      sourcePhysicalW !== null &&
      sourcePhysicalH !== null &&
      requiredPhysicalW !== null &&
      requiredPhysicalW > 0
    ) {
      const thresholdPhysicalWidth =
        requiredPhysicalW * RESOURCE_PERFORMANCE_THRESHOLDS.oversizedImageSafetyMultiplier;
      if (
        sourcePhysicalW > thresholdPhysicalWidth &&
        sourcePhysicalW >
          requiredPhysicalW + RESOURCE_PERFORMANCE_THRESHOLDS.oversizedImageMinPixelDelta
      ) {
        isOversized = true;
        oversizedFactor = Number((sourcePhysicalW / requiredPhysicalW).toFixed(2));
        oversizedImagesCount++;

        findings.push({
          ruleId: 'PERF_RES_OVERSIZED_IMAGE',
          category: 'static-performance',
          title: `Oversized Image Served for Display Dimensions (${oversizedFactor}x display target)`,
          description: `The image at ${redactUrl(currentSrc)} has an intrinsic source resolution of ${sourcePhysicalW}x${sourcePhysicalH} physical px, but is displayed at ${renderedW}x${renderedH} CSS px (requiring ${requiredPhysicalW}x${requiredPhysicalH} physical px at ${dpr}x DPR). Serving significantly oversized raster images consumes unnecessary bandwidth and memory.`,
          severity: 'low',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: redactUrl(currentSrc),
          evidence: {
            selector: img.selector,
            currentSrc: redactUrl(currentSrc),
            renderedDimensionsCss: `${renderedW}x${renderedH} CSS px`,
            dpr: dpr,
            requiredDisplayPixels: `${requiredPhysicalW}x${requiredPhysicalH} physical px`,
            sourcePhysicalPixels: `${sourcePhysicalW}x${sourcePhysicalH} physical px`,
            naturalDimensionsCss: `${naturalW}x${naturalH} CSS px`,
            densityDescriptor: densityDescriptor,
            oversizedFactor: oversizedFactor,
          },
          remediation:
            'Serve responsive image variants via srcset and sizes matching the rendered viewport display dimensions. Consider modern formats (WebP or AVIF) for improved compression efficiency without quality loss.',
          references: ['https://web.dev/articles/serve-responsive-images'],
        });
      }
    }

    analyzedImages.push({
      elementSelector: img.selector,
      currentSrc: redactUrl(currentSrc),
      originalSrc: img.src ? redactUrl(img.src) : null,
      naturalWidth: naturalW,
      naturalHeight: naturalH,
      renderedWidth: renderedW,
      renderedHeight: renderedH,
      dpr: dpr,
      effectiveWidthPixels: requiredPhysicalW,
      effectiveHeightPixels: requiredPhysicalH,
      sourcePhysicalWidth: sourcePhysicalW,
      sourcePhysicalHeight: sourcePhysicalH,
      densityDescriptor: densityDescriptor,
      isOversized: isOversized,
      oversizedFactor: oversizedFactor,
      format: format,
      isSvg: isSvg,
      isAboveTheFold: isAboveTheFold,
      isLcpCandidate: isLcpCandidate,
      loadingAttribute: img.loading,
      isLazyLoadedAboveTheFold: isLazyLoadedAboveTheFold,
      isBackground: false,
      boundingBox: img.boundingBox,
    });
  }

  // 4. Process CSS Background Images
  for (const bg of raw.backgroundImages) {
    if (analyzedImages.length >= maxImgs) break;
    const bgUrl = bg.url;
    const format = determineImageFormat(bgUrl);
    const isSvg = format === 'svg';
    const isAboveTheFold = Boolean(
      bg.boundingBox &&
      bg.boundingBox.y < raw.viewportHeight &&
      bg.boundingBox.y + bg.boundingBox.height > 0,
    );

    analyzedImages.push({
      elementSelector: bg.selector,
      currentSrc: redactUrl(bgUrl),
      originalSrc: null,
      naturalWidth: null, // Natural dimensions not available from CSS computed style alone
      naturalHeight: null,
      renderedWidth: bg.renderedWidth,
      renderedHeight: bg.renderedHeight,
      dpr: dpr,
      effectiveWidthPixels: Math.round(bg.renderedWidth * dpr),
      effectiveHeightPixels: Math.round(bg.renderedHeight * dpr),
      sourcePhysicalWidth: null, // CSS background image physical dimensions not established
      sourcePhysicalHeight: null,
      densityDescriptor: null,
      isOversized: false,
      oversizedFactor: null,
      format: format,
      isSvg: isSvg,
      isAboveTheFold: isAboveTheFold,
      isLcpCandidate: false,
      loadingAttribute: null,
      isLazyLoadedAboveTheFold: false,
      isBackground: true,
      boundingBox: bg.boundingBox,
    });
  }

  const summary: ResourceSummaryMetrics = {
    totalResources: analyzedResources.length,
    totalTransferSizeBytes: hasValidTransferBytes ? totalTransferBytes : null,
    totalEncodedSizeBytes: hasValidEncodedBytes ? totalEncodedBytes : null,
    totalDecodedSizeBytes: hasValidDecodedBytes ? totalDecodedBytes : null,
    scriptsCount: scriptsCount,
    stylesheetsCount: stylesheetsCount,
    imagesCount: imagesCount,
    fontsCount: fontsCount,
    otherCount: otherCount,
    renderBlockingCssCount: renderBlockingCssCount,
    renderBlockingJsCount: renderBlockingJsCount,
    uncompressedAssetsCount: uncompressedAssetsCount,
    oversizedImagesCount: oversizedImagesCount,
    lazyLoadedAboveTheFoldImagesCount: lazyLoadedAboveTheFoldCount,
    taoRestrictedCount: taoRestrictedCount,
    opaqueCrossOriginCount: opaqueCrossOriginCount,
    cachedCount: cachedCount,
    zeroByteCount: zeroByteCount,
    resourceBufferLimitReached: raw.bufferLimitReached,
  };

  return {
    summary,
    resources: analyzedResources,
    images: analyzedImages,
    findings,
  };
}

/**
 * Resource Performance Engine orchestrator for live Playwright pages.
 */
export class ResourcePerformanceEngine {
  /**
   * Executes in-browser data extraction and performs comprehensive resource analysis on a managed Page.
   */
  public async auditPage(
    page: Page,
    networkRecords: readonly CapturedNetworkResource[] = [],
    options: ResourcePerformanceOptions = {},
  ): Promise<ResourcePerformanceResult> {
    if (options.signal?.aborted || page.isClosed()) {
      return this.buildEmptyResult();
    }

    try {
      const rawData = await page.evaluate<RawResourceAuditData>(RESOURCE_EXTRACTION_SCRIPT);
      if (options.signal?.aborted || page.isClosed()) {
        return this.buildEmptyResult();
      }
      return analyzeResourcePerformance(rawData, networkRecords, options);
    } catch {
      return this.buildEmptyResult();
    }
  }

  private buildEmptyResult(): ResourcePerformanceResult {
    return {
      summary: {
        totalResources: 0,
        totalTransferSizeBytes: null,
        totalEncodedSizeBytes: null,
        totalDecodedSizeBytes: null,
        scriptsCount: 0,
        stylesheetsCount: 0,
        imagesCount: 0,
        fontsCount: 0,
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
      findings: [],
    };
  }
}
