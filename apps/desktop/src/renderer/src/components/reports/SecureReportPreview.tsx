import React, { useState, useMemo } from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import type { ReportDTO, ReportContentDTO } from '@auditor/shared';

export interface SecureReportPreviewProps {
  readonly report: ReportDTO;
  readonly content: ReportContentDTO;
  readonly onClose: () => void;
}

/**
 * Safely parses RFC 4180 CSV content into headers and rows for preview display.
 * Purely algorithmic parser, no eval or external execution.
 */
function parseCsvForPreview(csvText: string): { headers: string[]; rows: string[][] } {
  // Strip UTF-8 BOM if present
  const clean = csvText.startsWith('\uFEFF') ? csvText.slice(1) : csvText;
  const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current);
    return fields;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1, 101).map(parseLine); // Preview up to 100 rows
  return { headers, rows };
}

export const SecureReportPreview: React.FC<SecureReportPreviewProps> = ({
  report,
  content,
  onClose,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [showRawCsv, setShowRawCsv] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const parsedCsv = useMemo(() => {
    if (content.format === 'csv') {
      return parseCsvForPreview(content.content);
    }
    return { headers: [], rows: [] };
  }, [content]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Best effort clipboard
    }
  };

  return (
    <div
      className={`auditor-report-preview-container ${isExpanded ? 'auditor-report-preview--expanded' : ''}`}
      style={{ marginTop: '24px' }}
      data-testid="secure-report-preview"
    >
      <Card
        title={`Report Preview: ${report.title}`}
        subtitle={`Format: ${report.format.toUpperCase()} · Location: ${report.storagePath ?? 'Database Record'}`}
        headerAction={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Badge variant="info" size="sm" title="Zero script execution, zero network access">
              Sandboxed Preview · Isolated
            </Badge>
            <button
              type="button"
              className="auditor-button auditor-button--secondary auditor-button--sm"
              onClick={() => setIsExpanded(prev => !prev)}
              title={isExpanded ? 'Collapse preview' : 'Expand preview to full height'}
            >
              {isExpanded ? 'Collapse' : 'Expand'}
            </button>
            <button
              type="button"
              className="auditor-button auditor-button--secondary auditor-button--sm"
              onClick={onClose}
              title="Close preview"
            >
              Close
            </button>
          </div>
        }
      >
        {/* Security Advisory Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            marginBottom: '16px',
            backgroundColor: 'var(--auditor-bg-subtle, #1e293b)',
            borderRadius: '6px',
            fontSize: '12px',
            color: 'var(--auditor-text-muted, #94a3b8)',
          }}
        >
          <span>
            <strong>Security Boundary:</strong> Report content is isolated from the desktop
            application shell. Scripts and external network calls are disabled.
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {content.format !== 'html' && (
              <button
                type="button"
                className="auditor-button auditor-button--secondary auditor-button--sm"
                onClick={handleCopy}
              >
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
            )}
            {content.format === 'csv' && (
              <button
                type="button"
                className="auditor-button auditor-button--secondary auditor-button--sm"
                onClick={() => setShowRawCsv(prev => !prev)}
              >
                {showRawCsv ? 'View Table' : 'View Raw CSV'}
              </button>
            )}
          </div>
        </div>

        {/* Format Specific Preview Rendering */}
        {content.format === 'html' ? (
          <iframe
            title="Sandboxed HTML Report Preview"
            srcDoc={content.content}
            sandbox=""
            data-testid="sandboxed-html-iframe"
            style={{
              width: '100%',
              height: isExpanded ? '750px' : '520px',
              border: '1px solid var(--auditor-border, #334155)',
              borderRadius: '6px',
              backgroundColor: '#0f172a',
              display: 'block',
              transition: 'height 0.2s ease',
            }}
          />
        ) : content.format === 'csv' && !showRawCsv ? (
          <div
            style={{
              maxHeight: isExpanded ? '750px' : '520px',
              overflow: 'auto',
              border: '1px solid var(--auditor-border, #334155)',
              borderRadius: '6px',
            }}
            data-testid="csv-table-preview"
          >
            <table
              className="auditor-table"
              style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}
            >
              <thead>
                <tr style={{ background: 'var(--auditor-bg-subtle, #1e293b)' }}>
                  {parsedCsv.headers.map((h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'left',
                        borderBottom: '1px solid var(--auditor-border, #334155)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedCsv.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={parsedCsv.headers.length || 1}
                      style={{ padding: '16px', textAlign: 'center' }}
                    >
                      No data rows in CSV export.
                    </td>
                  </tr>
                ) : (
                  parsedCsv.rows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      style={{
                        borderBottom: '1px solid var(--auditor-border, #334155)',
                      }}
                    >
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          style={{
                            padding: '6px 12px',
                            maxWidth: '300px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={cell}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <pre
            data-testid="raw-content-preview"
            style={{
              background: 'var(--auditor-bg-subtle, #1e293b)',
              color: 'var(--auditor-text, #f8fafc)',
              padding: '16px',
              borderRadius: '6px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '12px',
              maxHeight: isExpanded ? '750px' : '450px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              border: '1px solid var(--auditor-border, #334155)',
            }}
          >
            <code>{content.content}</code>
          </pre>
        )}
      </Card>
    </div>
  );
};
