import type { BrowserContext, Page } from 'playwright-core';
import type {
  ClsData,
  LabWebVitalsMetrics,
  LcpCandidateData,
  LcpCompletenessState,
  NavigationTimingData,
  PaintTimingData,
  TbtData,
} from '@auditor/shared';
import type {
  PerformanceCollectionResult,
  PerformanceCollectorOptions,
  RawLcpEntry,
  RawLayoutShiftEntry,
  RawLongTaskEntry,
  RawNavigationEntry,
  RawPaintEntry,
  RawPerformanceData,
} from './performance-types.js';

export const PERFORMANCE_INIT_SCRIPT = `
(function() {
  if (window.__auditorPerformance) return;

  if (!window.__auditorDisconnectLayoutShiftObserver) {
    window.__auditorShiftConsumers = window.__auditorShiftConsumers || { performance: false, visual: false };
    window.__auditorDisconnectLayoutShiftObserver = function(consumer) {
      try {
        if (consumer === 'performance') window.__auditorShiftConsumers.performance = true;
        if (consumer === 'visual') window.__auditorShiftConsumers.visual = true;

        var hasPerf = Boolean(window.__auditorPerformance);
        var hasVisual = Boolean(window.__auditorLayoutShiftCollectorRegistered);

        var canDisconnect = false;
        if (hasPerf && hasVisual) {
          canDisconnect = Boolean(window.__auditorShiftConsumers.performance && window.__auditorShiftConsumers.visual);
        } else if (hasPerf) {
          canDisconnect = Boolean(window.__auditorShiftConsumers.performance);
        } else if (hasVisual) {
          canDisconnect = Boolean(window.__auditorShiftConsumers.visual);
        } else {
          canDisconnect = true;
        }

        if (canDisconnect && window.__auditorLayoutShiftObserver) {
          window.__auditorLayoutShiftObserver.disconnect();
        }
      } catch (e) {}
    };
  }

  var state = {
    supported: {
      navigationTiming: typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function',
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
    isHidden: document.visibilityState === 'hidden',
    hiddenAtMs: document.visibilityState === 'hidden' ? 0 : null,
    inputAtMs: null,
    loadFiredAtMs: null,
    nowMs: 0,
  };

  try {
    if (typeof performance !== 'undefined' && typeof performance.setResourceTimingBufferSize === 'function') {
      performance.setResourceTimingBufferSize(500);
    }
  } catch (e) {}

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden' && state.hiddenAtMs === null) {
      state.isHidden = true;
      state.hiddenAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
  });

  // Track first user interaction cutoff per W3C Largest Contentful Paint specification
  ['keydown', 'pointerdown', 'click'].forEach(function(eventType) {
    window.addEventListener(
      eventType,
      function() {
        if (state.inputAtMs === null) {
          state.inputAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        }
      },
      { once: true, capture: true }
    );
  });

  window.addEventListener('load', function() {
    state.loadFiredAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  });

  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) {
    var types = PerformanceObserver.supportedEntryTypes;

    // 1. Paint Timing Observer
    if (types.includes('paint')) {
      state.supported.paintTiming = true;
      try {
        var paintObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            state.paints.push({
              name: entries[i].name,
              startTime: entries[i].startTime,
            });
          }
        });
        try {
          paintObserver.observe({ type: 'paint', buffered: true });
        } catch (e1) {
          paintObserver.observe({ entryTypes: ['paint'] });
        }
        state.__paintObserver = paintObserver;
      } catch (e) {}
    }

    // 2. Largest Contentful Paint Observer
    if (types.includes('largest-contentful-paint')) {
      state.supported.lcp = true;
      try {
        var lcpObserver = new PerformanceObserver(function(list) {
          if (state.hiddenAtMs !== null || state.inputAtMs !== null) return;
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            if (state.lcpCandidates.length >= 50) break;
            var entry = entries[i];
            if (state.inputAtMs !== null && entry.startTime >= state.inputAtMs) continue;
            if (state.hiddenAtMs !== null && entry.startTime >= state.hiddenAtMs) continue;
            var el = entry.element;
            var selector = null;
            var tagName = null;
            var boundingBox = null;

            if (el && el.nodeType === 1) {
              tagName = el.tagName ? el.tagName.toLowerCase() : null;
              if (el.id) {
                selector = '#' + el.id;
              } else if (el.className && typeof el.className === 'string') {
                selector = (tagName || '') + '.' + el.className.trim().split(/\\s+/)[0];
              } else {
                selector = tagName;
              }
              try {
                var rect = el.getBoundingClientRect();
                boundingBox = {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              } catch (rectErr) {}
            }

            state.lcpCandidates.push({
              startTime: entry.startTime,
              loadTime: entry.loadTime || 0,
              renderTime: entry.renderTime || 0,
              size: entry.size || 0,
              id: entry.id || undefined,
              url: entry.url || undefined,
              tagName: tagName,
              selector: selector,
              boundingBox: boundingBox,
            });
          }
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
        state.__lcpObserver = lcpObserver;
      } catch (e) {}
    }

    // 3. Layout Shift Observer (Unified with LayoutStabilityCollector)
    if (types.includes('layout-shift')) {
      state.supported.layoutShift = true;
      try {
        if (window.__auditorLayoutShiftObserver) {
          // Observer was already registered by LayoutShiftCollector; reuse its observer and array
          state.__shiftObserver = window.__auditorLayoutShiftObserver;
          state.layoutShifts = window.__auditorLayoutShifts || [];
        } else {
          var shiftObserver = new PerformanceObserver(function(list) {
            var entries = list.getEntries();
            for (var i = 0; i < entries.length; i++) {
              if (state.layoutShifts.length >= 100) break;
              var entry = entries[i];
              var sourcesList = [];
              if (entry.sources && Array.isArray(entry.sources)) {
                for (var j = 0; j < entry.sources.length; j++) {
                  var s = entry.sources[j];
                  var sNode = s.node;
                  var sSelector = undefined;
                  if (sNode && sNode.nodeType === 1) {
                    if (sNode.id) {
                      sSelector = '#' + sNode.id;
                    } else if (sNode.className && typeof sNode.className === 'string') {
                      sSelector = sNode.tagName.toLowerCase() + '.' + sNode.className.trim().split(/\\s+/)[0];
                    } else {
                      sSelector = sNode.tagName.toLowerCase();
                    }
                  }
                  sourcesList.push({
                    selector: sSelector,
                    tagName: sNode ? sNode.tagName : undefined,
                    previousRect: s.previousRect ? {
                      x: s.previousRect.x,
                      y: s.previousRect.y,
                      width: s.previousRect.width,
                      height: s.previousRect.height,
                    } : undefined,
                    currentRect: s.currentRect ? {
                      x: s.currentRect.x,
                      y: s.currentRect.y,
                      width: s.currentRect.width,
                      height: s.currentRect.height,
                    } : undefined,
                  });
                }
              }
              state.layoutShifts.push({
                value: entry.value,
                startTime: entry.startTime,
                hadRecentInput: Boolean(entry.hadRecentInput),
                sources: sourcesList,
              });
            }
          });
          shiftObserver.observe({ type: 'layout-shift', buffered: true });
          state.__shiftObserver = shiftObserver;
          window.__auditorLayoutShiftObserver = shiftObserver;
        }
      } catch (e) {}
    }

    // 4. Long Task Observer (for TBT)
    if (types.includes('longtask')) {
      state.supported.longtask = true;
      try {
        var longTaskObserver = new PerformanceObserver(function(list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            if (state.longTasks.length >= 100) break;
            var entry = entries[i];
            var att = entry.attribution && entry.attribution.length > 0 ? entry.attribution[0] : null;
            state.longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration,
              name: entry.name,
              containerType: att ? att.containerType : undefined,
              containerSrc: att ? att.containerSrc : undefined,
              containerId: att ? att.containerId : undefined,
              containerName: att ? att.containerName : undefined,
            });
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: true });
        state.__longTaskObserver = longTaskObserver;
      } catch (e) {}
    }
  }

  // Also maintain backwards-compatible global pointers for LayoutShiftCollector
  window.__auditorLayoutShifts = state.layoutShifts;
  window.__auditorLayoutShiftSupported = state.supported.layoutShift;
  window.__auditorLayoutShiftLimitReached = false;
  window.__auditorPerformance = state;
})();
`;

