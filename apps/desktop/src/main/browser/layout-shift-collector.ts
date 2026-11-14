import type { Page, BrowserContext } from 'playwright-core';
import type { CreateFindingRequest } from '@auditor/shared';
import type {
  LayoutShiftCollectorOptions,
  LayoutShiftEvent,
  LayoutStabilityMetrics,
  ViewportProfile,
} from './visual-types.js';

export const DEFAULT_MAX_SHIFT_EVENTS_LIMIT = 100;
export const DEFAULT_LAYOUT_SHIFT_TIMEOUT_MS = 1000;

export const LAYOUT_SHIFT_INIT_SCRIPT = `
(function() {
  window.__auditorLayoutShiftCollectorRegistered = true;

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

  // If unified performance collector or layout shift observer is already initialized, do not register a duplicate observer!
  if (window.__auditorPerformance || window.__auditorLayoutShiftObserver) {
    return;
  }
  window.__auditorLayoutShifts = [];
  window.__auditorLayoutShiftSupported = false;
  window.__auditorLayoutShiftLimitReached = false;

  try {
    if (
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes &&
      PerformanceObserver.supportedEntryTypes.includes('layout-shift')
    ) {
      window.__auditorLayoutShiftSupported = true;

      const observer = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (window.__auditorLayoutShifts.length >= 100) {
            window.__auditorLayoutShiftLimitReached = true;
            break;
          }
          // Extract sources safely
          var sourcesList = [];
          if (entry.sources && Array.isArray(entry.sources)) {
            for (var i = 0; i < entry.sources.length; i++) {
              var s = entry.sources[i];
              var node = s.node;
              var selector = undefined;
              if (node && node.nodeType === 1) { // ELEMENT_NODE
                if (node.id) {
                  selector = '#' + node.id;
                } else if (node.className && typeof node.className === 'string') {
                  selector = node.tagName.toLowerCase() + '.' + node.className.trim().split(/\\s+/)[0];
                } else {
                  selector = node.tagName.toLowerCase();
                }
              }
              sourcesList.push({
                selector: selector,
                tagName: node ? node.tagName : undefined,
                previousRect: s.previousRect ? {
                  x: s.previousRect.x,
                  y: s.previousRect.y,
                  width: s.previousRect.width,
                  height: s.previousRect.height
                } : undefined,
                currentRect: s.currentRect ? {
                  x: s.currentRect.x,
                  y: s.currentRect.y,
                  width: s.currentRect.width,
                  height: s.currentRect.height
                } : undefined
              });
            }
          }

          window.__auditorLayoutShifts.push({
            value: entry.value,
            startTime: entry.startTime,
            hadRecentInput: Boolean(entry.hadRecentInput),
            sources: sourcesList
          });
        }
      });

      observer.observe({ type: 'layout-shift', buffered: true });
      window.__auditorLayoutShiftObserver = observer;
    }
  } catch (err) {
    // Graceful fallback if PerformanceObserver fails
  }
})();
`;

export class LayoutShiftCollector {
  private readonly maxLimit: number;
  private readonly timeoutMs: number;

  constructor(options: LayoutShiftCollectorOptions = {}) {
    this.maxLimit = options.maxShiftEventsLimit ?? DEFAULT_MAX_SHIFT_EVENTS_LIMIT;
    this.timeoutMs = options.layoutShiftTimeoutMs ?? DEFAULT_LAYOUT_SHIFT_TIMEOUT_MS;
  }

  /**
   * Registers the PerformanceObserver init script on the BrowserContext or Page before navigation.
   */
  public async installScript(target: Page | BrowserContext): Promise<void> {
    await target.addInitScript(LAYOUT_SHIFT_INIT_SCRIPT);
  }

