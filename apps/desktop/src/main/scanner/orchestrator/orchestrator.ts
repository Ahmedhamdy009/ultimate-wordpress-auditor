/**
 * Scan Execution & Orchestration Engine.
 * Coordinates target validation, bounded crawling, analyzer engine execution,
 * secret redaction, and atomic finding persistence into SQLite.
 */

import {
  type CreateScanRunRequest,
  type CancelScanRunRequest,
  type GetScanProgressRequest,
  type ScanConfig,
  type ScanProgressDTO,
  type ScanRunDTO,
  type ScanRunSummaryDTO,
  type AuditModulesConfig,
  type CreateFindingRequest,
  DEFAULT_AUDIT_MODULES,
  CreateScanRunRequestSchema,
  CancelScanRunRequestSchema,
  GetScanProgressRequestSchema,
  ScanConfigSchema,
  normalizeCrawlUrl,
  isTerminalScanRunStatus,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
} from '@auditor/shared';
import { DatabaseConnection } from '../../db/connection.js';
import { ScanRunRepository } from '../../db/repositories/scan-run.repository.js';
import { SiteRepository } from '../../db/repositories/site.repository.js';
import {
  FindingRepository,
  type CreateFindingInput,
} from '../../db/repositories/finding.repository.js';
import { redactSecrets } from '../../services/finding.service.js';
import { BoundedCrawler } from '../crawler/crawler.js';
import type { CrawlConfig, CrawlProgress, CrawlResult } from '../crawler/types.js';
import { SafeHttpClient } from '../client/http-client.js';
import { AnalyzerEngine } from '../analyzers/analyzer-engine.js';
import type { AnalyzerFinding } from '../analyzers/types.js';
import {
  BrowserManager,
  type BrowserManagerOptions,
  VisualAuditor,
  type VisualAuditorOptions,
  AccessibilityAuditor,
  type AccessibilityAuditorOptions,
  RuntimeResourceAuditor,
  type RuntimeAuditorOptions,
  DEFAULT_VIEWPORT_PROFILES,
  type ViewportProfile,
  redactHtmlSnippet,
} from '../../browser/index.js';
import type {
  BrowserAuditExecutionResult,
  IScanOrchestrator,
  ScanExecutionContext,
  ScanOrchestratorOptions,
  ScanProgressCallback,
  ScanStage,
} from './types.js';
import { SCAN_ORCHESTRATOR_ERROR_CODES, ScanOrchestratorError } from './errors.js';

export class ScanOrchestrator implements IScanOrchestrator {
  private readonly scanRunRepo: ScanRunRepository;
  private readonly siteRepo: SiteRepository;
  private readonly findingRepo: FindingRepository;
  private readonly options: {
    readonly maxConcurrentScans: number;
    readonly defaultMaxDurationMs: number;
    readonly progressThrottleMs: number;
    readonly crawlerFactory: (config: CrawlConfig) => BoundedCrawler;
    readonly analyzerEngineFactory: () => AnalyzerEngine;
    readonly browserManagerFactory: (options?: BrowserManagerOptions) => BrowserManager;
    readonly visualAuditorFactory: (
      manager: BrowserManager,
      options?: VisualAuditorOptions,
    ) => VisualAuditor;
    readonly accessibilityAuditorFactory: (
      options?: AccessibilityAuditorOptions,
    ) => AccessibilityAuditor;
    readonly runtimeAuditorFactory: (options?: RuntimeAuditorOptions) => RuntimeResourceAuditor;
    readonly testHooks?: ScanOrchestratorOptions['testHooks'];
    readonly clientOptions?: ScanOrchestratorOptions['clientOptions'];
  };

  private readonly activeScans = new Map<string, ScanExecutionContext>();
  private isDisposed = false;

  constructor(
    dbOrScanRepo: DatabaseConnection | ScanRunRepository,
    siteRepoOrOptions?: SiteRepository | ScanOrchestratorOptions,
    findingRepo?: FindingRepository,
    options?: ScanOrchestratorOptions,
  ) {
    if (dbOrScanRepo instanceof DatabaseConnection) {
      this.scanRunRepo = new ScanRunRepository(dbOrScanRepo);
      this.siteRepo = new SiteRepository(dbOrScanRepo);
      this.findingRepo = new FindingRepository(dbOrScanRepo);
      const opts = siteRepoOrOptions as ScanOrchestratorOptions | undefined;
      this.options = this.resolveOptions(opts);
    } else {
      this.scanRunRepo = dbOrScanRepo;
      this.siteRepo = siteRepoOrOptions as SiteRepository;
      this.findingRepo = findingRepo as FindingRepository;
      this.options = this.resolveOptions(options);
    }
  }

  private resolveOptions(options?: ScanOrchestratorOptions) {
    return {
      maxConcurrentScans: options?.maxConcurrentScans ?? 2,
      defaultMaxDurationMs: options?.defaultMaxDurationMs ?? 60_000,
      progressThrottleMs: options?.progressThrottleMs ?? 250,
      crawlerFactory: options?.crawlerFactory ?? (() => new BoundedCrawler()),
      analyzerEngineFactory: options?.analyzerEngineFactory ?? (() => new AnalyzerEngine()),
      browserManagerFactory: options?.browserManagerFactory ?? (opts => new BrowserManager(opts)),
      visualAuditorFactory:
        options?.visualAuditorFactory ?? ((mgr, opts) => new VisualAuditor(mgr, opts)),
      accessibilityAuditorFactory:
        options?.accessibilityAuditorFactory ?? (opts => new AccessibilityAuditor(opts)),
      runtimeAuditorFactory:
        options?.runtimeAuditorFactory ??
        (opts => new RuntimeResourceAuditor(opts ?? { authorizedOrigin: '' })),
      testHooks: options?.testHooks,
      clientOptions: options?.clientOptions ?? {},
    };
  }

