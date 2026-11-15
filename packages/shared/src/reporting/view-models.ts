import type { ReportLocale, ReportViewMode } from '../schemas/report.js';
import type { ConsolidatedFindingDTO, FindingDTO } from '../schemas/finding.js';
import { normalizeFindingCategoryId } from '../schemas/categories.js';
import { buildAuditChartSuite, type AuditChartSuite } from './chart-specs.js';
import {
  matchAndEnrichFindings,
  redactSensitiveText,
  type EnrichableFindingInput,
  type EnrichedRecommendationItem,
  type ExactAffectedLocation,
  type PreservedOriginalFindingSnapshot,
} from './evidence-enrichment.js';
import {
  evaluateAuditHealthTriad,
  type AuditHealthTriadResult,
  type DimensionCoverageDetail,
  type HealthAnalyticsFindingInput,
  type HealthAnalyticsInput,
} from './health-metrics.js';
import type {
  CauseConfidenceLevel,
  CodeExampleTemplate,
  DualAudienceBilingualText,
  RecommendationReference,
  SupportedPlatformScope,
} from './recommendation-kb.js';
import type { DetectedStackDTO } from './stack-guidance.js';
import {
  CATEGORY_LABELS_I18N,
  CAUSE_CONFIDENCE_LABELS_I18N,
  CONFIDENCE_BAND_LABELS_I18N,
  DIMENSION_LABELS_I18N,
  DIMENSION_STATUS_LABELS_I18N,
  getLocaleDirection,
  HEALTH_BAND_LABELS_I18N,
  HEALTH_INDEX_DISCLAIMER_BILINGUAL,
  normalizeReportLocale,
  normalizeReportViewMode,
  REASON_CODE_LABELS_I18N,
  resolveBilingualText,
  SCAN_STATUS_LABELS_I18N,
  SEVERITY_LABELS_I18N,
  STATUS_LABELS_I18N,
  UI_LABELS,
  type BilingualText,
  type ReportDirection,
} from './translations.js';

export interface AudiencePresentationBlock {
  readonly viewMode: ReportViewMode;
  readonly primaryText: string;
  readonly simpleText?: string;
  readonly technicalText?: string;
}

export interface LocalizedStepViewModel {
  readonly stepNumber: number;
  readonly text: AudiencePresentationBlock;
}

export interface LocalizedPlatformGuidanceViewModel {
  readonly platform: SupportedPlatformScope;
  readonly evidenceReason: string;
  readonly summary: AudiencePresentationBlock;
  readonly steps: readonly string[];
}

export interface RecommendationViewModel {
  readonly recommendationId: string;
  readonly ruleId: string;
  readonly matchType: 'exact' | 'prefix' | 'fallback';
  readonly isFallback: boolean;
  readonly fallbackNotice: string | null;
  readonly category: string;
  readonly categoryLabel: string;
  readonly severity: string;
  readonly severityLabel: string;
  readonly originalConfidence: string;
  readonly originalStatus: string;
  readonly originalStatusLabel: string;
  readonly effectiveCauseConfidence: CauseConfidenceLevel;
  readonly causeConfidenceLabel: string;
  readonly occurrenceCount: number;
  readonly technicalTextDirection: 'ltr';
  readonly exactLocation: {
    readonly urls: readonly string[];
    readonly selectors: readonly string[];
    readonly assetUrls: readonly string[];
    readonly headerNames: readonly string[];
    readonly schemaTypes: readonly string[];
    readonly sourceLocations: readonly string[];
    readonly hasSpecificDomSelector: boolean;
    readonly fallbackNotice: string | null;
    readonly summaryText: string;
  };
  readonly problem: AudiencePresentationBlock;
  readonly impact: AudiencePresentationBlock;
  readonly confirmedCauses: readonly string[];
  readonly possibleCauses: readonly string[];
  readonly locationGuidance: AudiencePresentationBlock;
  readonly remediationSteps: readonly LocalizedStepViewModel[];
  readonly platformGuidance: readonly LocalizedPlatformGuidanceViewModel[];
  readonly codeExamples: readonly {
    readonly title: string;
    readonly language: string;
    readonly scopeDisclaimer: string;
    readonly snippet: string;
    readonly direction: 'ltr';
  }[];
  readonly verificationSteps: readonly LocalizedStepViewModel[];
  readonly limitations: readonly string[];
  readonly references: readonly RecommendationReference[];
  readonly technicalDetailsVisibility: 'collapsed' | 'expanded';
  readonly preservedOriginalFinding: PreservedOriginalFindingSnapshot;
}

