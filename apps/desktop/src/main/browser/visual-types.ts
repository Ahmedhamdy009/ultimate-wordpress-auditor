import type { CreateFindingRequest } from '@auditor/shared';

/**
 * Viewport Profile Definition
 */
export interface ViewportProfile {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly isMobile?: boolean;
  readonly hasTouch?: boolean;
  readonly isLandscape?: boolean;
}

export type OverflowType =
  | 'viewport-horizontal-overflow'
  | 'element-boundary-overflow'
  | 'fixed-width-overflow'
  | 'image-overflow'
  | 'text-clipping'
  | 'control-overflow';

/**
 * Bounding Box of an element
 */
export interface ElementBoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Detailed Information on an overflowing or problematic element
 */
export interface OverflowingElementInfo {
  readonly selector: string;
  readonly tagName: string;
  readonly id?: string;
  readonly className?: string;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly boundingBox: ElementBoundingBox;
  readonly overflowAmountPx: number;
  readonly overflowType: OverflowType;
  readonly isFixedPosition?: boolean;
  readonly snippet?: string;
  readonly computedStyles?: {
    readonly width?: string;
    readonly maxWidth?: string;
    readonly overflowX?: string;
    readonly overflowY?: string;
    readonly display?: string;
    readonly position?: string;
    readonly whiteSpace?: string;
    readonly textOverflow?: string;
  };
}

/**
 * Responsive Page-Level Metrics
 */
export interface ResponsivePageMetrics {
  readonly viewport: ViewportProfile;
  readonly windowInnerWidth: number;
  readonly windowInnerHeight: number;
  readonly documentScrollWidth: number;
  readonly documentScrollHeight: number;
  readonly bodyScrollWidth: number;
  readonly bodyScrollHeight: number;
  readonly hasHorizontalOverflow: boolean;
  readonly maxHorizontalOverflowPx: number;
  readonly inspectedElementsCount: number;
  readonly overflowingElementsCount: number;
  readonly documentOverflowX?: string;
  readonly bodyOverflowX?: string;
  readonly rootClipsOverflow?: boolean;
}

/**
 * Layout Shift Source
 */
export interface LayoutShiftSource {
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
}

/**
 * Raw Layout Shift Event from PerformanceObserver
 */
export interface LayoutShiftEvent {
  readonly value: number;
  readonly startTime: number;
  readonly hadRecentInput: boolean;
  readonly sources?: readonly LayoutShiftSource[];
}

/**
 * Layout Stability Metrics (CLS Session Windows)
 */
export interface LayoutStabilityMetrics {
  readonly isSupported: boolean;
  readonly totalShiftsRecorded: number;
  readonly rawCumulativeLayoutShift: number;
  readonly sessionWindowCLS: number;
  readonly excludedUserShiftsCount: number;
  readonly sessionWindowsCount: number;
  readonly maxSingleShiftValue: number;
  readonly isLimitReached: boolean;
}

export type ScreenshotCaptureType = 'viewport' | 'fullpage' | 'element';
export type ScreenshotFormat = 'png' | 'jpeg';

/**
 * Safe Screenshot Metadata
 */
export interface ScreenshotMetadata {
  readonly id: string;
  readonly scanRunId?: string;
  readonly targetUrl: string;
  readonly viewport: ViewportProfile;
  readonly captureType: ScreenshotCaptureType;
  readonly format: ScreenshotFormat;
  readonly filePath: string;
  readonly relativePath: string;
  readonly width: number;
  readonly height: number;
  readonly fileSizeBytes: number;
  readonly sha256: string;
  readonly capturedAt: string;
  readonly findingId?: string;
  readonly elementSelector?: string;
}

/**
 * Options for Screenshot Storage and Capture Manager
 */
export interface ScreenshotManagerOptions {
  readonly storageDir?: string;
  readonly maxScreenshotsPerAudit?: number;
  readonly maxIndividualSizeBytes?: number;
  readonly maxTotalStorageBytes?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly captureTimeoutMs?: number;
  readonly defaultFormat?: ScreenshotFormat;
  readonly jpegQuality?: number;
}

