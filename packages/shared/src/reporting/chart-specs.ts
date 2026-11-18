import { z } from 'zod';
import {
  FINDING_CATEGORIES,
  FINDING_CATEGORY_DEFINITIONS,
  normalizeFindingCategoryId,
  type FindingCategoryId,
} from '../schemas/categories.js';
import {
  extractPerformanceSummary,
  LABORATORY_CONTEXT_DISCLAIMER,
  WEB_VITALS_THRESHOLDS,
  type MetricRating,
} from '../schemas/performance.js';
import { ResourceBytesByTypeSchema, type ResourceBytesByType } from '../schemas/scan-run.js';
import {
  evaluateAuditHealthTriad,
  isSystemMetaFinding,
  isValidCount,
  resolveEffectiveFindingClassification,
  type AuditHealthTriadResult,
  type DimensionStatus,
  type HealthAnalyticsFindingInput,
  type HealthAnalyticsInput,
} from './health-metrics.js';

export const CHART_TYPES = [
  'severity_distribution',
  'category_breakdown',
  'coverage_dimensions',
  'lab_vitals',
  'asset_breakdown',
  'bottleneck_summary',
  'top_affected_pages',
] as const;
export type AuditChartType = (typeof CHART_TYPES)[number];
export const AuditChartTypeSchema = z.enum(CHART_TYPES);

export const CHART_DATA_STATUSES = [
  'measured',
  'partial',
  'approximated',
  'unavailable',
  'excluded',
] as const;
export type ChartDataStatus = (typeof CHART_DATA_STATUSES)[number];
export const ChartDataStatusSchema = z.enum(CHART_DATA_STATUSES);

export interface ChartGeometryBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
}

export interface ChartViewportBox {
  readonly width: number;
  readonly height: number;
}

export interface ChartNotice {
  readonly code: string;
  readonly severity: 'info' | 'warning';
}

export interface BaseAuditChartSpec<TItem> {
  readonly chartType: AuditChartType;
  readonly status: ChartDataStatus;
  readonly reasonCodes: readonly string[];
  readonly totalItems: number;
  readonly excludedCount: number;
  readonly viewBox: ChartViewportBox;
  readonly items: readonly TItem[];
  readonly notices: readonly ChartNotice[];
}

export interface SeverityChartItem {
  readonly severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  readonly totalCount: number;
  readonly confirmedOrFirmCount: number;
  readonly provisionalCount: number;
  readonly normalizedShare: number;
  readonly percent: number;
  readonly bar: ChartGeometryBar;
}

export type SeverityDistributionChartSpec = BaseAuditChartSpec<SeverityChartItem> & {
  readonly chartType: 'severity_distribution';
  readonly excludedSystemFindingsCount: number;
  readonly excludedLifecycleFindingsCount: number;
};

export interface CategoryChartItem {
  readonly categoryId: FindingCategoryId;
  readonly label: string;
  readonly activeCount: number;
  readonly confirmedOrFirmCount: number;
  readonly provisionalCount: number;
  readonly highestSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  readonly normalizedShare: number;
  readonly percent: number;
  readonly bar: ChartGeometryBar;
}

export type CategoryBreakdownChartSpec = BaseAuditChartSpec<CategoryChartItem> & {
  readonly chartType: 'category_breakdown';
};

export interface CoverageDimensionChartItem {
  readonly dimension: 'd1' | 'd2' | 'd3' | 'd4';
  readonly label: string;
  readonly weight: number;
  readonly dimensionStatus: DimensionStatus;
  readonly ratio: number;
  readonly percent: number;
  readonly reasonCodes: readonly string[];
  readonly bar: ChartGeometryBar;
}

export type CoverageDimensionsChartSpec = BaseAuditChartSpec<CoverageDimensionChartItem> & {
  readonly chartType: 'coverage_dimensions';
  readonly auditCoverage: number;
  readonly auditConfidence: number;
  readonly coverageApproximated: boolean;
};

export type LabVitalMetricKey = 'ttfb' | 'fcp' | 'lcp' | 'cls' | 'tbt' | 'inp';

export interface LabVitalChartItem {
  readonly metric: LabVitalMetricKey;
  readonly label: string;
  readonly status: ChartDataStatus;
  readonly value: number | null;
  readonly unit: string;
  readonly rating: MetricRating | 'unavailable' | 'unsupported_in_lab';
  readonly goodThreshold: number;
  readonly poorThreshold: number;
  readonly scaleMax: number;
  readonly normalizedRatio: number;
  readonly goodThresholdRatio: number;
  readonly poorThresholdRatio: number;
  readonly isCapped: boolean;
  readonly reasonCode: string | null;
  readonly bar: ChartGeometryBar;
}

export type LabVitalsChartSpec = BaseAuditChartSpec<LabVitalChartItem> & {
  readonly chartType: 'lab_vitals';
  readonly disclaimer: string;
  readonly hasMeasuredVitals: boolean;
};

export type AssetBucketKey =
  'document' | 'script' | 'stylesheet' | 'image' | 'font' | 'other' | 'flagged_heavy';

export interface AssetBreakdownChartItem {
  readonly bucket: AssetBucketKey;
  readonly status: ChartDataStatus;
  readonly bytes: number | null;
  readonly count: number | null;
  readonly normalizedShare: number;
  readonly percent: number;
  readonly bar: ChartGeometryBar;
}