export interface DimensionViewModel {
  readonly id: 'd1' | 'd2' | 'd3' | 'd4';
  readonly label: string;
  readonly status: DimensionCoverageDetail['status'];
  readonly statusLabel: string;
  readonly ratio: number;
  readonly percent: number;
  readonly approximated: boolean;
  readonly weight: number;
  readonly localizedReasons: readonly { readonly code: string; readonly label: string }[];
  readonly raw: DimensionCoverageDetail;
}

export interface ReportViewModel {
  readonly schemaVersion: '7.4.2';
  readonly locale: ReportLocale;
  readonly direction: ReportDirection;
  readonly technicalTextDirection: 'ltr';
  readonly viewMode: ReportViewMode;
  readonly title: string;
  readonly generatedAt: string;
  readonly labels: Readonly<Record<keyof typeof UI_LABELS, string>>;
  readonly site: {
    readonly id: string | null;
    readonly name: string;
    readonly baseUrl: string;
    readonly platformType: string;
    readonly environmentType: string;
  };
  readonly scanMeta: {
    readonly id: string | null;
    readonly scanType: string;
    readonly status: string;
    readonly statusLabel: string;
    readonly targetUrl: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly durationMs: number | null;
    readonly isPartialAudit: boolean;
    readonly isPartialCoverage: boolean;
  };
  readonly executiveSummary: {
    readonly totalRawFindings: number;
    readonly uniqueRecommendationsCount: number;
    readonly deduplicatedCount: number;
    readonly fallbackCount: number;
    readonly bySeverity: Readonly<Record<string, number>>;
    readonly byCategory: readonly {
      readonly category: string;
      readonly label: string;
      readonly count: number;
    }[];
    readonly confirmedCount: number;
    readonly firmCount: number;
    readonly potentialCount: number;
    readonly topPriorityRecommendations: readonly {
      readonly recommendationId: string;
      readonly ruleId: string;
      readonly severity: string;
      readonly severityLabel: string;
      readonly title: string;
      readonly affectedUrlsCount: number;
    }[];
  };
  readonly healthOverview: {
    readonly healthIndexScore: number | null;
    readonly healthBand: string;
    readonly healthBandLabel: string;
    readonly provisional: boolean;
    readonly coveragePercent: number;
    readonly coverageStatus: string;
    readonly coverageStatusLabel: string;
    readonly coverageApproximated: boolean;
    readonly confidenceScore: number;
    readonly confidenceBand: string;
    readonly confidenceBandLabel: string;
    readonly dimensions: readonly DimensionViewModel[];
    readonly telemetryReasons: readonly { readonly code: string; readonly label: string }[];
    readonly rawTriad: AuditHealthTriadResult;
  };
  readonly detectedStack: DetectedStackDTO;
  readonly charts: AuditChartSuite;
  readonly recommendations: readonly RecommendationViewModel[];
  readonly disclosures: {
    readonly readOnlyAuditNotice: string;
    readonly laboratoryContextNotice: string;
    readonly noComplianceCertificationNotice: string;
    readonly healthIndexDisclaimer: string;
  };
  readonly localizationMeta: {
    readonly fallbackTranslationCount: number;
  };
}