/**
 * Options for Responsive Layout Analyzer
 */
export interface ResponsiveAnalyzerOptions {
  readonly overflowTolerancePx?: number;
  readonly elementInspectionLimit?: number;
  readonly maxFindingsPerViewport?: number;
}

/**
 * Options for Layout Shift Collector
 */
export interface LayoutShiftCollectorOptions {
  readonly maxShiftEventsLimit?: number;
  readonly layoutShiftTimeoutMs?: number;
}

/**
 * Full Visual Auditor Options
 */
export interface VisualAuditorOptions {
  readonly profiles?: readonly ViewportProfile[];
  readonly maxProfiles?: number;
  readonly captureScreenshots?: boolean;
  readonly captureFullPageScreenshots?: boolean;
  readonly screenshotOptions?: ScreenshotManagerOptions;
  readonly responsiveOptions?: ResponsiveAnalyzerOptions;
  readonly layoutShiftOptions?: LayoutShiftCollectorOptions;
  readonly scanRunId?: string;
  readonly signal?: AbortSignal;
  /**
   * Absolute timestamp in milliseconds (epoch) by which all navigation and auditing must complete.
   * VisualAuditor clamps internal page navigation timeouts to never exceed this deadline.
   */
  readonly deadlineAt?: number;
  /**
   * Maximum duration in milliseconds allowed for a single page navigation (defaults to 30,000ms).
   */
  readonly navigationTimeoutMs?: number;
  /**
   * Clock function returning the current epoch milliseconds (defaults to Date.now).
   */
  readonly clock?: () => number;
}

/**
 * Per-URL Execution Options for VisualAuditor.auditUrl()
 */
export interface VisualAuditUrlOptions {
  readonly deadlineAt?: number;
  readonly navigationTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Error raised when VisualAuditor aborts or times out due to the scan deadline being reached or exceeded.
 */
export class VisualAuditorTimeoutError extends Error {
  public readonly code: string = 'ERR_SCAN_TIMEOUT';
  public readonly targetUrl: string;
  public readonly remainingBudgetMs: number;
  public readonly deadlineAt: number;
  public readonly partialReport?: VisualAuditReport;

  constructor(
    message: string,
    context: {
      targetUrl: string;
      remainingBudgetMs: number;
      deadlineAt: number;
      partialReport?: VisualAuditReport;
    },
  ) {
    super(`[ERR_SCAN_TIMEOUT] ${message}`);
    this.name = 'VisualAuditorTimeoutError';
    this.targetUrl = context.targetUrl;
    this.remainingBudgetMs = context.remainingBudgetMs;
    this.deadlineAt = context.deadlineAt;
    this.partialReport = context.partialReport;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Per-Viewport Evaluation Result
 */
export interface ViewportAuditResult {
  readonly viewport: ViewportProfile;
  readonly targetUrl: string;
  readonly responsiveMetrics: ResponsivePageMetrics;
  readonly layoutStabilityMetrics: LayoutStabilityMetrics;
  readonly layoutShiftEvents: readonly LayoutShiftEvent[];
  readonly overflowingElements: readonly OverflowingElementInfo[];
  readonly screenshots: readonly ScreenshotMetadata[];
  readonly findings: readonly CreateFindingRequest[];
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * Comprehensive Visual Audit Report
 */
export interface VisualAuditReport {
  readonly targetUrl: string;
  readonly profilesEvaluated: number;
  readonly totalFindings: number;
  readonly findings: readonly CreateFindingRequest[];
  readonly viewportResults: readonly ViewportAuditResult[];
  readonly totalScreenshots: number;
  readonly totalScreenshotStorageBytes: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly limitsReached: {
    readonly profilesLimit: boolean;
    readonly elementsLimit: boolean;
    readonly shiftEventsLimit: boolean;
    readonly screenshotCountLimit: boolean;
    readonly screenshotStorageLimit: boolean;
  };
}
