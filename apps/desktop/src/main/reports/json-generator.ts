import {
  classifyFindingConfidenceBucket,
  getFindingCategoryLabel,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
} from '@auditor/shared';
import type { ReportModel } from './types.js';
import { redactSensitiveData } from './security.js';

/**
 * Generates a structured, versioned, secret-redacted JSON export of an audit report.
 */
export function generateJsonReport(model: ReportModel): string {
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
      targetUrl: f.targetUrl,
      evidence: redactSensitiveData(f.evidence),
      remediation: f.remediation,
      references: f.references,
      createdAt: f.createdAt,
    };
  });

  // Preserve summary counts when model contains summary-only synthetic counts (e.g., empty findings array in test mocks)
  const useFindingDerivedCounts = model.findings.length > 0;
  const summary = {
    ...model.summary,
    byCategory: useFindingDerivedCounts ? byCategory : model.summary.byCategory,
    byStatus: useFindingDerivedCounts ? byStatus : (model.summary.byStatus ?? {}),
    confirmedCount: useFindingDerivedCounts ? confirmedCount : model.summary.confirmedCount,
    firmCount: useFindingDerivedCounts ? firmCount : (model.summary.firmCount ?? 0),
    potentialCount: useFindingDerivedCounts ? potentialCount : model.summary.potentialCount,
  };

  // Deeply redact sensitive secrets from findings and scan configuration
  const sanitizedModel = redactSensitiveData({
    schemaVersion: '1.0.0',
    reportId: model.reportId,
    title: model.title,
    generatedAt: model.generatedAt,
    site: model.site,
    scanRun: {
      ...model.scanRun,
      config: redactSensitiveData(model.scanRun.config),
    },
    summary,
    consolidatedFindings: model.consolidatedFindings ?? [],
    findings: normalizedFindings,
  });

  return JSON.stringify(sanitizedModel, null, 2);
}