export type AssetBreakdownChartSpec = BaseAuditChartSpec<AssetBreakdownChartItem> & {
  readonly chartType: 'asset_breakdown';
  readonly mode: 'bytes_by_type' | 'counts_and_flagged_only' | 'unavailable';
  readonly totalBytes: number | null;
  readonly flaggedHeavyAssetsCount: number;
  readonly uncompressedAssetsCount: number;
  readonly oversizedImagesCount: number;
  readonly renderBlockingCount: number;
};

export interface BottleneckChartItem {
  readonly ruleId: string;
  readonly title: string;
  readonly classification: string;
  readonly causality: 'causal' | 'correlational';
  readonly severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  readonly severityWeight: number;
  readonly confidence: string;
  readonly observedValueText: string | null;
  readonly thresholdText: string | null;
  readonly normalizedRatio: number;
  readonly bar: ChartGeometryBar;
}

export type BottleneckSummaryChartSpec = BaseAuditChartSpec<BottleneckChartItem> & {
  readonly chartType: 'bottleneck_summary';
};

export interface TopAffectedPageChartItem {
  readonly targetUrl: string;
  readonly activeCount: number;
  readonly criticalCount: number;
  readonly highCount: number;
  readonly mediumCount: number;
  readonly lowCount: number;
  readonly infoCount: number;
  readonly weightedScore: number;
  readonly normalizedRatio: number;
  readonly hasMeasuredVitals: boolean;
  readonly bar: ChartGeometryBar;
}

export type TopAffectedPagesChartSpec = BaseAuditChartSpec<TopAffectedPageChartItem> & {
  readonly chartType: 'top_affected_pages';
  readonly totalDistinctAffectedPages: number;
};

export interface AuditChartSuite {
  readonly triad: AuditHealthTriadResult;
  readonly severityDistribution: SeverityDistributionChartSpec;
  readonly categoryBreakdown: CategoryBreakdownChartSpec;
  readonly coverageDimensions: CoverageDimensionsChartSpec;
  readonly labVitals: LabVitalsChartSpec;
  readonly assetBreakdown: AssetBreakdownChartSpec;
  readonly bottleneckSummary: BottleneckSummaryChartSpec;
  readonly topAffectedPages: TopAffectedPagesChartSpec;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
type NormalizedSeverity = (typeof SEVERITY_ORDER)[number];

const SEVERITY_RANK: Readonly<Record<NormalizedSeverity, number>> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const SEVERITY_PAGE_WEIGHT: Readonly<Record<NormalizedSeverity, number>> = {
  critical: 18,
  high: 10,
  medium: 5,
  low: 2,
  info: 0.25,
};

const DEFAULT_ROW_VIEWBOX_WIDTH = 420;
const BAR_X_OFFSET = 136;
const BAR_MAX_WIDTH = 240;
const BAR_HEIGHT = 18;
const ROW_STEP = 28;
const TOP_PADDING = 16;

function clampUnit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return Number(value.toFixed(6));
}

function finiteNonNeg(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(2));
}

function roundPercent(ratio: number): number {
  const safe = clampUnit(ratio);
  return Math.round(safe * 1000) / 10;
}

function makeHorizontalBar(rowIndex: number, ratio: number): ChartGeometryBar {
  const clamped = clampUnit(ratio);
  const y = finiteNonNeg(TOP_PADDING + rowIndex * ROW_STEP);
  const width = finiteNonNeg(clamped * BAR_MAX_WIDTH);
  return {
    x: BAR_X_OFFSET,
    y,
    width,
    height: BAR_HEIGHT,
    ratio: clamped,
  };
}

function makeVerticalViewportHeight(rowCount: number): number {
  const safeRows = Math.max(1, rowCount);
  return finiteNonNeg(TOP_PADDING * 2 + safeRows * ROW_STEP);
}

function normalizeSeverity(raw: string | null | undefined): NormalizedSeverity {
  const norm = (raw ?? '').trim().toLowerCase();
  if (norm === 'critical' || norm === 'high' || norm === 'medium' || norm === 'low') {
    return norm;
  }
  return 'info';
}