export interface ReportScanRunInput extends Record<string, unknown> {
  readonly id?: string | null;
  readonly scanType?: string | null;
  readonly status?: string | null;
  readonly targetUrl?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
  readonly durationMs?: number | null;
  readonly config?: Record<string, unknown> | null;
  readonly errorDetails?: Record<string, unknown> | null;
  readonly completedEngines?: readonly string[] | null;
  readonly isPartialAudit?: boolean | null;
  readonly isPartialCoverage?: boolean | null;
  readonly performanceMetrics?: Record<string, unknown> | null;
}

export interface BuildReportViewModelInput {
  readonly locale?: ReportLocale | string | null;
  readonly viewMode?: ReportViewMode | string | null;
  readonly title?: string | null;
  readonly generatedAt?: string | null;
  readonly site: {
    readonly id?: string | null;
    readonly name: string;
    readonly baseUrl: string;
    readonly platformType?: string | null;
    readonly environmentType?: string | null;
  };
  readonly scanRun: ReportScanRunInput;
  readonly findings: readonly (EnrichableFindingInput | FindingDTO | ConsolidatedFindingDTO)[];
  readonly precomputedHealthTriad?: AuditHealthTriadResult | null;
  readonly precomputedCharts?: AuditChartSuite | null;
}

class TranslationTracker {
  fallbackCount = 0;

  pick(
    text: Partial<BilingualText> | null | undefined,
    locale: ReportLocale,
    fallback = '',
  ): string {
    const res = resolveBilingualText(text, locale, fallback);
    if (res.usedFallback) {
      this.fallbackCount++;
    }
    return res.text;
  }

  pickFromDict(
    dict: Readonly<Record<string, BilingualText>>,
    key: string,
    locale: ReportLocale,
    fallback?: string,
  ): string {
    const entry = dict[key];
    if (!entry) {
      this.fallbackCount++;
      return fallback ?? key;
    }
    return this.pick(entry, locale, fallback ?? key);
  }
}

function toAudiencePresentation(
  dualText: DualAudienceBilingualText,
  locale: ReportLocale,
  viewMode: ReportViewMode,
  tracker: TranslationTracker,
): AudiencePresentationBlock {
  const simpleText = tracker.pick(dualText.simple, locale);
  const technicalText = tracker.pick(dualText.technical, locale);

  if (viewMode === 'simple') {
    return {
      viewMode,
      primaryText: simpleText,
      simpleText,
    };
  }
  if (viewMode === 'technical') {
    return {
      viewMode,
      primaryText: technicalText,
      technicalText,
    };
  }
  return {
    viewMode,
    primaryText: simpleText,
    simpleText,
    technicalText,
  };
}

function buildLocalizedExactLocation(
  loc: ExactAffectedLocation,
  locale: ReportLocale,
  tracker: TranslationTracker,
): RecommendationViewModel['exactLocation'] {
  return {
    urls: loc.urls,
    selectors: loc.selectors,
    assetUrls: loc.assetUrls,
    headerNames: loc.headerNames,
    schemaTypes: loc.schemaTypes,
    sourceLocations: loc.sourceLocations,
    hasSpecificDomSelector: loc.hasSpecificDomSelector,
    fallbackNotice: loc.fallbackNotice ? tracker.pick(loc.fallbackNotice, locale) : null,
    summaryText: tracker.pick(loc.summary, locale),
  };
}

function mapCodeExamples(
  examples: readonly CodeExampleTemplate[],
  locale: ReportLocale,
  tracker: TranslationTracker,
): RecommendationViewModel['codeExamples'] {
  return examples.map(ex => ({
    title: tracker.pick(ex.title, locale),
    language: ex.language,
    scopeDisclaimer: tracker.pick(ex.scopeDisclaimer, locale),
    snippet: redactSensitiveText(ex.snippet),
    direction: 'ltr' as const,
  }));
}

