import { z } from 'zod';
import {
  FINDING_CATEGORIES,
  normalizeFindingCategoryId,
  type FindingCategoryId,
} from '../schemas/categories.js';
import {
  classifyFindingConfidenceBucket,
  consolidateFindings,
  type FindingConfidence,
  type FindingDTO,
  type FindingSeverity,
  type FindingStatus,
} from '../schemas/finding.js';
import { extractPerformanceSummary, rateWebVitalMetric } from '../schemas/performance.js';
import type { ScanRunStatus, ScanRunType } from '../schemas/scan-run.js';

/**
 * Mandatory truthfulness disclaimer for all Health Index displays.
 */
export const HEALTH_INDEX_DISCLAIMER =
  'Internal Audit Health Index — deterministic evidence-based summary computed strictly from executed checks in this audit. Not a Google Lighthouse score, PageSpeed Insights score, Chrome User Experience Report (CrUX) field measurement, WCAG compliance certification, or formal penetration test.';

/**
 * Validates that a telemetry counter is a finite, non-negative safe integer.
 * Rejects negative values, fractional floats, NaN, ±Infinity, and integers > Number.MAX_SAFE_INTEGER.
 */
export function isValidCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function clamp(min: number, max: number, value: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(0, 1, value);
}

// ============================================================================
// Health Bands & Confidence Bands
// ============================================================================

export const HEALTH_BANDS = [
  'healthy',
  'needs_attention',
  'issues_detected',
  'action_required',
  'provisional_incomplete_scan',
  'insufficient_evidence',
] as const;
export type HealthBandId = (typeof HEALTH_BANDS)[number];
export const HealthBandIdSchema = z.enum(HEALTH_BANDS);

export interface HealthBandLabelPair {
  readonly en: string;
  readonly ar: string;
}

export const HEALTH_BAND_LABELS: Readonly<Record<HealthBandId, HealthBandLabelPair>> =
  Object.freeze({
    healthy: { en: 'Healthy', ar: 'سليم (مستقر)' },
    needs_attention: { en: 'Needs Attention', ar: 'يتطلب انتباهًا' },
    issues_detected: { en: 'Issues Detected', ar: 'مشكلات مكتشفة' },
    action_required: { en: 'Action Required', ar: 'يتطلب إجراءً عاجلًا' },
    provisional_incomplete_scan: {
      en: 'Provisional / Incomplete Scan',
      ar: 'تقييم مبدئي / فحص غير مكتمل',
    },
    insufficient_evidence: { en: 'Insufficient Evidence', ar: 'أدلة غير كافية' },
  });

export const CONFIDENCE_BANDS = ['high', 'moderate', 'low', 'insufficient'] as const;
export type ConfidenceBandId = (typeof CONFIDENCE_BANDS)[number];
export const ConfidenceBandIdSchema = z.enum(CONFIDENCE_BANDS);

export const DIMENSION_STATUSES = [
  'exact',
  'approximated',
  'unavailable',
  'not_applicable',
] as const;
export type DimensionStatus = (typeof DIMENSION_STATUSES)[number];
export const DimensionStatusSchema = z.enum(DIMENSION_STATUSES);

// ============================================================================
// Finding Classification & Precedence
// ============================================================================

export type EffectiveFindingClassification =
  'excluded_lifecycle' | 'provisional' | 'confirmed_or_firm';

export interface ResolvedFindingClassification {
  readonly classification: EffectiveFindingClassification;
  readonly multiplier: 0 | 0.5 | 1;
}

const EXCLUDED_LIFECYCLE_STATUSES = new Set<string>([
  'fixed',
  'resolved',
  'false_positive',
  'ignored',
  'accepted_risk',
]);

const PROVISIONAL_STATUSES = new Set<string>(['potential', 'needs_manual_review']);
const CONFIRMED_CAPABLE_STATUSES = new Set<string>(['confirmed', 'retest_required', 'active', '']);
const KNOWN_CONFIDENCES = new Set<string>([
  'confirmed',
  'firm',
  'tentative',
  'potential',
  'high',
  'medium',
  'low',
]);

/**
 * Evaluates (status, confidence) strictly top-to-bottom per approved precedence:
 * 1. Excluded lifecycle -> 0.0
 * 2. Provisional / uncertain / missing / contradictory -> 0.5
 * 3. Active confirmed or firm -> 1.0
 */
export function resolveEffectiveFindingClassification(
  status: string | null | undefined,
  confidence: string | null | undefined,
): ResolvedFindingClassification {
  const normStatus = (status ?? '').trim().toLowerCase();
  const normConf = (confidence ?? '').trim().toLowerCase();

  if (EXCLUDED_LIFECYCLE_STATUSES.has(normStatus)) {
    return { classification: 'excluded_lifecycle', multiplier: 0 };
  }

  if (
    PROVISIONAL_STATUSES.has(normStatus) ||
    !CONFIRMED_CAPABLE_STATUSES.has(normStatus) ||
    normConf.length === 0 ||
    !KNOWN_CONFIDENCES.has(normConf) ||
    classifyFindingConfidenceBucket(normConf) === 'potential'
  ) {
    return { classification: 'provisional', multiplier: 0.5 };
  }

  return { classification: 'confirmed_or_firm', multiplier: 1 };
}

export function isSystemMetaFinding(finding: {
  readonly ruleId?: string | null;
  readonly category?: string | null;
}): boolean {
  const rule = (finding.ruleId ?? '').trim().toUpperCase();
  return rule.startsWith('SYS_');
}

function normalizeSeverity(
  severity: string | null | undefined,
): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  const s = (severity ?? '').trim().toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') {
    return s;
  }
  return 'info';
}

/**
 * Returns true iff at least one persisted finding is an active, confirmed/firm,
 * critical target-site defect (strictly excluding SYS_* and system-category meta-findings).
 */
