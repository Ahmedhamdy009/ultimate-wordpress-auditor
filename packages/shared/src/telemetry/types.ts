/**
 * Telemetry Extension Types.
 * Defines models for bounded URL telemetry, crawl scope closure,
 * and Level C fallback summaries.
 */

export interface UrlTelemetryTruncationRecord {
  readonly isTruncated: boolean;
  readonly crawledUrlsTotal: number;
  readonly crawledUrlsPersisted: number;
  readonly crawledUrlsOmitted: number;
  readonly browserAuditedUrlsTotal: number;
  readonly browserAuditedUrlsPersisted: number;
  readonly browserAuditedUrlsOmitted: number;
  readonly serializedBytes: number;
  readonly budgetBytes: number;
}

export interface CrawlTerminationConditions {
  readonly naturalQueueDrained: boolean;
  readonly wasCancelled: boolean;
  readonly wasTimedOut: boolean;
  readonly wasPageLimitHit: boolean;
  readonly discardedQueueCount: number;
  readonly urlsSkippedLimits: number;
  readonly httpErrorPagesCount: number;
  readonly networkFetchErrorPagesCount: number;
  readonly totalPagesAttempted: number;
  readonly activeWorkersAtFinish: number;
}

export interface BoundedUrlTelemetryResult {
  readonly crawledUrls: readonly string[];
  readonly browserAuditedUrls: readonly string[];
  readonly truncation: UrlTelemetryTruncationRecord;
}