export class PerformanceCollector {
  private readonly settleTimeoutMs: number;
  private readonly maxCeilingMs: number;

  constructor(options: PerformanceCollectorOptions = {}) {
    this.settleTimeoutMs = Math.max(0, options.settleTimeoutMs ?? 1000);
    this.maxCeilingMs = Math.max(1000, options.maxCeilingMs ?? 5000);
  }

  /**
   * Registers the unified PerformanceObserver init script on the BrowserContext or Page before navigation.
   */
  public async installScript(target: Page | BrowserContext): Promise<void> {
    await target.addInitScript(PERFORMANCE_INIT_SCRIPT);
  }

  /**
   * Reads raw performance data from the page, evaluates Web Vitals, and determines measurement completeness.
   */
  public async collectMetrics(
    page: Page,
    options: PerformanceCollectorOptions = {},
  ): Promise<PerformanceCollectionResult> {
    const startTime = Date.now();
    const settleMs = options.settleTimeoutMs ?? this.settleTimeoutMs;
    const maxCeilingMs = options.maxCeilingMs ?? this.maxCeilingMs;

    // Bounded settling delay post-navigation
    if (settleMs > 0 && !page.isClosed()) {
      await page.waitForTimeout(settleMs).catch(() => {});
    }

    // Force frame layout settlement so paint timing events are presented in headless sessions
    if (!page.isClosed()) {
      await page
        .evaluate(
          `
          new Promise(function(resolve) {
            function checkPaint(attempts) {
              var hasPaint = (window.__auditorPerformance && window.__auditorPerformance.paints && window.__auditorPerformance.paints.length > 0) ||
                             (performance && performance.getEntriesByType && performance.getEntriesByType('paint').length > 0);
              if (hasPaint || attempts <= 0) {
                resolve();
              } else {
                setTimeout(function() { checkPaint(attempts - 1); }, 50);
              }
            }
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                  checkPaint(6);
                });
              });
            } else {
              checkPaint(6);
            }
          })
        `,
        )
        .catch(() => {});
    }

    if (options.signal?.aborted || page.isClosed()) {
      return this.buildInterruptedResult(startTime);
    }

    const raw = await page
      .evaluate<RawPerformanceData>(
        `
        (function() {
          try {
            var st = window.__auditorPerformance;
            if (!st) {
              return {
                supported: { navigationTiming: false, paintTiming: false, lcp: false, layoutShift: false, longtask: false },
                navigation: null,
                paints: [],
                lcpCandidates: [],
                layoutShifts: [],
                longTasks: [],
                isHidden: false,
                hiddenAtMs: null,
                inputAtMs: null,
                loadFiredAtMs: null,
                nowMs: performance ? performance.now() : 0,
              };
            }

            // Disconnect observers to cleanly conclude observation
            try {
              if (st.__paintObserver) st.__paintObserver.disconnect();
              if (st.__lcpObserver) st.__lcpObserver.disconnect();
              if (st.__longTaskObserver) st.__longTaskObserver.disconnect();
              if (typeof window.__auditorDisconnectLayoutShiftObserver === 'function') {
                window.__auditorDisconnectLayoutShiftObserver('performance');
              } else if (st.__shiftObserver) {
                st.__shiftObserver.disconnect();
              }
            } catch (discErr) {}

            var navEntry = null;
            if (st.supported.navigationTiming) {
              var navs = performance.getEntriesByType('navigation');
              if (navs && navs.length > 0) {
                var n = navs[0];
                var sTiming = [];
                if (n.serverTiming && Array.isArray(n.serverTiming)) {
                  for (var i = 0; i < n.serverTiming.length; i++) {
                    sTiming.push({
                      name: n.serverTiming[i].name,
                      duration: n.serverTiming[i].duration || 0,
                      description: n.serverTiming[i].description || '',
                    });
                  }
                }
                navEntry = {
                  startTime: n.startTime,
                  redirectStart: n.redirectStart,
                  redirectEnd: n.redirectEnd,
                  domainLookupStart: n.domainLookupStart,
                  domainLookupEnd: n.domainLookupEnd,
                  connectStart: n.connectStart,
                  secureConnectionStart: n.secureConnectionStart || 0,
                  connectEnd: n.connectEnd,
                  requestStart: n.requestStart,
                  responseStart: n.responseStart,
                  responseEnd: n.responseEnd,
                  domInteractive: n.domInteractive,
                  domContentLoadedEventStart: n.domContentLoadedEventStart,
                  domContentLoadedEventEnd: n.domContentLoadedEventEnd,
                  loadEventStart: n.loadEventStart,
                  loadEventEnd: n.loadEventEnd,
                  transferSize: n.transferSize || 0,
                  encodedBodySize: n.encodedBodySize || 0,
                  decodedBodySize: n.decodedBodySize || 0,
                  serverTiming: sTiming,
                };
              }
            }

            // Harvest paints from observer and performance.getEntriesByType('paint')
            var paints = [];
            if (st.paints && st.paints.length > 0) {
              for (var pi = 0; pi < st.paints.length; pi++) {
                paints.push({ name: st.paints[pi].name, startTime: st.paints[pi].startTime });
              }
            }
            if (performance && performance.getEntriesByType) {
              try {
                var pEntries = performance.getEntriesByType('paint');
                if (pEntries && pEntries.length > 0) {
                  for (var pj = 0; pj < pEntries.length; pj++) {
                    var pe = pEntries[pj];
                    var exists = false;
                    for (var pk = 0; pk < paints.length; pk++) {
                      if (paints[pk].name === pe.name) {
                        exists = true;
                        break;
                      }
                    }
                    if (!exists) {
                      paints.push({ name: pe.name, startTime: pe.startTime });
                    }
                  }
                }
              } catch (peErr) {}
            }

            return {
              supported: st.supported,
              navigation: navEntry,
              paints: paints,
              lcpCandidates: st.lcpCandidates,
              layoutShifts: st.layoutShifts,
              longTasks: st.longTasks,
              isHidden: st.isHidden,
              hiddenAtMs: st.hiddenAtMs,
              inputAtMs: st.inputAtMs,
              loadFiredAtMs: st.loadFiredAtMs,
              nowMs: performance ? performance.now() : 0,
            };
          } catch (err) {
            return {
              supported: { navigationTiming: false, paintTiming: false, lcp: false, layoutShift: false, longtask: false },
              navigation: null,
              paints: [],
              lcpCandidates: [],
              layoutShifts: [],
              longTasks: [],
              isHidden: false,
              hiddenAtMs: null,
              inputAtMs: null,
              loadFiredAtMs: null,
              nowMs: 0,
            };
          }
        })()
      `,
      )
      .catch(() => null);

    if (!raw) {
      return this.buildInterruptedResult(startTime);
    }

    return this.processRawPerformanceData(raw, options, startTime, maxCeilingMs, settleMs);
  }