  /**
   * Reads the collected layout shift records from the page, disconnects observer, and calculates CLS metrics.
   */
  public async collectMetrics(
    page: Page,
    viewport: ViewportProfile,
    targetUrl: string,
    scanRunId = '00000000-0000-0000-0000-000000000000',
  ): Promise<{
    metrics: LayoutStabilityMetrics;
    events: readonly LayoutShiftEvent[];
    findings: readonly CreateFindingRequest[];
  }> {
    // Optionally wait a brief moment for deferred layout shifts to settle
    if (this.timeoutMs > 0 && !page.isClosed()) {
      await page.waitForTimeout(this.timeoutMs).catch(() => {});
    }

    if (page.isClosed()) {
      const fallbackMetrics: LayoutStabilityMetrics = {
        isSupported: false,
        totalShiftsRecorded: 0,
        rawCumulativeLayoutShift: 0,
        sessionWindowCLS: 0,
        excludedUserShiftsCount: 0,
        sessionWindowsCount: 0,
        maxSingleShiftValue: 0,
        isLimitReached: false,
      };
      return { metrics: fallbackMetrics, events: [], findings: [] };
    }

    const rawData = await page
      .evaluate<{
        supported: boolean;
        limitReached: boolean;
        shifts: LayoutShiftEvent[];
      }>(
        `
        (function() {
          try {
            if (typeof window.__auditorDisconnectLayoutShiftObserver === 'function') {
              window.__auditorDisconnectLayoutShiftObserver('visual');
            } else if (window.__auditorLayoutShiftObserver) {
              window.__auditorLayoutShiftObserver.disconnect();
            }
          } catch (e) {}

          return {
            supported: Boolean(window.__auditorLayoutShiftSupported),
            limitReached: Boolean(window.__auditorLayoutShiftLimitReached),
            shifts: Array.isArray(window.__auditorLayoutShifts) ? window.__auditorLayoutShifts : [],
          };
        })()
      `,
      )
      .catch(() => ({
        supported: false,
        limitReached: false,
        shifts: [] as LayoutShiftEvent[],
      }));

    const events: LayoutShiftEvent[] = (rawData.shifts || []).slice(0, this.maxLimit);
    const isSupported = rawData.supported;
    const isLimitReached = rawData.limitReached || rawData.shifts.length >= this.maxLimit;

    // Calculate CLS with standard session window aggregation
    const calculation = this.calculateSessionWindowCLS(events);

    const metrics: LayoutStabilityMetrics = {
      isSupported,
      totalShiftsRecorded: events.length,
      rawCumulativeLayoutShift: calculation.rawTotal,
      sessionWindowCLS: calculation.sessionWindowCLS,
      excludedUserShiftsCount: calculation.excludedUserShiftsCount,
      sessionWindowsCount: calculation.sessionWindowsCount,
      maxSingleShiftValue: calculation.maxSingleShiftValue,
      isLimitReached,
    };

    const findings: CreateFindingRequest[] = [];

    // Findings evaluation
    if (isSupported && metrics.sessionWindowCLS > 0.1) {
      const isHigh = metrics.sessionWindowCLS > 0.25;
      findings.push({
        scanRunId,
        ruleId: isHigh ? 'LAYOUT_SHIFT_HIGH' : 'LAYOUT_SHIFT_NEEDS_IMPROVEMENT',
        category: 'layout-stability',
        title: isHigh
          ? `High Cumulative Layout Shift (CLS: ${metrics.sessionWindowCLS.toFixed(3)}) on ${viewport.name}`
          : `Layout Shift Needs Improvement (CLS: ${metrics.sessionWindowCLS.toFixed(3)}) on ${viewport.name}`,
        description:
          `Observed lab Cumulative Layout Shift (CLS) of ${metrics.sessionWindowCLS.toFixed(3)} ` +
          `(threshold: 0.10 for Good, 0.25 for Poor) on viewport ${viewport.name} (${viewport.width}x${viewport.height}). ` +
          `A total of ${metrics.totalShiftsRecorded} shifts were recorded across ${metrics.sessionWindowsCount} session window(s). ` +
          `Notice: Lab observations represent an automated single-visit observation and do not establish field real-user Core Web Vitals.`,
        severity: isHigh ? 'medium' : 'low',
        confidence: isHigh ? 'firm' : 'potential',
        status: isHigh ? 'confirmed' : 'potential',
        targetUrl,
        evidence: {
          viewport: {
            id: viewport.id,
            name: viewport.name,
            width: viewport.width,
            height: viewport.height,
          },
          sessionWindowCLS: metrics.sessionWindowCLS,
          rawCumulativeLayoutShift: metrics.rawCumulativeLayoutShift,
          totalShiftsRecorded: metrics.totalShiftsRecorded,
          excludedUserShiftsCount: metrics.excludedUserShiftsCount,
          sessionWindowsCount: metrics.sessionWindowsCount,
          maxSingleShiftValue: metrics.maxSingleShiftValue,
          shiftSamples: events.slice(0, 5),
          measurementNotice:
            'Lab measurement is single automated visit and does not represent real-user field Core Web Vitals.',
        },
        remediation:
          'Set explicit width and height on images, videos, and dynamic embeds. ' +
          'Reserve static space for dynamic UI components or ads to prevent content reflow during page load.',
      });
    }

    return { metrics, events, findings };
  }

