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
  ];

  const lines: string[] = [];

  // UTF-8 Byte Order Mark (BOM)
  const BOM = '\uFEFF';
  lines.push(headers.map(h => escapeCsvField(h)).join(','));

  for (const f of model.findings) {
    const categoryId = normalizeFindingCategoryId({ category: f.category, ruleId: f.ruleId });
    const status = normalizeFindingLifecycleStatus(f.status, f.confidence);
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
    ];
    lines.push(row.join(','));
  }

  return `${BOM}${lines.join('\r\n')}\r\n`;
}
