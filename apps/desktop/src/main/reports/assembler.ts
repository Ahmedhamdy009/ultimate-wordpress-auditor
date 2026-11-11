import crypto from 'node:crypto';
import {
  IPCError,
  IPC_ERROR_CODES,
  classifyFindingConfidenceBucket,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
  consolidateFindings,
} from '@auditor/shared';
import type { SiteRepository } from '../db/repositories/site.repository.js';
import type { ScanRunRepository } from '../db/repositories/scan-run.repository.js';
import type { FindingRepository } from '../db/repositories/finding.repository.js';
import type { ReportPathOptions } from './paths.js';
import { resolveReportVisualEvidence } from './visual-evidence.js';
import type { ReportModel, ReportSummaryModel, ReportSiteModel, ReportScanRunModel } from './types.js';

export interface AssemblerDependencies {
  readonly siteRepo: SiteRepository;
  readonly scanRunRepo: ScanRunRepository;
  readonly findingRepo: FindingRepository;
}

export interface AssembleReportOptions {
  readonly reportId?: string;
  readonly title?: string;
  readonly generatedAt?: string;
  readonly screenshotsDir?: string | ReportPathOptions;
}

/**
 * Assembles a comprehensive, validated ReportModel strictly from persisted SQLite scan data.
 * Guarantees that:
 * 1. Findings belong exclusively to the specified scan run.
 * 2. Associated site metadata is resolved and validated.
 * 3. The actual terminal scan status (e.g. completed, failed, cancelled) is preserved without disguising failures.
 * 4. Summary counts (severity, category, verification state, crawl coverage) are derived without duplication.
 */