  /**
   * Processes raw performance entries into structured Web Vitals and completeness models.
   */
  public processRawPerformanceData(
    raw: RawPerformanceData,
    options: PerformanceCollectorOptions,
    startTime: number,
    maxCeilingMs: number,
    settleMs = 1000,
  ): PerformanceCollectionResult {
    const isInterrupted = Boolean(options.isInterrupted);
    const isTimedOut = Boolean(options.isTimedOut);

    // 1. Navigation Timing Data
    const navigationTiming = this.calculateNavigationTiming(
      raw.navigation,
      options.serverTimingHeader,
    );
    const ttfbMs = navigationTiming?.ttfbMs ?? null;

    // 2. Paint Timing Data
    const paintTiming = this.calculatePaintTiming(raw.paints);
    const fcpMs = paintTiming?.firstContentfulPaintMs ?? null;

    // 3. Largest Contentful Paint (LCP)
    const { lcpData, lcpMs, lcpState, isLcpCapped } = this.calculateLcp(
      raw.lcpCandidates,
      raw.nowMs,
      raw.hiddenAtMs,
      raw.loadFiredAtMs,
      raw.inputAtMs ?? null,
      maxCeilingMs,
      settleMs,
      isTimedOut,
      isInterrupted,
    );

    // 4. Cumulative Layout Shift (CLS)
    const clsDetails = this.calculateSessionWindowCls(raw.layoutShifts);
    const cls = clsDetails.sessionWindowCls;

    // 5. Total Blocking Time (TBT)
    const { tbtDetails, tbtMs, tbtCalculated } = this.calculateTbt(raw.longTasks, fcpMs, raw.nowMs);

    const metrics: LabWebVitalsMetrics = {
      ttfbMs,
      fcpMs,
      lcpMs,
      cls,
      tbtMs,
      inp: null,
      inpStatus: 'unsupported_in_lab',
      navigationTiming,
      paintTiming,
      lcpDetails: lcpData,
      tbtDetails,
      clsDetails,
      methodologyNotice:
        'Empirical lab observation collected in an isolated Chromium session. ' +
        'Lab metrics represent single automated visit conditions and do not reproduce real-user field Core Web Vitals (CrUX). ' +
        'INP is an interaction-driven field metric and is fundamentally unsupported in read-only lab audits.',
    };

    return {
      metrics,
      completeness: {
        lcpState,
        isLcpCapped,
        tbtCalculated,
        navigationTimingAvailable: navigationTiming !== null,
      },
      durationMs: Date.now() - startTime,
    };
  }