function mapEnrichedItemToViewModel(
  item: EnrichedRecommendationItem,
  locale: ReportLocale,
  viewMode: ReportViewMode,
  tracker: TranslationTracker,
): RecommendationViewModel {
  return {
    recommendationId: item.recommendationId,
    ruleId: item.ruleId,
    matchType: item.matchType,
    isFallback: item.isFallback,
    fallbackNotice: item.isFallback ? tracker.pick(UI_LABELS.fallbackNotice, locale) : null,
    category: item.category,
    categoryLabel: tracker.pickFromDict(CATEGORY_LABELS_I18N, item.category, locale, item.category),
    severity: item.severity,
    severityLabel: tracker.pickFromDict(SEVERITY_LABELS_I18N, item.severity, locale, item.severity),
    originalConfidence: item.originalConfidence,
    originalStatus: item.originalStatus,
    originalStatusLabel: tracker.pickFromDict(
      STATUS_LABELS_I18N,
      item.originalStatus,
      locale,
      item.originalStatus,
    ),
    effectiveCauseConfidence: item.effectiveCauseConfidence,
    causeConfidenceLabel: tracker.pickFromDict(
      CAUSE_CONFIDENCE_LABELS_I18N,
      item.effectiveCauseConfidence,
      locale,
      item.effectiveCauseConfidence,
    ),
    occurrenceCount: item.occurrenceCount,
    technicalTextDirection: 'ltr',
    exactLocation: buildLocalizedExactLocation(item.exactLocation, locale, tracker),
    problem: toAudiencePresentation(item.problem, locale, viewMode, tracker),
    impact: toAudiencePresentation(item.impact, locale, viewMode, tracker),
    confirmedCauses: item.confirmedCauses.map(c => tracker.pick(c, locale)),
    possibleCauses: item.possibleCauses.map(c => tracker.pick(c, locale)),
    locationGuidance: toAudiencePresentation(item.locationGuidance, locale, viewMode, tracker),
    remediationSteps: item.remediationSteps.map(s => ({
      stepNumber: s.stepNumber,
      text: toAudiencePresentation(
        { simple: s.simple, technical: s.technical },
        locale,
        viewMode,
        tracker,
      ),
    })),
    platformGuidance: item.platformGuidance.map(pg => ({
      platform: pg.platform,
      evidenceReason: tracker.pick(pg.evidenceReason, locale),
      summary: toAudiencePresentation(pg.summary, locale, viewMode, tracker),
      steps: pg.steps.map(st => tracker.pick(st, locale)),
    })),
    codeExamples: mapCodeExamples(item.codeExamples, locale, tracker),
    verificationSteps: item.verificationSteps.map(s => ({
      stepNumber: s.stepNumber,
      text: toAudiencePresentation(
        { simple: s.simple, technical: s.technical },
        locale,
        viewMode,
        tracker,
      ),
    })),
    limitations: item.limitations.map(lim => tracker.pick(lim, locale)),
    references: item.references,
    technicalDetailsVisibility: viewMode === 'simple' ? 'collapsed' : 'expanded',
    preservedOriginalFinding: item.preservedOriginalFinding,
  };
}

function translateReasonCode(
  code: string,
  locale: ReportLocale,
  tracker: TranslationTracker,
): { readonly code: string; readonly label: string } {
  const dictEntry = REASON_CODE_LABELS_I18N[code];
  if (dictEntry) {
    return { code, label: tracker.pick(dictEntry, locale) };
  }
  return { code, label: code };
}

function toHealthFindings(
  findings: readonly (EnrichableFindingInput | FindingDTO | ConsolidatedFindingDTO)[],
): HealthAnalyticsFindingInput[] {
  return findings.map((raw, idx) => {
    const f = raw as EnrichableFindingInput;
    const primaryUrl =
      f.targetUrl ?? (Array.isArray(f.affectedUrls) ? f.affectedUrls[0] : undefined) ?? 'unknown';
    return {
      id: f.id ?? `finding-${idx}`,
      ruleId: f.ruleId ?? 'UNKNOWN_RULE',
      category: f.category ?? 'system',
      severity: f.severity ?? 'info',
      confidence: f.confidence ?? 'potential',
      status: f.status ?? 'potential',
      targetUrl: primaryUrl,
      evidence: f.evidence ?? null,
    };
  });
}

