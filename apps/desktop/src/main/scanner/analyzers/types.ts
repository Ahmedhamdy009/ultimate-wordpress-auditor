/**
 * Common Analyzer Types & Contracts for Batch 3.4.
 * Reuses existing FindingSeverity, FindingConfidence, FindingStatus,
 * and CrawledPageResult / CrawlResult models.
 */

import type { FindingSeverity, FindingConfidence, FindingStatus } from '@auditor/shared';
import type { CrawledPageResult, CrawlResult } from '../crawler/types.js';
import type { SafeHttpClient } from '../client/http-client.js';

export interface AnalyzerContext {
  readonly authorizedOrigin: string;
  readonly entryUrl: string;
  readonly scanRunId?: string;
  readonly httpClient?: SafeHttpClient;
  readonly signal?: AbortSignal;
}

export interface AnalyzerFinding {
  readonly ruleId: string;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  readonly status: FindingStatus;
  readonly targetUrl: string;
  readonly evidence?: Record<string, unknown> | string | null;
  readonly remediation?: string | null;
  readonly references?: readonly string[] | null;
}

export interface PageAnalysisResult<T = unknown> {
  readonly findings: readonly AnalyzerFinding[];
  readonly data?: T;
}

export interface SiteAnalysisResult<T = unknown> {
  readonly findings: readonly AnalyzerFinding[];
  readonly data?: T;
}

export interface PageAnalyzer<T = unknown> {
  readonly id: string;
  readonly name: string;
  analyzePage(
    page: CrawledPageResult,
    context: AnalyzerContext,
  ): Promise<PageAnalysisResult<T>> | PageAnalysisResult<T>;
}

export interface SiteAnalyzer<T = unknown> {
  readonly id: string;
  readonly name: string;
  analyzeSite(
    crawlResult: CrawlResult,
    context: AnalyzerContext,
  ): Promise<SiteAnalysisResult<T>> | SiteAnalysisResult<T>;
}

export interface AnalyzerEngineOptions {
  /**
   * Maximum findings to produce per analyzed page (protects against finding flooding).
   * Default: 50.
   */
  readonly maxFindingsPerPage?: number;

  /**
   * Maximum characters of snippet to retain in finding evidence.
   * Default: 500 characters.
   */
  readonly maxEvidenceLength?: number;

  /**
   * Maximum total findings to aggregate across all analyzers.
   * Default: 1,000.
   */
  readonly maxTotalFindings?: number;
}
