import {
  classifyFindingConfidenceBucket,
  FINDING_CATEGORY_FILTER_ORDER,
  getFindingCategoryLabel,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
} from '@auditor/shared';
import type { ReportModel } from './types.js';
import { escapeHtml, sanitizeUrl, redactSensitiveData } from './security.js';
import { getScreenshotEvidenceKey } from './visual-evidence.js';

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined || ms < 0) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

/**
 * Generates a complete, professional, standalone HTML audit report.
 * Features:
 * - 100% self-contained: embedded CSS, zero external JS/fonts/trackers.
 * - Restrictive Content Security Policy (default-src 'none').
 * - Strict context-aware HTML escaping and safe URL protocol filtering.
 * - Deep secret redaction of sensitive credentials and headers in evidence.
 * - Prominent warning callouts for partial/failed/cancelled scan runs.
 */
export function generateHtmlReport(model: ReportModel): string {
  const isFailedOrCancelled = model.summary.scanStatus === 'failed' || model.summary.scanStatus === 'cancelled';
  const isPartialCoverage = !isFailedOrCancelled && Boolean(model.summary.isPartialCoverage || model.summary.coverageStatus === 'partial');
  const hasBrowserUnavailable = model.findings.some(f => f.ruleId === 'SYS_BROWSER_UNAVAILABLE');
  const statusUpper = model.summary.scanStatus.toUpperCase();

  const completedEnginesText =
    model.summary.completedEngines && model.summary.completedEngines.length > 0
      ? model.summary.completedEngines.map(e => e.toUpperCase()).join(', ')
      : 'None';
  const interruptedEngineText = model.summary.interruptedEngine
    ? model.summary.interruptedEngine.toUpperCase()
    : 'None';

  // Findings list HTML
  const findingsListHtml = model.findings.length === 0
    ? `<div class="empty-findings">
         <div class="empty-icon">&#10003;</div>
         <h3>No Findings Detected</h3>
         <p>The automated security and quality analyzers did not detect any issues within the scanned scope.</p>
       </div>`
    : model.findings.map((f, index) => {
        const sevClass = `sev-${(f.severity === 'informational' ? 'info' : f.severity).toLowerCase()}`;
        const confidenceBucket = classifyFindingConfidenceBucket(f.confidence);
        const confText = confidenceBucket.toUpperCase();
        const confClass =
          confidenceBucket === 'confirmed'
            ? 'conf-confirmed'
            : confidenceBucket === 'firm'
              ? 'conf-firm'
              : 'conf-potential';
        const statusBucket = normalizeFindingLifecycleStatus(f.status, f.confidence);
        const statusLabel = statusBucket.replace(/_/g, ' ').toUpperCase();
        const categoryLabel = getFindingCategoryLabel(f);

        // Redact evidence and format JSON/text
        let evidenceHtml = '';
        if (f.evidence !== null && f.evidence !== undefined) {
          const redacted = redactSensitiveData(f.evidence);
          const evidenceStr = typeof redacted === 'string'
            ? redacted
            : JSON.stringify(redacted, null, 2);

          let visualExtra = '';
          if (typeof redacted === 'object' && redacted !== null) {
            const evObj = redacted as Record<string, unknown>;
            if (evObj.screenshot && typeof evObj.screenshot === 'object') {
              const sc = evObj.screenshot as Record<string, unknown>;
              const scKey = getScreenshotEvidenceKey(sc);
              const visualEntry =
                scKey && model.visualEvidence ? model.visualEvidence[scKey] : undefined;
              visualExtra += `
                <div class="visual-evidence-badge" style="margin-bottom: 8px; padding: 6px 10px; background: rgba(56, 189, 248, 0.1); border-left: 3px solid var(--accent); border-radius: 4px; font-size: 12px;">
                  &#128247; <strong>Visual Evidence Captured:</strong> ${escapeHtml(String(sc.viewportProfile ?? 'viewport'))} (${sc.width ?? 0}x${sc.height ?? 0}px &bull; ${Math.round(Number(sc.fileSizeBytes ?? 0) / 1024)} KB)
                </div>
              `;
              if (visualEntry?.embedded && visualEntry.dataUri) {
                visualExtra += `
                  <figure class="visual-evidence-figure">
                    <img class="visual-evidence-img" src="${escapeHtml(visualEntry.dataUri)}" alt="Visual evidence screenshot (${escapeHtml(String(sc.viewportProfile ?? 'viewport'))}) for ${escapeHtml(f.ruleId)}" />
                    <figcaption class="visual-evidence-caption">${escapeHtml(visualEntry.fileName)} &bull; ${Math.round(visualEntry.byteLength / 1024)} KB</figcaption>
                  </figure>
                `;
              } else {
                visualExtra += `
                  <div class="visual-evidence-fallback">
                    ${escapeHtml(visualEntry?.omittedReason ?? 'Visual preview unavailable: screenshot image not bundled in this export.')}
                  </div>
                `;
              }
            }
            if (typeof evObj.selectorNotice === 'string') {
              visualExtra += `
                <div class="selector-notice-badge font-mono" style="margin-bottom: 8px; padding: 4px 8px; background: rgba(148, 163, 184, 0.1); border-radius: 4px; font-size: 11px; color: var(--text-muted);">
                  &#128274; ${escapeHtml(evObj.selectorNotice)}
                </div>
              `;
            }
          }

          evidenceHtml = `
            <div class="finding-detail-section">
              <h5 class="detail-label">Observed Evidence</h5>
              ${visualExtra}
              <pre class="evidence-block"><code>${escapeHtml(evidenceStr)}</code></pre>
            </div>
          `;
        }

        let remediationHtml = '';
        if (f.remediation) {
          remediationHtml = `
            <div class="finding-detail-section remediation-box">
              <h5 class="detail-label">&#9881; Remediation Guidance</h5>
              <p>${escapeHtml(f.remediation)}</p>
            </div>
          `;
        }

        let referencesHtml = '';
        if (f.references && Array.isArray(f.references) && f.references.length > 0) {
          const links = f.references.map(ref => {
            const safe = sanitizeUrl(ref);
            if (safe === '#') {
              return `<li><code>${escapeHtml(ref)}</code></li>`;
            }
            return `<li><a href="${safe}" target="_blank" rel="noopener noreferrer">${escapeHtml(ref)}</a></li>`;
          }).join('\n');
          referencesHtml = `
            <div class="finding-detail-section">
              <h5 class="detail-label">References</h5>
              <ul class="references-list">${links}</ul>
            </div>
          `;
        }

        const safeTargetUrl = sanitizeUrl(f.targetUrl);

        return `
          <article class="finding-card ${sevClass}" id="finding-${index + 1}">
            <header class="finding-header">
              <div class="finding-title-row">
                <span class="finding-index">#${index + 1}</span>
                <h4 class="finding-title">${escapeHtml(f.title)}</h4>
              </div>
              <div class="finding-badges">
                <span class="badge badge-sev ${sevClass}">${escapeHtml(f.severity.toUpperCase())}</span>
                ${
                  f.status === 'needs_manual_review' || f.ruleId.startsWith('a11y-review-')
                    ? '<span class="badge badge-conf" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 600;">MANUAL REVIEW REQUIRED</span>'
                    : `<span class="badge badge-conf ${confClass}">${escapeHtml(confText)}</span>`
                }
                <span class="badge badge-status status-${escapeHtml(statusBucket)}">${escapeHtml(statusLabel)}</span>
                <span class="badge badge-cat">${escapeHtml(categoryLabel)}</span>
                <span class="badge badge-rule">Rule: ${escapeHtml(f.ruleId)}</span>
              </div>
            </header>
            <div class="finding-body">
              <div class="finding-detail-section">
                <h5 class="detail-label">Affected Target URL</h5>
                <div class="target-url-container">
                  ${safeTargetUrl !== '#'
                    ? `<a href="${safeTargetUrl}" class="target-url" target="_blank" rel="noopener noreferrer">${escapeHtml(f.targetUrl)}</a>`
                    : `<span class="target-url">${escapeHtml(f.targetUrl)}</span>`}
                </div>
              </div>
              <div class="finding-detail-section">
                <h5 class="detail-label">Description</h5>
                <p class="finding-description">${escapeHtml(f.description)}</p>
              </div>
              ${evidenceHtml}
              ${remediationHtml}
              ${referencesHtml}
            </div>
          </article>
        `;
      }).join('\n');

  // Category breakdown rows in canonical deterministic order without cross-domain overlap
  const normalizedCategoryCounts = new Map<string, number>();
  for (const [rawCat, count] of Object.entries(model.summary.byCategory)) {
    const canonicalCat = normalizeFindingCategoryId({ category: rawCat });
    normalizedCategoryCounts.set(canonicalCat, (normalizedCategoryCounts.get(canonicalCat) ?? 0) + count);
  }
  const orderedCategoryIds = FINDING_CATEGORY_FILTER_ORDER.map(def => def.id);
  const categoryEntries = Array.from(normalizedCategoryCounts.entries()).sort(([a], [b]) => {
    const idxA = orderedCategoryIds.indexOf(a as (typeof orderedCategoryIds)[number]);
    const idxB = orderedCategoryIds.indexOf(b as (typeof orderedCategoryIds)[number]);
    return (idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA) - (idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB);
  });
  const categoryHtml = categoryEntries.length === 0
    ? '<tr><td colspan="2" class="text-muted">No findings</td></tr>'
    : categoryEntries.map(([cat, count]) => `
        <tr>
          <td class="cat-name">${escapeHtml(getFindingCategoryLabel(cat))}</td>
          <td class="cat-count font-mono">${count}</td>
        </tr>
      `).join('\n');

  // Consolidated findings section HTML
  let consolidatedHtml = '';
  if (model.consolidatedFindings && model.consolidatedFindings.length > 0) {
    const multiOccurrence = model.consolidatedFindings.filter(g => g.totalOccurrences > 1);
    consolidatedHtml = `
    <!-- Consolidated Findings Summary -->
    <section class="section-card">
      <h2 class="section-title">Consolidated Issue Groups (${model.consolidatedFindings.length} Groups, ${multiOccurrence.length} Repeated/Shared)</h2>
      <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
        Repeated findings with matching selectors, structural signatures, or shared templates are consolidated below to highlight root causes. Individual finding records and per-page evidence remain fully detailed in the section below.
      </p>
      <div style="display: grid; gap: 10px;">
        ${model.consolidatedFindings.map(cf => {
          const sevClass = `sev-${(cf.severity === 'informational' ? 'info' : cf.severity).toLowerCase()}`;
          const groupBadge = cf.groupType === 'shared_template_component'
            ? '<span class="status-pill" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600;">SHARED TEMPLATE COMPONENT</span>'
            : cf.groupType === 'repeated_issue'
              ? '<span class="status-pill" style="background: rgba(148, 163, 184, 0.15); color: var(--text-muted); border: 1px solid rgba(148, 163, 184, 0.3); font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600;">REPEATED PATTERN</span>'
              : '<span class="status-pill" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 11px; padding: 2px 6px; border-radius: 4px;">SINGLE OCCURRENCE</span>';

          return `
            <div class="finding-card ${sevClass}" style="margin-bottom: 6px; padding: 12px 16px;">
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px;">
                <span class="badge badge-sev ${sevClass}">${escapeHtml(cf.severity.toUpperCase())}</span>
                ${groupBadge}
                <span class="badge badge-rule">Rule: ${escapeHtml(cf.ruleId)}</span>
                <span style="font-size: 12px; font-weight: 600; color: var(--accent); margin-left: auto;">
                  ${cf.totalOccurrences} occurrences across ${cf.affectedUrls.length} page(s)
                </span>
              </div>
              <h4 class="finding-title" style="margin: 4px 0 6px 0; font-size: 14px;">${escapeHtml(cf.title)}</h4>
              <p class="finding-desc" style="font-size: 13px; margin-bottom: 6px;">${escapeHtml(cf.description)}</p>
              ${cf.selector ? `<p class="font-mono" style="font-size: 11px; background: rgba(0,0,0,0.15); padding: 4px 8px; border-radius: 4px; margin: 4px 0; word-break: break-all;"><strong>Locator:</strong> ${escapeHtml(cf.selector)}</p>` : ''}
              ${cf.groupReason ? `<p style="font-size: 12px; color: var(--text-muted); font-style: italic; margin-bottom: 6px;">${escapeHtml(cf.groupReason)}</p>` : ''}
              <details style="margin-top: 6px; font-size: 12px;">
                <summary style="cursor: pointer; color: var(--accent); font-weight: 500;">View Affected URLs (${cf.affectedUrls.length})</summary>
                <ul style="margin: 6px 0 6px 20px;">
                  ${cf.affectedUrls.map(u => `<li><span class="font-mono">${escapeHtml(u)}</span></li>`).join('')}
                </ul>
              </details>
            </div>
          `;
        }).join('')}
      </div>
    </section>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; child-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none';">
  <title>${escapeHtml(model.title)}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-subtle: #334155;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --accent: #38bdf8;
      --critical: #ef4444;
      --critical-bg: rgba(239, 68, 68, 0.15);
      --high: #f97316;
      --high-bg: rgba(249, 115, 22, 0.15);
      --medium: #f59e0b;
      --medium-bg: rgba(245, 158, 11, 0.15);
      --low: #3b82f6;
      --low-bg: rgba(59, 130, 246, 0.15);
      --info: #64748b;
      --info-bg: rgba(100, 116, 139, 0.15);
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.15);
      --warning: #eab308;
      --warning-bg: rgba(234, 179, 8, 0.15);
      --radius-sm: 4px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --card-bg: #ffffff;
        --card-subtle: #f1f5f9;
        --border: #e2e8f0;
        --text: #0f172a;
        --text-muted: #475569;
        --text-dim: #94a3b8;
        --accent: #0284c7;
        --critical: #dc2626;
        --critical-bg: #fee2e2;
        --high: #ea580c;
        --high-bg: #ffedd5;
        --medium: #d97706;
        --medium-bg: #fef3c7;
        --low: #2563eb;
        --low-bg: #dbeafe;
        --info: #475569;
        --info-bg: #f1f5f9;
        --success: #059669;
        --success-bg: #d1fae5;
        --warning: #ca8a04;
        --warning-bg: #fef9c3;
      }
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.6;
      font-size: 14px;
      padding: 32px 16px;
    }

    .container {
      max-width: 1040px;
      margin: 0 auto;
    }

    /* Header / Cover */
    .report-header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .brand-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .brand-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--accent);
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.05em;
    }
    .status-badge.completed { background: var(--success-bg); color: var(--success); border: 1px solid var(--success); }
    .status-badge.failed { background: var(--critical-bg); color: var(--critical); border: 1px solid var(--critical); }
    .status-badge.cancelled { background: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning); }
    .status-badge.running { background: var(--low-bg); color: var(--low); border: 1px solid var(--low); }

    .report-main-title {
      font-size: 26px;
      font-weight: 800;
      line-height: 1.3;
      margin-bottom: 12px;
    }
    .site-target-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 16px;
    }
    .site-name { font-weight: 600; color: var(--text); }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .meta-item { display: flex; flex-direction: column; }
    .meta-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin-bottom: 2px; }
    .meta-value { font-size: 13px; font-weight: 600; }
    .font-mono { font-family: var(--font-mono); font-size: 12px; }

    /* Alert Banner */
    .alert-banner {
      border-radius: var(--radius-md);
      padding: 16px 20px;
      margin-bottom: 24px;
      font-size: 14px;
    }
    .alert-banner.alert-warning {
      background: var(--warning-bg);
      border: 1px solid var(--warning);
      color: var(--text);
    }
    .alert-banner strong { display: block; margin-bottom: 4px; font-size: 15px; }

    /* Executive Summary Cards */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .summary-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 16px;
      text-align: center;
      transition: transform 0.15s ease;
    }
    .summary-card .count { font-size: 28px; font-weight: 800; line-height: 1; margin-bottom: 6px; }
    .summary-card .label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .summary-card.card-total { border-color: var(--accent); }
    .summary-card.card-total .count { color: var(--accent); }
    .summary-card.card-critical { border-color: var(--critical); }
    .summary-card.card-critical .count { color: var(--critical); }
    .summary-card.card-high { border-color: var(--high); }
    .summary-card.card-high .count { color: var(--high); }
    .summary-card.card-medium { border-color: var(--medium); }
    .summary-card.card-medium .count { color: var(--medium); }
    .summary-card.card-low { border-color: var(--low); }
    .summary-card.card-low .count { color: var(--low); }
    .summary-card.card-info { border-color: var(--info); }
    .summary-card.card-info .count { color: var(--info); }

    /* Section Styling */
    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 24px;
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* Details Grid */
    .details-table-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    @media (max-width: 768px) {
      .details-table-grid { grid-template-columns: 1fr; }
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
    }
    .data-table th, .data-table td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }
    .data-table th { color: var(--text-dim); font-size: 11px; text-transform: uppercase; }

    /* Finding Card */
    .finding-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-left: 5px solid var(--info);
      border-radius: var(--radius-md);
      margin-bottom: 16px;
      overflow: hidden;
    }
    .finding-card.sev-critical { border-left-color: var(--critical); }
    .finding-card.sev-high { border-left-color: var(--high); }
    .finding-card.sev-medium { border-left-color: var(--medium); }
    .finding-card.sev-low { border-left-color: var(--low); }
    .finding-card.sev-info { border-left-color: var(--info); }

    .finding-header {
      padding: 16px 20px;
      background: var(--card-subtle);
      border-bottom: 1px solid var(--border);
    }
    .finding-title-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 8px;
    }
    .finding-index { font-family: var(--font-mono); font-size: 12px; color: var(--text-dim); }
    .finding-title { font-size: 16px; font-weight: 700; color: var(--text); }
    .finding-badges { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-sev.sev-critical { background: var(--critical-bg); color: var(--critical); }
    .badge-sev.sev-high { background: var(--high-bg); color: var(--high); }
    .badge-sev.sev-medium { background: var(--medium-bg); color: var(--medium); }
    .badge-sev.sev-low { background: var(--low-bg); color: var(--low); }
    .badge-sev.sev-info { background: var(--info-bg); color: var(--info); }

    .badge-conf.conf-confirmed { background: var(--success-bg); color: var(--success); }
    .badge-conf.conf-firm { background: var(--low-bg); color: var(--low); }
    .badge-conf.conf-potential { background: var(--warning-bg); color: var(--warning); }
    .badge-status { background: rgba(148, 163, 184, 0.14); color: var(--text-muted); border: 1px solid var(--border); }
    .badge-status.status-confirmed, .badge-status.status-resolved, .badge-status.status-fixed { background: var(--success-bg); color: var(--success); border-color: transparent; }
    .badge-status.status-potential, .badge-status.status-needs_manual_review, .badge-status.status-retest_required { background: var(--warning-bg); color: var(--warning); border-color: transparent; }
    .visual-evidence-figure {
      margin: 8px 0 12px 0;
      padding: 8px;
      background: #020617;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .visual-evidence-img {
      display: block;
      max-width: 100%;
      max-height: 480px;
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: var(--radius-sm);
      margin: 0 auto;
    }
    .visual-evidence-caption {
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      text-align: center;
    }
    .visual-evidence-fallback {
      margin-bottom: 8px;
      padding: 6px 10px;
      background: rgba(148, 163, 184, 0.08);
      border: 1px dashed var(--border);
      border-radius: var(--radius-sm);
      font-size: 12px;
      color: var(--text-muted);
    }
    .badge-cat { background: var(--border); color: var(--text-muted); }
    .badge-rule { background: transparent; border: 1px solid var(--border); color: var(--text-dim); font-family: var(--font-mono); }

    .finding-body { padding: 20px; }
    .finding-detail-section { margin-bottom: 16px; }
    .finding-detail-section:last-child { margin-bottom: 0; }
    .detail-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 4px;
      font-weight: 700;
    }
    .target-url-container {
      background: var(--card-subtle);
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      word-break: break-all;
    }
    .target-url { font-family: var(--font-mono); font-size: 12px; color: var(--accent); text-decoration: none; }
    .target-url:hover { text-decoration: underline; }
    .finding-description { font-size: 13.5px; color: var(--text); }

    .evidence-block {
      background: #020617;
      color: #38bdf8;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 12px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 300px;
    }

    .remediation-box {
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: var(--radius-sm);
      padding: 12px 16px;
    }
    .remediation-box p { font-size: 13px; color: var(--text); }

    .references-list {
      list-style-type: disc;
      padding-left: 20px;
      font-size: 12px;
    }
    .references-list a { color: var(--accent); text-decoration: none; }
    .references-list a:hover { text-decoration: underline; }

    .empty-findings {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-muted);
    }
    .empty-icon { font-size: 36px; color: var(--success); margin-bottom: 12px; }

    /* Footer */
    .report-footer {
      text-align: center;
      padding: 32px 16px;
      color: var(--text-dim);
      font-size: 12px;
      border-top: 1px solid var(--border);
      margin-top: 32px;
    }
    .report-footer p { margin-bottom: 6px; }

    @media print {
      body { background: #fff !important; color: #000 !important; font-size: 11pt; padding: 0; }
      .container { max-width: 100%; }
      .report-header, .section-card, .finding-card { box-shadow: none !important; border: 1px solid #ccc !important; page-break-inside: avoid; }
      .evidence-block { background: #f5f5f5 !important; color: #111 !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header / Cover -->
    <header class="report-header">
      <div class="brand-row">
        <span class="brand-title">Ultimate WordPress &amp; Website Auditor</span>
        <span class="status-badge ${escapeHtml(model.summary.scanStatus.toLowerCase())}">
          SCAN ${escapeHtml(statusUpper)}
        </span>
        ${isPartialCoverage ? `
          <span class="status-badge" style="margin-left: 8px; background: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning);">
            PARTIAL BROWSER COVERAGE
          </span>
        ` : !isFailedOrCancelled ? `
          <span class="status-badge" style="margin-left: 8px; background: var(--success-bg); color: var(--success); border: 1px solid var(--success);">
            FULL COVERAGE
          </span>
        ` : ''}
      </div>
      <h1 class="report-main-title">${escapeHtml(model.title)}</h1>
      <div class="site-target-row">
        <span>Site: <strong class="site-name">${escapeHtml(model.site.name)}</strong></span>
        <span>Target: <a href="${sanitizeUrl(model.scanRun.targetUrl)}" class="font-mono text-accent" target="_blank" rel="noopener noreferrer">${escapeHtml(model.scanRun.targetUrl)}</a></span>
        <span>Platform: <strong>${escapeHtml(model.site.platformType)}</strong></span>
        <span>Env: <strong>${escapeHtml(model.site.environmentType)}</strong></span>
      </div>
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">Report ID</span>
          <span class="meta-value font-mono">${escapeHtml(model.reportId)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Scan Run ID</span>
          <span class="meta-value font-mono">${escapeHtml(model.scanRun.id)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Generated At</span>
          <span class="meta-value">${formatDate(model.generatedAt)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Scan Duration</span>
          <span class="meta-value">${formatDuration(model.summary.scanDurationMs)}</span>
        </div>
      </div>
    </header>

    ${isFailedOrCancelled ? `
      <!-- Warning Banner for Interrupted / Failed Scans -->
      <div class="alert-banner alert-warning" role="alert">
        <strong>&#9888; Warning: Incomplete / ${escapeHtml(statusUpper)} Scan Run</strong>
        <p>This audit report was generated from a scan that terminated with status <strong>${escapeHtml(statusUpper)}</strong>.</p>
        <ul style="margin: 8px 0 8px 20px; font-size: 13px;">
          <li><strong>Audit Coverage:</strong> PARTIAL AUDIT (INTERRUPTED)</li>
          <li><strong>Completed Engines:</strong> ${escapeHtml(completedEnginesText)}</li>
          <li><strong>Interrupted Engine:</strong> ${escapeHtml(interruptedEngineText)}</li>
          <li><strong>Findings Collected Prior to Interruption:</strong> ${model.summary.totalFindings} findings</li>
          <li><strong>Remaining Unverified Areas:</strong> Audit modules associated with the interrupted engine and downstream stages did not execute.</li>
        </ul>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          The findings and metrics below represent partial evidence collected before termination and do NOT constitute a complete security assessment.
        </p>
      </div>
    ` : ''}

    ${isPartialCoverage ? `
      <!-- Notice Banner for Completed Scan with Partial Browser Coverage -->
      <div class="alert-banner alert-warning" role="alert">
        <strong>&#9888; Notice: Audit Completed with Partial Browser Coverage</strong>
        <p>This audit successfully crawled <strong>${model.summary.pagesScanned}</strong> pages, but evaluated <strong>${model.summary.browserPagesAudited ?? 0} of ${model.summary.browserCandidatesTotal ?? model.summary.browserPagesAudited ?? 0}</strong> browser candidate pages due to scan time constraints.</p>
        <ul style="margin: 8px 0 8px 20px; font-size: 13px;">
          <li><strong>Crawl &amp; Static Analyzers:</strong> Completed across all ${model.summary.pagesScanned} discovered pages.</li>
          <li><strong>Browser &amp; Accessibility Engine:</strong> Partial coverage (${model.summary.browserPagesAudited ?? 0} audited${(model.summary.browserCandidatesSkipped ?? 0) > 0 ? `, ${model.summary.browserCandidatesSkipped} skipped due to time budget` : ''}).</li>
          <li><strong>Important Notice:</strong> WCAG accessibility, visual screenshots, and client-side runtime errors reflect the audited pages only and do NOT imply full site-wide browser audit coverage.</li>
        </ul>
      </div>
    ` : ''}

    ${hasBrowserUnavailable ? `
      <!-- Notice Banner for Browser Engine Unavailable -->
      <div class="alert-banner alert-warning" role="alert">
        <strong>&#9888; Limitation Notice: Browser Engine Unavailable</strong>
        <p>A compatible Chromium-based browser was not available during this scan run. HTTP, WordPress, and security header analyzers completed successfully; however, client-side runtime errors, WCAG accessibility, responsive layout shifts, and visual screenshots could not be evaluated. Install an approved Chromium browser to unlock full browser-based audits.</p>
      </div>
    ` : ''}

    <!-- Executive Summary Metrics -->
    <section class="summary-grid" aria-label="Findings Severity Summary">
      <div class="summary-card card-total">
        <div class="count">${model.summary.totalFindings}</div>
        <div class="label">Total Findings</div>
      </div>
      <div class="summary-card card-critical">
        <div class="count">${model.summary.bySeverity.critical}</div>
        <div class="label">Critical</div>
      </div>
      <div class="summary-card card-high">
        <div class="count">${model.summary.bySeverity.high}</div>
        <div class="label">High</div>
      </div>
      <div class="summary-card card-medium">
        <div class="count">${model.summary.bySeverity.medium}</div>
        <div class="label">Medium</div>
      </div>
      <div class="summary-card card-low">
        <div class="count">${model.summary.bySeverity.low}</div>
        <div class="label">Low</div>
      </div>
      <div class="summary-card card-info">
        <div class="count">${model.summary.bySeverity.info}</div>
        <div class="label">Info</div>
      </div>
    </section>

    <!-- Scan Scope & Category Breakdown -->
    <section class="section-card">
      <h2 class="section-title">Scan Coverage &amp; Distribution</h2>
      <div class="details-table-grid">
        <div>
          <h3 class="meta-label" style="margin-bottom: 8px;">Execution Coverage</h3>
          <table class="data-table">
            <tbody>
              <tr><td>Target URL</td><td class="font-mono">${escapeHtml(model.scanRun.targetUrl)}</td></tr>
              <tr><td>Scan Type</td><td>${escapeHtml(model.scanRun.scanType)}</td></tr>
              <tr><td>Scan Status</td><td><span class="status-badge ${escapeHtml(model.summary.scanStatus.toLowerCase())}">${escapeHtml(statusUpper)}</span></td></tr>
              <tr><td>Audit Coverage</td><td><strong>${
                isFailedOrCancelled
                  ? 'PARTIAL AUDIT (INTERRUPTED)'
                  : isPartialCoverage
                    ? 'COMPLETED (PARTIAL BROWSER COVERAGE)'
                    : 'COMPLETE AUDIT (FULL COVERAGE)'
              }</strong></td></tr>
              ${isPartialCoverage && model.summary.coverageWarning ? `
                <tr><td>Coverage Notice</td><td style="color: var(--warning);">${escapeHtml(model.summary.coverageWarning)}</td></tr>
              ` : ''}
              ${typeof model.summary.browserCandidatesTotal === 'number' && model.summary.browserCandidatesTotal > 0 ? `
                <tr><td>Browser Candidates</td><td class="font-mono">${model.summary.browserPagesAudited ?? 0} of ${model.summary.browserCandidatesTotal} audited${(model.summary.browserCandidatesSkipped ?? 0) > 0 ? ` (${model.summary.browserCandidatesSkipped} skipped due to budget)` : ''}</td></tr>
              ` : ''}
              ${model.summary.isPartialAudit ? `
                <tr><td>Completed Engines</td><td class="font-mono">${escapeHtml(completedEnginesText)}</td></tr>
                <tr><td>Interrupted Engine</td><td class="font-mono">${escapeHtml(interruptedEngineText)}</td></tr>
              ` : ''}
              <tr><td>Pages Crawled (Static Analysis)</td><td class="font-mono">${model.summary.pagesScanned} pages (100% static coverage)</td></tr>
              <tr><td>Browser Pages Audited</td><td class="font-mono">${model.summary.browserPagesAudited ?? 0} of ${model.summary.pagesScanned} pages (${Math.round(((model.summary.browserPagesAudited ?? 0) / Math.max(1, model.summary.pagesScanned)) * 100)}% browser coverage)</td></tr>
              <tr><td>Browser Coverage Accounting</td><td><strong>${
                (model.summary.browserPagesAudited ?? 0) >= model.summary.pagesScanned && !(model.summary.browserCandidatesSkipped ?? 0)
                  ? 'Full Browser Coverage (100%)'
                  : `Partial Browser Coverage (${model.summary.browserPagesAudited ?? 0}/${model.summary.pagesScanned} pages audited)`
              }</strong></td></tr>
              <tr><td>Screenshots Captured</td><td class="font-mono">${model.summary.screenshotsCaptured ?? 0}</td></tr>
              <tr><td>Pages Failed / Errored</td><td class="font-mono">${model.summary.pagesFailed}</td></tr>
              <tr><td>Execution Duration</td><td class="font-mono">${formatDuration(model.summary.scanDurationMs)}</td></tr>
              <tr><td>Scan Started At</td><td>${formatDate(model.scanRun.startedAt)}</td></tr>
              <tr><td>Scan Ended At</td><td>${formatDate(model.scanRun.completedAt ?? model.scanRun.cancelledAt)}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3 class="meta-label" style="margin-bottom: 8px;">Findings by Category &amp; Confidence</h3>
          <table class="data-table">
            <thead>
              <tr><th>Category</th><th>Count</th></tr>
            </thead>
            <tbody>
              ${categoryHtml}
            </tbody>
            <tfoot>
              <tr>
                <td style="font-weight: 700; border-top: 1px solid var(--border);">Verification State</td>
                <td style="border-top: 1px solid var(--border); font-size: 12px;">
                  <span class="badge badge-conf conf-confirmed">${model.summary.confirmedCount} Confirmed</span>
                  <span class="badge badge-conf conf-firm" style="margin-left: 4px;">${model.summary.firmCount ?? 0} Firm</span>
                  <span class="badge badge-conf conf-potential" style="margin-left: 4px;">${model.summary.potentialCount} Potential</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>

    ${consolidatedHtml}

    <!-- Detailed Findings List -->
    <section class="section-card">
      <div class="section-title">
        <span>Detailed Findings (${model.findings.length})</span>
      </div>
      <div class="findings-list">
        ${findingsListHtml}
      </div>
    </section>

    <!-- Scan Limitations & Compliance Boundary -->
    <section class="section-card">
      <h2 class="section-title">Scan Limitations &amp; Disclaimers</h2>
      <div style="font-size: 12px; line-height: 1.6; color: var(--text-muted);">
        <p style="margin-bottom: 8px;"><strong>Automated Scan Limitations:</strong> This report reflects automated observations collected under bounded execution parameters at scan time. Automated audits cannot guarantee the discovery of all vulnerabilities, zero-day defects, or business-logic flaws.</p>
        <p style="margin-bottom: 8px;"><strong>Accessibility Disclaimers:</strong> Automated accessibility evaluations using axe-core verify specific programmatic WCAG 2.0, 2.1, and 2.2 AA success criteria (e.g. contrast, alt text, ARIA roles). Automated rules verify only a subset of WCAG requirements. This report does not constitute a legal certification of WCAG compliance. Items marked as Manual Review require evaluation with assistive technologies.</p>
        <p><strong>Layout Stability &amp; Performance:</strong> Synthetic layout shift (CLS) measurements are observed under simulated headless viewport conditions and do not substitute for Real User Monitoring (RUM) field metrics from Chrome UX Report (CrUX).</p>
      </div>
    </section>

    <!-- Footer -->
    <footer class="report-footer">
      <p><strong>Ultimate WordPress &amp; Website Auditor</strong> &bull; Version ${escapeHtml(model.version)}</p>
      <p>Report ID: <span class="font-mono">${escapeHtml(model.reportId)}</span> &bull; Generated: ${formatDate(model.generatedAt)}</p>
      <p style="margin-top: 8px; font-size: 11px;">Disclaimer: This automated audit reflects technical observations and findings collected at the time of scan execution. It does not certify the complete absence of undiscovered vulnerabilities or security defects.</p>
    </footer>
  </div>
</body>
</html>
`;
}