function buildHealthAnalyticsInput(
  scanRun: ReportScanRunInput,
  healthFindings: readonly HealthAnalyticsFindingInput[],
): HealthAnalyticsInput {
  return {
    scanType: scanRun.scanType ?? 'full',
    scanStatus: scanRun.status ?? 'completed',
    config: scanRun.config ?? null,
    summary: scanRun,
    errorDetails: scanRun.errorDetails ?? null,
    completedEngines: scanRun.completedEngines ?? null,
    findings: healthFindings,
  };
}

export function buildReportViewModel(input: BuildReportViewModelInput): ReportViewModel {
  const locale = normalizeReportLocale(input.locale);
  const viewMode = normalizeReportViewMode(input.viewMode);
  const direction = getLocaleDirection(locale);
  const tracker = new TranslationTracker();

  const healthFindings = toHealthFindings(input.findings);
  const healthInput = buildHealthAnalyticsInput(input.scanRun, healthFindings);

  const triad = input.precomputedHealthTriad ?? evaluateAuditHealthTriad(healthInput);

  const enrichment = matchAndEnrichFindings(input.findings, {
    sitePlatformType: input.site.platformType ?? null,
  });

  const charts = input.precomputedCharts ?? buildAuditChartSuite(healthInput);

  const labels = {} as Record<keyof typeof UI_LABELS, string>;
  for (const key of Object.keys(UI_LABELS) as (keyof typeof UI_LABELS)[]) {
    labels[key] = tracker.pick(UI_LABELS[key], locale);
  }

  const recommendations = enrichment.items.map(item =>
    mapEnrichedItemToViewModel(item, locale, viewMode, tracker),
  );

  const bySeverity: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const catCounts = new Map<string, number>();
  let confirmedCount = 0;
  let firmCount = 0;
  let potentialCount = 0;

  for (const raw of input.findings) {
    const f = raw as EnrichableFindingInput;
    const sevRaw = (f.severity ?? 'info').toString().trim().toLowerCase();
    const sevKey = sevRaw === 'informational' ? 'info' : sevRaw;
    bySeverity[sevKey] = (bySeverity[sevKey] ?? 0) + 1;

    const catKey = normalizeFindingCategoryId({
      category: f.category ?? undefined,
      ruleId: f.ruleId ?? undefined,
    });
    catCounts.set(catKey, (catCounts.get(catKey) ?? 0) + 1);

    const conf = (f.confidence ?? 'potential').toString().trim().toLowerCase();
    if (conf === 'confirmed' || conf === 'high') confirmedCount++;
    else if (conf === 'firm' || conf === 'medium') firmCount++;
    else potentialCount++;
  }

  const byCategory = Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({
      category,
      label: tracker.pickFromDict(CATEGORY_LABELS_I18N, category, locale, category),
      count,
    }));

  const topPriorityRecommendations = recommendations.slice(0, 5).map(rec => ({
    recommendationId: rec.recommendationId,
    ruleId: rec.ruleId,
    severity: rec.severity,
    severityLabel: rec.severityLabel,
    title: rec.problem.primaryText,
    affectedUrlsCount: rec.exactLocation.urls.length,
  }));

  const dimensions: DimensionViewModel[] = triad.coverage.dimensions.map(dim => ({
    id: dim.dimension,
    label: tracker.pickFromDict(DIMENSION_LABELS_I18N, dim.dimension, locale, dim.label),
    status: dim.status,
    statusLabel: tracker.pickFromDict(DIMENSION_STATUS_LABELS_I18N, dim.status, locale, dim.status),
    ratio: dim.ratio,
    percent: dim.percent,
    approximated: dim.status === 'approximated',
    weight: dim.weight,
    localizedReasons: dim.reasonCodes.map((r: string) => translateReasonCode(r, locale, tracker)),
    raw: dim,
  }));

  const telemetryReasonsSet = new Set<string>(triad.coverage.coverageApproximationReasons);
  for (const dim of triad.coverage.dimensions) {
    for (const r of dim.reasonCodes) telemetryReasonsSet.add(r);
  }
  const telemetryReasons = Array.from(telemetryReasonsSet)
    .sort()
    .map(code => translateReasonCode(code, locale, tracker));

  const scanStatusRaw = (input.scanRun.status ?? 'completed').toString().trim().toLowerCase();

  return {
    schemaVersion: '7.4.2',
    locale,
    direction,
    technicalTextDirection: 'ltr',
    viewMode,
    title:
      typeof input.title === 'string' && input.title.trim().length > 0
        ? redactSensitiveText(input.title.trim())
        : labels.reportTitleDefault,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    labels,
    site: {
      id: input.site.id ?? null,
      name: input.site.name,
      baseUrl: redactSensitiveText(input.site.baseUrl),
      platformType: input.site.platformType ?? 'generic',
      environmentType: input.site.environmentType ?? 'production',
    },
    scanMeta: {
      id: input.scanRun.id ?? null,
      scanType: input.scanRun.scanType ?? 'full',
      status: scanStatusRaw,
      statusLabel: tracker.pickFromDict(
        SCAN_STATUS_LABELS_I18N,
        scanStatusRaw,
        locale,
        scanStatusRaw,
      ),
      targetUrl: redactSensitiveText(input.scanRun.targetUrl ?? input.site.baseUrl),
      startedAt: input.scanRun.startedAt ?? null,
      completedAt: input.scanRun.completedAt ?? null,
      durationMs: input.scanRun.durationMs ?? null,
      isPartialAudit: Boolean(input.scanRun.isPartialAudit ?? triad.healthBand.isProvisional),
      isPartialCoverage: Boolean(
        input.scanRun.isPartialCoverage ?? triad.coverage.isPartialCoverage,
      ),
    },
    executiveSummary: {
      totalRawFindings: input.findings.length,
      uniqueRecommendationsCount: recommendations.length,
      deduplicatedCount: enrichment.deduplicatedCount,
      fallbackCount: enrichment.fallbackCount,
      bySeverity,
      byCategory,
      confirmedCount,
      firmCount,
      potentialCount,
      topPriorityRecommendations,
    },
    healthOverview: {
      healthIndexScore: triad.healthIndex,
      healthBand: triad.healthBand.bandId,
      healthBandLabel: tracker.pickFromDict(
        HEALTH_BAND_LABELS_I18N,
        triad.healthBand.bandId,
        locale,
        locale === 'ar' ? triad.healthBand.labelAr : triad.healthBand.labelEn,
      ),
      provisional: triad.healthBand.isProvisional,
      coveragePercent: triad.coverage.auditCoverage,
      coverageStatus: triad.coverage.coverageStatus,
      coverageStatusLabel: tracker.pickFromDict(
        DIMENSION_STATUS_LABELS_I18N,
        triad.coverage.coverageStatus,
        locale,
        triad.coverage.coverageStatus,
      ),
      coverageApproximated: triad.coverage.coverageApproximated,
      confidenceScore: triad.confidence.auditConfidence,
      confidenceBand: triad.confidence.confidenceBand,
      confidenceBandLabel: tracker.pickFromDict(
        CONFIDENCE_BAND_LABELS_I18N,
        triad.confidence.confidenceBand,
        locale,
        triad.confidence.confidenceBand,
      ),
      dimensions,
      telemetryReasons,
      rawTriad: triad,
    },
    detectedStack: enrichment.detectedStack,
    charts,
    recommendations,
    disclosures: {
      readOnlyAuditNotice: labels.readOnlyAuditNotice,
      laboratoryContextNotice: labels.laboratoryContextNotice,
      noComplianceCertificationNotice: labels.noComplianceCertificationNotice,
      healthIndexDisclaimer: tracker.pick(
        HEALTH_INDEX_DISCLAIMER_BILINGUAL,
        locale,
        triad.disclaimer,
      ),
    },
    localizationMeta: {
      fallbackTranslationCount: tracker.fallbackCount,
    },
  };
}