  private calculateNavigationTiming(
    nav: RawNavigationEntry | null,
    serverTimingHeader?: string | null,
  ): NavigationTimingData | null {
    if (!nav) return null;

    // Arithmetic differences according to W3C Navigation Timing spec
    const redirectDurationMs =
      nav.redirectEnd > nav.redirectStart ? Math.round(nav.redirectEnd - nav.redirectStart) : 0;

    const dnsLookupMs =
      nav.domainLookupEnd > nav.domainLookupStart
        ? Math.round(nav.domainLookupEnd - nav.domainLookupStart)
        : 0;

    const tcpConnectMs =
      nav.connectEnd > nav.connectStart ? Math.round(nav.connectEnd - nav.connectStart) : 0;

    const tlsHandshakeMs =
      nav.secureConnectionStart > 0 && nav.connectEnd > nav.secureConnectionStart
        ? Math.round(nav.connectEnd - nav.secureConnectionStart)
        : 0;

    // TTFB = responseStart - requestStart
    // Represents combined browser-to-origin transit + server wait time
    let ttfbMs: number | null = null;
    if (nav.responseStart > 0 && nav.requestStart > 0 && nav.responseStart >= nav.requestStart) {
      ttfbMs = Math.round(nav.responseStart - nav.requestStart);
    } else if (nav.responseStart > 0 && nav.startTime >= 0) {
      ttfbMs = Math.round(nav.responseStart - nav.startTime);
    }

    const contentDownloadMs =
      nav.responseEnd > nav.responseStart ? Math.round(nav.responseEnd - nav.responseStart) : null;

    const domInteractiveMs = nav.domInteractive > 0 ? Math.round(nav.domInteractive) : null;
    const domContentLoadedMs =
      nav.domContentLoadedEventEnd > 0 ? Math.round(nav.domContentLoadedEventEnd) : null;
    const loadEventMs = nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null;

    // Check for Server-Timing header or entries to isolate pure server execution time
    let serverProcessingMs: number | null = null;
    let hasServerTiming = false;

    if (serverTimingHeader) {
      hasServerTiming = true;
      const match = serverTimingHeader.match(/(?:dur|duration)\s*=\s*([0-9]+(?:\.[0-9]+)?)/i);
      if (match) {
        serverProcessingMs = Math.round(parseFloat(match[1]));
      }
    } else if (nav.serverTiming && nav.serverTiming.length > 0) {
      hasServerTiming = true;
      const totalDur = nav.serverTiming.reduce((acc, st) => acc + (st.duration || 0), 0);
      if (totalDur > 0) {
        serverProcessingMs = Math.round(totalDur);
      }
    }

    return {
      redirectDurationMs,
      dnsLookupMs,
      tcpConnectMs,
      tlsHandshakeMs,
      ttfbMs,
      contentDownloadMs,
      domInteractiveMs,
      domContentLoadedMs,
      loadEventMs,
      transferSizeBytes: nav.transferSize > 0 ? nav.transferSize : null,
      encodedBodySizeBytes: nav.encodedBodySize > 0 ? nav.encodedBodySize : null,
      decodedBodySizeBytes: nav.decodedBodySize > 0 ? nav.decodedBodySize : null,
      serverProcessingMs,
      hasServerTiming,
    };
  }

