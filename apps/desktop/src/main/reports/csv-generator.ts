import {
  getFindingCategoryLabel,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
} from '@auditor/shared';
import type { ReportModel } from './types.js';
import { escapeCsvField } from './security.js';

/**
 * Generates an RFC 4180 compliant CSV export of audit findings.
 * Includes UTF-8 BOM for Microsoft Excel compatibility.
 * Strictly neutralizes spreadsheet formula injection (=, +, -, @, Tab, CR).
 */
export function generateCsvReport(model: ReportModel): string {
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

    const row = [
      escapeCsvField(model.reportId),
      escapeCsvField(model.scanRun.id),
      escapeCsvField(model.site.name),
      escapeCsvField(f.ruleId),
      escapeCsvField(f.severity),
      escapeCsvField(f.confidence),
      escapeCsvField(getFindingCategoryLabel(categoryId)),
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
    ];
    lines.push(row.join(','));
  }

  return `${BOM}${lines.join('\r\n')}\r\n`;
}