export function assembleReportData(
  scanRunId: string,
  deps: AssemblerDependencies,
  options?: AssembleReportOptions,
): ReportModel {
  const scanRun = deps.scanRunRepo.getById(scanRunId);
  if (!scanRun) {
    throw new IPCError(
      `Scan run '${scanRunId}' not found`,
      IPC_ERROR_CODES.SCAN_RUN_NOT_FOUND,
    );
  }

  const site = deps.siteRepo.getById(scanRun.siteId);
  if (!site) {
    throw new IPCError(
      `Associated site '${scanRun.siteId}' not found for scan run '${scanRunId}'`,
      IPC_ERROR_CODES.SITE_NOT_FOUND,
    );
  }

  const findings = deps.findingRepo.getAllByScanRunId(scanRunId).map(f => ({
    ...f,
    category: normalizeFindingCategoryId({ category: f.category, ruleId: f.ruleId }),
    status: normalizeFindingLifecycleStatus(f.status, f.confidence),
  }));

  // Exact severity distribution without duplicate counting
  const bySeverity = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let confirmedCount = 0;
  let firmCount = 0;
  let potentialCount = 0;

  for (const f of findings) {
    // Severity bucket
    const sev = f.severity === 'informational' ? 'info' : f.severity.toLowerCase();
    if (sev in bySeverity) {
      bySeverity[sev as keyof typeof bySeverity]++;
    } else {
      bySeverity.info++;
    }

    // Canonical 1:1 category distribution
    const cat = normalizeFindingCategoryId({ category: f.category, ruleId: f.ruleId });
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;

    // Confidence / Verification state without collapsing firm into confirmed
    const bucket = classifyFindingConfidenceBucket(f.confidence);
    if (bucket === 'confirmed') {
      confirmedCount++;
    } else if (bucket === 'firm') {
      firmCount++;
    } else {
      potentialCount++;
    }

    // Lifecycle status distribution
    const status = normalizeFindingLifecycleStatus(f.status, f.confidence);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  // Crawl coverage metrics from scanRun summary or error details for interrupted scans
  const errorObj = scanRun.error as
    | { code?: string; message?: string; details?: Record<string, unknown> }
    | null
    | undefined;
  const errorDetails = errorObj?.details as Record<string, unknown> | undefined;
  const metricsSource = ((scanRun.summary ?? errorDetails ?? {}) as Record<string, unknown>);

  const pagesScanned =
    typeof metricsSource.pagesScanned === 'number'
      ? metricsSource.pagesScanned
      : typeof metricsSource.urlsCrawled === 'number'
        ? metricsSource.urlsCrawled
        : 1;

  const pagesFailed =
    typeof metricsSource.pagesFailed === 'number'
      ? metricsSource.pagesFailed
      : 0;

  const browserPagesAudited =
    typeof metricsSource.browserPagesAudited === 'number'
      ? metricsSource.browserPagesAudited
      : 0;

  const screenshotsCaptured =
    typeof metricsSource.screenshotsCaptured === 'number'
      ? metricsSource.screenshotsCaptured
      : 0;

  const browserCandidatesTotal =
    typeof metricsSource.browserCandidatesTotal === 'number'
      ? metricsSource.browserCandidatesTotal
      : browserPagesAudited;

  const browserCandidatesSkipped =
    typeof metricsSource.browserCandidatesSkipped === 'number'
      ? metricsSource.browserCandidatesSkipped
      : 0;

  const isPartialAudit = scanRun.status !== 'completed';
  const isBrowserAuditEnabled = Boolean(scanRun.config?.enableBrowserAudit);

  const isPartialBrowserCoverage =
    isBrowserAuditEnabled &&
    (browserPagesAudited < pagesScanned || browserCandidatesSkipped > 0);

  const isPartialCoverage =
    isPartialAudit ||
    metricsSource.isPartialCoverage === true ||
    metricsSource.coverageStatus === 'partial' ||
    browserCandidatesSkipped > 0 ||
    browserPagesAudited < browserCandidatesTotal ||
    isPartialBrowserCoverage ||
    pagesFailed > 0;

  const coverageStatus: 'full' | 'partial' = isPartialCoverage ? 'partial' : 'full';

  const browserCoverageStatus: 'full' | 'partial' | 'none' =
    typeof metricsSource.browserCoverageStatus === 'string'
      ? (metricsSource.browserCoverageStatus as 'full' | 'partial' | 'none')
      : !isBrowserAuditEnabled || browserPagesAudited === 0
        ? 'none'
        : browserPagesAudited >= pagesScanned && browserCandidatesSkipped === 0
          ? 'full'
          : 'partial';

  const staticCoverageStatus: 'full' | 'partial' | 'none' =
    typeof metricsSource.staticCoverageStatus === 'string'
      ? (metricsSource.staticCoverageStatus as 'full' | 'partial' | 'none')
      : pagesFailed > 0
        ? 'partial'
        : 'full';

  const coverageWarning: string | undefined =
    typeof metricsSource.coverageWarning === 'string'
      ? (metricsSource.coverageWarning as string)
      : isPartialCoverage && scanRun.status === 'completed'
        ? browserCandidatesSkipped > 0
          ? `Scan completed with partial browser coverage: ${browserCandidatesSkipped} candidate page(s) were skipped due to scan duration budget.`
          : isBrowserAuditEnabled && browserPagesAudited < pagesScanned
            ? `Scan completed with partial browser coverage: ${browserPagesAudited}/${pagesScanned} pages browser-audited (${pagesScanned - browserPagesAudited} pages received static analysis only).`
            : pagesFailed > 0
              ? `Scan completed with partial coverage: ${pagesFailed} page(s) encountered audit errors.`
              : undefined
        : undefined;

  const completedEngines: readonly string[] = Array.isArray(errorDetails?.completedEngines)
    ? (errorDetails!.completedEngines as string[])
    : scanRun.status === 'completed'
      ? ['crawler', 'analyzers', ...(browserPagesAudited > 0 ? ['browser'] : [])]
      : ['crawler'];

  const interruptedEngine: string | null =
    typeof errorDetails?.interruptedEngine === 'string'
      ? (errorDetails!.interruptedEngine as string)
      : isPartialAudit
        ? 'unknown'
        : null;

  const now = options?.generatedAt ?? new Date().toISOString();

  const summary: ReportSummaryModel = {
    totalFindings: findings.length,
    bySeverity,
    byCategory: Object.freeze(byCategory),
    confirmedCount,
    firmCount,
    potentialCount,
    byStatus: Object.freeze(byStatus),
    pagesScanned,
    pagesFailed,
    browserPagesAudited,
    screenshotsCaptured,
    scanDurationMs: scanRun.durationMs,
    scanStatus: scanRun.status,
    isPartialAudit,
    completedEngines,
    interruptedEngine,
    browserCandidatesTotal,
    browserCandidatesSkipped,
    isPartialCoverage,
    coverageStatus,
    browserCoverageStatus,
    staticCoverageStatus,
    coverageWarning,
    generatedAt: now,
  };

  const siteModel: ReportSiteModel = {
    id: site.id,
    projectId: site.projectId,
    name: site.name,
    baseUrl: site.baseUrl,
    platformType: site.platformType,
    environmentType: site.environmentType,
    description: site.description,
  };

  const scanRunModel: ReportScanRunModel = {
    id: scanRun.id,
    siteId: scanRun.siteId,
    scanType: scanRun.scanType,
    status: scanRun.status,
    targetUrl: scanRun.targetUrl,
    startedAt: scanRun.startedAt,
    completedAt: scanRun.completedAt,
    cancelledAt: scanRun.cancelledAt,
    durationMs: scanRun.durationMs,
    config: scanRun.config,
    pagesScanned,
    pagesFailed,
    browserPagesAudited,
    screenshotsCaptured,
    isPartialAudit,
    completedEngines,
    interruptedEngine,
    browserCandidatesTotal,
    browserCandidatesSkipped,
    isPartialCoverage,
    coverageStatus,
    browserCoverageStatus,
    staticCoverageStatus,
    coverageWarning,
  };

  const reportId = options?.reportId ?? crypto.randomUUID();
  const title =
    options?.title?.trim() ||
    (scanRun.status === 'cancelled'
      ? `${site.name} — Cancelled Security & Audit Report`
      : scanRun.status === 'failed' || isPartialAudit
        ? `${site.name} — Partial Security & Audit Report (Interrupted)`
        : isPartialCoverage
          ? `${site.name} — Security & Audit Report (Partial Browser Coverage)`
          : `${site.name} — Security & Audit Report (Full Coverage)`);

  const visualEvidence = resolveReportVisualEvidence(findings, {
    screenshotsDir: options?.screenshotsDir,
  });

  const consolidatedFindings = consolidateFindings(findings);

  return {
    reportId,
    title,
    site: siteModel,
    scanRun: scanRunModel,
    findings,
    consolidatedFindings,
    summary,
    visualEvidence,
    generatedAt: now,
    version: '1.0.0',
  };
}
