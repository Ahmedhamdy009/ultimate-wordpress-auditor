import type {
  AnalyzedImage,
  AnalyzedResource,
  ResourcePerformanceResult,
  ResourceSummaryMetrics,
} from '@auditor/shared';
import type { CapturedNetworkResource } from './runtime-types.js';

export interface RawResourceTimingEntry {
  readonly name: string;
  readonly initiatorType: string;
  readonly startTime: number;
  readonly duration: number;
  readonly responseEnd: number;
  readonly transferSize: number;
  readonly encodedBodySize: number;
  readonly decodedBodySize: number;
  readonly domainLookupStart: number;
  readonly domainLookupEnd: number;
  readonly connectStart: number;
  readonly secureConnectionStart: number;
  readonly connectEnd: number;
  readonly requestStart: number;
  readonly responseStart: number;
  readonly workerStart: number;
  readonly nextHopProtocol?: string;
}

export interface RawDomImageEntry {
  readonly selector: string | null;
  readonly currentSrc: string;
  readonly src: string | null;
  readonly srcset?: string | null;
  readonly sizes?: string | null;
  readonly hasPictureParent?: boolean;
  readonly naturalWidth: number; // Density-corrected CSS px per HTML spec
  readonly naturalHeight: number; // Density-corrected CSS px per HTML spec
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  readonly sourcePhysicalWidth?: number | null; // Resolved physical bitmap px
  readonly sourcePhysicalHeight?: number | null; // Resolved physical bitmap px
  readonly densityDescriptor?: number | null; // e.g. 1.0, 2.0
  readonly loading: string | null;
  readonly boundingBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly isSvg: boolean;
}

export interface RawDomHeadElementEntry {
  readonly tagName: 'link' | 'script';
  readonly url: string;
  readonly rel?: string;
  readonly media?: string;
  readonly mediaMatches?: boolean;
  readonly disabled?: boolean;
  readonly async?: boolean;
  readonly defer?: boolean;
  readonly type?: string;
  readonly selector?: string;
}

export interface RawDomBackgroundImageEntry {
  readonly selector: string;
  readonly url: string;
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  readonly boundingBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
}

export interface RawResourceAuditData {
  readonly pageUrl: string;
  readonly pageOrigin: string;
  readonly dpr: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly resourceEntries: readonly RawResourceTimingEntry[];
  readonly images: readonly RawDomImageEntry[];
  readonly headElements: readonly RawDomHeadElementEntry[];
  readonly backgroundImages: readonly RawDomBackgroundImageEntry[];
  readonly bufferLimitReached: boolean;
}

export interface ResourcePerformanceOptions {
  /**
   * Primary authorized origin for scope & security comparison.
   */
  readonly authorizedOrigin?: string;

  /**
   * Optional URL of observed LCP candidate (from PerformanceCollector).
   */
  readonly lcpUrl?: string | null;

  /**
   * Optional CSS selector of observed LCP candidate.
   */
  readonly lcpSelector?: string | null;

  /**
   * Maximum Resource Timing entries to evaluate.
   * Default: 500.
   */
  readonly maxResources?: number;

  /**
   * Maximum DOM images to inspect.
   * Default: 100.
   */
  readonly maxImages?: number;

  /**
   * Optional caller cancellation signal.
   */
  readonly signal?: AbortSignal;
}

export type {
  AnalyzedImage,
  AnalyzedResource,
  CapturedNetworkResource,
  ResourcePerformanceResult,
  ResourceSummaryMetrics,
};