function compareStringsDeterministic(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function pushUnique(target: string[], code: string): void {
  if (!target.includes(code)) {
    target.push(code);
  }
}

function toPerfFindings(findings: readonly HealthAnalyticsFindingInput[] | null | undefined):
  | readonly {
      ruleId: string;
      category?: string;
      title?: string;
      severity?: string;
      confidence?: string;
      evidence?: Record<string, unknown> | string | null;
    }[]
  | undefined {
  if (!findings) return undefined;
  return findings.map(f => ({
    ruleId: f.ruleId,
    category: f.category,
    title: f.title,
    severity: f.severity,
    confidence: f.confidence ?? undefined,
    evidence: f.evidence ?? null,
  }));
}

function partitionTargetFindings(
  findings: readonly HealthAnalyticsFindingInput[] | null | undefined,
): {
  readonly active: Array<
    HealthAnalyticsFindingInput & {
      readonly normalizedSeverity: NormalizedSeverity;
      readonly normalizedCategory: FindingCategoryId;
      readonly effectiveClass: 'provisional' | 'confirmed_or_firm';
    }
  >;
  readonly excludedSystemFindingsCount: number;
  readonly excludedLifecycleFindingsCount: number;
} {
  const list = findings ?? [];
  const active: Array<
    HealthAnalyticsFindingInput & {
      readonly normalizedSeverity: NormalizedSeverity;
      readonly normalizedCategory: FindingCategoryId;
      readonly effectiveClass: 'provisional' | 'confirmed_or_firm';
    }
  > = [];
  let excludedSystemFindingsCount = 0;
  let excludedLifecycleFindingsCount = 0;

  for (const f of list) {
    if (isSystemMetaFinding(f)) {
      excludedSystemFindingsCount += 1;
      continue;
    }
    const categoryId = normalizeFindingCategoryId({ category: f.category, ruleId: f.ruleId });
    if (categoryId === 'system') {
      excludedSystemFindingsCount += 1;
      continue;
    }
    const resolved = resolveEffectiveFindingClassification(f.status, f.confidence);
    if (resolved.classification === 'excluded_lifecycle') {
      excludedLifecycleFindingsCount += 1;
      continue;
    }
    active.push({
      ...f,
      normalizedSeverity: normalizeSeverity(f.severity),
      normalizedCategory: categoryId,
      effectiveClass: resolved.classification,
    });
  }

  return {
    active,
    excludedSystemFindingsCount,
    excludedLifecycleFindingsCount,
  };
}

/**
 * Chart 1: Severity distribution across active target-site findings.
 */
export function buildSeverityDistributionChart(
  findings: readonly HealthAnalyticsFindingInput[] | null | undefined,
): SeverityDistributionChartSpec {
  const { active, excludedSystemFindingsCount, excludedLifecycleFindingsCount } =
    partitionTargetFindings(findings);
  const excludedCount = excludedSystemFindingsCount + excludedLifecycleFindingsCount;

  const buckets = new Map<
    NormalizedSeverity,
    { total: number; confirmed: number; provisional: number }
  >();
  for (const sev of SEVERITY_ORDER) {
    buckets.set(sev, { total: 0, confirmed: 0, provisional: 0 });
  }

  for (const f of active) {
    const entry = buckets.get(f.normalizedSeverity)!;
    entry.total += 1;
    if (f.effectiveClass === 'confirmed_or_firm') {
      entry.confirmed += 1;
    } else {
      entry.provisional += 1;
    }
  }

  const totalActive = active.length;
  const items: SeverityChartItem[] = SEVERITY_ORDER.map((sev, index) => {
    const counts = buckets.get(sev)!;
    const share = totalActive > 0 ? clampUnit(counts.total / totalActive) : 0;
    return {
      severity: sev,
      totalCount: counts.total,
      confirmedOrFirmCount: counts.confirmed,
      provisionalCount: counts.provisional,
      normalizedShare: share,
      percent: roundPercent(share),
      bar: makeHorizontalBar(index, share),
    };
  });

  const reasonCodes: string[] = [];
  const notices: ChartNotice[] = [];
  if (totalActive === 0) {
    pushUnique(reasonCodes, 'no_active_target_findings');
  }
  if (excludedSystemFindingsCount > 0) {
    pushUnique(reasonCodes, 'sys_meta_findings_excluded');
    notices.push({ code: 'sys_meta_findings_excluded', severity: 'info' });
  }
  if (excludedLifecycleFindingsCount > 0) {
    pushUnique(reasonCodes, 'lifecycle_excluded_findings_omitted');
  }

  return {
    chartType: 'severity_distribution',
    status: totalActive > 0 ? 'measured' : excludedCount > 0 ? 'excluded' : 'unavailable',
    reasonCodes,
    totalItems: totalActive,
    excludedCount,
    excludedSystemFindingsCount,
    excludedLifecycleFindingsCount,
    viewBox: {
      width: DEFAULT_ROW_VIEWBOX_WIDTH,
      height: makeVerticalViewportHeight(SEVERITY_ORDER.length),
    },
    items,
    notices,
  };
}

/**
 * Chart 2: Canonical category breakdown across active target-site findings.
 */
export function buildCategoryBreakdownChart(
  findings: readonly HealthAnalyticsFindingInput[] | null | undefined,
): CategoryBreakdownChartSpec {
  const { active, excludedSystemFindingsCount, excludedLifecycleFindingsCount } =
    partitionTargetFindings(findings);
  const excludedCount = excludedSystemFindingsCount + excludedLifecycleFindingsCount;

  const stats = new Map<
    FindingCategoryId,
    {
      activeCount: number;
      confirmed: number;
      provisional: number;
      highestSeverity: NormalizedSeverity;
    }
  >();

  for (const f of active) {
    const existing = stats.get(f.normalizedCategory) ?? {
      activeCount: 0,
      confirmed: 0,
      provisional: 0,
      highestSeverity: 'info' as NormalizedSeverity,
    };
    existing.activeCount += 1;
    if (f.effectiveClass === 'confirmed_or_firm') {
      existing.confirmed += 1;
    } else {
      existing.provisional += 1;
    }
    if (SEVERITY_RANK[f.normalizedSeverity] > SEVERITY_RANK[existing.highestSeverity]) {
      existing.highestSeverity = f.normalizedSeverity;
    }
    stats.set(f.normalizedCategory, existing);
  }

  const totalActive = active.length;
  const canonicalOrder = new Map<FindingCategoryId, number>();
  FINDING_CATEGORIES.forEach((cat, idx) => canonicalOrder.set(cat, idx));

  const nonEmptyCategories = [...stats.entries()].sort((a, b) => {
    if (b[1].activeCount !== a[1].activeCount) {
      return b[1].activeCount - a[1].activeCount;
    }
    const sevDiff = SEVERITY_RANK[b[1].highestSeverity] - SEVERITY_RANK[a[1].highestSeverity];
    if (sevDiff !== 0) return sevDiff;
    return (canonicalOrder.get(a[0]) ?? 999) - (canonicalOrder.get(b[0]) ?? 999);
  });

  const items: CategoryChartItem[] = nonEmptyCategories.map(([categoryId, data], idx) => {
    const share = totalActive > 0 ? clampUnit(data.activeCount / totalActive) : 0;
    const def = FINDING_CATEGORY_DEFINITIONS[categoryId];
    return {
      categoryId,
      label: def.label,
      activeCount: data.activeCount,
      confirmedOrFirmCount: data.confirmed,
      provisionalCount: data.provisional,
      highestSeverity: data.highestSeverity,
      normalizedShare: share,
      percent: roundPercent(share),
      bar: makeHorizontalBar(idx, share),
    };
  });

  const reasonCodes: string[] = [];
  const notices: ChartNotice[] = [];
  if (totalActive === 0) {
    pushUnique(reasonCodes, 'no_active_target_findings');
  }
  if (excludedSystemFindingsCount > 0) {
    pushUnique(reasonCodes, 'sys_meta_findings_excluded');
    notices.push({ code: 'sys_meta_findings_excluded', severity: 'info' });
  }

  return {
    chartType: 'category_breakdown',
    status: totalActive > 0 ? 'measured' : excludedCount > 0 ? 'excluded' : 'unavailable',
    reasonCodes,
    totalItems: totalActive,
    excludedCount,
    viewBox: {
      width: DEFAULT_ROW_VIEWBOX_WIDTH,
      height: makeVerticalViewportHeight(Math.max(1, items.length)),
    },
    items,
    notices,
  };
}

/**
 * Chart 3: D1–D4 execution coverage dimensions from the Audit Health Triad.
 */
export function buildCoverageDimensionsChart(
  triad: AuditHealthTriadResult,
): CoverageDimensionsChartSpec {
  const dims = triad.coverage.dimensions;
  let excludedCount = 0;

  const items: CoverageDimensionChartItem[] = dims.map((d, idx) => {
    const safeRatio =
      d.status === 'not_applicable' || d.status === 'unavailable' ? 0 : clampUnit(d.ratio);
    if (d.status === 'not_applicable') {
      excludedCount += 1;
    }
    return {
      dimension: d.dimension,
      label: d.label,
      weight: d.weight,
      dimensionStatus: d.status,
      ratio: safeRatio,
      percent: d.status === 'not_applicable' ? 0 : roundPercent(safeRatio),
      reasonCodes: [...d.reasonCodes],
      bar: makeHorizontalBar(idx, safeRatio),
    };
  });

  const hasApprox =
    triad.coverage.coverageApproximated || dims.some(d => d.status === 'approximated');
  const applicableCount = dims.filter(d => d.status !== 'not_applicable').length;
  const availableCount = dims.filter(
    d => d.status === 'exact' || d.status === 'approximated',
  ).length;

  let status: ChartDataStatus;
  if (applicableCount === 0 || availableCount === 0) {
    status = 'unavailable';
  } else if (hasApprox) {
    status = 'approximated';
  } else if (availableCount < applicableCount || triad.coverage.isPartialCoverage) {
    status = 'partial';
  } else {
    status = 'measured';
  }

  const reasonCodes = [...triad.coverage.coverageApproximationReasons];
  const notices: ChartNotice[] = [];
  if (hasApprox) {
    notices.push({ code: 'coverage_approximated_fallback_used', severity: 'warning' });
  }
  if (excludedCount > 0) {
    notices.push({ code: 'non_applicable_dimensions_excluded', severity: 'info' });
  }

  return {
    chartType: 'coverage_dimensions',
    status,
    reasonCodes,
    totalItems: items.length,
    excludedCount,
    auditCoverage: triad.coverage.auditCoverage,
    auditConfidence: triad.confidence.auditConfidence,
    coverageApproximated: triad.coverage.coverageApproximated,
    viewBox: {
      width: DEFAULT_ROW_VIEWBOX_WIDTH,
      height: makeVerticalViewportHeight(items.length),
    },
    items,
    notices,
  };
}

const LAB_VITAL_SCALE_MAX: Readonly<Record<'ttfb' | 'fcp' | 'lcp' | 'cls' | 'tbt', number>> = {
  ttfb: 3000,
  fcp: 5000,
  lcp: 6000,
  cls: 0.5,
  tbt: 1000,
};

/**
 * Chart 4: Lab Web Vitals vs Google/CrUX thresholds (explicitly excludes field-only INP).
 */
export function buildLabVitalsChart(
  input: Pick<HealthAnalyticsInput, 'summary' | 'findings'>,
): LabVitalsChartSpec {
  const rawPerf =
    input.summary?.performanceMetrics && typeof input.summary.performanceMetrics === 'object'
      ? (input.summary.performanceMetrics as Record<string, unknown>)
      : null;
  const perfSummary = extractPerformanceSummary(rawPerf, toPerfFindings(input.findings));

  const metricSpecs: Array<{
    key: 'ttfb' | 'fcp' | 'lcp' | 'cls' | 'tbt';
    label: string;
    unit: string;
  }> = [
    { key: 'ttfb', label: 'TTFB (Lab)', unit: 'ms' },
    { key: 'fcp', label: 'FCP (Lab)', unit: 'ms' },
    { key: 'lcp', label: 'LCP (Lab)', unit: 'ms' },
    { key: 'cls', label: 'CLS (Lab)', unit: '' },
    { key: 'tbt', label: 'TBT (Lab)', unit: 'ms' },
  ];

  let measuredCount = 0;
  let unavailableCount = 0;
  const items: LabVitalChartItem[] = [];

  metricSpecs.forEach((spec, idx) => {
    const threshold = WEB_VITALS_THRESHOLDS[spec.key];
    const goodThreshold = 'goodMax' in threshold ? threshold.goodMax : threshold.goodMaxMs;
    const poorThreshold =
      'needsImprovementMax' in threshold
        ? threshold.needsImprovementMax
        : threshold.needsImprovementMaxMs;
    const scaleMax = Math.max(LAB_VITAL_SCALE_MAX[spec.key], poorThreshold * 1.25);
    const extractedMetric = perfSummary ? perfSummary[spec.key] : null;
    const rawValue =
      extractedMetric &&
      typeof extractedMetric.value === 'number' &&
      Number.isFinite(extractedMetric.value)
        ? Math.max(0, extractedMetric.value)
        : null;

    if (rawValue === null) {
      unavailableCount += 1;
      items.push({
        metric: spec.key,
        label: spec.label,
        status: 'unavailable',
        value: null,
        unit: spec.unit,
        rating: 'unavailable',
        goodThreshold,
        poorThreshold,
        scaleMax,
        normalizedRatio: 0,
        goodThresholdRatio: clampUnit(goodThreshold / scaleMax),
        poorThresholdRatio: clampUnit(poorThreshold / scaleMax),
        isCapped: false,
        reasonCode: 'lab_metric_not_measured',
        bar: makeHorizontalBar(idx, 0),
      });
      return;
    }

    measuredCount += 1;
    const effectiveScaleMax = Math.max(scaleMax, rawValue);
    const ratio = clampUnit(rawValue / effectiveScaleMax);
    const isLcpCapped = spec.key === 'lcp' && Boolean(perfSummary?.lcp.isCapped);

    items.push({
      metric: spec.key,
      label: spec.label,
      status: isLcpCapped ? 'approximated' : 'measured',
      value: finiteNonNeg(rawValue),
      unit: spec.unit,
      rating: extractedMetric!.rating,
      goodThreshold,
      poorThreshold,
      scaleMax: finiteNonNeg(effectiveScaleMax),
      normalizedRatio: ratio,
      goodThresholdRatio: clampUnit(goodThreshold / effectiveScaleMax),
      poorThresholdRatio: clampUnit(poorThreshold / effectiveScaleMax),
      isCapped: isLcpCapped,
      reasonCode: isLcpCapped ? 'lcp_measurement_capped' : null,
      bar: makeHorizontalBar(idx, ratio),
    });
  });

  // Explicitly surface INP as field-only / unsupported in lab browser audits
  items.push({
    metric: 'inp',
    label: 'INP (Field Only)',
    status: 'excluded',
    value: null,
    unit: 'ms',
    rating: 'unsupported_in_lab',
    goodThreshold: 200,
    poorThreshold: 500,
    scaleMax: 1000,
    normalizedRatio: 0,
    goodThresholdRatio: 0.2,
    poorThresholdRatio: 0.5,
    isCapped: false,
    reasonCode: 'unsupported_in_lab_requires_field_crux',
    bar: makeHorizontalBar(metricSpecs.length, 0),
  });

  const reasonCodes: string[] = ['inp_unsupported_in_lab'];
  const notices: ChartNotice[] = [{ code: 'inp_unsupported_in_lab', severity: 'info' }];
  if (measuredCount === 0) {
    pushUnique(reasonCodes, 'no_measured_lab_vitals');
  } else if (unavailableCount > 0) {
    pushUnique(reasonCodes, 'partial_lab_vitals_measured');
  }
  if (perfSummary?.lcp.isCapped) {
    pushUnique(reasonCodes, 'lcp_measurement_capped');
    notices.push({ code: 'lcp_measurement_capped', severity: 'warning' });
  }

  let status: ChartDataStatus;
  if (measuredCount === 0) {
    status = 'unavailable';
  } else if (unavailableCount > 0) {
    status = 'partial';
  } else if (perfSummary?.lcp.isCapped) {
    status = 'approximated';
  } else {
    status = 'measured';
  }

  return {
    chartType: 'lab_vitals',
    status,
    reasonCodes,
    totalItems: items.length,
    excludedCount: 1, // INP excluded from lab metrics
    disclaimer: LABORATORY_CONTEXT_DISCLAIMER,
    hasMeasuredVitals: measuredCount > 0,
    viewBox: {
      width: DEFAULT_ROW_VIEWBOX_WIDTH,
      height: makeVerticalViewportHeight(items.length),
    },
    items,
    notices,
  };
}

function parseResourceBytesByType(raw: unknown): {
  readonly buckets: ResourceBytesByType;
  readonly isPartial: boolean;
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const isPartial = record.isPartial === true;
  const numericEntries: Record<string, number> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === 'isPartial') continue;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      numericEntries[k] = v;
    } else if (v !== undefined) {
      return null;
    }
  }
  if (Object.keys(numericEntries).length === 0) return null;
  const parsed = ResourceBytesByTypeSchema.safeParse(numericEntries);
  if (!parsed.success) return null;
  return { buckets: parsed.data, isPartial };
}

