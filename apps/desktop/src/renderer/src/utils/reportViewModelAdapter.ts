import {
  buildReportViewModel,
  type DimensionViewModel,
  type FindingDTO,
  type ReportLocale,
  type ReportViewMode,
  type ReportViewModel,
  type ScanRunDTO,
  type SiteDTO,
} from '@auditor/shared';

export interface DimensionTelemetryDisplay {
  readonly executed: number | null;
  readonly eligible: number | null;
  readonly unitKind: 'pages' | 'modules';
  readonly subModules: readonly {
    readonly name: string;
    readonly status: string;
    readonly percent: number;
  }[];
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readSafeCount(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null;
  const val = record[key];
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0 ? val : null;
}

function deriveSafeSiteName(scanRun: ScanRunDTO, site?: SiteDTO | null): string {
  if (site?.name && site.name.trim().length > 0) {
    return site.name.trim();
  }
  try {
    return new URL(scanRun.targetUrl).hostname || scanRun.targetUrl;
  } catch {
    return scanRun.targetUrl;
  }
}

/**
 * Adapts persisted desktop DTOs (`ScanRunDTO`, `SiteDTO`, `FindingDTO[]`) into the
 * authoritative shared `ReportViewModel` without duplicating any health, coverage,
 * chart, or recommendation logic, and strictly matching `assembler.ts` semantics.
 */
export function adaptScanRunForViewModel(params: {
  readonly scanRun: ScanRunDTO;
  readonly site?: SiteDTO | null;
  readonly findings: readonly FindingDTO[];
  readonly locale: ReportLocale;
  readonly viewMode: ReportViewMode;
}): ReportViewModel {
  const { scanRun, site, findings, locale, viewMode } = params;

  // Enforce strict scanRunId isolation so stale findings from another scan can never leak in
  const scopedFindings = findings.filter(f => f.scanRunId === scanRun.id);

  const errorDetails = asPlainRecord(scanRun.error?.details) ?? asPlainRecord(scanRun.errorDetails);
  const summaryRecord = asPlainRecord(scanRun.summary);
  const metricsSource: Record<string, unknown> = summaryRecord ?? errorDetails ?? {};

  const browserPagesAudited = readSafeCount(metricsSource, 'browserPagesAudited') ?? 0;

  const completedEngines: readonly string[] = Array.isArray(metricsSource.completedEngines)
    ? (metricsSource.completedEngines as string[])
    : Array.isArray(errorDetails?.completedEngines)
      ? (errorDetails.completedEngines as string[])
      : scanRun.status === 'completed'
        ? ['crawler', 'analyzers', ...(browserPagesAudited > 0 ? ['browser'] : [])]
        : ['crawler'];

  return buildReportViewModel({
    locale,
    viewMode,
    generatedAt: scanRun.completedAt ?? scanRun.updatedAt ?? scanRun.createdAt,
    site: {
      id: site?.id ?? scanRun.siteId,
      name: deriveSafeSiteName(scanRun, site),
      baseUrl: site?.baseUrl ?? scanRun.targetUrl,
      platformType: site?.platformType ?? 'generic',
      environmentType: site?.environmentType ?? 'production',
    },
    scanRun: {
      ...metricsSource,
      id: scanRun.id,
      scanType: scanRun.scanType,
      status: scanRun.status,
      targetUrl: scanRun.targetUrl,
      startedAt: scanRun.startedAt,
      completedAt: scanRun.completedAt,
      durationMs: scanRun.durationMs,
      config: scanRun.config,
      completedEngines,
      errorDetails: errorDetails ?? null,
      performanceMetrics:
        (metricsSource.performanceMetrics as Record<string, unknown> | null | undefined) ?? null,
    },
    findings: scopedFindings,
  });
}

/**
 * Extracts explicit persisted executed/eligible counts for a given D1–D4 dimension
 * without fabricating missing counters or merging dimensions together.
 */
export function extractDimensionTelemetryCounts(
  scanRun: ScanRunDTO,
  dimension: DimensionViewModel,
): DimensionTelemetryDisplay {
  const summary = asPlainRecord(scanRun.summary);
  const subModules = dimension.raw.modules
    ? Object.entries(dimension.raw.modules).map(([name, mod]) => ({
        name,
        status: mod.status,
        percent: Math.round(Math.max(0, Math.min(1, mod.ratio)) * 100),
      }))
    : [];

  if (dimension.id === 'd1') {
    const pagesScanned = readSafeCount(summary, 'pagesScanned');
    const urlsCrawled = readSafeCount(summary, 'urlsCrawled');
    const crawlFailedPages = readSafeCount(summary, 'crawlFailedPages');
    const eligible =
      urlsCrawled !== null
        ? urlsCrawled
        : pagesScanned !== null && crawlFailedPages !== null
          ? pagesScanned + crawlFailedPages
          : null;
    return {
      executed: pagesScanned,
      eligible,
      unitKind: 'pages',
      subModules,
    };
  }

  if (dimension.id === 'd2') {
    const staticExec = readSafeCount(summary, 'staticModulesExecuted');
    const staticTotal = readSafeCount(summary, 'staticModulesTotal');
    if (staticExec !== null || staticTotal !== null) {
      return {
        executed: staticExec,
        eligible: staticTotal,
        unitKind: 'modules',
        subModules,
      };
    }
    const staticPagesCompleted = readSafeCount(summary, 'staticPagesCompleted');
    const staticPagesExpected = readSafeCount(summary, 'staticPagesExpected');
    return {
      executed: staticPagesCompleted ?? readSafeCount(summary, 'staticPagesAnalyzed'),
      eligible: staticPagesExpected ?? readSafeCount(summary, 'pagesScanned'),
      unitKind: 'pages',
      subModules,
    };
  }

  const maxDefinedCount = (...values: Array<number | null>): number | null => {
    const valid = values.filter((v): v is number => v !== null);
    return valid.length > 0 ? Math.max(...valid) : null;
  };

  if (dimension.id === 'd3') {
    const a11yCompleted = readSafeCount(summary, 'accessibilityAuditsCompleted');
    const runtimeCompleted = readSafeCount(summary, 'runtimeAuditsCompleted');
    const browserAudited = readSafeCount(summary, 'browserPagesAudited');
    const a11yCandidates = readSafeCount(summary, 'accessibilityCandidatesTotal');
    const browserCandidates = readSafeCount(summary, 'browserCandidatesTotal');
    const pagesScanned = readSafeCount(summary, 'pagesScanned');

    if (dimension.status === 'not_applicable') {
      return {
        executed: null,
        eligible: null,
        unitKind: 'pages',
        subModules,
      };
    }

    return {
      executed: a11yCompleted ?? runtimeCompleted ?? browserAudited,
      eligible: maxDefinedCount(a11yCandidates, browserCandidates, pagesScanned),
      unitKind: 'pages',
      subModules,
    };
  }

  // D4: Lab Performance, Responsive & Visual
  if (dimension.status === 'not_applicable') {
    return {
      executed: null,
      eligible: null,
      unitKind: 'pages',
      subModules,
    };
  }

  const clsCompleted = readSafeCount(summary, 'clsPagesCompleted');
  const layoutCompleted = readSafeCount(summary, 'layoutStabilityPagesCompleted');
  const browserAudited = readSafeCount(summary, 'browserPagesAudited');
  const clsExpected = readSafeCount(summary, 'clsPagesExpected');
  const browserCandidates = readSafeCount(summary, 'browserCandidatesTotal');
  const pagesScanned = readSafeCount(summary, 'pagesScanned');

  // Only prioritize layout-stability completion counters when layoutStability is actually an
  // active D4 module; otherwise layoutStabilityPagesCompleted=0 would mask executed browser pages.
  const hasLayoutStabilityModule = dimension.raw.modules?.layoutStability !== undefined;
  const executedD4 = hasLayoutStabilityModule
    ? (clsCompleted ?? layoutCompleted ?? browserAudited)
    : browserAudited;

  return {
    executed: executedD4,
    eligible: maxDefinedCount(
      hasLayoutStabilityModule ? clsExpected : null,
      browserCandidates,
      pagesScanned,
    ),
    unitKind: 'pages',
    subModules,
  };
}