  /**
   * Pre-flight checks and creates a new scan run in 'pending' status.
   */
  public createScan(request: CreateScanRunRequest): ScanRunDTO {
    this.assertNotDisposed();

    const parsedRequest = CreateScanRunRequestSchema.parse(request);

    // 1. Verify site exists and is not archived
    const site = this.siteRepo.getById(parsedRequest.siteId);
    if (!site) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SITE_NOT_FOUND,
        `Site '${parsedRequest.siteId}' not found`,
        { siteId: parsedRequest.siteId },
      );
    }

    if (site.isArchived) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SITE_ARCHIVED,
        `Cannot scan archived site '${site.name}'`,
        { siteId: site.id },
      );
    }

    // 2. Enforce global concurrency limits
    if (this.activeScans.size >= this.options.maxConcurrentScans) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_CONCURRENT_SCAN_LIMIT_REACHED,
        `Maximum concurrent scan limit reached (${this.options.maxConcurrentScans})`,
        { siteId: site.id },
      );
    }

    // 3. Enforce per-site concurrency limits (only 1 active scan per site)
    for (const active of this.activeScans.values()) {
      if (active.siteId === site.id) {
        throw new ScanOrchestratorError(
          SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SITE_SCAN_IN_PROGRESS,
          `A scan is already in progress for site '${site.name}' (scan ID: ${active.scanId})`,
          { siteId: site.id, scanId: active.scanId },
        );
      }
    }

    const activeDbRun = this.scanRunRepo.findActiveBySiteId(site.id);
    if (activeDbRun) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SITE_SCAN_IN_PROGRESS,
        `A scan is already active in database for site '${site.name}' (scan ID: ${activeDbRun.id})`,
        { siteId: site.id, scanId: activeDbRun.id },
      );
    }

    // 4. Validate and normalize target URL
    const rawTargetUrl =
      parsedRequest.targetUrl && parsedRequest.targetUrl.trim() !== ''
        ? parsedRequest.targetUrl.trim()
        : site.baseUrl;

    const normalizedTarget = normalizeCrawlUrl(rawTargetUrl);
    if (!normalizedTarget) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INVALID_ENTRY_URL,
        `Invalid or prohibited target URL: ${rawTargetUrl}`,
        { siteId: site.id },
      );
    }

    // Verify target URL origin matches site origin
    const normalizedSiteBase = normalizeCrawlUrl(site.baseUrl);
    const siteOrigin = (
      normalizedSiteBase ? normalizedSiteBase.origin : new URL(site.baseUrl).origin
    ).toLowerCase();
    const targetOrigin = normalizedTarget.origin.toLowerCase();

    if (targetOrigin !== siteOrigin) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INVALID_ENTRY_URL,
        `Scan target URL origin '${targetOrigin}' does not match registered site origin '${siteOrigin}'`,
        { siteId: site.id },
      );
    }

    // 5. Validate scan configuration against bounds
    const configResult = ScanConfigSchema.safeParse(parsedRequest.config ?? {});
    if (!configResult.success) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INVALID_SCAN_CONFIG,
        `Invalid scan configuration: ${configResult.error.message}`,
        { siteId: site.id, details: configResult.error.issues },
      );
    }

    // 6. Create record in SQLite (status: 'pending')
    return this.scanRunRepo.create({
      siteId: site.id,
      scanType: parsedRequest.scanType ?? 'full',
      targetUrl: normalizedTarget.href,
      config: configResult.data,
    });
  }

  /**
   * Executes a pending scan run through the complete pipeline:
   * crawling -> analysis -> secret redaction -> atomic finding persistence -> summary calculation.
   */
  public async executeScan(scanId: string, onProgress?: ScanProgressCallback): Promise<ScanRunDTO> {
    this.assertNotDisposed();

    const scanRun = this.scanRunRepo.getById(scanId);
    if (!scanRun) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_NOT_FOUND,
        `Scan run '${scanId}' not found`,
        { scanId },
      );
    }

    if (scanRun.status !== 'pending') {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_ALREADY_TERMINAL,
        `Cannot execute scan in status '${scanRun.status}'`,
        { scanId },
      );
    }

    // Concurrency check before moving to running
    if (this.activeScans.size >= this.options.maxConcurrentScans) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_CONCURRENT_SCAN_LIMIT_REACHED,
        `Maximum concurrent scan limit reached (${this.options.maxConcurrentScans})`,
        { scanId, siteId: scanRun.siteId },
      );
    }

    const config: ScanConfig = ScanConfigSchema.parse(scanRun.config ?? {});
    const maxDurationMs = config.maxDurationMs || this.options.defaultMaxDurationMs;
    const now = new Date().toISOString();

    // 1. Transition to 'running'
    this.scanRunRepo.updateStatus(scanId, {
      status: 'running',
      startedAt: now,
    });

    const abortController = new AbortController();
    const authorizedOrigin = new URL(scanRun.targetUrl).origin;

    const initialProgress: ScanProgressDTO = {
      scanId,
      status: 'running',
      stage: 'initializing',
      pagesAttempted: 0,
      pagesSucceeded: 0,
      pagesFailed: 0,
      pagesPending: 1,
      uniqueUrlsDiscovered: 1,
      currentCrawlDepth: 0,
      findingsProduced: 0,
      findingsPersisted: 0,
      activeRequests: 0,
      elapsedMs: 0,
      currentUrl: scanRun.targetUrl,
      browserPagesAudited: 0,
      viewportsCompleted: 0,
      accessibilityAuditsCompleted: 0,
      screenshotsCaptured: 0,
      currentEngine: 'crawler',
    };

    const context: ScanExecutionContext = {
      scanId,
      siteId: scanRun.siteId,
      entryUrl: scanRun.targetUrl,
      authorizedOrigin,
      config,
      abortController,
      startedAt: now,
      deadlineAt: Date.now() + maxDurationMs,
      timeoutTimer: null,
      stage: 'initializing',
      progress: initialProgress,
      persistedFindingsCount: 0,
      lastProgressEmitAt: 0,
      persistedFindingKeys: new Set<string>(),
      completedEngines: [],
      interruptedEngine: null,
    };

    // 2. Setup overall scan timeout timer
    context.timeoutTimer = setTimeout(() => {
      abortController.abort(
        new ScanOrchestratorError(
          SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT,
          `Scan exceeded maximum duration limit of ${maxDurationMs}ms`,
          { scanId, siteId: scanRun.siteId },
        ),
      );
    }, maxDurationMs);

    this.activeScans.set(scanId, context);
    this.notifyProgress(context, onProgress, true);

    try {
      // 3. Stage: Crawling
      context.stage = 'crawling';
      context.progress.stage = 'crawling';
      context.interruptedEngine = 'crawler';
      this.notifyProgress(context, onProgress, true);

      const crawler = this.options.crawlerFactory({
        entryUrl: context.entryUrl,
        authorizedOrigin: context.authorizedOrigin,
        maxPages: config.maxPages,
        maxDepth: config.maxDepth,
        maxConcurrency: config.maxConcurrency,
        maxDiscoveredLinksPerPage: config.maxDiscoveredLinksPerPage,
        maxDurationMs: Math.max(1000, context.deadlineAt - Date.now()),
        requestTimeoutMs: config.requestTimeoutMs,
        maxEncodedBytes: config.maxEncodedBytes,
        maxDecompressedBytes: config.maxDecompressedBytes,
        userAgent: config.userAgent,
        signal: abortController.signal,
        clientOptions: this.options.clientOptions,
        testHooks: this.options.testHooks,
      });

      const onCrawlProgress = (cp: CrawlProgress): void => {
        context.progress.pagesAttempted = cp.pagesCrawled;
        context.progress.pagesPending = cp.queueSize;
        context.progress.currentCrawlDepth = cp.depth;
        context.progress.currentUrl = cp.currentUrl;
        this.notifyProgress(context, onProgress);
      };

      const crawlResult: CrawlResult = await crawler.crawl(
        {
          entryUrl: context.entryUrl,
          authorizedOrigin: context.authorizedOrigin,
          maxPages: config.maxPages,
          maxDepth: config.maxDepth,
          maxConcurrency: config.maxConcurrency,
          maxDiscoveredLinksPerPage: config.maxDiscoveredLinksPerPage,
          maxDurationMs: Math.max(1000, context.deadlineAt - Date.now()),
          requestTimeoutMs: config.requestTimeoutMs,
          maxEncodedBytes: config.maxEncodedBytes,
          maxDecompressedBytes: config.maxDecompressedBytes,
          userAgent: config.userAgent,
          signal: abortController.signal,
          clientOptions: this.options.clientOptions,
          testHooks: this.options.testHooks,
        },
        onCrawlProgress,
      );

      context.crawlResult = crawlResult;
      context.progress.pagesAttempted = crawlResult.summary.totalPagesAttempted;
      context.progress.pagesSucceeded = crawlResult.summary.successfulPages;
      context.progress.pagesFailed = crawlResult.summary.failedPages;
      context.progress.uniqueUrlsDiscovered = crawlResult.summary.uniqueUrlsDiscovered;
      context.progress.currentCrawlDepth = crawlResult.summary.maxDepthReached;
      context.progress.pagesPending = 0;
      context.completedEngines.push('crawler');
      context.interruptedEngine = null;

      this.checkAborted(context);

      const modules: AuditModulesConfig = {
        ...DEFAULT_AUDIT_MODULES,
        ...(config.auditModules ?? {}),
      };

      // 4. Stage: Analyzing
      context.stage = 'analyzing';
      context.progress.stage = 'analyzing';
      context.interruptedEngine = 'analyzers';
      this.notifyProgress(context, onProgress, true);

      const analyzerEngine = this.options.analyzerEngineFactory();
      const httpClient = new SafeHttpClient(this.options.clientOptions, this.options.testHooks);
      const analyzerResult = await analyzerEngine.runAnalysis(crawlResult, {
        authorizedOrigin: context.authorizedOrigin,
        entryUrl: context.entryUrl,
        scanRunId: context.scanId,
        httpClient,
        signal: abortController.signal,
      });

      context.analyzerResult = analyzerResult;
      context.progress.findingsProduced = analyzerResult.findings.length;
      this.checkAborted(context);

      context.completedEngines.push('analyzers');
      context.interruptedEngine = null;

      // Incremental Checkpoint 1: Persist static analyzer findings immediately before browser audit starts
      this.persistFindingsCheckpoint(context, analyzerResult.findings, modules, onProgress);

      this.checkAborted(context);

      // 5. Stage: Browser Auditing (if enabled)
      const hasBrowserModules =
        Boolean(modules.runtimeErrors) ||
        Boolean(modules.networkResources) ||
        Boolean(modules.responsiveLayout) ||
        Boolean(modules.layoutStability) ||
        Boolean(modules.screenshots) ||
        Boolean(modules.accessibility);

      const shouldRunBrowserAudit =
        Boolean(config.enableBrowserAudit) &&
        hasBrowserModules &&
        crawlResult.summary.successfulPages > 0;
      let browserResult: BrowserAuditExecutionResult | undefined;

      if (shouldRunBrowserAudit) {
        context.stage = 'browser_auditing';
        context.progress.stage = 'browser_auditing';
        context.progress.currentEngine = 'browser';
        context.interruptedEngine = 'browser';
        this.notifyProgress(context, onProgress, true);

        browserResult = await this.executeBrowserAudit(context, crawlResult, modules, onProgress);
        context.browserResult = browserResult;
        context.completedEngines.push('browser');
        context.interruptedEngine = null;
        this.checkAborted(context);
      }

      // 6. Stage: Aggregating & Deduplicating Findings
      const allRawFindings: Array<AnalyzerFinding | CreateFindingRequest> = [
        ...analyzerResult.findings,
        ...(browserResult?.findings ?? []),
      ];

      // 7. Stage: Persisting Findings (Final Checkpoint for any remaining items)
      context.stage = 'persisting';
      context.progress.stage = 'persisting';
      context.progress.currentEngine = 'database';
      this.notifyProgress(context, onProgress, true);

      this.checkAborted(context);

      // Flush any remaining findings that were not captured in earlier checkpoints
      this.persistFindingsCheckpoint(context, allRawFindings, modules, onProgress);

      this.checkAborted(context);

      // 8. Derive category distribution and summary statistics
      const countsBySeverity = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      };
      const countsByCategory: Record<string, number> = {};

      const allPersisted = this.findingRepo.getAllByScanRunId(scanId);

      for (const item of allPersisted) {
        const s = item.severity === 'informational' ? 'info' : item.severity.toLowerCase();
        if (s in countsBySeverity) {
          countsBySeverity[s as keyof typeof countsBySeverity]++;
        } else {
          countsBySeverity.info++;
        }
        const cat = normalizeFindingCategoryId(item);
        countsByCategory[cat] = (countsByCategory[cat] ?? 0) + 1;
      }

      const completedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - new Date(context.startedAt).getTime());

      const browserCandidatesTotal = browserResult?.browserCandidatesTotal ?? 0;
      const browserCandidatesSkipped = browserResult?.browserCandidatesSkipped ?? 0;
      const browserPagesAudited = browserResult?.pagesAudited ?? 0;
      const pagesScanned = crawlResult.summary.successfulPages;
      const totalPagesFailed =
        crawlResult.summary.failedPages + (browserResult?.failedPages.length ?? 0);

      const isBrowserAuditEnabled = Boolean(config.enableBrowserAudit);
      const isPartialBrowserCoverage =
        isBrowserAuditEnabled &&
        (browserPagesAudited < pagesScanned || browserCandidatesSkipped > 0);
      const isPartialCoverage = isPartialBrowserCoverage || totalPagesFailed > 0;
      const coverageStatus: 'full' | 'partial' = isPartialCoverage ? 'partial' : 'full';

      const browserCoverageStatus: 'full' | 'partial' | 'none' =
        !isBrowserAuditEnabled || browserPagesAudited === 0
          ? 'none'
          : browserPagesAudited >= pagesScanned && browserCandidatesSkipped === 0
            ? 'full'
            : 'partial';
      const staticCoverageStatus: 'full' | 'partial' | 'none' =
        crawlResult.summary.failedPages > 0 ? 'partial' : 'full';

      const coverageWarning = isPartialCoverage
        ? browserCandidatesSkipped > 0
          ? `Scan completed with partial browser coverage: ${browserCandidatesSkipped} browser candidate page(s) were skipped due to remaining scan duration budget.`
          : isBrowserAuditEnabled && browserPagesAudited < pagesScanned
            ? `Scan completed with partial browser coverage: ${browserPagesAudited}/${pagesScanned} pages browser-audited (${pagesScanned - browserPagesAudited} pages received static analysis only).`
            : totalPagesFailed > 0
              ? `Scan completed with partial coverage: ${totalPagesFailed} page(s) encountered audit errors.`
              : undefined
        : undefined;

      const summary: ScanRunSummaryDTO = {
        totalFindings: allPersisted.length,
        criticalCount: countsBySeverity.critical,
        highCount: countsBySeverity.high,
        mediumCount: countsBySeverity.medium,
        lowCount: countsBySeverity.low,
        infoCount: countsBySeverity.info,
        urlsCrawled: crawlResult.summary.totalPagesAttempted,
        pagesScanned,
        pagesFailed: totalPagesFailed,
        browserPagesAudited,
        viewportsCompleted: browserResult?.viewportsCompleted ?? 0,
        accessibilityAuditsCompleted: browserResult?.accessibilityAuditsCompleted ?? 0,
        screenshotsCaptured: browserResult?.screenshotsCaptured ?? 0,
        browserCandidatesTotal,
        browserCandidatesSkipped,
        isPartialCoverage,
        coverageStatus,
        browserCoverageStatus,
        staticCoverageStatus,
        coverageWarning,
        categories: countsByCategory,
      };

      const completedRun = this.scanRunRepo.updateStatus(scanId, {
        status: 'completed',
        completedAt,
        durationMs,
        summary,
      });

      context.stage = 'completed';
      context.progress.stage = 'completed';
      context.progress.status = 'completed';
      context.progress.elapsedMs = durationMs;
      context.progress.currentEngine = null;
      context.progress.browserCandidatesTotal = browserCandidatesTotal;
      context.progress.browserCandidatesSkipped = browserCandidatesSkipped;
      context.progress.isPartialCoverage = isPartialCoverage;
      context.progress.coverageStatus = coverageStatus;
      context.progress.browserCoverageStatus = browserCoverageStatus;
      context.progress.staticCoverageStatus = staticCoverageStatus;
      this.notifyProgress(context, onProgress, true);

      return completedRun;
    } catch (err) {
      return this.handleExecutionError(context, err, onProgress);
    } finally {
      this.cleanupContext(context);
    }
  }

  /**
   * Starts a bounded scan execution pipeline end-to-end.
   */
  public async startScan(
    request: CreateScanRunRequest,
    onProgress?: ScanProgressCallback,
  ): Promise<ScanRunDTO> {
    const pendingRun = this.createScan(request);
    return this.executeScan(pendingRun.id, onProgress);
  }

  /**
   * Cancels an active or pending scan run.
   */
  public async cancelScan(request: CancelScanRunRequest, reason?: string): Promise<ScanRunDTO> {
    this.assertNotDisposed();

    const parsed = CancelScanRunRequestSchema.parse(request);
    const active = this.activeScans.get(parsed.id);

    if (active) {
      active.stage = 'cancelled';
      active.progress.stage = 'cancelled';
      active.progress.status = 'cancelled';

      const cancelError = new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_CANCELLED,
        reason ?? 'Scan cancelled by user',
        { scanId: active.scanId, siteId: active.siteId },
      );

      active.abortController.abort(cancelError);

      const now = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - new Date(active.startedAt).getTime());

      const cancelledRun = this.scanRunRepo.updateStatus(active.scanId, {
        status: 'cancelled',
        cancelledAt: now,
        durationMs,
      });

      this.cleanupContext(active);
      return cancelledRun;
    }

    // Check DB status if not active in memory
    const scanRun = this.scanRunRepo.getById(parsed.id);
    if (!scanRun) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_NOT_FOUND,
        `Scan run '${parsed.id}' not found`,
        { scanId: parsed.id },
      );
    }

    if (isTerminalScanRunStatus(scanRun.status)) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_ALREADY_TERMINAL,
        `Cannot cancel scan run in terminal status '${scanRun.status}'`,
        { scanId: parsed.id },
      );
    }

    const now = new Date().toISOString();
    let durationMs: number | null = null;
    if (scanRun.startedAt) {
      durationMs = Math.max(0, Date.now() - new Date(scanRun.startedAt).getTime());
    }

    return this.scanRunRepo.updateStatus(parsed.id, {
      status: 'cancelled',
      cancelledAt: now,
      durationMs,
    });
  }

  /**
   * Retrieves live or completed progress metrics for a scan.
   */
  public getScanProgress(request: GetScanProgressRequest): ScanProgressDTO {
    this.assertNotDisposed();

    const parsed = GetScanProgressRequestSchema.parse(request);
    const active = this.activeScans.get(parsed.id);

    if (active) {
      const elapsedMs = Math.max(0, Date.now() - new Date(active.startedAt).getTime());
      return {
        ...active.progress,
        elapsedMs,
      };
    }

    const scanRun = this.scanRunRepo.getById(parsed.id);
    if (!scanRun) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_NOT_FOUND,
        `Scan run '${parsed.id}' not found`,
        { scanId: parsed.id },
      );
    }

    let stage: ScanStage;
    if (scanRun.status === 'pending') {
      stage = 'pending';
    } else if (scanRun.status === 'running') {
      // If marked running in database but absent from active memory, execution terminated abnormally
      stage = 'failed';
    } else {
      stage = scanRun.status;
    }
    const details = scanRun.error?.details as
      | {
          urlsCrawled?: number;
          pagesScanned?: number;
          pagesFailed?: number;
          browserPagesAudited?: number;
          screenshotsCaptured?: number;
          partialFindingsPersisted?: number;
        }
      | undefined;

    const totalFindings =
      scanRun.summary?.totalFindings ??
      (typeof details?.partialFindingsPersisted === 'number'
        ? details.partialFindingsPersisted
        : this.findingRepo.getAllByScanRunId(scanRun.id).length);

    return {
      scanId: scanRun.id,
      status: scanRun.status,
      stage,
      pagesAttempted: scanRun.summary?.urlsCrawled ?? details?.urlsCrawled ?? 0,
      pagesSucceeded: scanRun.summary?.pagesScanned ?? details?.pagesScanned ?? 0,
      pagesFailed: scanRun.summary?.pagesFailed ?? details?.pagesFailed ?? 0,
      pagesPending: 0,
      uniqueUrlsDiscovered: scanRun.summary?.urlsCrawled ?? details?.urlsCrawled ?? 0,
      currentCrawlDepth: 0,
      findingsProduced: totalFindings,
      findingsPersisted: totalFindings,
      activeRequests: 0,
      elapsedMs: scanRun.durationMs ?? 0,
      currentUrl: scanRun.targetUrl,
      browserPagesAudited:
        scanRun.summary?.browserPagesAudited ?? details?.browserPagesAudited ?? 0,
      viewportsCompleted:
        scanRun.summary?.viewportsCompleted ??
        (details as { viewportsCompleted?: number } | undefined)?.viewportsCompleted ??
        0,
      accessibilityAuditsCompleted:
        scanRun.summary?.accessibilityAuditsCompleted ??
        (details as { accessibilityAuditsCompleted?: number } | undefined)
          ?.accessibilityAuditsCompleted ??
        0,
      screenshotsCaptured:
        scanRun.summary?.screenshotsCaptured ?? details?.screenshotsCaptured ?? 0,
      browserCandidatesTotal:
        scanRun.summary?.browserCandidatesTotal ??
        (details as { browserCandidatesTotal?: number } | undefined)?.browserCandidatesTotal,
      browserCandidatesSkipped:
        scanRun.summary?.browserCandidatesSkipped ??
        (details as { browserCandidatesSkipped?: number } | undefined)?.browserCandidatesSkipped,
      isPartialCoverage:
        scanRun.summary?.isPartialCoverage ??
        (details as { isPartialCoverage?: boolean } | undefined)?.isPartialCoverage ??
        (scanRun.status !== 'completed' ||
          (scanRun.summary?.browserCandidatesSkipped ?? 0) > 0 ||
          (scanRun.summary?.pagesFailed ?? 0) > 0 ||
          Boolean(
            (scanRun.summary?.browserPagesAudited ?? 0) > 0 &&
            (scanRun.summary?.pagesScanned ?? 0) > (scanRun.summary?.browserPagesAudited ?? 0),
          )),
      coverageStatus:
        scanRun.summary?.coverageStatus ??
        (details as { coverageStatus?: 'full' | 'partial' } | undefined)?.coverageStatus ??
        (scanRun.status === 'completed' &&
        !(scanRun.summary?.browserCandidatesSkipped ?? 0) &&
        !(scanRun.summary?.pagesFailed ?? 0) &&
        ((scanRun.summary?.browserPagesAudited ?? 0) === 0 ||
          (scanRun.summary?.browserPagesAudited ?? 0) >= (scanRun.summary?.pagesScanned ?? 0))
          ? 'full'
          : 'partial'),
      browserCoverageStatus:
        scanRun.summary?.browserCoverageStatus ??
        ((scanRun.summary?.browserPagesAudited ?? 0) === 0
          ? 'none'
          : (scanRun.summary?.browserPagesAudited ?? 0) >= (scanRun.summary?.pagesScanned ?? 0) &&
              !(scanRun.summary?.browserCandidatesSkipped ?? 0)
            ? 'full'
            : 'partial'),
      staticCoverageStatus:
        scanRun.summary?.staticCoverageStatus ??
        ((scanRun.summary?.pagesFailed ?? 0) > 0 ? 'partial' : 'full'),
      currentEngine: null,
    };
  }

  /**
   * Returns active progress snapshots for all scans currently in memory.
   */
  public getActiveScans(): readonly ScanProgressDTO[] {
    const list: ScanProgressDTO[] = [];
    for (const ctx of this.activeScans.values()) {
      const elapsedMs = Math.max(0, Date.now() - new Date(ctx.startedAt).getTime());
      list.push({ ...ctx.progress, elapsedMs });
    }
    return list;
  }

  /**
   * Recovers orphaned scan runs that were pending or running across app restart.
   */
  public recoverInterruptedScans(reason?: string): number {
    return this.scanRunRepo.recoverInterruptedScans(reason);
  }

  /**
   * Shuts down the orchestrator, cancelling active scans and cleaning up timers.
   */
  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    for (const ctx of this.activeScans.values()) {
      if (ctx.timeoutTimer) {
        clearTimeout(ctx.timeoutTimer);
        ctx.timeoutTimer = null;
      }
      ctx.abortController.abort(new Error('ScanOrchestrator disposed'));
    }
    this.activeScans.clear();
  }

  private handleExecutionError(
    context: ScanExecutionContext,
    err: unknown,
    onProgress?: ScanProgressCallback,
  ): ScanRunDTO {
    const now = new Date().toISOString();
    const durationMs = Math.max(0, Date.now() - new Date(context.startedAt).getTime());

    // If already in terminal status (e.g. cancelled synchronously by cancelScan), do not attempt illegal re-transition
    const currentRun = this.scanRunRepo.getById(context.scanId);
    if (currentRun && isTerminalScanRunStatus(currentRun.status)) {
      context.stage = currentRun.status as ScanStage;
      context.progress.stage = currentRun.status as ScanStage;
      context.progress.status = currentRun.status;
      this.notifyProgress(context, onProgress, true);
      return currentRun;
    }

    // Check if the error or abort was due to cancellation
    const isCancelled =
      context.stage === 'cancelled' ||
      (err instanceof ScanOrchestratorError &&
        err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_CANCELLED) ||
      (context.abortController.signal.aborted &&
        context.abortController.signal.reason instanceof ScanOrchestratorError &&
        context.abortController.signal.reason.code ===
          SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_CANCELLED);

    // Check if timeout
    const isTimeout =
      (err instanceof ScanOrchestratorError &&
        err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT) ||
      (context.abortController.signal.aborted &&
        context.abortController.signal.reason instanceof ScanOrchestratorError &&
        context.abortController.signal.reason.code ===
          SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT);

    let errorCode: string;
    let errorMessage: string;

    if (isTimeout) {
      errorCode = SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT;
      const timeoutReason = context.abortController.signal.reason;
      if (timeoutReason instanceof Error) {
        errorMessage = timeoutReason.message;
      } else if (
        err instanceof ScanOrchestratorError &&
        err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT
      ) {
        errorMessage = err.message;
      } else {
        const limitMs = context.config.maxDurationMs || this.options.defaultMaxDurationMs;
        errorMessage = `Scan exceeded maximum duration limit of ${limitMs}ms`;
      }
    } else if (isCancelled) {
      errorCode = SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_CANCELLED;
      const cancelReason = context.abortController.signal.reason;
      if (cancelReason instanceof Error) {
        errorMessage = cancelReason.message;
      } else if (
        err instanceof ScanOrchestratorError &&
        err.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_CANCELLED
      ) {
        errorMessage = err.message;
      } else {
        errorMessage = 'Scan operation cancelled by user';
      }
    } else if (err instanceof ScanOrchestratorError) {
      errorCode = err.code;
      errorMessage = err.message;
    } else {
      errorCode =
        (err as { code?: string })?.code || SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INTERNAL_SCAN_ERROR;
      errorMessage = err instanceof Error ? err.message : 'Unknown scan execution failure';
    }

    context.stage = isCancelled ? 'cancelled' : 'failed';
    context.progress.stage = isCancelled ? 'cancelled' : 'failed';
    context.progress.status = isCancelled ? 'cancelled' : 'failed';
    context.progress.elapsedMs = durationMs;
    context.progress.currentEngine = null;
    this.notifyProgress(context, onProgress, true);

    const errorDetails: Record<string, unknown> | undefined = isTimeout
      ? {
          ...(err instanceof ScanOrchestratorError && err.details
            ? (err.details as Record<string, unknown>)
            : {}),
          urlsCrawled:
            context.crawlResult?.summary?.totalPagesAttempted ?? context.progress.pagesAttempted,
          pagesScanned:
            context.crawlResult?.summary?.successfulPages ?? context.progress.pagesSucceeded,
          pagesFailed: context.crawlResult?.summary?.failedPages ?? context.progress.pagesFailed,
          browserPagesAudited: context.progress.browserPagesAudited,
          viewportsCompleted: context.progress.viewportsCompleted,
          accessibilityAuditsCompleted: context.progress.accessibilityAuditsCompleted,
          screenshotsCaptured: context.progress.screenshotsCaptured,
          isPartialCoverage: true,
          coverageStatus: 'partial',
          ...(context.persistedFindingsCount > 0
            ? { partialFindingsPersisted: context.persistedFindingsCount }
            : {}),
          completedEngines: [...context.completedEngines],
          interruptedEngine: context.interruptedEngine,
        }
      : context.persistedFindingsCount > 0
        ? {
            partialFindingsPersisted: context.persistedFindingsCount,
            ...(context.interruptedEngine
              ? {
                  completedEngines: [...context.completedEngines],
                  interruptedEngine: context.interruptedEngine,
                }
              : {}),
            ...(err instanceof ScanOrchestratorError && err.details
              ? (err.details as Record<string, unknown>)
              : {}),
          }
        : err instanceof ScanOrchestratorError && err.details
          ? (err.details as Record<string, unknown>)
          : undefined;

    const targetStatus = isCancelled ? 'cancelled' : 'failed';
    const statusUpdatePayload = isCancelled
      ? {
          status: 'cancelled' as const,
          cancelledAt: now,
          durationMs,
        }
      : {
          status: 'failed' as const,
          completedAt: now,
          durationMs,
          error: {
            code: errorCode,
            message: errorMessage,
            details: errorDetails,
          },
        };

    try {
      return this.scanRunRepo.updateStatus(context.scanId, statusUpdatePayload);
    } catch (secondaryErr) {
      const secondaryMsg =
        secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr);
      const combinedMessage =
        `Failed to transition scan run '${context.scanId}' to terminal status '${targetStatus}' (${secondaryMsg}). ` +
        `Original execution error: ${errorMessage}`;

      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INTERNAL_SCAN_ERROR,
        combinedMessage,
        {
          scanId: context.scanId,
          siteId: context.siteId,
          details: {
            originalError: errorMessage,
            secondaryError: secondaryMsg,
            persistedFindingsCount: context.persistedFindingsCount,
          },
        },
      );
    }
  }

  private checkAborted(context: ScanExecutionContext): void {
    if (context.abortController.signal.aborted) {
      const reason = context.abortController.signal.reason;
      if (reason instanceof Error) {
        throw reason;
      }
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_CANCELLED,
        'Scan operation aborted',
        { scanId: context.scanId, siteId: context.siteId },
      );
    }
  }

  private notifyProgress(
    context: ScanExecutionContext,
    onProgress?: ScanProgressCallback,
    force = false,
  ): void {
    if (!onProgress) return;

    const now = Date.now();
    if (!force && now - context.lastProgressEmitAt < this.options.progressThrottleMs) {
      return;
    }

    context.lastProgressEmitAt = now;
    context.progress.elapsedMs = Math.max(0, now - new Date(context.startedAt).getTime());

    try {
      onProgress({ ...context.progress });
    } catch {
      // User callback exception must never break the scan execution pipeline
    }
  }

  private cleanupContext(context: ScanExecutionContext): void {
    if (context.timeoutTimer) {
      clearTimeout(context.timeoutTimer);
      context.timeoutTimer = null;
    }
    this.activeScans.delete(context.scanId);
  }

  private assertNotDisposed(): void {
    if (this.isDisposed) {
      throw new ScanOrchestratorError(
        SCAN_ORCHESTRATOR_ERROR_CODES.ERR_INTERNAL_SCAN_ERROR,
        'ScanOrchestrator has been disposed',
      );
    }
  }

  private async executeBrowserAudit(
    context: ScanExecutionContext,
    crawlResult: CrawlResult,
    modules: AuditModulesConfig,
    onProgress?: ScanProgressCallback,
  ): Promise<BrowserAuditExecutionResult> {
    const findings: CreateFindingRequest[] = [];
    context.inProgressFindings = findings;
    const failedPages: Array<{ url: string; error: string }> = [];
    let pagesAudited = 0;
    let viewportsCompleted = 0;
    let accessibilityAuditsCompleted = 0;
    let screenshotsCaptured = 0;

    // Filter and intelligently prioritize eligible HTML pages from crawl result
    const maxPagesToAudit = Math.min(Math.max(1, context.config.maxBrowserPages ?? 5), 50);

    const targetOrigin = new URL(context.authorizedOrigin).origin.toLowerCase();
    const entryUrlNormalized = new URL(context.entryUrl).href.toLowerCase();

    interface PageCandidate {
      url: string;
      pathname: string;
      stem: string;
      depth: number;
      isEntry: boolean;
      urlLength: number;
    }

    const eligibleCandidates: PageCandidate[] = [];
    const seenCandidateUrls = new Set<string>();

    for (const page of crawlResult.pages) {
      if (page.statusCode !== null && page.statusCode >= 200 && page.statusCode < 400) {
        const contentType = (page.contentType ?? '').toLowerCase();
        if (page.isHtml || contentType.includes('text/html') || contentType === '') {
          try {
            const pageUrl = page.finalUrl || page.requestedUrl;
            const parsed = new URL(pageUrl);
            if (parsed.origin.toLowerCase() === targetOrigin) {
              const normalizedHref = parsed.href;
              // Skip Cloudflare or utility paths
              if (parsed.pathname.startsWith('/cdn-cgi/')) {
                continue;
              }
              if (!seenCandidateUrls.has(normalizedHref)) {
                seenCandidateUrls.add(normalizedHref);
                const pathParts = parsed.pathname.split('/').filter(Boolean);
                const stem = pathParts.length > 0 ? pathParts[0] : '';
                const isEntry =
                  normalizedHref.toLowerCase() === entryUrlNormalized ||
                  parsed.pathname === '/' ||
                  parsed.pathname === '';
                eligibleCandidates.push({
                  url: pageUrl,
                  pathname: parsed.pathname,
                  stem,
                  depth: pathParts.length,
                  isEntry,
                  urlLength: pageUrl.length,
                });
              }
            }
          } catch {
            // invalid URL ignored
          }
        }
      }
    }

    // Prioritize candidates:
    // 1. Entry URL first
    // 2. Diversify stems (one top page per first-level directory/stem)
    // 3. Remaining pages ordered by depth (shallower first) then urlLength
    const prioritizedUrls: string[] = [];
    const addedUrls = new Set<string>();

    // 1. Add entry URL if present
    const entryCandidate = eligibleCandidates.find(c => c.isEntry);
    if (entryCandidate) {
      prioritizedUrls.push(entryCandidate.url);
      addedUrls.add(entryCandidate.url);
    }

    // 2. Select the shortest / shallowest page for each distinct stem
    const stemsMap = new Map<string, PageCandidate>();
    for (const c of eligibleCandidates) {
      if (c.isEntry || addedUrls.has(c.url) || !c.stem) continue;
      const existing = stemsMap.get(c.stem);
      if (
        !existing ||
        c.depth < existing.depth ||
        (c.depth === existing.depth && c.urlLength < existing.urlLength)
      ) {
        stemsMap.set(c.stem, c);
      }
    }

    for (const stemCandidate of stemsMap.values()) {
      if (prioritizedUrls.length >= maxPagesToAudit) break;
      if (!addedUrls.has(stemCandidate.url)) {
        prioritizedUrls.push(stemCandidate.url);
        addedUrls.add(stemCandidate.url);
      }
    }

    // 3. Fill remaining slots with remaining candidates sorted by depth and length
    const remainingCandidates = eligibleCandidates
      .filter(c => !addedUrls.has(c.url))
      .sort((a, b) => a.depth - b.depth || a.urlLength - b.urlLength);

    for (const rem of remainingCandidates) {
      if (prioritizedUrls.length >= maxPagesToAudit) break;
      prioritizedUrls.push(rem.url);
      addedUrls.add(rem.url);
    }

    if (prioritizedUrls.length === 0) {
      prioritizedUrls.push(context.entryUrl);
    }

    const candidateUrls = new Set<string>(prioritizedUrls);
    const browserCandidatesTotal = candidateUrls.size;

    // Resolve viewport profiles once for budget estimation and visual auditing
    let resolvedProfiles: readonly ViewportProfile[] | undefined;
    if (context.config.viewportProfiles && context.config.viewportProfiles.length > 0) {
      const matched = DEFAULT_VIEWPORT_PROFILES.filter(p =>
        context.config.viewportProfiles!.includes(p.id),
      );
      if (matched.length > 0) {
        resolvedProfiles = matched;
      }
    }
    const activeProfileCount = resolvedProfiles
      ? resolvedProfiles.length
      : DEFAULT_VIEWPORT_PROFILES.length;
    const captureScreenshots = Boolean(context.config.captureScreenshots && modules.screenshots);

    // Empirical baseline:
    // Navigation (3-5s) + Axe-core (2-3s) + Runtime (0.2s) = ~6-8s
    // If screenshots enabled: per profile viewport + full-page capture = ~3.0s per profile
    // With 3 profiles: 6s + 3*3s = 15s. With 5 profiles: 6s + 5*3s = 21s.
    // If screenshots disabled: ~8s.
    const observedPageDurations: number[] = [];

    let browserManager: BrowserManager;
    try {
      browserManager = this.options.browserManagerFactory({
        headless: true,
        maxConcurrentPages: 1,
        scopePolicy: {
          authorizedOrigin: context.authorizedOrigin,
          thirdPartyPolicy: 'ALLOW_PUBLIC_SUBRESOURCES',
        },
        testHooks: this.options.testHooks
          ? {
              lookupFn: this.options.testHooks.lookupFn,
              pinnedIpOverride: this.options.testHooks.pinnedIpOverride,
              allowLoopbackInTests:
                (
                  this.options.testHooks as {
                    allowLoopbackInTests?: boolean;
                  }
                ).allowLoopbackInTests ?? Boolean(this.options.testHooks.pinnedIpOverride),
            }
          : undefined,
      });

      await browserManager.launch();
    } catch (launchErr) {
      if (
        context.abortController.signal.aborted ||
        (launchErr instanceof ScanOrchestratorError &&
          (launchErr.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT ||
            launchErr.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_CANCELLED))
      ) {
        throw launchErr;
      }

      const errMsg = launchErr instanceof Error ? launchErr.message : String(launchErr);
      findings.push({
        scanRunId: context.scanId,
        ruleId: 'SYS_BROWSER_UNAVAILABLE',
        category: 'system',
        title: 'Browser Audit Engine Unavailable',
        description: `Browser audit could not be executed: ${errMsg}`,
        severity: 'medium',
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: context.entryUrl,
        evidence: { error: errMsg },
        remediation: 'Ensure an approved Chromium-based browser is installed and accessible.',
        references: [],
      });
      return {
        pagesAudited: 0,
        viewportsCompleted: 0,
        accessibilityAuditsCompleted: 0,
        screenshotsCaptured: 0,
        browserCandidatesTotal,
        browserCandidatesSkipped: browserCandidatesTotal,
        findings,
        failedPages: [{ url: context.entryUrl, error: errMsg }],
      };
    }

    try {
      for (const pageUrl of candidateUrls) {
        this.checkAborted(context);
        if (Date.now() >= context.deadlineAt) break;

        // Dynamic calibrated browser budgeting:
        // A single page audit requires navigation, DOM/axe-core evaluation,
        // and responsive viewport screenshot captures.
        // Also reserve time for final persistence and scan finalization.
        const remainingBudgetMs = context.deadlineAt - Date.now();
        const FINALIZATION_RESERVE_MS = 3_000;
        const minPageBudgetMs = captureScreenshots
          ? Math.max(18_000, 6_000 + activeProfileCount * 2_500)
          : 12_000;

        let estimatedPageBudgetMs = minPageBudgetMs;
        if (observedPageDurations.length > 0) {
          const avgObserved =
            observedPageDurations.reduce((a, b) => a + b, 0) / observedPageDurations.length;
          estimatedPageBudgetMs = Math.max(minPageBudgetMs, Math.ceil(avgObserved * 1.2));
        }

        const requiredBudgetMs = estimatedPageBudgetMs + FINALIZATION_RESERVE_MS;

        if (pagesAudited > 0 && remainingBudgetMs < requiredBudgetMs) {
          break;
        }
        if (pagesAudited === 0 && remainingBudgetMs < 5_000) {
          break;
        }

        context.progress.currentUrl = pageUrl;
        context.progress.currentEngine = 'browser';
        this.notifyProgress(context, onProgress);

        let managedPage = null;
        let runtimeAuditor: RuntimeResourceAuditor | null = null;
        const pageAuditStartTime = Date.now();

        try {
          const needsDomAudit =
            Boolean(modules.runtimeErrors) ||
            Boolean(modules.networkResources) ||
            Boolean(modules.accessibility);

          if (needsDomAudit) {
            managedPage = await browserManager.acquirePage({
              signal: context.abortController.signal,
            });

            // 1. Attach runtime & network auditor if enabled
            if (modules.runtimeErrors || modules.networkResources) {
              context.progress.currentEngine = 'runtime';
              this.notifyProgress(context, onProgress);

              runtimeAuditor = this.options.runtimeAuditorFactory({
                authorizedOrigin: context.authorizedOrigin,
              });
              runtimeAuditor.attach(managedPage.page);
            }

            // 2. Navigate page with bounded timeout so slow responses cannot starve finalization
            const availableForPageMs = Math.max(
              2_000,
              context.deadlineAt - Date.now() - FINALIZATION_RESERVE_MS,
            );
            const navTimeout = Math.min(
              15_000,
              Math.max(3_000, Math.floor(availableForPageMs * 0.45)),
            );
            await managedPage.page.goto(pageUrl, {
              waitUntil: 'domcontentloaded',
              timeout: navTimeout,
            });

            // 3. Accessibility Audit if enabled
            if (modules.accessibility) {
              this.checkAborted(context);
              context.progress.currentEngine = 'accessibility';
              this.notifyProgress(context, onProgress);

              const a11yAuditor = this.options.accessibilityAuditorFactory({
                tags: context.config.wcagTags,
                scanRunId: context.scanId,
                signal: context.abortController.signal,
              });
              const a11yReport = await a11yAuditor.auditPage(managedPage.page);
              findings.push(...a11yReport.findings);
              accessibilityAuditsCompleted++;
              context.progress.accessibilityAuditsCompleted = accessibilityAuditsCompleted;
              this.notifyProgress(context, onProgress);
            }

            // 4. Collect runtime audit findings
            if (runtimeAuditor) {
              const runtimeReport = runtimeAuditor.audit(pageUrl);
              runtimeAuditor.detach();
              runtimeAuditor = null;
              findings.push(
                ...runtimeReport.findings.map(f => ({
                  scanRunId: context.scanId,
                  ruleId: f.ruleId,
                  category: f.category,
                  title: f.title,
                  description: f.description,
                  severity: f.severity,
                  confidence: f.confidence,
                  status: f.status,
                  targetUrl: f.targetUrl,
                  evidence: (f.evidence as Record<string, unknown> | null | undefined) ?? null,
                  remediation: f.remediation ?? null,
                  references: f.references ? [...f.references] : [],
                })),
              );
            }

            // Release the page before visual audit so VisualAuditor can manage viewport dimensions
            await managedPage.release();
            managedPage = null;
          }

          // 5. Visual & Responsive Audit across viewport profiles
          if (modules.responsiveLayout || modules.layoutStability || modules.screenshots) {
            this.checkAborted(context);
            context.progress.currentEngine = 'visual';
            this.notifyProgress(context, onProgress);

            const visualAuditor = this.options.visualAuditorFactory(browserManager, {
              scanRunId: context.scanId,
              signal: context.abortController.signal,
              profiles: resolvedProfiles,
              captureScreenshots,
              captureFullPageScreenshots: captureScreenshots,
              screenshotOptions: {
                maxScreenshotsPerAudit: captureScreenshots ? 20 : 0,
              },
            });

            const visualReport = await visualAuditor.auditUrl(pageUrl);
            findings.push(...visualReport.findings);
            viewportsCompleted += visualReport.viewportResults.length;
            screenshotsCaptured += visualReport.totalScreenshots;
            context.progress.viewportsCompleted = viewportsCompleted;
            context.progress.screenshotsCaptured = screenshotsCaptured;

            // Associate primary viewport screenshot with accessibility and page-level findings for this pageUrl
            const allPageScreenshots = visualReport.viewportResults.flatMap(vr => vr.screenshots);
            const primaryPageScreenshot =
              allPageScreenshots.find(
                s => s.viewport.id === 'desktop' && s.captureType === 'viewport',
              ) ||
              allPageScreenshots.find(s => s.captureType === 'viewport') ||
              allPageScreenshots[0];

            if (primaryPageScreenshot) {
              for (const f of findings) {
                if (
                  f.targetUrl === pageUrl &&
                  (f.category === 'Accessibility' ||
                    f.category.toLowerCase() === 'accessibility') &&
                  f.evidence &&
                  typeof f.evidence === 'object'
                ) {
                  const ev = f.evidence as Record<string, unknown>;
                  if (!ev.screenshot) {
                    ev.screenshot = {
                      id: primaryPageScreenshot.id,
                      fileName:
                        primaryPageScreenshot.relativePath ||
                        `${primaryPageScreenshot.id}.${primaryPageScreenshot.format}`,
                      width: primaryPageScreenshot.width,
                      height: primaryPageScreenshot.height,
                      viewportProfile: primaryPageScreenshot.viewport.name,
                      fileSizeBytes: primaryPageScreenshot.fileSizeBytes,
                      captureType: primaryPageScreenshot.captureType,
                    };
                  }
                }
              }
            }

            this.notifyProgress(context, onProgress);
          }

          pagesAudited++;
          observedPageDurations.push(Date.now() - pageAuditStartTime);
          context.progress.browserPagesAudited = pagesAudited;
          this.notifyProgress(context, onProgress);

          // Incremental Checkpoint 2: Persist findings discovered for this page
          if (findings.length > 0) {
            this.persistFindingsCheckpoint(context, findings, modules, onProgress);
          }
        } catch (pageErr) {
          if (runtimeAuditor) {
            try {
              runtimeAuditor.detach();
            } catch {
              // ignore
            }
          }
          if (managedPage) {
            try {
              await managedPage.release();
            } catch {
              // ignore
            }
          }

          if (
            context.abortController.signal.aborted ||
            (pageErr instanceof ScanOrchestratorError &&
              (pageErr.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_TIMEOUT ||
                pageErr.code === SCAN_ORCHESTRATOR_ERROR_CODES.ERR_SCAN_CANCELLED))
          ) {
            try {
              if (findings.length > 0) {
                this.persistFindingsCheckpoint(context, findings, modules);
              }
            } catch {
              // Bounded safe flush failure must not mask original abort error
            }
            throw pageErr;
          }

          const pageErrMsg = pageErr instanceof Error ? pageErr.message : String(pageErr);
          failedPages.push({ url: pageUrl, error: pageErrMsg });
        }
      }
    } finally {
      if (browserManager) {
        try {
          await browserManager.close();
        } catch {
          // ignore
        }
      }
    }

    const browserCandidatesSkipped = Math.max(
      0,
      candidateUrls.size - (pagesAudited + failedPages.length),
    );

    return {
      pagesAudited,
      viewportsCompleted,
      accessibilityAuditsCompleted,
      screenshotsCaptured,
      browserCandidatesTotal: candidateUrls.size,
      browserCandidatesSkipped,
      findings,
      failedPages,
    };
  }

  private isFindingAllowedByModules(
    finding: { ruleId: string; category: string },
    modules: AuditModulesConfig,
  ): boolean {
    const rule = finding.ruleId.toUpperCase();
    const cat = (finding.category || '').toLowerCase();

    if (rule.startsWith('SEO_') || rule.startsWith('SEO-')) {
      return Boolean(modules.seo);
    }
    if (rule.startsWith('A11Y_') || rule.startsWith('A11Y-') || cat.includes('accessibility')) {
      return Boolean(modules.accessibility);
    }
    if (
      rule.startsWith('RESPONSIVE_') ||
      rule.startsWith('RESPONSIVE-') ||
      cat.includes('responsive')
    ) {
      return Boolean(modules.responsiveLayout);
    }
    if (
      rule.startsWith('LAYOUT_STABILITY_') ||
      rule.startsWith('LAYOUT_STABILITY-') ||
      rule.startsWith('LAYOUT_SHIFT_') ||
      cat.includes('stability')
    ) {
      return Boolean(modules.layoutStability);
    }
    if (
      rule.startsWith('NET_') ||
      rule.startsWith('NETWORK_') ||
      rule.startsWith('NETWORK-') ||
      cat.includes('network resource')
    ) {
      return Boolean(modules.networkResources);
    }
    if (rule.startsWith('HTTP_') || rule.startsWith('HTTP-')) {
      return Boolean(modules.http);
    }
    if (
      rule.startsWith('RUN_') ||
      rule.startsWith('RUNTIME_') ||
      rule.startsWith('RUNTIME-') ||
      rule.startsWith('JS_') ||
      rule.startsWith('BROWSER_CONSOLE_') ||
      cat.includes('runtime')
    ) {
      return Boolean(modules.runtimeErrors);
    }
    if (rule.startsWith('WP_') || rule.startsWith('WP-') || cat.includes('wordpress')) {
      return Boolean(modules.wordpress);
    }
    if (rule.startsWith('COOKIE_') || rule.startsWith('COOKIE-') || cat.includes('cookie')) {
      return Boolean(modules.cookies);
    }
    if (rule.startsWith('SEC_') || rule.startsWith('SEC-') || cat.includes('security')) {
      return Boolean(modules.securityHeaders);
    }
    if (cat.includes('seo')) {
      return Boolean(modules.seo);
    }
    if (
      rule.startsWith('CONTENT_') ||
      rule.startsWith('QC_') ||
      rule.startsWith('QC-') ||
      cat.includes('content') ||
      cat.includes('quality')
    ) {
      return Boolean(modules.http);
    }

    return true;
  }

  /**
   * Persists newly produced findings at a safe incremental checkpoint.
   * Guarantees:
   * 1. Intra-batch and cross-checkpoint deduplication using deterministic keys.
   * 2. Atomic database transaction via findingRepo.batchCreate.
   * 3. Idempotent: previously persisted findings are never duplicated in SQLite.
   * 4. Progress and persisted findings count are immediately updated.
   */
  private persistFindingsCheckpoint(
    context: ScanExecutionContext,
    newRawFindings: ReadonlyArray<AnalyzerFinding | CreateFindingRequest>,
    modules: AuditModulesConfig,
    onProgress?: ScanProgressCallback,
  ): number {
    if (newRawFindings.length === 0) {
      return 0;
    }

    // 1. Sanitize and deduplicate incoming findings within the batch
    const sanitizedBatch = this.deduplicateAndSanitizeFindings(
      newRawFindings,
      context.scanId,
      modules,
    );

    // 2. Filter out findings that were already persisted in an earlier checkpoint
    const itemsToInsert: CreateFindingInput[] = [];
    for (const item of sanitizedBatch) {
      const key = this.getFindingDeduplicationKey(item);
      if (!context.persistedFindingKeys.has(key)) {
        itemsToInsert.push(item);
      }
    }

    if (itemsToInsert.length === 0) {
      return 0;
    }

    // 3. Atomically persist new findings to SQLite
    const inserted = this.findingRepo.batchCreate(itemsToInsert);

    // 4. Record keys and update context state only after successful commit
    for (const item of itemsToInsert) {
      const key = this.getFindingDeduplicationKey(item);
      context.persistedFindingKeys.add(key);
    }

    context.persistedFindingsCount += inserted.length;
    context.progress.findingsPersisted = context.persistedFindingsCount;
    context.progress.findingsProduced = context.persistedFindingKeys.size;

    this.notifyProgress(context, onProgress);
    return inserted.length;
  }

  private getFindingDeduplicationKey(f: CreateFindingInput): string {
    const ev = (f.evidence ?? {}) as Record<string, unknown>;

    // 1. Selector resolution: targetSelector, selector, direct target, or first node target
    let selector = '';
    if (typeof ev.targetSelector === 'string') {
      selector = ev.targetSelector;
    } else if (typeof ev.selector === 'string') {
      selector = ev.selector;
    } else if (typeof ev.target === 'string') {
      selector = ev.target;
    } else if (Array.isArray(ev.target)) {
      selector = ev.target.join(' ');
    } else if (Array.isArray(ev.nodes) && ev.nodes.length > 0) {
      const firstNode = ev.nodes[0] as Record<string, unknown> | null;
      if (firstNode && Array.isArray(firstNode.target)) {
        selector = firstNode.target.join(' ');
      }
    }

    // 2. Viewport resolution: string, object with id/name, or viewportProfile
    let viewport = '';
    if (typeof ev.viewport === 'string') {
      viewport = ev.viewport;
    } else if (ev.viewport && typeof ev.viewport === 'object') {
      const vObj = ev.viewport as Record<string, unknown>;
      viewport =
        typeof vObj.id === 'string' ? vObj.id : typeof vObj.name === 'string' ? vObj.name : '';
    } else if (typeof ev.viewportProfile === 'string') {
      viewport = ev.viewportProfile;
    }

    // 3. Error / detail message resolution
    let detail = '';
    if (typeof ev.errorMessage === 'string') {
      detail = ev.errorMessage;
    } else if (typeof ev.failureText === 'string') {
      detail = ev.failureText;
    } else if (typeof ev.message === 'string') {
      detail = ev.message;
    } else if (typeof ev.text === 'string') {
      detail = ev.text;
    } else if (typeof ev.url === 'string' && ev.url !== f.targetUrl) {
      detail = ev.url;
    }

    return `${f.ruleId}::${f.targetUrl}::${selector}::${detail}::${viewport}`;
  }

  private deduplicateAndSanitizeFindings(
    rawFindings: ReadonlyArray<AnalyzerFinding | CreateFindingRequest>,
    scanRunId: string,
    modules: AuditModulesConfig,
  ): CreateFindingInput[] {
    const deduplicatedMap = new Map<string, CreateFindingInput>();

    for (const raw of rawFindings) {
      if (!this.isFindingAllowedByModules(raw, modules)) {
        continue;
      }

      const input: CreateFindingInput = {
        scanRunId,
        ruleId: raw.ruleId,
        category: normalizeFindingCategoryId({ category: raw.category, ruleId: raw.ruleId }),
        title: raw.title,
        description: raw.description,
        severity: raw.severity,
        confidence: raw.confidence,
        status: normalizeFindingLifecycleStatus(raw.status, raw.confidence),
        targetUrl: raw.targetUrl,
        evidence: raw.evidence ? (raw.evidence as Record<string, unknown>) : null,
        remediation: raw.remediation ?? null,
        references: raw.references ? [...raw.references] : null,
      };

      const key = this.getFindingDeduplicationKey(input);
      const existing = deduplicatedMap.get(key);

      if (existing) {
        const existingEv = (existing.evidence ?? {}) as Record<string, unknown>;
        const currentCount =
          typeof existingEv.occurrenceCount === 'number' ? existingEv.occurrenceCount : 1;
        existingEv.occurrenceCount = currentCount + 1;

        // Preserve distinct viewports if present across duplicate events
        const rawEv = (input.evidence ?? {}) as Record<string, unknown>;
        const rawVp = rawEv.viewport ?? rawEv.viewportProfile;
        if (rawVp) {
          const vpId =
            typeof rawVp === 'string'
              ? rawVp
              : typeof rawVp === 'object' &&
                  rawVp !== null &&
                  typeof (rawVp as { id?: string }).id === 'string'
                ? (rawVp as { id: string }).id
                : undefined;
          if (vpId) {
            const vpList = Array.isArray(existingEv.viewports)
              ? [...(existingEv.viewports as string[])]
              : [];
            if (!vpList.includes(vpId)) {
              vpList.push(vpId);
            }
            existingEv.viewports = vpList;
          }
        }

        existing.evidence = existingEv;
      } else {
        deduplicatedMap.set(key, input);
      }
    }

    const sanitizedList: CreateFindingInput[] = [];
    for (const item of deduplicatedMap.values()) {
      let cleanEvidence: Record<string, unknown> | null = null;
      if (item.evidence && typeof item.evidence === 'object') {
        cleanEvidence = redactSecrets(item.evidence) as Record<string, unknown>;

        if (typeof cleanEvidence.html === 'string') {
          cleanEvidence.html = redactHtmlSnippet(cleanEvidence.html);
        }

        if (Array.isArray(cleanEvidence.nodes)) {
          cleanEvidence.nodes = cleanEvidence.nodes.map(n => {
            if (
              n &&
              typeof n === 'object' &&
              typeof (n as Record<string, unknown>).html === 'string'
            ) {
              return {
                ...n,
                html: redactHtmlSnippet((n as Record<string, unknown>).html as string),
              };
            }
            return n;
          });
        }
      }
      item.evidence = cleanEvidence;
      sanitizedList.push(item);
    }

    return sanitizedList;
  }
}
