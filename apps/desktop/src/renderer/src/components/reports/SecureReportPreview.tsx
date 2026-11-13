import React, { useState, useMemo } from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import type { ReportDTO, ReportContentDTO } from '@auditor/shared';

export interface SecureReportPreviewProps {
  readonly report: ReportDTO;
  readonly content: ReportContentDTO;
  readonly onClose: () => void;
}

export interface ParsedCsvPreview {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly totalRowsParsed: number;
  readonly hasMalformedRecords: boolean;
}

/**
 * Restrictive Content Security Policy enforced on HTML report preview documents.
 * - default-src 'none': Disallow everything by default.
 * - style-src 'unsafe-inline': Allow self-contained inline report stylesheets and CSS variables.
 * - img-src data:: Allow only inline base64 visual evidence screenshots. Blocks all external/local network requests.
 * - font-src 'none': Forbid all external or custom web fonts.
 * - script-src 'none': Forbid all scripts (inline or external).
 * - connect-src 'none': Forbid all fetch, XHR, WebSocket, EventSource, sendBeacon.
 * - media-src 'none': Forbid all audio and video.
 * - object-src 'none': Forbid all plugins (Flash, Java, PDF).
 * - child-src 'none' & frame-src 'none': Forbid nested frames.
 * - worker-src 'none': Forbid Web Workers & Service Workers.
 * - form-action 'none': Forbid form submissions.
 * - base-uri 'none': Forbid <base> tag URL manipulation.
 */
export const REPORT_PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Prepares and hardens HTML content for isolated rendering in a sandboxed iframe.
 * 1. Strips any pre-existing or adversary-controlled <meta ... Content-Security-Policy ...> tags.
 * 2. Strips any <base ...> tags to prevent base URL hijacking.
 * 3. Injects the authoritative REPORT_PREVIEW_CSP meta tag at the top of <head>.
 */