export function hasActiveConfirmedCriticalFinding(
  findings: readonly {
    readonly ruleId?: string | null;
    readonly category?: string | null;
    readonly severity?: string | null;
    readonly status?: string | null;
    readonly confidence?: string | null;
  }[],
): boolean {
  for (const f of findings) {
    if (isSystemMetaFinding(f)) continue;
    if (normalizeFindingCategoryId({ category: f.category, ruleId: f.ruleId }) === 'system') {
      continue;
    }
    if (normalizeSeverity(f.severity) !== 'critical') continue;
    const resolved = resolveEffectiveFindingClassification(f.status, f.confidence);
    if (resolved.classification === 'confirmed_or_firm') {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Input Contracts
// ============================================================================

export interface HealthAnalyticsFindingInput {
  readonly id?: string;
  readonly scanRunId?: string;
  readonly ruleId: string;
  readonly category: string;
  readonly title?: string;
  readonly description?: string;
  readonly severity: FindingSeverity | string;
  readonly confidence: FindingConfidence | string | null | undefined;
  readonly status: FindingStatus | string | null | undefined;
  readonly targetUrl: string;
  readonly evidence?: Record<string, unknown> | string | null;
  readonly remediation?: string | null;
  readonly references?: readonly string[] | null;
  readonly createdAt?: string;
}

export interface HealthAnalyticsInput {
  readonly scanType?: ScanRunType | string;
  readonly scanStatus?: ScanRunStatus | string;
  readonly config?: Record<string, unknown> | null;
  readonly summary?: Record<string, unknown> | null;
  readonly errorDetails?: Record<string, unknown> | null;
  readonly completedEngines?: readonly string[] | null;
  readonly findings?: readonly HealthAnalyticsFindingInput[] | null;
}

// ============================================================================
// D1 — Crawl & Reachability Evaluation
// ============================================================================

export interface D1EvaluationResult {
  readonly status: DimensionStatus;
  readonly ratio: number;
  readonly coverageApproximated: boolean;
  readonly reasonCodes: readonly string[];
  readonly pathUsed:
    | 'invalid_count'
    | 'path1_exact_triple'
    | 'path2_missing_crawl_failed'
    | 'path3_missing_urls_crawled'
    | 'path4_h1_crawler_only_proven'
    | 'path4_h2_mixed_or_missing'
    | 'missing_pages_scanned'
    | 'missing_all_counters';
}

const BROWSER_ONLY_RULE_PREFIXES = [
  'A11Y_',
  'A11Y-',
  'RESPONSIVE_',
  'RESPONSIVE-',
  'LAYOUT_SHIFT_',
  'LAYOUT_STABILITY_',
  'LAYOUT_STABILITY-',
  'JS_RUNTIME_ERROR',
  'JS_UNHANDLED_PROMISE_REJECTION',
  'BROWSER_CONSOLE_',
  'RUN_',
  'RUNTIME_',
  'RUNTIME-',
  'NET_',
  'NETWORK_',
  'NETWORK-',
  'PERF_LAB_',
  'PERF_RES_',
  'PERF_BOTTLENECK_',
  'PERF_LCP_',
  'SYS_BROWSER_',
] as const;

export function hasBrowserFindingEvidence(
  findings: readonly { readonly ruleId?: string | null }[],
): boolean {
  return findings.some(f => {
    const rule = (f.ruleId ?? '').trim().toUpperCase();
    return BROWSER_ONLY_RULE_PREFIXES.some(prefix => rule.startsWith(prefix));
  });
}

function invalidD1Result(): D1EvaluationResult {
  return {
    status: 'unavailable',
    ratio: 0,
    coverageApproximated: true,
    reasonCodes: ['d1_crawl_telemetry_invalid_count'],
    pathUsed: 'invalid_count',
  };
}

/**
 * Evaluates Dimension 1 (Crawl & Reachability) using the canonical `summary.pagesScanned` counter,
 * Step 0A/0B pre-validation, derived-sum safe-integer checks, Path 2 condition ordering,
 * Path 4 historical fallback semantics (H1, H2a, H2b, H2c), and strict `browserFailedPages` isolation.
 */
export function evaluateD1CrawlCoverage(input: {
  readonly summary?: Record<string, unknown> | null;
  readonly errorDetails?: Record<string, unknown> | null;
  readonly config?: Record<string, unknown> | null;
  readonly scanStatus?: string;
  readonly completedEngines?: readonly string[] | null;
  readonly findings?: readonly { readonly ruleId?: string | null }[] | null;
}): D1EvaluationResult {
  const summary = input.summary ?? {};
  const errorDetails = input.errorDetails ?? undefined;
  const config = input.config ?? {};
  const findings = input.findings ?? [];

  const urlsCrawled = summary.urlsCrawled;
  const pagesScanned = summary.pagesScanned;
  const crawlFailedPages = summary.crawlFailedPages;
  const pagesFailed = summary.pagesFailed;
  const errPagesFailed = errorDetails?.pagesFailed;

  // Step 0A — Primary Counter Sanity Guard (inspects every defined value before arithmetic)
  if (
    (urlsCrawled !== undefined && !isValidCount(urlsCrawled)) ||
    (pagesScanned !== undefined && !isValidCount(pagesScanned)) ||
    (crawlFailedPages !== undefined && !isValidCount(crawlFailedPages))
  ) {
    return invalidD1Result();
  }

  // Missing pagesScanned rows (Matrix Rows 3, 6, 7)
  if (pagesScanned === undefined) {
    if (urlsCrawled !== undefined || crawlFailedPages !== undefined) {
      return {
        status: 'unavailable',
        ratio: 0,
        coverageApproximated: true,
        reasonCodes: ['d1_missing_pages_scanned_numerator'],
        pathUsed: 'missing_pages_scanned',
      };
    }
    return {
      status: 'unavailable',
      ratio: 0,
      coverageApproximated: true,
      reasonCodes: ['d1_missing_denominator_units'],
      pathUsed: 'missing_all_counters',
    };
  }

  // Path 1 — All Three Authoritative Counters Present (urlsCrawled, pagesScanned, crawlFailedPages)
  if (urlsCrawled !== undefined && crawlFailedPages !== undefined) {
    if (urlsCrawled === 0 && pagesScanned === 0 && crawlFailedPages === 0) {
      return {
        status: 'unavailable',
        ratio: 0,
        coverageApproximated: false,
        reasonCodes: [],
        pathUsed: 'path1_exact_triple',
      };
    }

    const outcomesSum = pagesScanned + crawlFailedPages;
    if (!isValidCount(outcomesSum)) {
      return invalidD1Result();
    }

    if (urlsCrawled === outcomesSum && urlsCrawled > 0) {
      return {
        status: 'exact',
        ratio: clamp01(pagesScanned / urlsCrawled),
        coverageApproximated: false,
        reasonCodes: [],
        pathUsed: 'path1_exact_triple',
      };
    }

    if (urlsCrawled > outcomesSum && urlsCrawled > 0) {
      return {
        status: 'approximated',
        ratio: clamp01(pagesScanned / urlsCrawled),
        coverageApproximated: true,
        reasonCodes: ['d1_crawl_telemetry_mismatch_attempts_gt_outcomes'],
        pathUsed: 'path1_exact_triple',
      };
    }

    return {
      status: 'unavailable',
      ratio: 0,
      coverageApproximated: true,
      reasonCodes: ['d1_crawl_telemetry_mismatch_outcomes_exceed_attempts'],
      pathUsed: 'path1_exact_triple',
    };
  }

  // Path 2 — Pre-7.4 Scan With Valid urlsCrawled Present (crawlFailedPages === undefined)
  // Strict mandatory ordering:
  // 1. Validate defined pagesFailed; 2. Zero-attempt; 3. pagesScanned > urlsCrawled;
  // 4. Full-success exact; 5. Remaining valid partial/in-flight approximated.
  if (urlsCrawled !== undefined && crawlFailedPages === undefined) {
    if (pagesFailed !== undefined && !isValidCount(pagesFailed)) {
      return invalidD1Result();
    }

    if (urlsCrawled === 0 && pagesScanned === 0) {
      return {
        status: 'unavailable',
        ratio: 0,
        coverageApproximated: false,
        reasonCodes: [],
        pathUsed: 'path2_missing_crawl_failed',
      };
    }

    if (pagesScanned > urlsCrawled) {
      return {
        status: 'unavailable',
        ratio: 0,
        coverageApproximated: true,
        reasonCodes: ['d1_crawl_telemetry_mismatch_outcomes_exceed_attempts'],
        pathUsed: 'path2_missing_crawl_failed',
      };
    }

    if (urlsCrawled > 0 && pagesScanned === urlsCrawled && (pagesFailed ?? 0) === 0) {
      return {
        status: 'exact',
        ratio: 1,
        coverageApproximated: false,
        reasonCodes: [],
        pathUsed: 'path2_missing_crawl_failed',
      };
    }

    return {
      status: 'approximated',
      ratio: clamp01(pagesScanned / urlsCrawled),
      coverageApproximated: true,
      reasonCodes: ['d1_historical_missing_crawl_failed_split'],
      pathUsed: 'path2_missing_crawl_failed',
    };
  }

  // Path 3 — urlsCrawled === undefined AND both pagesScanned and crawlFailedPages present
  if (urlsCrawled === undefined && crawlFailedPages !== undefined) {
    const crawlAttempted = pagesScanned + crawlFailedPages;
    if (!isValidCount(crawlAttempted)) {
      return invalidD1Result();
    }

    if (crawlAttempted === 0) {
      return {
        status: 'unavailable',
        ratio: 0,
        coverageApproximated: false,
        reasonCodes: [],
        pathUsed: 'path3_missing_urls_crawled',
      };
    }

    return {
      status: 'exact',
      ratio: clamp01(pagesScanned / crawlAttempted),
      coverageApproximated: false,
      reasonCodes: [],
      pathUsed: 'path3_missing_urls_crawled',
    };
  }

  // Path 4 — Historical Scans Without urlsCrawled and Without crawlFailedPages
  // Step 0B Historical Failure Counter Sanity Guard before any arithmetic
  if (errPagesFailed !== undefined && !isValidCount(errPagesFailed)) {
    return invalidD1Result();
  }
  if (pagesFailed !== undefined && !isValidCount(pagesFailed)) {
    return invalidD1Result();
  }
  if (errPagesFailed === undefined && pagesFailed === undefined) {
    return {
      status: 'unavailable',
      ratio: 0,
      coverageApproximated: true,
      reasonCodes: ['d1_missing_denominator_units'],
      pathUsed: 'path4_h2_mixed_or_missing',
    };
  }

  const scanStatus = input.scanStatus ?? 'completed';
  const hasSysBrowserUnavailable = findings.some(
    f => (f.ruleId ?? '').trim().toUpperCase() === 'SYS_BROWSER_UNAVAILABLE',
  );
  const completedEngines = input.completedEngines ?? null;
  const hasBrowserFindings = hasBrowserFindingEvidence(findings);

  const crawlerOnlyFailuresProven =
    (config.enableBrowserAudit === false &&
      !hasSysBrowserUnavailable &&
      (completedEngines === null || !completedEngines.includes('browser')) &&
      !hasBrowserFindings) ||
    (scanStatus !== 'completed' && isValidCount(errPagesFailed));

  // Case H1
  if (crawlerOnlyFailuresProven) {
    const historicalCrawlFailed =
      scanStatus !== 'completed' && isValidCount(errPagesFailed)
        ? errPagesFailed
        : ((pagesFailed as number | undefined) ?? (errPagesFailed as number));
    const crawlAttempted = pagesScanned + historicalCrawlFailed;
    if (!isValidCount(crawlAttempted)) {
      return invalidD1Result();
    }
    if (crawlAttempted === 0) {
      return {
        status: 'unavailable',
        ratio: 0,
        coverageApproximated: false,
        reasonCodes: [],
        pathUsed: 'path4_h1_crawler_only_proven',
      };
    }
    return {
      status: 'exact',
      ratio: clamp01(pagesScanned / crawlAttempted),
      coverageApproximated: false,
      reasonCodes: [],
      pathUsed: 'path4_h1_crawler_only_proven',
    };
  }

  // Case H2 (crawlerOnlyFailuresProven === false; requires explicit valid summary.pagesFailed)
  if (!isValidCount(pagesFailed)) {
    return {
      status: 'unavailable',
      ratio: 0,
      coverageApproximated: true,
      reasonCodes: ['d1_missing_denominator_units'],
      pathUsed: 'path4_h2_mixed_or_missing',
    };
  }

  // H2a: pagesScanned > 0 && summary.pagesFailed > 0
  if (pagesScanned > 0 && pagesFailed > 0) {
    const crawlAttempted = pagesScanned + pagesFailed;
    if (!isValidCount(crawlAttempted)) {
      return invalidD1Result();
    }
    return {
      status: 'approximated',
      ratio: clamp01(pagesScanned / crawlAttempted),
      coverageApproximated: true,
      reasonCodes: ['d1_historical_mixed_pages_failed'],
      pathUsed: 'path4_h2_mixed_or_missing',
    };
  }

  // H2b: pagesScanned > 0 && summary.pagesFailed === 0
  if (pagesScanned > 0 && pagesFailed === 0) {
    return {
      status: 'approximated',
      ratio: 1,
      coverageApproximated: true,
      reasonCodes: ['d1_historical_missing_urls_crawled'],
      pathUsed: 'path4_h2_mixed_or_missing',
    };
  }

  // H2c: pagesScanned === 0 && summary.pagesFailed >= 0
  return {
    status: 'unavailable',
    ratio: 0,
    coverageApproximated: true,
    reasonCodes: ['d1_missing_denominator_units'],
    pathUsed: 'path4_h2_mixed_or_missing',
  };
}

// ============================================================================
// Eligibility Gate & Health Index
// ============================================================================

export interface EligibilityResult {
  readonly hasEligibleExecutedChecks: boolean;
  readonly targetSiteFindingsCount: number;
  readonly hasSysBrowserUnavailable: boolean;
  readonly hasPerfTelemetry: boolean;
  readonly hasBrowserSubCheckEvidence: boolean;
}

function resolveCompletedEngines(input: HealthAnalyticsInput): readonly string[] | null {
  if (Array.isArray(input.completedEngines)) {
    return input.completedEngines;
  }
  const errEngines = input.errorDetails?.completedEngines;
  if (Array.isArray(errEngines)) {
    return errEngines.filter((e): e is string => typeof e === 'string');
  }
  const sumEngines = input.summary?.completedEngines;
  if (Array.isArray(sumEngines)) {
    return sumEngines.filter((e): e is string => typeof e === 'string');
  }
  return null;
}

function extractPerfForHealth(
  rawPerf: Record<string, unknown> | null,
  findings: readonly HealthAnalyticsFindingInput[],
) {
  return extractPerformanceSummary(
    rawPerf,
    findings.map(f => ({
      ruleId: f.ruleId,
      category: f.category,
      title: f.title,
      severity: f.severity,
      confidence: f.confidence ?? undefined,
      evidence: f.evidence ?? null,
    })),
  );
}

export function evaluateExecutedCheckEligibility(input: HealthAnalyticsInput): EligibilityResult {
  const summary = input.summary ?? {};
  const findings = input.findings ?? [];

  const targetSiteFindingsCount = findings.filter(f => !isSystemMetaFinding(f)).length;
  const hasSysBrowserUnavailable = findings.some(
    f => (f.ruleId ?? '').trim().toUpperCase() === 'SYS_BROWSER_UNAVAILABLE',
  );

  const rawPerf =
    summary.performanceMetrics && typeof summary.performanceMetrics === 'object'
      ? (summary.performanceMetrics as Record<string, unknown>)
      : null;
  const perfSummary = extractPerfForHealth(rawPerf, findings);
  const hasPerfPages = Array.isArray(rawPerf?.pages) && rawPerf.pages.length > 0;
  const hasPerfResourcesObj =
    (rawPerf?.resources !== null && rawPerf?.resources !== undefined) ||
    (rawPerf?.resourceSummary !== null && rawPerf?.resourceSummary !== undefined);
  const hasPerfTelemetry =
    perfSummary?.hasMeasuredVitals === true || hasPerfPages || hasPerfResourcesObj;

  const runtimeCompleted = summary.runtimeAuditsCompleted;
  const browserPagesAudited = isValidCount(summary.browserPagesAudited)
    ? summary.browserPagesAudited
    : 0;

  const hasBrowserSubCheckEvidence =
    (isValidCount(runtimeCompleted) && runtimeCompleted > 0) ||
    (isValidCount(summary.accessibilityAuditsCompleted) &&
      summary.accessibilityAuditsCompleted > 0) ||
    (isValidCount(summary.layoutStabilityPagesCompleted) &&
      summary.layoutStabilityPagesCompleted > 0) ||
    (isValidCount(summary.viewportsCompleted) && summary.viewportsCompleted > 0) ||
    (isValidCount(summary.screenshotsCaptured) && summary.screenshotsCaptured > 0) ||
    hasPerfTelemetry ||
    (runtimeCompleted === undefined && !hasSysBrowserUnavailable && browserPagesAudited > 0);

  const hasEligibleExecutedChecks =
    (isValidCount(summary.pagesScanned) && summary.pagesScanned > 0) ||
    (isValidCount(summary.staticPagesAnalyzed) && summary.staticPagesAnalyzed > 0) ||
    (isValidCount(summary.staticModulesExecuted) && summary.staticModulesExecuted > 0) ||
    (browserPagesAudited > 0 && hasBrowserSubCheckEvidence) ||
    targetSiteFindingsCount > 0 ||
    perfSummary?.hasMeasuredVitals === true;

  return {
    hasEligibleExecutedChecks,
    targetSiteFindingsCount,
    hasSysBrowserUnavailable,
    hasPerfTelemetry,
    hasBrowserSubCheckEvidence,
  };
}

export interface HealthIndexBreakdown {
  readonly healthIndex: number | null;
  readonly hasEligibleExecutedChecks: boolean;
  readonly confirmedDeductionPoints: number;
  readonly provisionalDeductionPoints: number;
  readonly fallbackLabPenaltyPoints: number;
  readonly totalDeductionPoints: number;
  readonly categoryPenalties: Readonly<Record<FindingCategoryId, number>>;
  readonly excludedFindingsCount: number;
  readonly systemMetaFindingsCount: number;
  readonly activeTargetGroupsCount: number;
  readonly hasActiveConfirmedCriticalFinding: boolean;
}

const SEVERITY_WEIGHTS: Readonly<Record<'critical' | 'high' | 'medium' | 'low' | 'info', number>> =
  Object.freeze({
    critical: 18,
    high: 10,
    medium: 5,
    low: 2,
    info: 0,
  });

function toConsolidatedInputFinding(f: HealthAnalyticsFindingInput, index: number): FindingDTO {
  const sev = normalizeSeverity(f.severity);
  const normStatus = (f.status ?? '').trim().toLowerCase();
  const normConf = (f.confidence ?? '').trim().toLowerCase();

  return {
    id: f.id ?? `finding-${index}`,
    scanRunId: f.scanRunId ?? '00000000-0000-0000-0000-000000000000',
    ruleId: f.ruleId,
    category: normalizeFindingCategoryId({ category: f.category, ruleId: f.ruleId }),
    title: f.title ?? f.ruleId,
    description: f.description ?? '',
    severity: sev,
    confidence: (KNOWN_CONFIDENCES.has(normConf) ? normConf : 'potential') as FindingConfidence,
    status: (normStatus || 'active') as FindingStatus,
    targetUrl: f.targetUrl || 'about:blank',
    evidence: f.evidence ?? null,
    remediation: f.remediation ?? null,
    references: f.references ? [...f.references] : null,
    createdAt: f.createdAt ?? '',
  };
}

/**
 * Computes the deterministic, evidence-based Health Index (0..100, or null when ineligible).
 */
export function evaluateHealthIndex(
  input: HealthAnalyticsInput,
  eligibility?: EligibilityResult,
): HealthIndexBreakdown {
  const resolvedEligibility = eligibility ?? evaluateExecutedCheckEligibility(input);
  const summary = input.summary ?? {};
  const findings = input.findings ?? [];

  const categoryPenalties: Record<FindingCategoryId, number> = {
    accessibility: 0,
    'accessibility-best-practice': 0,
    security: 0,
    'runtime-network': 0,
    'responsive-design': 0,
    'layout-stability': 0,
    'technical-seo': 0,
    'static-performance': 0,
    'content-quality': 0,
    'dom-quality': 0,
    'content-structure': 0,
    wordpress: 0,
    system: 0,
  };

  let systemMetaFindingsCount = 0;
  let excludedFindingsCount = 0;
  const activeTargetFindings: FindingDTO[] = [];
  const activeWithOriginalMeta = new Map<
    string,
    {
      readonly rawStatus: string | null | undefined;
      readonly rawConfidence: string | null | undefined;
    }
  >();

  findings.forEach((f, idx) => {
    if (isSystemMetaFinding(f)) {
      systemMetaFindingsCount++;
      return;
    }
    const cls = resolveEffectiveFindingClassification(f.status, f.confidence);
    if (cls.classification === 'excluded_lifecycle') {
      excludedFindingsCount++;
      return;
    }
    const dto = toConsolidatedInputFinding(f, idx);
    activeTargetFindings.push(dto);
    activeWithOriginalMeta.set(dto.id, { rawStatus: f.status, rawConfidence: f.confidence });
  });

  const activeCriticalConfirmed = hasActiveConfirmedCriticalFinding(findings);

  if (!resolvedEligibility.hasEligibleExecutedChecks) {
    return {
      healthIndex: null,
      hasEligibleExecutedChecks: false,
      confirmedDeductionPoints: 0,
      provisionalDeductionPoints: 0,
      fallbackLabPenaltyPoints: 0,
      totalDeductionPoints: 0,
      categoryPenalties: Object.freeze(categoryPenalties),
      excludedFindingsCount,
      systemMetaFindingsCount,
      activeTargetGroupsCount: 0,
      hasActiveConfirmedCriticalFinding: activeCriticalConfirmed,
    };
  }

  const consolidated = consolidateFindings(activeTargetFindings);
  const distinctTargetUrlsInFindings = new Set(
    activeTargetFindings.map(f => f.targetUrl).filter(Boolean),
  ).size;
  const pagesScannedVal = isValidCount(summary.pagesScanned) ? summary.pagesScanned : 0;
  const urlsCrawledVal = isValidCount(summary.urlsCrawled) ? summary.urlsCrawled : 0;
  const totalPagesBasis = Math.max(
    1,
    pagesScannedVal,
    urlsCrawledVal,
    distinctTargetUrlsInFindings,
  );

  const categoryConfirmedCritical = new Set<FindingCategoryId>();
  const rawCategorySums: Record<FindingCategoryId, number> = { ...categoryPenalties };

  let confirmedDeductionPoints = 0;
  let provisionalDeductionPoints = 0;

  for (const group of consolidated) {
    const catId = normalizeFindingCategoryId({ category: group.category, ruleId: group.ruleId });
    if (catId === 'system') continue;

    const sev = normalizeSeverity(group.severity);
    const baseWeight = SEVERITY_WEIGHTS[sev];
    const ruleCap = baseWeight * 1.5;

    const p = Math.max(1, group.affectedUrls.length);
    const mPages =
      p <= 1 ? 1 : 1 + 0.5 * Math.min(1, Math.log(p) / Math.log(Math.max(2, totalPagesBasis)));

    // Use original raw metadata from representative finding so invalid/missing confidence isn't masked
    const repId = group.originalFindingIds[0];
    const rawMeta = repId ? activeWithOriginalMeta.get(repId) : undefined;
    const resolvedClass = resolveEffectiveFindingClassification(
      rawMeta?.rawStatus ?? group.status,
      rawMeta?.rawConfidence ?? group.confidence,
    );

    if (resolvedClass.classification === 'confirmed_or_firm' && sev === 'critical') {
      categoryConfirmedCritical.add(catId);
    }

    const penalty = Math.min(ruleCap, baseWeight * mPages) * resolvedClass.multiplier;
    rawCategorySums[catId] += penalty;

    if (resolvedClass.classification === 'confirmed_or_firm') {
      confirmedDeductionPoints += penalty;
    } else if (resolvedClass.classification === 'provisional') {
      provisionalDeductionPoints += penalty;
    }
  }

  // Fallback Measured Lab Vitals Penalty (anti-double-counting with PERF_LAB_* findings)
  const rawPerf =
    summary.performanceMetrics && typeof summary.performanceMetrics === 'object'
      ? (summary.performanceMetrics as Record<string, unknown>)
      : null;
  const perfSummary = extractPerfForHealth(rawPerf, findings);
  let fallbackLabPenaltyPoints = 0;

  if (perfSummary?.hasMeasuredVitals) {
    const activeRuleIds = new Set(activeTargetFindings.map(f => f.ruleId.toUpperCase()));
    const vitalChecks: Array<{
      readonly metric: 'ttfb' | 'fcp' | 'lcp' | 'tbt';
      readonly value: number | null;
      readonly ruleId: string;
    }> = [
      { metric: 'ttfb', value: perfSummary.ttfb.value, ruleId: 'PERF_LAB_SLOW_TTFB' },
      { metric: 'fcp', value: perfSummary.fcp.value, ruleId: 'PERF_LAB_SLOW_FCP' },
      { metric: 'lcp', value: perfSummary.lcp.value, ruleId: 'PERF_LAB_SLOW_LCP' },
      { metric: 'tbt', value: perfSummary.tbt.value, ruleId: 'PERF_LAB_HIGH_TBT' },
    ];

    for (const check of vitalChecks) {
      if (activeRuleIds.has(check.ruleId)) continue;
      const rating = rateWebVitalMetric(check.metric, check.value);
      if (rating === 'needs_improvement') {
        fallbackLabPenaltyPoints += 2;
        rawCategorySums['static-performance'] += 2;
        confirmedDeductionPoints += 2;
      } else if (rating === 'poor') {
        fallbackLabPenaltyPoints += 5;
        rawCategorySums['static-performance'] += 5;
        confirmedDeductionPoints += 5;
      }
    }
  }

  let totalDeductionPoints = 0;
  for (const catId of FINDING_CATEGORIES) {
    if (catId === 'system') continue;
    const cap = categoryConfirmedCritical.has(catId) ? 60 : 40;
    const capped = Math.min(cap, rawCategorySums[catId]);
    categoryPenalties[catId] = Number(capped.toFixed(4));
    totalDeductionPoints += capped;
  }

  const healthIndex = Math.max(0, Math.round(100 - totalDeductionPoints));

  return {
    healthIndex,
    hasEligibleExecutedChecks: true,
    confirmedDeductionPoints: Number(confirmedDeductionPoints.toFixed(4)),
    provisionalDeductionPoints: Number(provisionalDeductionPoints.toFixed(4)),
    fallbackLabPenaltyPoints,
    totalDeductionPoints: Number(totalDeductionPoints.toFixed(4)),
    categoryPenalties: Object.freeze(categoryPenalties),
    excludedFindingsCount,
    systemMetaFindingsCount,
    activeTargetGroupsCount: consolidated.length,
    hasActiveConfirmedCriticalFinding: activeCriticalConfirmed,
  };
}

// ============================================================================
// D2–D4 & Audit Coverage
// ============================================================================

export interface DimensionCoverageDetail {
  readonly dimension: 'd1' | 'd2' | 'd3' | 'd4';
  readonly label: string;
  readonly weight: number;
  readonly status: DimensionStatus;
  readonly ratio: number;
  readonly percent: number;
  readonly reasonCodes: readonly string[];
  readonly modules?: Readonly<
    Record<string, { readonly status: DimensionStatus; readonly ratio: number }>
  >;
}

export interface AuditCoverageResult {
  readonly auditCoverage: number;
  readonly coverageApproximated: boolean;
  readonly coverageApproximationReasons: readonly string[];
  readonly d1Status: DimensionStatus;
  readonly d2Status: DimensionStatus;
  readonly d3Status: DimensionStatus;
  readonly d4Status: DimensionStatus;
  readonly dimensions: readonly [
    DimensionCoverageDetail,
    DimensionCoverageDetail,
    DimensionCoverageDetail,
    DimensionCoverageDetail,
  ];
  readonly applicableWeightSum: number;
  readonly isPartialCoverage: boolean;
  readonly coverageStatus: 'full' | 'partial';
  readonly applicableD4Modules: readonly string[];
}

const STATIC_FINDING_PREFIXES = [
  'WP_',
  'WP-',
  'SEC_',
  'SEC-',
  'COOKIE_',
  'COOKIE-',
  'SEO_',
  'SEO-',
  'CONTENT_',
  'QC_',
  'QC-',
] as const;

const STATIC_PERF_RULE_IDS = new Set<string>([
  'PERF_SLOW_SERVER_RESPONSE',
  'PERF_LARGE_HTML_DOCUMENT',
  'PERF_EXCESSIVE_SCRIPTS',
  'PERF_EXCESSIVE_STYLESHEETS',
  'PERF_IMG_DIMENSIONS_MISSING',
]);

function isStaticTargetFinding(f: { readonly ruleId?: string | null }): boolean {
  const rule = (f.ruleId ?? '').trim().toUpperCase();
  if (STATIC_PERF_RULE_IDS.has(rule)) return true;
  return STATIC_FINDING_PREFIXES.some(prefix => rule.startsWith(prefix));
}

function isAccessibilityFinding(f: {
  readonly ruleId?: string | null;
  readonly category?: string | null;
}): boolean {
  const rule = (f.ruleId ?? '').trim().toUpperCase();
  if (rule.startsWith('A11Y_') || rule.startsWith('A11Y-')) return true;
  const cat = normalizeFindingCategoryId({ category: f.category, ruleId: f.ruleId });
  return cat === 'accessibility' || cat === 'accessibility-best-practice';
}

function isLayoutShiftFinding(f: { readonly ruleId?: string | null }): boolean {
  const rule = (f.ruleId ?? '').trim().toUpperCase();
  return (
    rule.startsWith('LAYOUT_SHIFT_') ||
    rule.startsWith('LAYOUT_STABILITY_') ||
    rule === 'PERF_LAB_HIGH_CLS'
  );
}

function readModulesConfig(config: Record<string, unknown> | null | undefined): {
  readonly rawPresent: boolean;
  readonly modules: Record<string, boolean>;
} {
  const raw = config?.auditModules;
  const rawObj =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

  const getFlag = (key: string): boolean => {
    if (!rawObj) return true;
    return rawObj[key] !== false;
  };

  return {
    rawPresent: rawObj !== null,
    modules: {
      http: getFlag('http'),
      wordpress: getFlag('wordpress'),
      securityHeaders: getFlag('securityHeaders'),
      cookies: getFlag('cookies'),
      seo: getFlag('seo'),
      runtimeErrors: getFlag('runtimeErrors'),
      networkResources: getFlag('networkResources'),
      responsiveLayout: getFlag('responsiveLayout'),
      layoutStability: getFlag('layoutStability'),
      screenshots: getFlag('screenshots'),
      accessibility: getFlag('accessibility'),
    },
  };
}

/**
 * Evaluates D1–D4 coverage dimensions independently without double-counting browser failures,
 * ensuring every ratio passed downstream is finite and bounded in [0, 1].
 */
export function evaluateAuditCoverage(
  input: HealthAnalyticsInput,
  eligibility?: EligibilityResult,
): AuditCoverageResult {
  const resolvedEligibility = eligibility ?? evaluateExecutedCheckEligibility(input);
  const summary = input.summary ?? {};
  const config = input.config ?? {};
  const findings = input.findings ?? [];
  const scanType = (input.scanType ?? 'full').trim().toLowerCase();
  const scanStatus = (input.scanStatus ?? 'completed').trim().toLowerCase();
  const completedEngines = resolveCompletedEngines(input);
  const { rawPresent: hasExplicitAuditModules, modules } = readModulesConfig(config);
  const enableBrowserAudit = Boolean(config.enableBrowserAudit);

  const reasons: string[] = [];
  const pushReason = (code: string) => {
    if (!reasons.includes(code)) reasons.push(code);
  };
  let coverageApproximated = false;

  // ---------------- D1 (w = 20, Always Applicable) ----------------
  const d1 = evaluateD1CrawlCoverage({
    summary,
    errorDetails: input.errorDetails,
    config,
    scanStatus,
    completedEngines,
    findings,
  });
  if (d1.coverageApproximated) {
    coverageApproximated = true;
    for (const r of d1.reasonCodes) pushReason(r);
  }
  const r1 = clamp01(d1.ratio);

  // ---------------- D2 (w = 30, Static Analyzers) ----------------
  const staticTargetFindingsCount = findings.filter(f => isStaticTargetFinding(f)).length;
  const staticModulesAnyEnabled =
    modules.http || modules.wordpress || modules.securityHeaders || modules.cookies || modules.seo;
  const isSpecializedBrowserOnlyType = scanType === 'accessibility' || scanType === 'performance';
  const d2Applicable = isSpecializedBrowserOnlyType
    ? (hasExplicitAuditModules && staticModulesAnyEnabled) ||
      (isValidCount(summary.staticModulesExecuted) && summary.staticModulesExecuted > 0) ||
      staticTargetFindingsCount > 0
    : staticModulesAnyEnabled;

  let d2Status: DimensionStatus = 'not_applicable';
  let r2 = 0;
  const d2Reasons: string[] = [];

  if (d2Applicable) {
    const staticCoverageStatus =
      typeof summary.staticCoverageStatus === 'string' ? summary.staticCoverageStatus : undefined;
    const pagesScannedValid = isValidCount(summary.pagesScanned) ? summary.pagesScanned : 0;
    const staticExecValid = isValidCount(summary.staticModulesExecuted)
      ? summary.staticModulesExecuted
      : 0;

    if (
      staticCoverageStatus === 'none' &&
      staticExecValid === 0 &&
      staticTargetFindingsCount === 0 &&
      pagesScannedValid === 0
    ) {
      d2Status = 'unavailable';
      r2 = 0;
    } else if (
      isValidCount(summary.staticModulesExecuted) &&
      isValidCount(summary.staticModulesTotal) &&
      summary.staticModulesTotal > 0
    ) {
      d2Status = 'exact';
      r2 = clamp01(summary.staticModulesExecuted / summary.staticModulesTotal);
    } else if (
      completedEngines?.includes('analyzers') &&
      staticCoverageStatus === 'full' &&
      (pagesScannedValid > 0 || staticTargetFindingsCount > 0)
    ) {
      d2Status = 'exact';
      r2 = 1;
    } else if (
      completedEngines?.includes('analyzers') &&
      (staticCoverageStatus === 'partial' || pagesScannedValid > 0 || staticTargetFindingsCount > 0)
    ) {
      d2Status = 'approximated';
      r2 = 0.5;
      coverageApproximated = true;
      d2Reasons.push('d2_historical_partial_static_approximated');
      pushReason('d2_historical_partial_static_approximated');
    } else {
      d2Status = 'unavailable';
      r2 = 0;
    }
  }

  // ---------------- D3 (w = 25, Runtime & Accessibility) ----------------
  const runtimeApplicable = enableBrowserAudit && modules.runtimeErrors;
  const a11yApplicable =
    (enableBrowserAudit && modules.accessibility) ||
    (scanType === 'accessibility' && modules.accessibility);

  const d3ModulesList: Array<'runtimeErrors' | 'accessibility'> = [];
  if (runtimeApplicable) d3ModulesList.push('runtimeErrors');
  if (a11yApplicable) d3ModulesList.push('accessibility');

  let d3Status: DimensionStatus = 'not_applicable';
  let r3 = 0;
  const d3Reasons: string[] = [];
  const d3ModuleMap: Record<string, { readonly status: DimensionStatus; readonly ratio: number }> =
    {};

  const browserCandidatesTotal = isValidCount(summary.browserCandidatesTotal)
    ? summary.browserCandidatesTotal
    : 0;
  const pagesScannedCount = isValidCount(summary.pagesScanned) ? summary.pagesScanned : 0;
  const browserPagesAudited = isValidCount(summary.browserPagesAudited)
    ? summary.browserPagesAudited
    : 0;
  const expectedBrowserPages =
    browserCandidatesTotal > 0 ? browserCandidatesTotal : pagesScannedCount;
  const hasSysBrowserUnavailable = resolvedEligibility.hasSysBrowserUnavailable;

  if (d3ModulesList.length > 0) {
    let d3AnyApproximated = false;
    let d3AnyDenominator = false;
    let d3RatioSum = 0;

    if (runtimeApplicable) {
      let rRuntime: number;
      let statusRuntime: DimensionStatus;

      if (hasSysBrowserUnavailable || expectedBrowserPages === 0 || browserPagesAudited === 0) {
        rRuntime = 0;
        statusRuntime =
          hasSysBrowserUnavailable || expectedBrowserPages === 0 ? 'unavailable' : 'exact';
      } else if (isValidCount(summary.runtimeAuditsCompleted)) {
        d3AnyDenominator = true;
        rRuntime = clamp01(summary.runtimeAuditsCompleted / expectedBrowserPages);
        statusRuntime = 'exact';
      } else {
        d3AnyDenominator = true;
        d3AnyApproximated = true;
        coverageApproximated = true;
        rRuntime = clamp01(browserPagesAudited / expectedBrowserPages);
        statusRuntime = 'approximated';
        d3Reasons.push('d3_historical_runtime_from_browser_pages');
        pushReason('d3_historical_runtime_from_browser_pages');
      }

      d3ModuleMap.runtimeErrors = { status: statusRuntime, ratio: rRuntime };
      d3RatioSum += rRuntime;
    }

    if (a11yApplicable) {
      let rA11y: number;
      let statusA11y: DimensionStatus;
      let expectedA11yPages = 0;
      let candidateApproximated = false;

      const hasA11yFindings = findings.some(f => isAccessibilityFinding(f));

      if (isValidCount(summary.accessibilityCandidatesTotal)) {
        expectedA11yPages = summary.accessibilityCandidatesTotal;
      } else if (browserCandidatesTotal > 0) {
        expectedA11yPages = browserCandidatesTotal;
        candidateApproximated = true;
        d3Reasons.push('d3_historical_a11y_candidates_from_browser_candidates');
        pushReason('d3_historical_a11y_candidates_from_browser_candidates');
      } else if (
        pagesScannedCount > 0 &&
        (enableBrowserAudit ||
          Boolean(completedEngines?.includes('browser')) ||
          isValidCount(summary.accessibilityAuditsCompleted) ||
          hasA11yFindings)
      ) {
        expectedA11yPages = pagesScannedCount;
        candidateApproximated = true;
        d3Reasons.push('d3_historical_a11y_candidates_from_pages_scanned');
        pushReason('d3_historical_a11y_candidates_from_pages_scanned');
      }

      if (hasSysBrowserUnavailable || expectedA11yPages === 0) {
        rA11y = 0;
        statusA11y = 'unavailable';
      } else if (isValidCount(summary.accessibilityAuditsCompleted)) {
        d3AnyDenominator = true;
        rA11y = clamp01(summary.accessibilityAuditsCompleted / expectedA11yPages);
        if (candidateApproximated) {
          d3AnyApproximated = true;
          coverageApproximated = true;
          statusA11y = 'approximated';
        } else {
          statusA11y = 'exact';
        }
      } else if (browserPagesAudited > 0 && hasA11yFindings) {
        d3AnyDenominator = true;
        d3AnyApproximated = true;
        coverageApproximated = true;
        rA11y = clamp01(browserPagesAudited / expectedA11yPages);
        statusA11y = 'approximated';
        d3Reasons.push('d3_historical_missing_a11y_completed_count');
        pushReason('d3_historical_missing_a11y_completed_count');
      } else {
        rA11y = 0;
        statusA11y = 'unavailable';
      }

      d3ModuleMap.accessibility = { status: statusA11y, ratio: rA11y };
      d3RatioSum += rA11y;
    } else {
      d3ModuleMap.accessibility = { status: 'not_applicable', ratio: 0 };
    }

    if (!runtimeApplicable) {
      d3ModuleMap.runtimeErrors = { status: 'not_applicable', ratio: 0 };
    }

    r3 = clamp01(d3RatioSum / d3ModulesList.length);
    if (hasSysBrowserUnavailable || (!d3AnyDenominator && r3 === 0)) {
      d3Status = 'unavailable';
    } else if (d3AnyApproximated) {
      d3Status = 'approximated';
    } else {
      d3Status = 'exact';
    }
  }

  // ---------------- D4 (w = 25, Lab Perf, Responsive & Visual) ----------------
  const d4ModulesList: Array<
    'networkResources' | 'responsiveLayout' | 'layoutStability' | 'screenshots'
  > = [];
  if (
    (enableBrowserAudit && modules.networkResources) ||
    (scanType === 'performance' && modules.networkResources)
  ) {
    d4ModulesList.push('networkResources');
  }
  if (enableBrowserAudit && modules.responsiveLayout) {
    d4ModulesList.push('responsiveLayout');
  }
  if (
    (enableBrowserAudit && modules.layoutStability) ||
    (scanType === 'performance' && modules.layoutStability)
  ) {
    d4ModulesList.push('layoutStability');
  }
  if (enableBrowserAudit && config.captureScreenshots !== false && modules.screenshots) {
    d4ModulesList.push('screenshots');
  }

  let d4Status: DimensionStatus = 'not_applicable';
  let r4 = 0;
  const d4Reasons: string[] = [];
  const d4ModuleMap: Record<string, { readonly status: DimensionStatus; readonly ratio: number }> =
    {};

  if (d4ModulesList.length > 0) {
    let d4AnyApproximated = false;
    let d4RatioSum = 0;

    const rawPerf =
      summary.performanceMetrics && typeof summary.performanceMetrics === 'object'
        ? (summary.performanceMetrics as Record<string, unknown>)
        : null;
    const perfPages = Array.isArray(rawPerf?.pages) ? rawPerf.pages : null;
    const perfSummary = extractPerfForHealth(rawPerf, findings);

    for (const mod of d4ModulesList) {
      let modRatio = 0;
      let modStatus: DimensionStatus = 'exact';

      if (mod === 'networkResources') {
        if (hasSysBrowserUnavailable || browserPagesAudited === 0 || expectedBrowserPages === 0) {
          modRatio = 0;
          modStatus =
            hasSysBrowserUnavailable || expectedBrowserPages === 0 ? 'unavailable' : 'exact';
        } else if (perfPages) {
          const measuredPagesCount = perfPages.filter(p => {
            if (!p || typeof p !== 'object') return false;
            const rec = p as Record<string, unknown>;
            return rec.labMetrics != null || rec.resourceSummary != null;
          }).length;
          modRatio = clamp01(measuredPagesCount / expectedBrowserPages);
          modStatus = 'exact';
        } else if (perfSummary?.hasMeasuredVitals || perfSummary?.resources != null) {
          modRatio = clamp01(browserPagesAudited / expectedBrowserPages);
          modStatus = 'approximated';
          d4AnyApproximated = true;
          coverageApproximated = true;
          d4Reasons.push('d4_historical_network_from_summary');
          pushReason('d4_historical_network_from_summary');
        } else {
          modRatio = 0;
          modStatus = 'unavailable';
        }
      } else if (mod === 'responsiveLayout') {
        const viewportsCompleted = isValidCount(summary.viewportsCompleted)
          ? summary.viewportsCompleted
          : 0;
        if (
          hasSysBrowserUnavailable ||
          browserPagesAudited === 0 ||
          expectedBrowserPages === 0 ||
          viewportsCompleted === 0
        ) {
          modRatio = 0;
          modStatus =
            hasSysBrowserUnavailable || expectedBrowserPages === 0 ? 'unavailable' : 'exact';
        } else {
          const configuredProfiles = Array.isArray(config.viewportProfiles)
            ? config.viewportProfiles.filter(p => typeof p === 'string' && p.trim().length > 0)
            : [];
          const hasExplicitProfiles = configuredProfiles.length > 0;
          const activeProfileCount = hasExplicitProfiles ? configuredProfiles.length : 8;
          modRatio = clamp01(viewportsCompleted / (expectedBrowserPages * activeProfileCount));
          if (!hasExplicitProfiles && modRatio < 1) {
            modStatus = 'approximated';
            d4AnyApproximated = true;
            coverageApproximated = true;
            d4Reasons.push('d4_responsive_default_viewport_count_assumed');
            pushReason('d4_responsive_default_viewport_count_assumed');
          } else {
            modStatus = 'exact';
          }
        }
      } else if (mod === 'layoutStability') {
        if (hasSysBrowserUnavailable || browserPagesAudited === 0 || expectedBrowserPages === 0) {
          modRatio = 0;
          modStatus =
            hasSysBrowserUnavailable || expectedBrowserPages === 0 ? 'unavailable' : 'exact';
        } else if (isValidCount(summary.layoutStabilityPagesCompleted)) {
          modRatio = clamp01(summary.layoutStabilityPagesCompleted / expectedBrowserPages);
          modStatus = 'exact';
        } else if (perfPages) {
          const clsPagesCount = perfPages.filter(p => {
            if (!p || typeof p !== 'object') return false;
            const lm = (p as Record<string, unknown>).labMetrics as
              Record<string, unknown> | null | undefined;
            return typeof lm?.cls === 'number' && Number.isFinite(lm.cls);
          }).length;
          modRatio = clamp01(clsPagesCount / expectedBrowserPages);
          modStatus = 'exact';
        } else if (
          typeof (rawPerf?.labMetrics as Record<string, unknown> | null | undefined)?.cls ===
            'number' &&
          Number.isFinite((rawPerf?.labMetrics as Record<string, unknown>).cls)
        ) {
          modRatio = clamp01(browserPagesAudited / expectedBrowserPages);
          modStatus = 'approximated';
          d4AnyApproximated = true;
          coverageApproximated = true;
          d4Reasons.push('d4_historical_cls_from_summary');
          pushReason('d4_historical_cls_from_summary');
        } else {
          const clsFindingUrls = new Set(
            findings
              .filter(f => isLayoutShiftFinding(f))
              .map(f => f.targetUrl)
              .filter(Boolean),
          );
          if (clsFindingUrls.size > 0) {
            modRatio = clamp01(clsFindingUrls.size / expectedBrowserPages);
            modStatus = 'approximated';
            d4AnyApproximated = true;
            coverageApproximated = true;
            d4Reasons.push('d4_historical_cls_from_findings');
            pushReason('d4_historical_cls_from_findings');
          } else {
            // Strictly never inferred from viewportsCompleted or screenshotsCaptured
            modRatio = 0;
            modStatus = 'unavailable';
          }
        }
      } else if (mod === 'screenshots') {
        const screenshotsCaptured = isValidCount(summary.screenshotsCaptured)
          ? summary.screenshotsCaptured
          : 0;
        if (hasSysBrowserUnavailable || browserPagesAudited === 0 || expectedBrowserPages === 0) {
          modRatio = 0;
          modStatus =
            hasSysBrowserUnavailable || expectedBrowserPages === 0 ? 'unavailable' : 'exact';
        } else if (Array.isArray(summary.pageScreenshots)) {
          const validUrls = new Set<string>();
          for (const rec of summary.pageScreenshots) {
            if (!rec || typeof rec !== 'object') continue;
            const item = rec as Record<string, unknown>;
            const pageUrl = typeof item.pageUrl === 'string' ? item.pageUrl.trim() : '';
            const st = typeof item.status === 'string' ? item.status : undefined;
            if (
              pageUrl &&
              st !== 'missing' &&
              st !== 'rejected' &&
              st !== 'unavailable' &&
              st !== 'failed'
            ) {
              validUrls.add(pageUrl);
            }
          }
          modRatio = clamp01(validUrls.size / expectedBrowserPages);
          modStatus = 'exact';
        } else if (screenshotsCaptured === 0) {
          modRatio = 0;
          modStatus = 'exact';
        } else {
          modRatio = clamp01(screenshotsCaptured / expectedBrowserPages);
          modStatus = 'approximated';
          d4AnyApproximated = true;
          coverageApproximated = true;
          d4Reasons.push('d4_historical_screenshots_count');
          pushReason('d4_historical_screenshots_count');
        }
      }

      d4ModuleMap[mod] = { status: modStatus, ratio: modRatio };
      d4RatioSum += modRatio;
    }

    r4 = clamp01(d4RatioSum / d4ModulesList.length);
    if (hasSysBrowserUnavailable || expectedBrowserPages === 0) {
      d4Status = 'unavailable';
    } else if (d4AnyApproximated) {
      d4Status = 'approximated';
    } else {
      d4Status = 'exact';
    }
  }

  // ---------------- Combined Audit Coverage ----------------
  const dimensions: [
    DimensionCoverageDetail,
    DimensionCoverageDetail,
    DimensionCoverageDetail,
    DimensionCoverageDetail,
  ] = [
    {
      dimension: 'd1',
      label: 'Crawl & Reachability',
      weight: 20,
      status: d1.status,
      ratio: r1,
      percent: Math.round(r1 * 100),
      reasonCodes: d1.reasonCodes,
    },
    {
      dimension: 'd2',
      label: 'Static Analyzers',
      weight: 30,
      status: d2Status,
      ratio: r2,
      percent: Math.round(r2 * 100),
      reasonCodes: d2Reasons,
    },
    {
      dimension: 'd3',
      label: 'Browser Runtime & Accessibility',
      weight: 25,
      status: d3Status,
      ratio: r3,
      percent: Math.round(r3 * 100),
      reasonCodes: d3Reasons,
      modules: Object.keys(d3ModuleMap).length > 0 ? d3ModuleMap : undefined,
    },
    {
      dimension: 'd4',
      label: 'Lab Performance, Responsive & Visual',
      weight: 25,
      status: d4Status,
      ratio: r4,
      percent: Math.round(r4 * 100),
      reasonCodes: d4Reasons,
      modules: Object.keys(d4ModuleMap).length > 0 ? d4ModuleMap : undefined,
    },
  ];

  let applicableWeightSum = 0;
  let weightedSum = 0;
  for (const dim of dimensions) {
    if (dim.status !== 'not_applicable') {
      applicableWeightSum += dim.weight;
      weightedSum += dim.weight * dim.ratio;
    }
  }

  const auditCoverage =
    !resolvedEligibility.hasEligibleExecutedChecks || applicableWeightSum === 0
      ? 0
      : clamp(0, 100, Math.round((100 * weightedSum) / applicableWeightSum));

  const isPartialAudit = scanStatus !== 'completed';
  const browserCandidatesSkipped = isValidCount(summary.browserCandidatesSkipped)
    ? summary.browserCandidatesSkipped
    : 0;
  const crawlFailedCount = isValidCount(summary.crawlFailedPages) ? summary.crawlFailedPages : 0;
  const browserFailedCount = isValidCount(summary.browserFailedPages)
    ? summary.browserFailedPages
    : 0;
  const legacyFailedCount = isValidCount(summary.pagesFailed) ? summary.pagesFailed : 0;

  const isPartialCoverage =
    isPartialAudit ||
    summary.isPartialCoverage === true ||
    summary.coverageStatus === 'partial' ||
    browserCandidatesSkipped > 0 ||
    (enableBrowserAudit &&
      browserCandidatesTotal > 0 &&
      browserPagesAudited < browserCandidatesTotal) ||
    (enableBrowserAudit && pagesScannedCount > 0 && browserPagesAudited < pagesScannedCount) ||
    crawlFailedCount > 0 ||
    browserFailedCount > 0 ||
    legacyFailedCount > 0 ||
    hasSysBrowserUnavailable ||
    (applicableWeightSum > 0 && auditCoverage < 100);

  return {
    auditCoverage,
    coverageApproximated,
    coverageApproximationReasons: reasons,
    d1Status: d1.status,
    d2Status,
    d3Status,
    d4Status,
    dimensions,
    applicableWeightSum,
    isPartialCoverage,
    coverageStatus: isPartialCoverage ? 'partial' : 'full',
    applicableD4Modules: d4ModulesList,
  };
}

// ============================================================================
// Audit Confidence (0..100, Non-Negative Deductions)
// ============================================================================

export interface AuditConfidenceDeductions {
  readonly coverageDeduction: number;
  readonly interruptionDeduction: number;
  readonly browserDegradationDeduction: number;
  readonly labCompletenessDeduction: number;
  readonly provisionalUncertaintyDeduction: number;
}

export interface AuditConfidenceResult {
  readonly auditConfidence: number;
  readonly confidenceBand: ConfidenceBandId;
  readonly deductions: AuditConfidenceDeductions;
}

export function evaluateAuditConfidence(
  input: HealthAnalyticsInput,
  coverage: AuditCoverageResult,
  eligibility: EligibilityResult,
): AuditConfidenceResult {
  const summary = input.summary ?? {};
  const findings = input.findings ?? [];
  const scanStatus = (input.scanStatus ?? 'completed').trim().toLowerCase();
  const isPartialAudit = scanStatus !== 'completed';

  const coverageDeduction = clamp(0, 40, Math.round((100 - coverage.auditCoverage) * 0.4));
  const interruptionDeduction = isPartialAudit ? 20 : 0;
  const browserDegradationDeduction = eligibility.hasSysBrowserUnavailable ? 10 : 0;

  const rawPerf =
    summary.performanceMetrics && typeof summary.performanceMetrics === 'object'
      ? (summary.performanceMetrics as Record<string, unknown>)
      : null;
  const perfSummary = extractPerfForHealth(rawPerf, findings);
  const browserPagesAudited = isValidCount(summary.browserPagesAudited)
    ? summary.browserPagesAudited
    : 0;

  const isLcpCapped =
    perfSummary?.lcp.isCapped === true ||
    Boolean((rawPerf?.labMetrics as Record<string, unknown> | null | undefined)?.isLcpCapped);
  const resourceBufferLimitReached = Boolean(
    (rawPerf?.resourceSummary as Record<string, unknown> | null | undefined)
      ?.resourceBufferLimitReached ??
    (rawPerf?.resources as Record<string, unknown> | null | undefined)?.resourceBufferLimitReached,
  );
  const isNetworkResourcesApplicable = coverage.applicableD4Modules.includes('networkResources');
  const lcpMs = perfSummary?.lcp.value ?? null;

  const labCompletenessDeduction =
    browserPagesAudited > 0 &&
    (isLcpCapped || (isNetworkResourcesApplicable && lcpMs === null) || resourceBufferLimitReached)
      ? 5
      : 0;

  let activeNonInfoFindings = 0;
  let provisionalActiveFindings = 0;
  for (const f of findings) {
    if (isSystemMetaFinding(f)) continue;
    const sev = normalizeSeverity(f.severity);
    if (sev === 'info') continue;
    const cls = resolveEffectiveFindingClassification(f.status, f.confidence);
    if (cls.classification === 'excluded_lifecycle') continue;
    activeNonInfoFindings++;
    if (cls.classification === 'provisional') {
      provisionalActiveFindings++;
    }
  }

  const provisionalUncertaintyDeduction =
    activeNonInfoFindings > 0
      ? clamp(0, 20, Math.round((provisionalActiveFindings / activeNonInfoFindings) * 20))
      : 0;

  const auditConfidence = clamp(
    0,
    100,
    100 -
      coverageDeduction -
      interruptionDeduction -
      browserDegradationDeduction -
      labCompletenessDeduction -
      provisionalUncertaintyDeduction,
  );

  let confidenceBand: ConfidenceBandId;
  if (!eligibility.hasEligibleExecutedChecks || coverage.auditCoverage === 0) {
    confidenceBand = 'insufficient';
  } else if (
    isPartialAudit ||
    coverage.isPartialCoverage ||
    coverage.coverageStatus === 'partial'
  ) {
    if (auditConfidence >= 55) {
      confidenceBand = 'moderate';
    } else if (auditConfidence >= 25) {
      confidenceBand = 'low';
    } else {
      confidenceBand = 'insufficient';
    }
  } else if (auditConfidence >= 80) {
    confidenceBand = 'high';
  } else if (auditConfidence >= 55) {
    confidenceBand = 'moderate';
  } else if (auditConfidence >= 25) {
    confidenceBand = 'low';
  } else {
    confidenceBand = 'insufficient';
  }

  return {
    auditConfidence,
    confidenceBand,
    deductions: {
      coverageDeduction,
      interruptionDeduction,
      browserDegradationDeduction,
      labCompletenessDeduction,
      provisionalUncertaintyDeduction,
    },
  };
}

// ============================================================================
// Health Band Precedence Classification & Unified Triad
// ============================================================================

export interface HealthBandResult {
  readonly bandId: HealthBandId;
  readonly isProvisional: boolean;
  readonly labelEn: string;
  readonly labelAr: string;
}

export function classifyHealthBand(params: {
  readonly hasActiveConfirmedCriticalFinding: boolean;
  readonly hasEligibleExecutedChecks: boolean;
  readonly healthIndex: number | null;
  readonly auditCoverage: number;
  readonly auditConfidence: number;
  readonly isPartialAudit: boolean;
  readonly isPartialCoverage: boolean;
  readonly scanType?: string;
  readonly enableBrowserAudit?: boolean;
}): HealthBandResult {
  const {
    hasActiveConfirmedCriticalFinding: hasCritical,
    hasEligibleExecutedChecks,
    healthIndex,
    auditCoverage,
    auditConfidence,
    isPartialAudit,
    isPartialCoverage,
    scanType = 'full',
    enableBrowserAudit = false,
  } = params;

  const provisionalFlag =
    auditCoverage < 75 ||
    isPartialAudit ||
    isPartialCoverage ||
    auditConfidence < 60 ||
    auditCoverage === 0;

  let bandId: HealthBandId;
  let isProvisional: boolean;

  // Priority 1
  if (hasCritical || (hasEligibleExecutedChecks && healthIndex !== null && healthIndex < 40)) {
    bandId = 'action_required';
    isProvisional = provisionalFlag;
  }
  // Priority 2
  else if (!hasEligibleExecutedChecks || healthIndex === null) {
    bandId = 'insufficient_evidence';
    isProvisional = true;
  }
  // Priority 3
  else if (healthIndex < 65) {
    bandId = 'issues_detected';
    isProvisional = provisionalFlag;
  }
  // Priority 4
  else if (auditCoverage === 0) {
    bandId = 'insufficient_evidence';
    isProvisional = true;
  }
  // Priority 5
  else if (
    isPartialAudit ||
    isPartialCoverage ||
    auditCoverage < 75 ||
    auditConfidence < 60 ||
    (scanType.trim().toLowerCase() === 'full' && !enableBrowserAudit)
  ) {
    bandId = 'provisional_incomplete_scan';
    isProvisional = true;
  }
  // Priority 6a
  else if (healthIndex < 85) {
    bandId = 'needs_attention';
    isProvisional = false;
  }
  // Priority 6b
  else {
    bandId = 'healthy';
    isProvisional = false;
  }

  return {
    bandId,
    isProvisional,
    labelEn: HEALTH_BAND_LABELS[bandId].en,
    labelAr: HEALTH_BAND_LABELS[bandId].ar,
  };
}

export interface AuditHealthTriadResult {
  readonly disclaimer: string;
  readonly healthIndex: number | null;
  readonly healthBand: HealthBandResult;
  readonly healthBreakdown: HealthIndexBreakdown;
  readonly coverage: AuditCoverageResult;
  readonly confidence: AuditConfidenceResult;
}

/**
 * Single authoritative entry point computing the complete Health Triad:
 * Health Index, Audit Coverage (D1–D4), Audit Confidence, and Health Band classification.
 */
export function evaluateAuditHealthTriad(input: HealthAnalyticsInput): AuditHealthTriadResult {
  const eligibility = evaluateExecutedCheckEligibility(input);
  const healthBreakdown = evaluateHealthIndex(input, eligibility);
  const coverage = evaluateAuditCoverage(input, eligibility);
  const confidence = evaluateAuditConfidence(input, coverage, eligibility);

  const scanStatus = (input.scanStatus ?? 'completed').trim().toLowerCase();
  const isPartialAudit = scanStatus !== 'completed';
  const enableBrowserAudit = Boolean(input.config?.enableBrowserAudit);

  const healthBand = classifyHealthBand({
    hasActiveConfirmedCriticalFinding: healthBreakdown.hasActiveConfirmedCriticalFinding,
    hasEligibleExecutedChecks: eligibility.hasEligibleExecutedChecks,
    healthIndex: healthBreakdown.healthIndex,
    auditCoverage: coverage.auditCoverage,
    auditConfidence: confidence.auditConfidence,
    isPartialAudit,
    isPartialCoverage: coverage.isPartialCoverage,
    scanType: input.scanType ?? 'full',
    enableBrowserAudit,
  });

  return {
    disclaimer: HEALTH_INDEX_DISCLAIMER,
    healthIndex: healthBreakdown.healthIndex,
    healthBand,
    healthBreakdown,
    coverage,
    confidence,
  };
}