const HEAVY_ASSET_RULE_IDS = new Set<string>([
  'PERF_LARGE_JS',
  'PERF_LARGE_CSS',
  'PERF_LARGE_IMAGE',
  'PERF_LARGE_DOCUMENT',
  'PERF_LARGE_FONT',
  'PERF_UNCOMPRESSED_ASSET',
  'PERF_OVERSIZED_IMAGE',
  'PERF_TOTAL_TRANSFER_HIGH',
]);

/**
 * Chart 5: Asset byte breakdown when `summary.resourceBytesByType` exists,
 * else honest historical degradation to counts + flagged heavy assets only.
 */
export function buildAssetBreakdownChart(
  input: Pick<HealthAnalyticsInput, 'summary' | 'findings'>,
): AssetBreakdownChartSpec {
  const rawPerf =
    input.summary?.performanceMetrics && typeof input.summary.performanceMetrics === 'object'
      ? (input.summary.performanceMetrics as Record<string, unknown>)
      : null;
  const perfSummary = extractPerformanceSummary(rawPerf, toPerfFindings(input.findings));
  const { active } = partitionTargetFindings(input.findings);

  const flaggedHeavyAssetsCount = active.filter(f =>
    HEAVY_ASSET_RULE_IDS.has((f.ruleId ?? '').trim().toUpperCase()),
  ).length;

  const resCounts = perfSummary?.resources ?? null;
  const uncompressedAssetsCount = resCounts?.uncompressedAssetsCount ?? 0;
  const oversizedImagesCount = resCounts?.oversizedImagesCount ?? 0;
  const renderBlockingCount = resCounts?.renderBlockingCount ?? 0;

  const parsedBytes = parseResourceBytesByType(input.summary?.resourceBytesByType);

  if (parsedBytes) {
    const bytesByType = parsedBytes.buckets;
    const getBytes = (key: string): number => {
      const val = bytesByType[key];
      return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : 0;
    };
    const bucketEntries: Array<{ key: AssetBucketKey; bytes: number }> = [
      { key: 'document', bytes: getBytes('document') },
      { key: 'script', bytes: getBytes('script') },
      { key: 'stylesheet', bytes: getBytes('stylesheet') },
      { key: 'image', bytes: getBytes('image') },
      { key: 'font', bytes: getBytes('font') },
      { key: 'other', bytes: getBytes('other') },
    ];

    const computedSum = bucketEntries.reduce((acc, e) => acc + e.bytes, 0);
    const totalBytes =
      typeof bytesByType.totalBytes === 'number' &&
      Number.isFinite(bytesByType.totalBytes) &&
      bytesByType.totalBytes >= 0
        ? bytesByType.totalBytes
        : computedSum;
    const denom = totalBytes > 0 ? totalBytes : computedSum > 0 ? computedSum : 0;

    // Sort deterministically by bytes desc then canonical bucket order
    const sorted = [...bucketEntries].sort((a, b) => b.bytes - a.bytes);
    const items: AssetBreakdownChartItem[] = sorted.map((entry, idx) => {
      const share = denom > 0 ? clampUnit(entry.bytes / denom) : 0;
      return {
        bucket: entry.key,
        status: parsedBytes.isPartial ? 'partial' : 'measured',
        bytes: entry.bytes,
        count: null,
        normalizedShare: share,
        percent: roundPercent(share),
        bar: makeHorizontalBar(idx, share),
      };
    });

    const reasonCodes: string[] = [];
    const notices: ChartNotice[] = [];
    if (parsedBytes.isPartial) {
      pushUnique(reasonCodes, 'resource_bytes_partial_capture');
      notices.push({ code: 'resource_bytes_partial_capture', severity: 'warning' });
    }
    if (denom === 0) {
      pushUnique(reasonCodes, 'zero_resource_bytes_recorded');
    }

    return {
      chartType: 'asset_breakdown',
      status: denom === 0 ? 'unavailable' : parsedBytes.isPartial ? 'partial' : 'measured',
      reasonCodes,
      totalItems: items.length,
      excludedCount: 0,
      mode: denom === 0 && !bytesByType.totalBytes ? 'unavailable' : 'bytes_by_type',
      totalBytes,
      flaggedHeavyAssetsCount,
      uncompressedAssetsCount,
      oversizedImagesCount,
      renderBlockingCount,
      viewBox: {
        width: DEFAULT_ROW_VIEWBOX_WIDTH,
        height: makeVerticalViewportHeight(items.length),
      },
      items,
      notices,
    };
  }

  // Historical fallback: NO byte totals per type available -> NEVER fabricate byte shares!
  const scriptsCount = resCounts?.scriptsCount ?? 0;
  const stylesheetsCount = resCounts?.stylesheetsCount ?? 0;
  const imagesCount = resCounts?.imagesCount ?? 0;
  const totalTypedCounts = scriptsCount + stylesheetsCount + imagesCount + flaggedHeavyAssetsCount;

  if (!resCounts && flaggedHeavyAssetsCount === 0) {
    return {
      chartType: 'asset_breakdown',
      status: 'unavailable',
      reasonCodes: ['asset_telemetry_unavailable'],
      totalItems: 0,
      excludedCount: 0,
      mode: 'unavailable',
      totalBytes: null,
      flaggedHeavyAssetsCount: 0,
      uncompressedAssetsCount: 0,
      oversizedImagesCount: 0,
      renderBlockingCount: 0,
      viewBox: {
        width: DEFAULT_ROW_VIEWBOX_WIDTH,
        height: makeVerticalViewportHeight(1),
      },
      items: [],
      notices: [{ code: 'asset_telemetry_unavailable', severity: 'info' }],
    };
  }

  const fallbackBuckets: Array<{ key: AssetBucketKey; count: number }> = [
    { key: 'script', count: scriptsCount },
    { key: 'stylesheet', count: stylesheetsCount },
    { key: 'image', count: imagesCount },
    { key: 'flagged_heavy', count: flaggedHeavyAssetsCount },
  ];
  const sorted = [...fallbackBuckets].sort((a, b) => b.count - a.count);
  const denom = Math.max(1, totalTypedCounts);

  const items: AssetBreakdownChartItem[] = sorted.map((entry, idx) => {
    const share = totalTypedCounts > 0 ? clampUnit(entry.count / denom) : 0;
    return {
      bucket: entry.key,
      status: 'partial',
      bytes: null, // Explicitly null — never fabricated in historical fallback
      count: entry.count,
      normalizedShare: share,
      percent: roundPercent(share),
      bar: makeHorizontalBar(idx, share),
    };
  });

  const knownTransferBytes =
    typeof resCounts?.totalTransferSizeBytes === 'number' &&
    isValidCount(Math.round(resCounts.totalTransferSizeBytes))
      ? Math.round(resCounts.totalTransferSizeBytes)
      : null;

  return {
    chartType: 'asset_breakdown',
    status: 'partial',
    reasonCodes: ['counts_and_flagged_only_missing_resource_bytes_by_type'],
    totalItems: items.length,
    excludedCount: 0,
    mode: 'counts_and_flagged_only',
    totalBytes: knownTransferBytes,
    flaggedHeavyAssetsCount,
    uncompressedAssetsCount,
    oversizedImagesCount,
    renderBlockingCount,
    viewBox: {
      width: DEFAULT_ROW_VIEWBOX_WIDTH,
      height: makeVerticalViewportHeight(items.length),
    },
    items,
    notices: [
      {
        code: 'counts_and_flagged_only_missing_resource_bytes_by_type',
        severity: 'warning',
      },
    ],
  };
}