  /**
   * Implements the official Web Vitals Cumulative Layout Shift (CLS) session window algorithm:
   * - Session window maximum duration: 5,000 ms.
   * - Maximum gap between shifts in the same session window: 1,000 ms.
   * - Shifts with hadRecentInput === true are excluded from CLS score.
   * - CLS score = maximum sum among all session windows.
   */
  public calculateSessionWindowCLS(events: readonly LayoutShiftEvent[]): {
    rawTotal: number;
    sessionWindowCLS: number;
    excludedUserShiftsCount: number;
    sessionWindowsCount: number;
    maxSingleShiftValue: number;
  } {
    let rawTotal = 0;
    let excludedUserShiftsCount = 0;
    let maxSingleShiftValue = 0;

    const nonInputShifts: LayoutShiftEvent[] = [];

    for (const shift of events) {
      rawTotal += shift.value;
      if (shift.value > maxSingleShiftValue) {
        maxSingleShiftValue = shift.value;
      }

      if (shift.hadRecentInput) {
        excludedUserShiftsCount++;
      } else {
        nonInputShifts.push(shift);
      }
    }

    let sessionWindowValue = 0;
    let sessionWindowStartTime = 0;
    let sessionWindowLatestTime = 0;
    let maxSessionWindowCLS = 0;
    let sessionWindowsCount = 0;

    for (const shift of nonInputShifts) {
      if (sessionWindowValue > 0) {
        const gap = shift.startTime - sessionWindowLatestTime;
        const duration = shift.startTime - sessionWindowStartTime;

        if (gap < 1000 && duration < 5000) {
          sessionWindowValue += shift.value;
          sessionWindowLatestTime = shift.startTime;
        } else {
          // Window closed; start a new window
          sessionWindowValue = shift.value;
          sessionWindowStartTime = shift.startTime;
          sessionWindowLatestTime = shift.startTime;
          sessionWindowsCount++;
        }
      } else {
        sessionWindowValue = shift.value;
        sessionWindowStartTime = shift.startTime;
        sessionWindowLatestTime = shift.startTime;
        sessionWindowsCount++;
      }

      if (sessionWindowValue > maxSessionWindowCLS) {
        maxSessionWindowCLS = sessionWindowValue;
      }
    }

    return {
      rawTotal: Math.round(rawTotal * 10000) / 10000,
      sessionWindowCLS: Math.round(maxSessionWindowCLS * 10000) / 10000,
      excludedUserShiftsCount,
      sessionWindowsCount,
      maxSingleShiftValue: Math.round(maxSingleShiftValue * 10000) / 10000,
    };
  }
}
