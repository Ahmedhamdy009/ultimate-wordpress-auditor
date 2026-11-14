/**
 * Typed contracts and data structures for the Scan Execution & Orchestration Pipeline.
 */

import type {
  CreateScanRunRequest,
  CancelScanRunRequest,
  GetScanProgressRequest,
  ScanConfig,
  ScanProgressDTO,
  ScanRunDTO,
  ScanStage,
  CreateFindingRequest,
} from '@auditor/shared';
import type { CrawlConfig, CrawlResult } from '../crawler/types.js';
import type { BoundedCrawler } from '../crawler/crawler.js';
import type { AnalyzerEngine, AnalyzerEngineResult } from '../analyzers/analyzer-engine.js';
import type { AnalyzerEngineOptions, AnalyzerFinding } from '../analyzers/types.js';
import type { SafeHttpClientOptions, SafeHttpClientTestHooks } from '../client/types.js';
import type {
  BrowserManager,
  BrowserManagerOptions,
  VisualAuditor,
  VisualAuditorOptions,
  AccessibilityAuditor,
  AccessibilityAuditorOptions,
  RuntimeResourceAuditor,
  RuntimeAuditorOptions,
} from '../../browser/index.js';
import type { PerformanceAuditor } from '../performance/index.js';

export type { ScanStage };

export interface BrowserAuditExecutionResult {
  pagesAudited: number;
  viewportsCompleted: number;
  accessibilityAuditsCompleted: number;
  screenshotsCaptured: number;
  browserCandidatesTotal: number;
  browserCandidatesSkipped: number;
  findings: CreateFindingRequest[];
  failedPages: Array<{ url: string; error: string }>;
}

export interface ScanExecutionContext {
  readonly scanId: string;
  readonly siteId: string;
  readonly entryUrl: string;
  readonly authorizedOrigin: string;
  readonly config: ScanConfig;
  readonly abortController: AbortController;
  readonly startedAt: string;
  readonly deadlineAt: number;
  timeoutTimer: NodeJS.Timeout | null;
  stage: ScanStage;
  progress: ScanProgressDTO;
  crawlResult?: CrawlResult;
  analyzerResult?: AnalyzerEngineResult;
  browserResult?: BrowserAuditExecutionResult;
  inProgressFindings?: Array<AnalyzerFinding | CreateFindingRequest>;
  persistedFindingsCount: number;
  lastProgressEmitAt: number;
  readonly persistedFindingKeys: Set<string>;
  readonly completedEngines: Array<'crawler' | 'analyzers' | 'browser'>;
  interruptedEngine: 'crawler' | 'analyzers' | 'browser' | null;
}

export type ScanProgressCallback = (progress: ScanProgressDTO) => void;

export interface ScanOrchestratorOptions {
  /**
   * Maximum concurrent scans allowed globally across the application.
   * Default: 2.
   */
  readonly maxConcurrentScans?: number;

  /**
   * Default scan duration timeout if not specified in scan config.
   * Default: 60,000 ms.
   */
  readonly defaultMaxDurationMs?: number;

  /**
   * Minimum interval in milliseconds between progress notifications.
   * Default: 250 ms.
   */
  readonly progressThrottleMs?: number;

  /**
   * Factory function to create a BoundedCrawler instance.
   * Useful for testing with mocked or stubbed crawlers.
   */
  readonly crawlerFactory?: (config: CrawlConfig) => BoundedCrawler;

  /**
   * Factory function to create an AnalyzerEngine instance.
   * Useful for testing with mocked or stubbed analyzer engines.
   */
  readonly analyzerEngineFactory?: (options?: AnalyzerEngineOptions) => AnalyzerEngine;

  /**
   * Factory function to create a BrowserManager instance.
   * Useful for testing with mocked or custom browser managers.
   */
  readonly browserManagerFactory?: (options?: BrowserManagerOptions) => BrowserManager;

  /**
   * Factory function to create a VisualAuditor instance.
   */
  readonly visualAuditorFactory?: (
    manager: BrowserManager,
    options?: VisualAuditorOptions,
  ) => VisualAuditor;

  /**
   * Factory function to create an AccessibilityAuditor instance.
   */
  readonly accessibilityAuditorFactory?: (
    options?: AccessibilityAuditorOptions,
  ) => AccessibilityAuditor;

  /**
   * Factory function to create a RuntimeResourceAuditor instance.
   */
  readonly runtimeAuditorFactory?: (options?: RuntimeAuditorOptions) => RuntimeResourceAuditor;

  /**
   * Factory function to create a PerformanceAuditor instance.
   */
  readonly performanceAuditorFactory?: () => PerformanceAuditor;

  /**
   * Isolated test-only hooks for dependency injection.
   */
  readonly testHooks?: SafeHttpClientTestHooks;

  /**
   * HTTP client configuration overrides.
   */
  readonly clientOptions?: Partial<SafeHttpClientOptions>;
}

export interface ScanExecutionResult {
  readonly scanRun: ScanRunDTO;
  readonly crawlResult: CrawlResult;
  readonly analyzerResult: AnalyzerEngineResult;
  readonly browserResult?: BrowserAuditExecutionResult;
  readonly persistedFindingsCount: number;
  readonly durationMs: number;
}

export interface IScanOrchestrator {
  /**
   * Pre-flight checks and creates a new scan run in pending status in the database.
   */
  createScan(request: CreateScanRunRequest): ScanRunDTO;

  /**
   * Executes a pending scan run by ID through the complete pipeline.
   */
  executeScan(scanId: string, onProgress?: ScanProgressCallback): Promise<ScanRunDTO>;

  /**
   * Starts a bounded scan execution pipeline.
   * Creates scan in pending status, transitions to running, coordinates crawl,
   * analysis, and atomic finding persistence, then completes with summary.
   */
  startScan(request: CreateScanRunRequest, onProgress?: ScanProgressCallback): Promise<ScanRunDTO>;

  /**
   * Cancels an active or pending scan run.
   * Signals crawler/HTTP abort, closes open connections, and marks run as cancelled.
   */
  cancelScan(request: CancelScanRunRequest, reason?: string): Promise<ScanRunDTO>;

  /**
   * Retrieves real-time or persistent progress metrics for a scan run.
   */
  getScanProgress(request: GetScanProgressRequest): ScanProgressDTO;

  /**
   * Returns progress snapshots for all active scans currently in memory.
   */
  getActiveScans(): readonly ScanProgressDTO[];

  /**
   * Startup crash recovery: identifies scans left in pending/running state
   * and transitions them to failed with ERR_SCAN_INTERRUPTED_BY_SHUTDOWN.
   */
  recoverInterruptedScans(reason?: string): number;

  /**
   * Shuts down the orchestrator, cancelling active scans and clearing timers.
   */
  dispose(): void;
}