/**
 * Chart 6: Bottleneck summary from extracted performance diagnoses.
 */
export function buildBottleneckSummaryChart(
  input: Pick<HealthAnalyticsInput, 'summary' | 'findings'>,
): BottleneckSummaryChartSpec {
  const rawPerf =
    input.summary?.performanceMetrics && typeof input.summary.performanceMetrics === 'object'
      ? (input.summary.performanceMetrics as Record<string, unknown>)
      : null;
  const perfSummary = extractPerformanceSummary(rawPerf, toPerfFindings(input.findings));

  if (!perfSummary) {
    return {
      chartType: 'bottleneck_summary',
      status: 'unavailable',
      reasonCodes: ['performance_telemetry_unavailable'],
      totalItems: 0,
      excludedCount: 0,
      viewBox: {
        width: DEFAULT_ROW_VIEWBOX_WIDTH,
        height: makeVerticalViewportHeight(1),
      },
      items: [],
      notices: [{ code: 'performance_telemetry_unavailable', severity: 'info' }],
    };
  }

  const bottlenecks = [...perfSummary.bottleneckDiagnoses].sort((a, b) => {
    const sevDiff =
      SEVERITY_RANK[normalizeSeverity(b.severity)] - SEVERITY_RANK[normalizeSeverity(a.severity)];
    if (sevDiff !== 0) return sevDiff;
    return compareStringsDeterministic(a.ruleId, b.ruleId);
  });

  if (bottlenecks.length === 0) {
    return {
      chartType: 'bottleneck_summary',
      status: perfSummary.hasMeasuredVitals ? 'measured' : 'unavailable',
      reasonCodes: perfSummary.hasMeasuredVitals
        ? ['no_performance_bottlenecks_detected']
        : ['performance_telemetry_unavailable'],
      totalItems: 0,
      excludedCount: 0,
      viewBox: {
        width: DEFAULT_ROW_VIEWBOX_WIDTH,
        height: makeVerticalViewportHeight(1),
      },
      items: [],
      notices: [],
    };
  }

  const maxWeight = SEVERITY_RANK.critical;
  const items: BottleneckChartItem[] = bottlenecks.map((b, idx) => {
    const sev = normalizeSeverity(b.severity);
    const weight = SEVERITY_RANK[sev];
    const ratio = clampUnit(weight / maxWeight);
    return {
      ruleId: b.ruleId,
      title: b.title,
      classification: b.classification,
      causality: b.causality,
      severity: sev,
      severityWeight: weight,
      confidence: b.confidence,
      observedValueText: b.observedValueText ?? null,
      thresholdText: b.thresholdText ?? null,
      normalizedRatio: ratio,
      bar: makeHorizontalBar(idx, ratio),
    };
  });

  return {
    chartType: 'bottleneck_summary',
    status: 'measured',
    reasonCodes: [],
    totalItems: items.length,
    excludedCount: 0,
    viewBox: {
      width: DEFAULT_ROW_VIEWBOX_WIDTH,
      height: makeVerticalViewportHeight(items.length),
    },
    items,
    notices: [],
  };
}

