import type { LabWebVitalsMetrics, LcpCompletenessState } from '@auditor/shared';

export interface PerformanceCollectorOptions {
  /**
   * Additional time in milliseconds to wait after the 'load' event for layout/rendering to settle.
   * Default: 1000ms.
   */
  readonly settleTimeoutMs?: number;

  /**
   * Hard ceiling in milliseconds from navigation start after which observation is capped.
   * Default: 5000ms.
   */
  readonly maxCeilingMs?: number;

  /**
   * PerformanceResourceTiming buffer size.
   * Default: 500.
   */
  readonly resourceBufferSize?: number;

  /**
   * Caller AbortSignal for immediate cancellation.
   */
  readonly signal?: AbortSignal;

  /**
   * Optional Server-Timing header extracted from initial document response headers.
   */
  readonly serverTimingHeader?: string | null;

  /**
   * Explicit flag indicating that the observation reached a caller-configured deadline.
   */
  readonly isTimedOut?: boolean;

  /**
   * Explicit flag indicating that the observation was interrupted prematurely.
   */
  readonly isInterrupted?: boolean;
}

export interface RawNavigationEntry {
  readonly startTime: number;
  readonly redirectStart: number;
  readonly redirectEnd: number;
  readonly domainLookupStart: number;
  readonly domainLookupEnd: number;
  readonly connectStart: number;
  readonly secureConnectionStart: number;
  readonly connectEnd: number;
  readonly requestStart: number;
  readonly responseStart: number;
  readonly responseEnd: number;
  readonly domInteractive: number;
  readonly domContentLoadedEventStart: number;
  readonly domContentLoadedEventEnd: number;
  readonly loadEventStart: number;
  readonly loadEventEnd: number;
  readonly transferSize: number;
  readonly encodedBodySize: number;
  readonly decodedBodySize: number;
  readonly serverTiming?: ReadonlyArray<{
    readonly name: string;
    readonly duration: number;
    readonly description: string;
  }>;
}

export interface RawPaintEntry {
  readonly name: string;
  readonly startTime: number;
}

export interface RawLcpEntry {
  readonly startTime: number;
  readonly loadTime: number;
  readonly renderTime: number;
  readonly size: number;
  readonly id?: string;
  readonly url?: string;
  readonly tagName?: string;
  readonly selector?: string;
  readonly boundingBox?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface RawLayoutShiftEntry {
  readonly value: number;
  readonly startTime: number;
  readonly hadRecentInput: boolean;
  readonly sources?: ReadonlyArray<{
    readonly selector?: string;
    readonly tagName?: string;
    readonly previousRect?: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    readonly currentRect?: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }>;
}

export interface RawLongTaskEntry {
  readonly startTime: number;
  readonly duration: number;
  readonly name: string;
  readonly containerType?: string;
  readonly containerSrc?: string;
  readonly containerId?: string;
  readonly containerName?: string;
}

export interface RawPerformanceData {
  readonly supported: {
    readonly navigationTiming: boolean;
    readonly paintTiming: boolean;
    readonly lcp: boolean;
    readonly layoutShift: boolean;
    readonly longtask: boolean;
  };
  readonly navigation: RawNavigationEntry | null;
  readonly paints: readonly RawPaintEntry[];
  readonly lcpCandidates: readonly RawLcpEntry[];
  readonly layoutShifts: readonly RawLayoutShiftEntry[];
  readonly longTasks: readonly RawLongTaskEntry[];
  readonly isHidden: boolean;
  readonly hiddenAtMs: number | null;
  readonly inputAtMs?: number | null;
  readonly loadFiredAtMs: number | null;
  readonly nowMs: number;
}

export interface PerformanceCollectionResult {
  readonly metrics: LabWebVitalsMetrics;
  readonly completeness: {
    readonly lcpState: LcpCompletenessState;
    readonly isLcpCapped: boolean;
    readonly tbtCalculated: boolean;
    readonly navigationTimingAvailable: boolean;
  };
  readonly durationMs: number;
}
