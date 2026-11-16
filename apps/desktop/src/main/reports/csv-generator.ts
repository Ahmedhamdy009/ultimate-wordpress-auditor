import {
  CATEGORY_LABELS_I18N,
  getFindingCategoryLabel,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
  resolveBilingualText,
  type RecommendationViewModel,
} from '@auditor/shared';
import { ensureReportViewModel, type ReportPresentationOptions } from './assembler.js';
import type { ReportModel } from './types.js';
import { escapeCsvField } from './security.js';

function findMatchingRecommendation(
  findingId: string,
  ruleId: string,
  recommendationsByFindingId: ReadonlyMap<string, RecommendationViewModel>,
  recommendationsByRuleId: ReadonlyMap<string, RecommendationViewModel>,
): RecommendationViewModel | undefined {
  return recommendationsByFindingId.get(findingId) ?? recommendationsByRuleId.get(ruleId);
}

/**
 * Generates an RFC 4180 compliant CSV export of audit findings.
 * Preserves all 17 historical columns cleanly in order and appends 5 additive
 * Batch 7.4 recommendation columns (Exact Location, Recommendation Summary,
 * Remediation Steps, Verification Steps, Report Locale).
 * Includes UTF-8 BOM for Microsoft Excel compatibility and neutralizes
 * spreadsheet formula injection (=, +, -, @, Tab, CR).
 */
export function generateCsvReport(
  model: ReportModel,
  options?: ReportPresentationOptions,
): string {
  const viewModel = ensureReportViewModel(model, options);

  const recommendationsByFindingId = new Map<string, RecommendationViewModel>();
  const recommendationsByRuleId = new Map<string, RecommendationViewModel>();
  for (const rec of viewModel.recommendations) {
    if (!recommendationsByRuleId.has(rec.ruleId)) {
      recommendationsByRuleId.set(rec.ruleId, rec);
    }
    for (const fid of rec.preservedOriginalFinding.findingIds) {
      recommendationsByFindingId.set(fid, rec);
    }
  }

  const headers = [
    'Report ID',
    'Scan Run ID',
    'Site Name',
    'Rule ID',
    'Severity',
    'Confidence',
    'Category',
    'Title',
    'Target URL',
    'Description',
    'Remediation',
    'Status',
    'Created At',
    'Causality',
    'Classification',
    'Observed Value',
    'Threshold',
    'Exact Location',
    'Recommendation Summary',
    'Remediation Steps',
    'Verification Steps',
    'Report Locale',
  ];

  const lines: string[] = [];

  // UTF-8 Byte Order Mark (BOM)
  const BOM = '\uFEFF';
  lines.push(headers.map(h => escapeCsvField(h)).join(','));

  for (const f of model.findings) {
    const categoryId = normalizeFindingCategoryId({ category: f.category, ruleId: f.ruleId });
    const status = normalizeFindingLifecycleStatus(f.status, f.confidence);
    const ev =
      typeof f.evidence === 'object' && f.evidence !== null
        ? (f.evidence as Record<string, unknown>)
        : null;

    const causality = typeof ev?.causality === 'string' ? ev.causality : '';
    const classification = typeof ev?.classification === 'string' ? ev.classification : '';

    let observedVal = '';
    if (ev?.observedValue !== undefined && ev.observedValue !== null) {
      observedVal = ev.unit ? `${ev.observedValue} ${ev.unit}` : String(ev.observedValue);
    } else if (typeof ev?.observedValueMs === 'number') {
      observedVal = `${ev.observedValueMs} ms`;
    }

    let thresholdVal = '';
    if (ev?.thresholdValue !== undefined && ev.thresholdValue !== null) {
      thresholdVal = ev.unit ? `${ev.thresholdValue} ${ev.unit}` : String(ev.thresholdValue);
    } else if (typeof ev?.thresholdMs === 'number') {
      thresholdVal = `${ev.thresholdMs} ms`;
    } else if (ev?.threshold !== undefined && ev.threshold !== null) {
      thresholdVal = String(ev.threshold);
    }

    const matchedRec = findMatchingRecommendation(
      f.id,
      f.ruleId,
      recommendationsByFindingId,
      recommendationsByRuleId,
    );

    const exactLocation = matchedRec?.exactLocation.summaryText ?? '';
    const recommendationSummary = matchedRec?.problem.primaryText ?? '';
    const remediationSteps = matchedRec
      ? matchedRec.remediationSteps.map(s => `${s.stepNumber}. ${s.text.primaryText}`).join(' | ')
      : '';
    const verificationSteps = matchedRec
      ? matchedRec.verificationSteps.map(s => `${s.stepNumber}. ${s.text.primaryText}`).join(' | ')
      : '';

    const localizedCategory =
      viewModel.locale === 'ar'
        ? resolveBilingualText(
            CATEGORY_LABELS_I18N[categoryId],
            'ar',
            getFindingCategoryLabel(categoryId),
          ).text
        : getFindingCategoryLabel(categoryId);

    const row = [
      escapeCsvField(model.reportId),
      escapeCsvField(model.scanRun.id),
      escapeCsvField(model.site.name),
      escapeCsvField(f.ruleId),
      escapeCsvField(f.severity),
      escapeCsvField(f.confidence),
      escapeCsvField(localizedCategory),
      escapeCsvField(f.title),
      escapeCsvField(f.targetUrl),
      escapeCsvField(f.description),
      escapeCsvField(f.remediation ?? ''),
      escapeCsvField(status),
      escapeCsvField(f.createdAt),
      escapeCsvField(causality),
      escapeCsvField(classification),
      escapeCsvField(observedVal),
      escapeCsvField(thresholdVal),
      escapeCsvField(exactLocation),
      escapeCsvField(recommendationSummary),
      escapeCsvField(remediationSteps),
      escapeCsvField(verificationSteps),
      escapeCsvField(viewModel.locale),
    ];
    lines.push(row.join(','));
  }

  return `${BOM}${lines.join('\r\n')}\r\n`;
}