  private calculatePaintTiming(paints: readonly RawPaintEntry[]): PaintTimingData | null {
    if (!paints || paints.length === 0) return null;

    let firstPaintMs: number | null = null;
    let firstContentfulPaintMs: number | null = null;

    for (const p of paints) {
      if (p.name === 'first-paint' && p.startTime > 0) {
        firstPaintMs = Math.round(p.startTime);
      } else if (p.name === 'first-contentful-paint' && p.startTime > 0) {
        firstContentfulPaintMs = Math.round(p.startTime);
      }
    }

    return {
      firstPaintMs,
      firstContentfulPaintMs,
    };
  }

  public calculateLcp(
    candidates: readonly RawLcpEntry[],
    nowMs: number,
    hiddenAtMs: number | null,
    loadFiredAtMs: number | null,
    inputAtMs: number | null = null,
    maxCeilingMs = 5000,
    settleMs = 1000,
    isTimedOut = false,
    isInterrupted = false,
  ): {
    lcpData: LcpCandidateData | null;
    lcpMs: number | null;
    lcpState: LcpCompletenessState;
    isLcpCapped: boolean;
  } {
    // 1. Determine strict cutoff time per W3C specification
    // LCP candidate observation stops when document visibility becomes hidden or user inputs
    const cutoffMs = Math.min(
      hiddenAtMs !== null ? hiddenAtMs : Infinity,
      inputAtMs !== null ? inputAtMs : Infinity,
    );

    const validCandidates = (candidates || []).filter(c => {
      const t = c.renderTime > 0 ? c.renderTime : c.loadTime > 0 ? c.loadTime : c.startTime;
      return t <= cutoffMs;
    });

    if (validCandidates.length === 0) {
      return {
        lcpData: null,
        lcpMs: null,
        lcpState: isInterrupted ? 'interrupted' : 'unavailable',
        isLcpCapped: false,
      };
    }

    // Pick the last candidate recorded before cutoff
    // (Note: newer candidate rendered after load event is fully valid and preserved)
    const lastCandidate = validCandidates[validCandidates.length - 1];
    const candidateTimeMs = Math.round(
      lastCandidate.renderTime > 0
        ? lastCandidate.renderTime
        : lastCandidate.loadTime > 0
          ? lastCandidate.loadTime
          : lastCandidate.startTime,
    );

    let lcpState: LcpCompletenessState = 'complete';
    let isCapped = false;
    let limitationNotice: string | null = null;

    if (isInterrupted) {
      lcpState = 'interrupted';
      limitationNotice =
        'LCP observation was interrupted prematurely by page closure, navigation abort, or lifecycle termination.';
    } else if (isTimedOut) {
      lcpState = 'capped';
      isCapped = true;
      limitationNotice =
        'LCP observation was capped because navigation or settling timed out before full lifecycle settlement.';
    } else if (nowMs >= maxCeilingMs) {
      lcpState = 'capped';
      isCapped = true;
      limitationNotice = `LCP observation was capped because configured maximum measurement ceiling (${maxCeilingMs}ms) was reached.`;
    } else if (loadFiredAtMs === null && hiddenAtMs === null && inputAtMs === null) {
      lcpState = 'capped';
      isCapped = true;
      limitationNotice =
        'LCP observation was capped because measurement deadline was reached before load event or lifecycle termination.';
    } else if (
      loadFiredAtMs !== null &&
      hiddenAtMs === null &&
      inputAtMs === null &&
      nowMs < loadFiredAtMs + settleMs
    ) {
      lcpState = 'capped';
      isCapped = true;
      limitationNotice = `LCP observation ended before the post-load settling window (${settleMs}ms) completed. The observed candidate is preserved but represents an unsettled observation.`;
    } else if (inputAtMs !== null) {
      lcpState = 'complete';
      limitationNotice =
        'LCP observation was concluded upon user interaction per W3C specification.';
    } else if (hiddenAtMs !== null) {
      lcpState = 'complete';
      limitationNotice =
        'LCP observation was concluded when document visibility transitioned to hidden per W3C specification.';
    } else if (loadFiredAtMs !== null && nowMs >= loadFiredAtMs + settleMs) {
      lcpState = 'complete';
      limitationNotice = null;
    }

    const lcpData: LcpCandidateData = {
      elementSelector: lastCandidate.selector || null,
      elementTagName: lastCandidate.tagName || null,
      elementUrl: lastCandidate.url || null,
      renderTimeMs: lastCandidate.renderTime > 0 ? Math.round(lastCandidate.renderTime) : null,
      loadTimeMs: lastCandidate.loadTime > 0 ? Math.round(lastCandidate.loadTime) : null,
      size: lastCandidate.size > 0 ? Math.round(lastCandidate.size) : null,
      boundingBox: lastCandidate.boundingBox || null,
      completenessState: lcpState,
      isCapped,
      limitationNotice,
    };

    return {
      lcpData,
      lcpMs: candidateTimeMs > 0 ? candidateTimeMs : null,
      lcpState,
      isLcpCapped: isCapped,
    };
  }

