import {
  classifyFindingConfidenceBucket,
  extractPerformanceSummary,
  getFindingCategoryLabel,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
} from '@auditor/shared';
import { ensureReportViewModel, type ReportPresentationOptions } from './assembler.js';
import type { ReportModel } from './types.js';
import { redactSensitiveData } from './security.js';

/**
 * Generates a structured, versioned, secret-redacted JSON export of an audit report.
 * Preserves all historical fields while integrating the Batch 7.4 shared health triad,
 * D1-D4 coverage, 7-chart specifications, detected stack, and bilingual recommendations.
 */
export function generateJsonReport(
  model: ReportModel,
  options?: ReportPresentationOptions,
): string {
  const viewModel = ensureReportViewModel(model, options);

  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let confirmedCount = 0;
  let firmCount = 0;
  let potentialCount = 0;

  const normalizedFindings = model.findings.map(f => {
    const category = normalizeFindingCategoryId({ category: f.category, ruleId: f.ruleId });
    const status = normalizeFindingLifecycleStatus(f.status, f.confidence);
    const bucket = classifyFindingConfidenceBucket(f.confidence);

    byCategory[category] = (byCategory[category] ?? 0) + 1;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (bucket === 'confirmed') {
      confirmedCount++;
    } else if (bucket === 'firm') {
      firmCount++;
    } else {
      potentialCount++;
    }

    return {
      id: f.id,
      scanRunId: f.scanRunId,
      ruleId: f.ruleId,
      category,
      categoryLabel: getFindingCategoryLabel(category),
      title: f.title,
      description: f.description,
      severity: f.severity,
      confidence: f.confidence,
      confidenceBucket: bucket,
      status,
      targetUrl: redactSensitiveData(f.targetUrl) as string,
      evidence: redactSensitiveData(f.evidence),
      remediation: f.remediation,
      references: f.references,
      createdAt: f.createdAt,
    };
  });

  // Preserve summary counts when model contains summary-only synthetic counts (e.g., empty findings array in test mocks)
  const useFindingDerivedCounts = model.findings.length > 0;
  const performanceSummary = extractPerformanceSummary(
    model.summary.performanceMetrics,
    model.findings,
  );
  const summary = {
    ...model.summary,
    byCategory: useFindingDerivedCounts ? byCategory : model.summary.byCategory,
    byStatus: useFindingDerivedCounts ? byStatus : (model.summary.byStatus ?? {}),
    confirmedCount: useFindingDerivedCounts ? confirmedCount : model.summary.confirmedCount,
    firmCount: useFindingDerivedCounts ? firmCount : (model.summary.firmCount ?? 0),
    potentialCount: useFindingDerivedCounts ? potentialCount : model.summary.potentialCount,
    performanceMetrics:
      model.summary.performanceMetrics ??
      (performanceSummary
        ? {
            labMetrics: performanceSummary.hasMeasuredVitals
              ? {
                  ttfbMs: performanceSummary.ttfb.value,
                  fcpMs: performanceSummary.fcp.value,
                  lcpMs: performanceSummary.lcp.value,
                  cls: performanceSummary.cls.value,
                  tbtMs: performanceSummary.tbt.value,
                  isLcpCapped: performanceSummary.lcp.isCapped ?? false,
                }
              : null,
            resourceSummary: performanceSummary.resources ?? null,
          }
        : null),
  };

  // Expose visual evidence metadata without duplicating massive base64 payloads inside JSON
  const visualEvidenceSummary = model.visualEvidence
    ? Object.fromEntries(
        Object.entries(model.visualEvidence).map(([key, entry]) => [
          key,
          {
            fileName: entry.fileName,
            byteLength: entry.byteLength,
            embedded: entry.embedded,
            ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
            ...(entry.omittedReason ? { omittedReason: entry.omittedReason } : {}),
          },
        ]),
      )
    : undefined;

  // Deeply redact sensitive secrets from findings, recommendations, and scan configuration
  const sanitizedModel = redactSensitiveData({
    schemaVersion: '1.0.0',
    reportId: model.reportId,
    title: model.title,
    locale: viewModel.locale,
    direction: viewModel.direction,
    viewMode: viewModel.viewMode,
    generatedAt: model.generatedAt,
    site: {
      ...model.site,
      baseUrl: redactSensitiveData(model.site.baseUrl) as string,
    },
    scanRun: {
      ...model.scanRun,
      targetUrl: redactSensitiveData(model.scanRun.targetUrl) as string,
      config: redactSensitiveData(model.scanRun.config),
    },
    summary,
    healthOverview: viewModel.healthOverview,
    detectedStack: viewModel.detectedStack,
    charts: viewModel.charts,
    recommendations: viewModel.recommendations,
    disclosures: viewModel.disclosures,
    ...(visualEvidenceSummary ? { visualEvidence: visualEvidenceSummary } : {}),
    consolidatedFindings: model.consolidatedFindings ?? [],
    findings: normalizedFindings,
  });

  return JSON.stringify(sanitizedModel, null, 2);
}