export function prepareSandboxedHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="${REPORT_PREVIEW_CSP}">\n</head>\n<body></body>\n</html>`;
  }

  // 1. Strip existing CSP meta tags to prevent policy conflicts or overrides
  let sanitized = rawHtml.replace(
    /<meta\s+[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
    '',
  );

  // 2. Strip any <base> tags to prevent relative URL hijacking
  sanitized = sanitized.replace(/<base\b[^>]*>/gi, '');

  const cspMetaTag = `<meta http-equiv="Content-Security-Policy" content="${REPORT_PREVIEW_CSP}">`;

  // 3. Inject authoritative CSP tag into <head>
  if (/<head\b[^>]*>/i.test(sanitized)) {
    return sanitized.replace(/(<head\b[^>]*>)/i, `$1\n  ${cspMetaTag}`);
  }

  if (/<html\b[^>]*>/i.test(sanitized)) {
    return sanitized.replace(/(<html\b[^>]*>)/i, `$1\n<head>\n  ${cspMetaTag}\n</head>`);
  }

  // If no html or head tags exist, wrap safely
  return `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  ${cspMetaTag}\n</head>\n<body>\n${sanitized}\n</body>\n</html>`;
}

/**
 * Full RFC 4180 compliant CSV state-machine parser.
 * Properly handles embedded newlines inside quoted fields, escaped double quotes (""),
 * quoted commas, UTF-8 BOM, empty/trailing fields, and malformed records.
 */
export function parseCsvForPreview(
  csvText: string,
  maxDataRows = 100,
): ParsedCsvPreview {
  if (!csvText || typeof csvText !== 'string') {
    return { headers: [], rows: [], totalRowsParsed: 0, hasMalformedRecords: false };
  }

  // Strip UTF-8 BOM if present
  const clean = csvText.startsWith('\uFEFF') ? csvText.slice(1) : csvText;
  if (clean.length === 0) {
    return { headers: [], rows: [], totalRowsParsed: 0, hasMalformedRecords: false };
  }

  const allRecords: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let hasMalformed = false;
  let quoteClosed = false;

  const len = clean.length;
  let i = 0;

  while (i < len) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && clean[i + 1] === '"') {
          // Escaped double quote ("")
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote of quoted field
          inQuotes = false;
          quoteClosed = true;
          i++;
          continue;
        }
      } else {
        // Literal character inside quoted field (including \r, \n, commas, unicode)
        currentField += char;
        i++;
        continue;
      }
    }

    if (quoteClosed) {
      if (char === ',') {
        currentRecord.push(currentField);
        currentField = '';
        quoteClosed = false;
        i++;
        continue;
      } else if (char === '\r') {
        currentRecord.push(currentField);
        currentField = '';
        quoteClosed = false;
        if (i + 1 < len && clean[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
        allRecords.push(currentRecord);
        currentRecord = [];
        if (allRecords.length > maxDataRows) break;
        continue;
      } else if (char === '\n') {
        currentRecord.push(currentField);
        currentField = '';
        quoteClosed = false;
        i++;
        allRecords.push(currentRecord);
        currentRecord = [];
        if (allRecords.length > maxDataRows) break;
        continue;
      } else if (char === ' ' || char === '\t') {
        i++;
        continue;
      } else {
        hasMalformed = true;
        currentField += char;
        quoteClosed = false;
        i++;
        continue;
      }
    }

    // Unquoted field
    if (char === '"') {
      if (currentField.length === 0) {
        inQuotes = true;
        i++;
        continue;
      } else {
        hasMalformed = true;
        currentField += '"';
        i++;
        continue;
      }
    } else if (char === ',') {
      currentRecord.push(currentField);
      currentField = '';
      i++;
      continue;
    } else if (char === '\r') {
      currentRecord.push(currentField);
      currentField = '';
      if (i + 1 < len && clean[i + 1] === '\n') {
        i += 2;
      } else {
        i++;
      }
      allRecords.push(currentRecord);
      currentRecord = [];
      if (allRecords.length > maxDataRows) break;
      continue;
    } else if (char === '\n') {
      currentRecord.push(currentField);
      currentField = '';
      i++;
      allRecords.push(currentRecord);
      currentRecord = [];
      if (allRecords.length > maxDataRows) break;
      continue;
    } else {
      currentField += char;
      i++;
      continue;
    }
  }

  if (inQuotes) {
    hasMalformed = true;
  }

  if (currentField.length > 0 || quoteClosed || currentRecord.length > 0) {
    currentRecord.push(currentField);
    allRecords.push(currentRecord);
  }

  if (allRecords.length === 0) {
    return { headers: [], rows: [], totalRowsParsed: 0, hasMalformedRecords: hasMalformed };
  }

  const headers = allRecords[0];
  const rows = allRecords.slice(1, maxDataRows + 1);

  return {
    headers,
    rows,
    totalRowsParsed: Math.max(0, allRecords.length - 1),
    hasMalformedRecords: hasMalformed,
  };
}

export const SecureReportPreview: React.FC<SecureReportPreviewProps> = ({
  report,
  content,
  onClose,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [showRawCsv, setShowRawCsv] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const preparedHtml = useMemo(() => {
    if (content.format === 'html') {
      return prepareSandboxedHtml(content.content);
    }
    return '';
  }, [content]);

  const parsedCsv = useMemo(() => {
    if (content.format === 'csv') {
      return parseCsvForPreview(content.content);
    }
    return { headers: [], rows: [], totalRowsParsed: 0, hasMalformedRecords: false };
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
            <Badge variant="info" size="sm" title="Zero script execution, zero external network access">
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
            application shell. Scripts and external network calls are disabled via strict sandbox and Content Security Policy.
            {content.format === 'csv' && parsedCsv.hasMalformedRecords && (
              <span style={{ color: '#f59e0b', marginLeft: '8px' }}>
                (Notice: Malformed CSV records detected and safely recovered for preview)
              </span>
            )}
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
            srcDoc={preparedHtml}
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