  private calculateTbt(
    longTasks: readonly RawLongTaskEntry[],
    fcpMs: number | null,
    nowMs: number,
  ): {
    tbtDetails: TbtData | null;
    tbtMs: number | null;
    tbtCalculated: boolean;
  } {
    // TBT is undefined without a valid First Contentful Paint
    if (fcpMs === null) {
      return {
        tbtDetails: null,
        tbtMs: null,
        tbtCalculated: false,
      };
    }

    let totalBlockingTimeMs = 0;
    let qualifyingLongTasksCount = 0;
    let maxLongTaskDurationMs = 0;

    for (const task of longTasks) {
      // Must occur after FCP
      if (task.startTime >= fcpMs) {
        if (task.duration > 50) {
          qualifyingLongTasksCount++;
          const blockingDuration = task.duration - 50;
          totalBlockingTimeMs += blockingDuration;
          if (task.duration > maxLongTaskDurationMs) {
            maxLongTaskDurationMs = task.duration;
          }
        }
      }
    }

    const roundedTbt = Math.round(totalBlockingTimeMs);
    const observationWindowMs = Math.round(Math.max(0, nowMs - fcpMs));

    const tbtDetails: TbtData = {
      totalBlockingTimeMs: roundedTbt,
      longTasksCount: qualifyingLongTasksCount,
      maxLongTaskDurationMs: maxLongTaskDurationMs > 0 ? Math.round(maxLongTaskDurationMs) : null,
      fcpTimeMs: fcpMs,
      observationWindowMs,
    };

    return {
      tbtDetails,
      tbtMs: roundedTbt,
      tbtCalculated: true,
    };
  }