/**
 * Chart 7: Top affected pages ranked deterministically by severity-weighted score,
 * excluding SYS_* and excluded-lifecycle findings.
 */
export function buildTopAffectedPagesChart(
  input: Pick<HealthAnalyticsInput, 'summary' | 'findings'>,
  options?: { readonly limit?: number },
): TopAffectedPagesChartSpec {
  const { active, excludedSystemFindingsCount, excludedLifecycleFindingsCount } =
    partitionTargetFindings(input.findings);
  const excludedCount = excludedSystemFindingsCount + excludedLifecycleFindingsCount;

  const safeLimit = Math.min(25, Math.max(1, Math.floor(options?.limit ?? 10)));

  // Identify URLs that have measured per-page vitals if available
  const rawPerf =
    input.summary?.performanceMetrics && typeof input.summary.performanceMetrics === 'object'
      ? (input.summary.performanceMetrics as Record<string, unknown>)
      : null;
  const perfUrls = new Set<string>();
  if (Array.isArray(rawPerf?.pages)) {
    for (const p of rawPerf.pages) {
      if (p && typeof p === 'object') {
        const rec = p as Record<string, unknown>;
        const u =
          typeof rec.url === 'string'
            ? rec.url
            : typeof rec.pageUrl === 'string'
              ? rec.pageUrl
              : null;
        if (u && rec.labMetrics && typeof rec.labMetrics === 'object') {
          perfUrls.add(u.trim());
        }
      }
    }
  }

  const pageMap = new Map<
    string,
    {
      activeCount: number;
      criticalCount: number;
      highCount: number;
      mediumCount: number;
      lowCount: number;
      infoCount: number;
      weightedScore: number;
    }
  >();

  for (const f of active) {
    const url = (f.targetUrl ?? '').trim() || '(unknown-target)';
    const entry = pageMap.get(url) ?? {
      activeCount: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      weightedScore: 0,
    };
    entry.activeCount += 1;
    if (f.normalizedSeverity === 'critical') entry.criticalCount += 1;
    else if (f.normalizedSeverity === 'high') entry.highCount += 1;
    else if (f.normalizedSeverity === 'medium') entry.mediumCount += 1;
    else if (f.normalizedSeverity === 'low') entry.lowCount += 1;
    else entry.infoCount += 1;

    entry.weightedScore = finiteNonNeg(
      entry.weightedScore + SEVERITY_PAGE_WEIGHT[f.normalizedSeverity],
    );
    pageMap.set(url, entry);
  }

  const sortedPages = [...pageMap.entries()].sort((a, b) => {
    if (b[1].weightedScore !== a[1].weightedScore) {
      return b[1].weightedScore - a[1].weightedScore;
    }
    if (b[1].activeCount !== a[1].activeCount) {
      return b[1].activeCount - a[1].activeCount;
    }
    return compareStringsDeterministic(a[0], b[0]);
  });

  const sliced = sortedPages.slice(0, safeLimit);
  const topScore = sliced.length > 0 ? Math.max(1, sliced[0]![1].weightedScore) : 1;

  const items: TopAffectedPageChartItem[] = sliced.map(([targetUrl, data], idx) => {
    const ratio = clampUnit(data.weightedScore / topScore);
    return {
      targetUrl,
      activeCount: data.activeCount,
      criticalCount: data.criticalCount,
      highCount: data.highCount,
      mediumCount: data.mediumCount,
      lowCount: data.lowCount,
      infoCount: data.infoCount,
      weightedScore: data.weightedScore,
      normalizedRatio: ratio,
      hasMeasuredVitals: perfUrls.has(targetUrl),
      bar: makeHorizontalBar(idx, ratio),
    };
  });

  const reasonCodes: string[] = [];
  if (items.length === 0) {
    pushUnique(reasonCodes, 'no_active_target_findings');
  }
  if (excludedSystemFindingsCount > 0) {
    pushUnique(reasonCodes, 'sys_meta_findings_excluded');
  }

  return {
    chartType: 'top_affected_pages',
    status: items.length > 0 ? 'measured' : excludedCount > 0 ? 'excluded' : 'unavailable',
    reasonCodes,
    totalItems: items.length,
    excludedCount,
    totalDistinctAffectedPages: sortedPages.length,
    viewBox: {
      width: DEFAULT_ROW_VIEWBOX_WIDTH,
      height: makeVerticalViewportHeight(Math.max(1, items.length)),
    },
    items,
    notices: [],
  };
}

/**
 * Single deterministic entry point building the complete Health Triad + all 7 chart specs.
 */
export function buildAuditChartSuite(
  input: HealthAnalyticsInput,
  options?: { readonly topPagesLimit?: number },
): AuditChartSuite {
  const triad = evaluateAuditHealthTriad(input);
  return {
    triad,
    severityDistribution: buildSeverityDistributionChart(input.findings),
    categoryBreakdown: buildCategoryBreakdownChart(input.findings),
    coverageDimensions: buildCoverageDimensionsChart(triad),
    labVitals: buildLabVitalsChart(input),
    assetBreakdown: buildAssetBreakdownChart(input),
    bottleneckSummary: buildBottleneckSummaryChart(input),
    topAffectedPages: buildTopAffectedPagesChart(input, { limit: options?.topPagesLimit }),
  };
}