  /**
   * Official W3C Cumulative Layout Shift (CLS) session window algorithm:
   * - Max session window duration: 5000ms
   * - Max gap between shifts: 1000ms
   * - Excludes shifts with hadRecentInput === true
   */
  public calculateSessionWindowCls(shifts: readonly RawLayoutShiftEntry[]): ClsData {
    if (!shifts || shifts.length === 0) {
      return {
        sessionWindowCls: 0,
        rawCls: 0,
        totalShiftsCount: 0,
        sessionWindowsCount: 0,
        maxSingleShiftValue: 0,
      };
    }

    let rawCls = 0;
    let maxSingleShiftValue = 0;
    const nonInputShifts: RawLayoutShiftEntry[] = [];

    for (const s of shifts) {
      rawCls += s.value;
      if (s.value > maxSingleShiftValue) {
        maxSingleShiftValue = s.value;
      }
      if (!s.hadRecentInput) {
        nonInputShifts.push(s);
      }
    }

    if (nonInputShifts.length === 0) {
      return {
        sessionWindowCls: 0,
        rawCls: Number(rawCls.toFixed(4)),
        totalShiftsCount: shifts.length,
        sessionWindowsCount: 0,
        maxSingleShiftValue: Number(maxSingleShiftValue.toFixed(4)),
      };
    }

    let maxSessionWindowScore = 0;
    let currentSessionWindowScore = 0;
    let sessionWindowStartTime = nonInputShifts[0].startTime;
    let lastShiftTime = nonInputShifts[0].startTime;
    let sessionWindowsCount = 1;

    for (const shift of nonInputShifts) {
      const timeSincePreviousShift = shift.startTime - lastShiftTime;
      const windowDuration = shift.startTime - sessionWindowStartTime;

      if (timeSincePreviousShift > 1000 || windowDuration > 5000) {
        sessionWindowsCount++;
        sessionWindowStartTime = shift.startTime;
        currentSessionWindowScore = 0;
      }

      lastShiftTime = shift.startTime;
      currentSessionWindowScore += shift.value;

      if (currentSessionWindowScore > maxSessionWindowScore) {
        maxSessionWindowScore = currentSessionWindowScore;
      }
    }

    return {
      sessionWindowCls: Number(maxSessionWindowScore.toFixed(4)),
      rawCls: Number(rawCls.toFixed(4)),
      totalShiftsCount: shifts.length,
      sessionWindowsCount,
      maxSingleShiftValue: Number(maxSingleShiftValue.toFixed(4)),
    };
  }

  private buildInterruptedResult(startTime: number): PerformanceCollectionResult {
    const fallbackMetrics: LabWebVitalsMetrics = {
      ttfbMs: null,
      fcpMs: null,
      lcpMs: null,
      cls: null,
      tbtMs: null,
      inp: null,
      inpStatus: 'unsupported_in_lab',
      navigationTiming: null,
      paintTiming: null,
      lcpDetails: null,
      tbtDetails: null,
      clsDetails: null,
      methodologyNotice:
        'Measurement interrupted or browser session closed prematurely. All metrics are unavailable.',
    };

    return {
      metrics: fallbackMetrics,
      completeness: {
        lcpState: 'interrupted',
        isLcpCapped: false,
        tbtCalculated: false,
        navigationTimingAvailable: false,
      },
      durationMs: Date.now() - startTime,
    };
  }
}
