import {
  CATEGORY_LABELS_I18N,
  classifyFindingConfidenceBucket,
  extractPerformanceSummary,
  FINDING_CATEGORY_FILTER_ORDER,
  getFindingCategoryLabel,
  LABORATORY_CONTEXT_DISCLAIMER,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
  resolveBilingualText,
  type RecommendationViewModel,
  type ReportLocale,
  type ReportViewModel,
} from '@auditor/shared';
import { ensureReportViewModel, type ReportPresentationOptions } from './assembler.js';
import { renderAuditChartsSection } from './chart-renderer.js';
import { getStandaloneReportCss } from './html-styles.js';
import { escapeHtml, redactSensitiveData, sanitizeUrl } from './security.js';
import type { ReportModel } from './types.js';
import { getScreenshotEvidenceKey } from './visual-evidence.js';

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined || ms < 0) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

function renderVisualEvidenceBlock(
  evObj: Record<string, unknown>,
  model: ReportModel,
  ruleId: string,
  locale: ReportLocale,
): string {
  let html = '';
  if (evObj.screenshot && typeof evObj.screenshot === 'object') {
    const sc = evObj.screenshot as Record<string, unknown>;
    const scKey = getScreenshotEvidenceKey(sc);
    const visualEntry = scKey && model.visualEvidence ? model.visualEvidence[scKey] : undefined;
    const viewport = String(sc.viewportProfile ?? sc.viewport ?? 'viewport');
    const captureType = typeof sc.captureType === 'string' ? sc.captureType : null;
    const captureStatus = typeof sc.status === 'string' ? sc.status : null;
    const pageUrl = typeof sc.pageUrl === 'string' ? sc.pageUrl : null;
    const width = Number(sc.width ?? 0);
    const height = Number(sc.height ?? 0);
    const kb = Math.round(Number(sc.fileSizeBytes ?? visualEntry?.byteLength ?? 0) / 1024);

    const metaBits = [
      `${viewport} (${width}x${height}px`,
      `${kb} KB)`,
      captureType ? `${locale === 'ar' ? 'النوع' : 'Type'}: ${captureType}` : null,
      captureStatus ? `${locale === 'ar' ? 'الحالة' : 'Status'}: ${captureStatus}` : null,
    ]
      .filter(Boolean)
      .join(' &bull; ');

    const headerLabel = locale === 'ar' ? 'دليل بصري ملتقط:' : 'Visual Evidence Captured:';

    html += `
      <div class="visual-evidence-badge" style="margin-top: 8px; margin-bottom: 8px; padding: 6px 10px; background: rgba(56, 189, 248, 0.1); border-inline-start: 3px solid var(--accent); border-radius: 4px; font-size: 12px;">
        &#128247; <strong>${escapeHtml(headerLabel)}</strong> ${escapeHtml(metaBits)}
        ${pageUrl ? `<div class="font-mono" dir="ltr" style="font-size:11px; margin-top:2px;">${escapeHtml(String(redactSensitiveData(pageUrl)))}</div>` : ''}
      </div>
    `;

    if (visualEntry?.embedded && visualEntry.dataUri) {
      html += `
        <figure class="visual-evidence-figure">
          <img class="visual-evidence-img" src="${escapeHtml(visualEntry.dataUri)}" alt="Visual evidence screenshot (${escapeHtml(viewport)}) for ${escapeHtml(ruleId)}" />
          <figcaption class="visual-evidence-caption" dir="ltr">${escapeHtml(visualEntry.fileName)} &bull; ${Math.round(visualEntry.byteLength / 1024)} KB</figcaption>
        </figure>
      `;
    } else {
      html += `
        <div class="visual-evidence-fallback">
          ${escapeHtml(visualEntry?.omittedReason ?? (locale === 'ar' ? 'المعاينة البصرية غير متاحة في هذا التصدير.' : 'Visual preview unavailable: screenshot image not bundled in this export.'))}
        </div>
      `;
    }
  }
  return html;
}

function renderRecommendationsSection(
  dualVm: ReportViewModel,
  activeVm: ReportViewModel,
): string {
  const locale = activeVm.locale;
  const heading = activeVm.labels.findingsAndRemediation;

  if (dualVm.recommendations.length === 0) {
    return `
      <section class="section-card">
        <h2 class="section-title">${escapeHtml(heading)}</h2>
        <p class="text-muted">${escapeHtml(locale === 'ar' ? 'لا توجد توصيات إصلاح نشطة في هذا الفحص.' : 'No active actionable recommendations generated for this scan.')}</p>
      </section>
    `;
  }

  const cardsHtml = dualVm.recommendations
    .map((rec: RecommendationViewModel, idx: number) => {
      const sevClass = `sev-${(rec.severity === 'informational' ? 'info' : rec.severity).toLowerCase()}`;
      const confBucket = classifyFindingConfidenceBucket(rec.originalConfidence);
      const confClass =
        confBucket === 'confirmed'
          ? 'conf-confirmed'
          : confBucket === 'firm'
            ? 'conf-firm'
            : 'conf-potential';

      const simpleProblem = rec.problem.simpleText ?? rec.problem.primaryText;
      const techProblem = rec.problem.technicalText ?? rec.problem.primaryText;
      const simpleImpact = rec.impact.simpleText ?? rec.impact.primaryText;
      const techImpact = rec.impact.technicalText ?? rec.impact.primaryText;

      const confirmedList =
        rec.confirmedCauses.length > 0
          ? `<div class="finding-detail-section">
               <h5 class="detail-label">${escapeHtml(activeVm.labels.confirmedCauses)}</h5>
               <ul class="step-list">${rec.confirmedCauses.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
             </div>`
          : '';

      const possibleList =
        rec.possibleCauses.length > 0
          ? `<div class="finding-detail-section">
               <h5 class="detail-label">${escapeHtml(activeVm.labels.possibleCauses)}</h5>
               <ul class="step-list">${rec.possibleCauses.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
             </div>`
          : '';

      const stepsSimple = rec.remediationSteps
        .map(s => `<li>${escapeHtml(s.text.simpleText ?? s.text.primaryText)}</li>`)
        .join('');
      const stepsTech = rec.remediationSteps
        .map(s => `<li>${escapeHtml(s.text.technicalText ?? s.text.primaryText)}</li>`)
        .join('');

      const verifySimple = rec.verificationSteps
        .map(s => `<li>${escapeHtml(s.text.simpleText ?? s.text.primaryText)}</li>`)
        .join('');
      const verifyTech = rec.verificationSteps
        .map(s => `<li>${escapeHtml(s.text.technicalText ?? s.text.primaryText)}</li>`)
        .join('');

      const platformHtml =
        rec.platformGuidance.length > 0
          ? `<div class="finding-detail-section">
               <h5 class="detail-label">${escapeHtml(activeVm.labels.platformSpecificGuidance)}</h5>
               ${rec.platformGuidance
                 .map(
                   pg => `
                   <div style="padding:10px; border:1px solid var(--border); border-radius:6px; margin-top:6px;">
                     <strong>${escapeHtml(pg.platform.toUpperCase())}</strong>
                     <div style="font-size:12px; color:var(--text-dim);">${escapeHtml(pg.evidenceReason)}</div>
                     <p style="margin-top:4px;">${escapeHtml(pg.summary.simpleText ?? pg.summary.primaryText)}</p>
                     <ul class="step-list">${pg.steps.map(st => `<li>${escapeHtml(st)}</li>`).join('')}</ul>
                   </div>
                 `,
                 )
                 .join('')}
             </div>`
          : '';

      const codeHtml =
        rec.codeExamples.length > 0
          ? `<div class="finding-detail-section audience-technical">
               <h5 class="detail-label">${escapeHtml(activeVm.labels.codeExampleLabel)}</h5>
               ${rec.codeExamples
                 .map(
                   ex => `
                   <div style="margin-top:6px;">
                     <strong>${escapeHtml(ex.title)}</strong> <span class="badge">${escapeHtml(ex.language)}</span>
                     <div style="font-size:11px; color:var(--text-dim);">${escapeHtml(ex.scopeDisclaimer)}</div>
                     <pre class="code-block" dir="ltr"><code>${escapeHtml(ex.snippet)}</code></pre>
                   </div>
                 `,
                 )
                 .join('')}
             </div>`
          : '';

      const urlsListHtml =
        rec.exactLocation.urls.length > 0
          ? `<ul class="step-list" dir="ltr">${rec.exactLocation.urls
              .slice(0, 15)
              .map(u => {
                const safe = sanitizeUrl(u);
                return safe !== '#'
                  ? `<li><a class="text-accent font-mono" href="${safe}" target="_blank" rel="noopener noreferrer">${escapeHtml(u)}</a></li>`
                  : `<li><code dir="ltr">${escapeHtml(u)}</code></li>`;
              })
              .join('')}</ul>`
          : '';

      const selectorsHtml =
        rec.exactLocation.selectors.length > 0
          ? `<div style="margin-top:6px;"><strong>${locale === 'ar' ? 'المحددات:' : 'Selectors:'}</strong> ${rec.exactLocation.selectors.slice(0, 10).map(s => `<code dir="ltr">${escapeHtml(s)}</code>`).join(', ')}</div>`
          : '';

      const rawEvidenceSnapshot = redactSensitiveData(rec.preservedOriginalFinding.preservedEvidence);
      const rawEvidenceStr =
        rawEvidenceSnapshot !== null && rawEvidenceSnapshot !== undefined
          ? typeof rawEvidenceSnapshot === 'string'
            ? rawEvidenceSnapshot
            : JSON.stringify(rawEvidenceSnapshot, null, 2)
          : '';

      return `
        <article class="rec-card ${sevClass}" id="rec-${idx + 1}">
          <header class="finding-header">
            <div class="finding-title-row">
              <span class="finding-index" dir="ltr">#${idx + 1}</span>
              <h3 class="finding-title">${escapeHtml(simpleProblem)}</h3>
            </div>
            <div class="finding-badges">
              <span class="badge badge-sev ${sevClass}">${escapeHtml(rec.severityLabel)}</span>
              <span class="badge badge-conf ${confClass}">${escapeHtml(rec.causeConfidenceLabel)}</span>
              <span class="badge">${escapeHtml(rec.categoryLabel)}</span>
              <span class="badge font-mono" dir="ltr">${escapeHtml(rec.ruleId)}</span>
              <span class="badge" dir="ltr">${escapeHtml(activeVm.labels.occurrencesLabel)}: ${rec.occurrenceCount}</span>
            </div>
          </header>

          <div class="finding-detail-section">
            <h5 class="detail-label">${escapeHtml(activeVm.labels.affectedLocation)}</h5>
            <p class="font-mono" dir="ltr" style="font-size:12px;">${escapeHtml(rec.exactLocation.summaryText)}</p>
            ${urlsListHtml}
            ${selectorsHtml}
          </div>

          <div class="audience-simple">
            <div class="finding-detail-section">
              <h5 class="detail-label">${escapeHtml(activeVm.labels.impactAnalysis)}</h5>
              <p>${escapeHtml(simpleImpact)}</p>
            </div>
            <div class="finding-detail-section">
              <h5 class="detail-label">${escapeHtml(activeVm.labels.remediationSteps)}</h5>
              <ol class="step-list">${stepsSimple}</ol>
            </div>
            <div class="finding-detail-section">
              <h5 class="detail-label">${escapeHtml(activeVm.labels.verificationSteps)}</h5>
              <ol class="step-list">${verifySimple}</ol>
            </div>
          </div>

          <div class="audience-technical">
            <div class="finding-detail-section">
              <h5 class="detail-label">${escapeHtml(activeVm.labels.problemSummary)} (${escapeHtml(activeVm.labels.viewModeTechnicalLabel)})</h5>
              <p>${escapeHtml(techProblem)}</p>
            </div>
            <div class="finding-detail-section">
              <h5 class="detail-label">${escapeHtml(activeVm.labels.impactAnalysis)}</h5>
              <p>${escapeHtml(techImpact)}</p>
            </div>
            ${confirmedList}
            ${possibleList}
            <div class="finding-detail-section">
              <h5 class="detail-label">${escapeHtml(activeVm.labels.remediationSteps)}</h5>
              <ol class="step-list">${stepsTech}</ol>
            </div>
            ${codeHtml}
            <div class="finding-detail-section">
              <h5 class="detail-label">${escapeHtml(activeVm.labels.verificationSteps)}</h5>
              <ol class="step-list">${verifyTech}</ol>
            </div>
            <details style="margin-top:10px;">
              <summary style="cursor:pointer; color:var(--accent); font-weight:600; font-size:12px;">
                ${escapeHtml(activeVm.labels.rawEvidenceLabel)} (Finding IDs: ${escapeHtml(rec.preservedOriginalFinding.findingIds.join(', ') || rec.ruleId)})
              </summary>
              <div style="margin-top:8px; font-size:12px;">
                <p><strong>${escapeHtml(String(redactSensitiveData(rec.preservedOriginalFinding.title)))}</strong> &mdash; ${escapeHtml(String(redactSensitiveData(rec.preservedOriginalFinding.description)))}</p>
                ${rawEvidenceStr ? `<pre class="evidence-block" dir="ltr"><code>${escapeHtml(rawEvidenceStr)}</code></pre>` : ''}
              </div>
            </details>
          </div>

          ${platformHtml}

          <div class="finding-detail-section">
            <h5 class="detail-label">${escapeHtml(activeVm.labels.knownLimitations)}</h5>
            <ul class="step-list" style="font-size:12px; color:var(--text-muted);">
              ${rec.limitations.map(lim => `<li>${escapeHtml(lim)}</li>`).join('')}
            </ul>
          </div>
        </article>
      `;
    })
    .join('\n');

  return `
    <section class="section-card" aria-label="${escapeHtml(heading)}">
      <h2 class="section-title">${escapeHtml(heading)} (${dualVm.recommendations.length})</h2>
      <p class="section-subtitle">${escapeHtml(activeVm.disclosures.readOnlyAuditNotice)}</p>
      ${cardsHtml}
    </section>
  `;
}

/**
 * Generates a complete, self-contained, bilingual, offline-capable HTML audit report.
 * Powered exclusively by `@auditor/shared` via `ensureReportViewModel()`, preserving all
 * strict CSP (`default-src 'none'; script-src 'none'`), XSS, URL, and secret redaction rules.
 */
export function generateHtmlReport(
  model: ReportModel,
  options?: ReportPresentationOptions,
): string {
  const activeVm = ensureReportViewModel(model, options);
  const dualVm =
    activeVm.viewMode === 'dual'
      ? activeVm
      : ensureReportViewModel(model, { locale: activeVm.locale, viewMode: 'dual' });

  const locale: ReportLocale = activeVm.locale;
  const isArabic = locale === 'ar';
  const dirAttr = activeVm.direction;
  const htmlOpenTag = isArabic ? '<html lang="ar" dir="rtl">' : '<html lang="en">';

  const isFailedOrCancelled =
    model.summary.scanStatus === 'failed' || model.summary.scanStatus === 'cancelled';
  const isPartialCoverage =
    !isFailedOrCancelled &&
    Boolean(model.summary.isPartialCoverage || model.summary.coverageStatus === 'partial');
  const hasBrowserUnavailable = model.findings.some(f => f.ruleId === 'SYS_BROWSER_UNAVAILABLE');
  const statusUpper = model.summary.scanStatus.toUpperCase();

  const completedEnginesText =
    model.summary.completedEngines && model.summary.completedEngines.length > 0
      ? model.summary.completedEngines.map(e => e.toUpperCase()).join(', ')
      : 'None';
  const interruptedEngineText = model.summary.interruptedEngine
    ? model.summary.interruptedEngine.toUpperCase()
    : 'None';

  // Detailed raw findings cards (preserved verbatim + visual screenshot evidence)
  const findingsListHtml =
    model.findings.length === 0
      ? `<div class="empty-findings">
           <div class="empty-icon">&#10003;</div>
           <h3>${isArabic ? 'لم تُرصد ملاحظات' : 'No Findings Detected'}</h3>
           <p>${isArabic ? 'لم ترصد أدوات الفحص أي ملاحظات ضمن النطاق المفحوص.' : 'The automated security and quality analyzers did not detect any issues within the scanned scope.'}</p>
         </div>`
      : model.findings
          .map((f, index) => {
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
            const categoryId = normalizeFindingCategoryId({
              category: f.category,
              ruleId: f.ruleId,
            });
            const categoryLabel = isArabic
              ? resolveBilingualText(
                  CATEGORY_LABELS_I18N[categoryId],
                  'ar',
                  getFindingCategoryLabel(f),
                ).text
              : getFindingCategoryLabel(f);

            let evidenceHtml = '';
            let causalityBadge = '';
            let classificationBadge = '';

            if (f.evidence !== null && f.evidence !== undefined) {
              const redacted = redactSensitiveData(f.evidence);
              const evidenceStr =
                typeof redacted === 'string' ? redacted : JSON.stringify(redacted, null, 2);

              let visualExtra = '';
              let perfExtra = '';

              if (typeof redacted === 'object' && redacted !== null) {
                const evObj = redacted as Record<string, unknown>;

                if (evObj.causality === 'causal') {
                  causalityBadge =
                    '<span class="badge badge-causal">CAUSAL (PROVEN CAUSE)</span>';
                } else if (evObj.causality === 'correlational') {
                  causalityBadge =
                    '<span class="badge badge-correlational">CORRELATIONAL (ASSOCIATED FACTOR)</span>';
                }

                if (typeof evObj.classification === 'string') {
                  classificationBadge = `<span class="badge badge-bottleneck">BOTTLENECK: ${escapeHtml(evObj.classification)}</span>`;
                }

                let observedValStr = '';
                if (evObj.observedValue !== undefined && evObj.observedValue !== null) {
                  observedValStr = `${evObj.observedValue}${evObj.unit ? ` ${evObj.unit}` : ''}`;
                } else if (typeof evObj.observedValueMs === 'number') {
                  observedValStr = `${evObj.observedValueMs} ms`;
                }

                let thresholdValStr = '';
                if (evObj.thresholdValue !== undefined && evObj.thresholdValue !== null) {
                  thresholdValStr = `${evObj.thresholdValue}${evObj.unit ? ` ${evObj.unit}` : ''}`;
                } else if (typeof evObj.thresholdMs === 'number') {
                  thresholdValStr = `${evObj.thresholdMs} ms`;
                } else if (evObj.threshold !== undefined && evObj.threshold !== null) {
                  thresholdValStr = String(evObj.threshold);
                }

                if (observedValStr && thresholdValStr) {
                  perfExtra += `
                    <div class="metric-comparison-box">
                      <span class="metric-comp-label">Observed Metric:</span> <strong dir="ltr">${escapeHtml(observedValStr)}</strong> &bull;
                      <span class="metric-comp-label">Target Budget:</span> <strong dir="ltr">${escapeHtml(thresholdValStr)}</strong>
                    </div>
                  `;
                }

                if (typeof evObj.inferenceRationale === 'string') {
                  perfExtra += `
                    <div class="inference-rationale-box">
                      <strong>Inference Rationale:</strong> ${escapeHtml(evObj.inferenceRationale)}
                    </div>
                  `;
                }

                const limNotice = evObj.limitationsNotice ?? evObj.limitationNotice;
                if (typeof limNotice === 'string') {
                  perfExtra += `
                    <div class="limitations-box">
                      <h5 class="detail-label">&#9888; Measurement Limitations</h5>
                      <p>${escapeHtml(limNotice)}</p>
                    </div>
                  `;
                }

                const resourcesList = Array.isArray(evObj.resources)
                  ? evObj.resources
                  : Array.isArray(evObj.renderBlockingResources)
                    ? evObj.renderBlockingResources
                    : Array.isArray(evObj.uncompressedAssets)
                      ? evObj.uncompressedAssets
                      : Array.isArray(evObj.oversizedImages)
                        ? evObj.oversizedImages
                        : null;

                if (resourcesList && resourcesList.length > 0) {
                  const items = resourcesList
                    .slice(0, 10)
                    .map((r: unknown) => {
                      if (typeof r === 'object' && r !== null) {
                        const resObj = r as Record<string, unknown>;
                        const u = String(redactSensitiveData(resObj.url ?? resObj.currentSrc ?? resObj.targetUrl ?? ''));
                        const size =
                          typeof resObj.transferSizeBytes === 'number'
                            ? `(${Math.round(resObj.transferSizeBytes / 1024)} KB)`
                            : '';
                        return `<li><code dir="ltr">${escapeHtml(u)}</code> ${size}</li>`;
                      }
                      return `<li><code dir="ltr">${escapeHtml(String(redactSensitiveData(r)))}</code></li>`;
                    })
                    .join('');
                  perfExtra += `
                    <div class="affected-resources-box">
                      <h5 class="detail-label">&#128196; Affected Resources (${resourcesList.length}${resourcesList.length > 10 ? ', showing top 10' : ''})</h5>
                      <ul class="step-list">${items}</ul>
                    </div>
                  `;
                }

                visualExtra += renderVisualEvidenceBlock(evObj, model, f.ruleId, locale);

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
                  <h5 class="detail-label">${isArabic ? 'الأدلة المرصودة' : 'Observed Evidence'}</h5>
                  ${perfExtra}
                  ${visualExtra}
                  <pre class="evidence-block" dir="ltr"><code>${escapeHtml(evidenceStr)}</code></pre>
                </div>
              `;
            }

            const safeTitle = String(redactSensitiveData(f.title));
            const safeDescription = String(redactSensitiveData(f.description));
            const safeRemediation = f.remediation
              ? String(redactSensitiveData(f.remediation))
              : null;

            const remediationHtml = safeRemediation
              ? `<div class="finding-detail-section remediation-box">
                   <h5 class="detail-label">&#9881; ${isArabic ? 'إرشاد المعالجة المرفق' : 'Remediation Guidance'}</h5>
                   <p>${escapeHtml(safeRemediation)}</p>
                 </div>`
              : '';

            let referencesHtml = '';
            if (f.references && Array.isArray(f.references) && f.references.length > 0) {
              const links = f.references
                .map(ref => {
                  const redactedRef = String(redactSensitiveData(ref));
                  const safe = sanitizeUrl(redactedRef);
                  return safe === '#'
                    ? `<li><code dir="ltr">${escapeHtml(redactedRef)}</code></li>`
                    : `<li><a href="${safe}" class="text-accent" dir="ltr" target="_blank" rel="noopener noreferrer">${escapeHtml(redactedRef)}</a></li>`;
                })
                .join('\n');
              referencesHtml = `
                <div class="finding-detail-section">
                  <h5 class="detail-label">${escapeHtml(activeVm.labels.referencesLabel)}</h5>
                  <ul class="step-list">${links}</ul>
                </div>
              `;
            }

            const safeTargetUrlRaw = String(redactSensitiveData(f.targetUrl));
            const safeTargetUrl = sanitizeUrl(safeTargetUrlRaw);

            return `
              <article class="finding-card ${sevClass}" id="finding-${index + 1}">
                <header class="finding-header">
                  <div class="finding-title-row">
                    <span class="finding-index" dir="ltr">#${index + 1}</span>
                    <h4 class="finding-title">${escapeHtml(safeTitle)}</h4>
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
                    <span class="badge badge-rule font-mono" dir="ltr">Rule: ${escapeHtml(f.ruleId)}</span>
                    ${causalityBadge}
                    ${classificationBadge}
                  </div>
                </header>
                <div class="finding-body">
                  <div class="finding-detail-section">
                    <h5 class="detail-label">${isArabic ? 'الرابط المستهدف' : 'Affected Target URL'}</h5>
                    <div class="target-url-container" dir="ltr">
                      ${
                        safeTargetUrl !== '#'
                          ? `<a href="${safeTargetUrl}" class="target-url text-accent font-mono" target="_blank" rel="noopener noreferrer">${escapeHtml(safeTargetUrlRaw)}</a>`
                          : `<span class="target-url font-mono">${escapeHtml(safeTargetUrlRaw)}</span>`
                      }
                    </div>
                  </div>
                  <div class="finding-detail-section">
                    <h5 class="detail-label">${isArabic ? 'الوصف' : 'Description'}</h5>
                    <p class="finding-description">${escapeHtml(safeDescription)}</p>
                  </div>
                  ${evidenceHtml}
                  ${remediationHtml}
                  ${referencesHtml}
                </div>
              </article>
            `;
          })
          .join('\n');

  // Category breakdown rows
  const normalizedCategoryCounts = new Map<string, number>();
  for (const [rawCat, count] of Object.entries(model.summary.byCategory)) {
    const canonicalCat = normalizeFindingCategoryId({ category: rawCat });
    normalizedCategoryCounts.set(canonicalCat, (normalizedCategoryCounts.get(canonicalCat) ?? 0) + count);
  }
  const orderedCategoryIds = FINDING_CATEGORY_FILTER_ORDER.map(def => def.id);
  const categoryEntries = Array.from(normalizedCategoryCounts.entries()).sort(([a], [b]) => {
    const idxA = orderedCategoryIds.indexOf(a as (typeof orderedCategoryIds)[number]);
    const idxB = orderedCategoryIds.indexOf(b as (typeof orderedCategoryIds)[number]);
    return (
      (idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA) -
      (idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB)
    );
  });
  const categoryHtml =
    categoryEntries.length === 0
      ? `<tr><td colspan="2" class="text-muted">${isArabic ? 'لا توجد ملاحظات' : 'No findings'}</td></tr>`
      : categoryEntries
          .map(([cat, count]) => {
            const catName = isArabic
              ? resolveBilingualText(
                  CATEGORY_LABELS_I18N[cat],
                  'ar',
                  getFindingCategoryLabel(cat),
                ).text
              : getFindingCategoryLabel(cat);
            return `
              <tr>
                <td class="cat-name">${escapeHtml(catName)}</td>
                <td class="cat-count font-mono" dir="ltr">${count}</td>
              </tr>
            `;
          })
          .join('\n');

  // Consolidated findings HTML
  let consolidatedHtml = '';
  if (model.consolidatedFindings && model.consolidatedFindings.length > 0) {
    const multiOccurrence = model.consolidatedFindings.filter(g => g.totalOccurrences > 1);
    consolidatedHtml = `
      <section class="section-card audience-technical">
        <h2 class="section-title">${isArabic ? 'المجموعات المجمّعة للملاحظات' : 'Consolidated Issue Groups'} (${model.consolidatedFindings.length} Groups, ${multiOccurrence.length} Repeated/Shared)</h2>
        <div style="display: grid; gap: 10px;">
          ${model.consolidatedFindings
            .map(cf => {
              const sevClass = `sev-${(cf.severity === 'informational' ? 'info' : cf.severity).toLowerCase()}`;
              return `
                <div class="finding-card ${sevClass}" style="margin-bottom: 6px; padding: 12px 16px;">
                  <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px;">
                    <span class="badge badge-sev ${sevClass}">${escapeHtml(cf.severity.toUpperCase())}</span>
                    <span class="badge badge-rule font-mono" dir="ltr">Rule: ${escapeHtml(cf.ruleId)}</span>
                    <span dir="ltr" style="font-size: 12px; font-weight: 600; color: var(--accent);">
                      ${cf.totalOccurrences} occurrences across ${cf.affectedUrls.length} page(s)
                    </span>
                  </div>
                  <h4 class="finding-title" style="margin: 4px 0 6px 0; font-size: 14px;">${escapeHtml(String(redactSensitiveData(cf.title)))}</h4>
                  <p class="finding-desc" style="font-size: 13px; margin-bottom: 6px;">${escapeHtml(String(redactSensitiveData(cf.description)))}</p>
                  ${cf.selector ? `<p class="font-mono" dir="ltr" style="font-size: 11px; padding: 4px 8px; border-radius: 4px; margin: 4px 0;"><strong>Locator:</strong> ${escapeHtml(String(redactSensitiveData(cf.selector)))}</p>` : ''}
                  <details style="margin-top: 6px; font-size: 12px;">
                    <summary style="cursor: pointer; color: var(--accent); font-weight: 500;">${escapeHtml(activeVm.labels.affectedUrls)} (${cf.affectedUrls.length})</summary>
                    <ul class="step-list" dir="ltr">
                      ${cf.affectedUrls.map(u => `<li><span class="font-mono">${escapeHtml(String(redactSensitiveData(u)))}</span></li>`).join('')}
                    </ul>
                  </details>
                </div>
              `;
            })
            .join('')}
        </div>
      </section>
    `;
  }

  // Laboratory Performance Section (preserved cleanly when performance metrics exist; omitted when absent on historical scans)
  const perfSummary = extractPerformanceSummary(model.summary.performanceMetrics, model.findings);
  let performanceSectionHtml = '';
  if (perfSummary) {
    const vitalsList = [
      perfSummary.ttfb,
      perfSummary.fcp,
      perfSummary.lcp,
      perfSummary.cls,
      perfSummary.tbt,
    ];
    const vitalsCardsHtml = vitalsList
      .map(v => {
        const ratingClass = `rating-${v.rating.replace(/_/g, '-')}`;
        const ratingLabel =
          v.rating === 'needs_improvement' ? 'NEEDS IMPROVEMENT' : v.rating.toUpperCase();
        const valStr =
          v.value !== null
            ? v.name === 'cls'
              ? v.value.toFixed(3)
              : `${Math.round(v.value)} ${v.unit}`
            : 'Unavailable';
        return `
          <div class="perf-metric-tile ${ratingClass}">
            <div class="perf-metric-top">
              <span class="perf-metric-label" dir="ltr">${escapeHtml(v.label)}</span>
              <span class="badge badge-rating ${ratingClass}">${escapeHtml(ratingLabel)}</span>
            </div>
            <div class="perf-metric-value font-mono" dir="ltr">${escapeHtml(valStr)}</div>
            <div class="perf-metric-target font-mono" dir="ltr">Target: ${escapeHtml(v.targetLabel)}</div>
            ${v.name === 'lcp' && v.isCapped ? '<div class="perf-metric-capped">&#9888; Capped by 5,000ms deadline ceiling</div>' : ''}
            ${v.limitationNotice ? `<div class="perf-metric-limitation">${escapeHtml(v.limitationNotice)}</div>` : ''}
          </div>
        `;
      })
      .join('\n');

    let resourcesBarHtml = '';
    if (perfSummary.resources) {
      const res = perfSummary.resources;
      const transferKb =
        typeof res.totalTransferSizeBytes === 'number'
          ? `${Math.round(res.totalTransferSizeBytes / 1024)} KB`
          : 'N/A';
      resourcesBarHtml = `
        <div class="perf-resources-summary">
          <h3 class="meta-label" style="margin-bottom: 8px;">Page Resource Metrics</h3>
          <div class="perf-resources-grid">
            <div class="perf-resource-stat"><span class="perf-stat-label">Total Transferred</span><span class="perf-stat-val font-mono" dir="ltr">${transferKb}</span></div>
            <div class="perf-resource-stat"><span class="perf-stat-label">Render-Blocking</span><span class="perf-stat-val font-mono" dir="ltr">${res.renderBlockingCount ?? 0}</span></div>
            <div class="perf-resource-stat"><span class="perf-stat-label">Scripts / Stylesheets</span><span class="perf-stat-val font-mono" dir="ltr">${res.scriptsCount ?? 0} / ${res.stylesheetsCount ?? 0}</span></div>
            <div class="perf-resource-stat"><span class="perf-stat-label">Images (Oversized)</span><span class="perf-stat-val font-mono" dir="ltr">${res.imagesCount ?? 0} (${res.oversizedImagesCount ?? 0} oversized)</span></div>
            <div class="perf-resource-stat"><span class="perf-stat-label">Uncompressed Assets</span><span class="perf-stat-val font-mono" dir="ltr">${res.uncompressedAssetsCount ?? 0}</span></div>
          </div>
        </div>
      `;
    }

    let bottlenecksSummaryHtml = '';
    if (perfSummary.bottleneckDiagnoses.length > 0) {
      bottlenecksSummaryHtml = `
        <div class="perf-bottlenecks-summary">
          <h3 class="meta-label" style="margin-bottom: 8px;">Diagnosed Bottlenecks (${perfSummary.bottleneckDiagnoses.length})</h3>
          <div class="perf-bottlenecks-list">
            ${perfSummary.bottleneckDiagnoses
              .map(b => {
                const causalityClass = b.causality === 'causal' ? 'causal' : 'correlational';
                const causalityText =
                  b.causality === 'causal'
                    ? 'CAUSAL (PROVEN CAUSE)'
                    : 'CORRELATIONAL (ASSOCIATED FACTOR)';
                return `
                  <div class="perf-bottleneck-card">
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 4px;">
                      <span class="badge badge-bottleneck">${escapeHtml(b.classification)}</span>
                      <span class="badge badge-${causalityClass}">${escapeHtml(causalityText)}</span>
                      <span class="badge badge-sev sev-${b.severity.toLowerCase()}">${escapeHtml(b.severity.toUpperCase())}</span>
                      <span class="badge badge-conf conf-${b.confidence.toLowerCase()}">${escapeHtml(b.confidence.toUpperCase())}</span>
                    </div>
                    <h4 style="font-size: 14px; font-weight: 600; margin: 4px 0;">${escapeHtml(b.title)}</h4>
                    ${b.observedValueText && b.thresholdText ? `<div class="font-mono" dir="ltr" style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Observed: <strong>${escapeHtml(b.observedValueText)}</strong> vs Budget: <strong>${escapeHtml(b.thresholdText)}</strong></div>` : ''}
                    ${b.limitationsNotice ? `<div style="font-size: 11px; color: var(--warning); margin-top: 4px;">&#9888; ${escapeHtml(b.limitationsNotice)}</div>` : ''}
                  </div>
                `;
              })
              .join('\n')}
          </div>
        </div>
      `;
    }

    performanceSectionHtml = `
      <section class="section-card perf-section">
        <div class="perf-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
          <h2 class="section-title" style="margin: 0;">Laboratory Web Vitals &amp; Performance Diagnostics</h2>
          <span class="badge badge-lab-context" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">AUTOMATED CHROMIUM SESSION</span>
        </div>
        <div class="perf-disclaimer-callout">
          <div>&#9432; <strong>Laboratory Context &amp; Methodology Notice</strong></div>
          <p>${escapeHtml(LABORATORY_CONTEXT_DISCLAIMER)}</p>
        </div>
        <div class="perf-metrics-grid">${vitalsCardsHtml}</div>
        ${resourcesBarHtml}
        ${bottlenecksSummaryHtml}
      </section>
    `;
  }

  // Detected Stack Section (Evidence-Gated)
  const stack = activeVm.detectedStack;
  const stackChips: string[] = [];
  if (stack.isWordPress) {
    stackChips.push(
      `WordPress${stack.wordPressVersion ? ` v${stack.wordPressVersion}` : ''} (${stack.wordPressConfidence})`,
    );
  }
  if (stack.isElementorPro) stackChips.push('Elementor Pro');
  else if (stack.isElementor) stackChips.push('Elementor');
  if (stack.isWooCommerce) stackChips.push('WooCommerce');
  for (const t of stack.detectedThemes) stackChips.push(`Theme: ${t}`);
  for (const p of stack.detectedPlugins) stackChips.push(`Plugin: ${p}`);
  for (const c of stack.cdnOrCacheHints) stackChips.push(`CDN/Cache: ${c}`);
  for (const s of stack.serverHints) stackChips.push(`Server: ${s}`);

  const stackSectionHtml = `
    <section class="section-card">
      <h2 class="section-title">${escapeHtml(activeVm.labels.detectedStackSection)}</h2>
      ${
        stackChips.length > 0
          ? `<div class="stack-grid">${stackChips.map(ch => `<span class="stack-chip font-mono" dir="ltr">${escapeHtml(ch)}</span>`).join('')}</div>`
          : `<p class="text-muted">${isArabic ? 'لم تُرصد إشارات منصة ووردبريس أو طبقة CDN محددة في أدلة هذا الفحص.' : 'No specific WordPress, plugin, or CDN markers were observed in persisted scan evidence.'}</p>`
      }
    </section>
  `;

  // Health Overview Section (D1–D4 Dimensions + Reasons from Shared Model)
  const ho = activeVm.healthOverview;
  const healthScoreDisplay =
    ho.healthIndexScore !== null ? `${ho.healthIndexScore}/100` : isArabic ? 'غير متاح' : 'Unavailable';

  const dimensionsHtml = ho.dimensions
    .map(
      d => `
      <tr>
        <td>${escapeHtml(d.label)}</td>
        <td><span class="chart-status-pill chart-status-${escapeHtml(d.status)}">${escapeHtml(d.statusLabel)}</span></td>
        <td class="font-mono" dir="ltr">${d.percent}%</td>
        <td class="font-mono" dir="ltr">${d.weight}%</td>
      </tr>
    `,
    )
    .join('');

  const telemetryReasonsHtml =
    ho.telemetryReasons.length > 0
      ? `<div class="finding-detail-section">
           <h5 class="detail-label">${isArabic ? 'أسباب دقة القياس والتقريب' : 'Coverage &amp; Telemetry Disclosures'}</h5>
           <ul class="step-list" style="font-size:12px;">
             ${ho.telemetryReasons.map(r => `<li><code dir="ltr">${escapeHtml(r.code)}</code> &mdash; ${escapeHtml(r.label)}</li>`).join('')}
           </ul>
         </div>`
      : '';

  const chartsSectionHtml = renderAuditChartsSection(activeVm.charts, locale);
  const recommendationsHtml = renderRecommendationsSection(dualVm, activeVm);

  const visualEntries = model.visualEvidence ? Object.values(model.visualEvidence) : [];
  const visualGalleryHtml =
    visualEntries.length > 0
      ? `<section class="section-card" aria-label="${isArabic ? 'الأدلة البصرية ولقطات الشاشة' : 'Visual Evidence &amp; Screenshots'}">
           <h2 class="section-title">${isArabic ? 'الأدلة البصرية ولقطات الشاشة' : 'Visual Evidence &amp; Captured Screenshots'} (${visualEntries.length})</h2>
           <div class="charts-grid">
             ${visualEntries
               .map(
                 entry => `
                 <div class="chart-card">
                   <div class="chart-card-head">
                     <strong class="font-mono" dir="ltr">${escapeHtml(entry.fileName)}</strong>
                     <div>
                       ${entry.status ? `<span class="badge">${escapeHtml(entry.status)}</span>` : ''}
                       ${entry.viewportCategory ? `<span class="badge" style="margin-inline-start:4px;">${escapeHtml(entry.viewportCategory)}</span>` : ''}
                     </div>
                   </div>
                   <div style="font-size:12px; color:var(--text-muted);">
                     ${entry.viewport ? `<span>${isArabic ? 'الشاشة:' : 'Viewport:'} <strong>${escapeHtml(entry.viewport)}</strong></span> &bull; ` : ''}
                     ${entry.width && entry.height ? `<span>${entry.width}&times;${entry.height}</span> &bull; ` : ''}
                     ${entry.captureType ? `<span>${isArabic ? 'النوع:' : 'Type:'} <strong>${escapeHtml(entry.captureType)}</strong></span> &bull; ` : ''}
                     <span dir="ltr">${Math.round(entry.byteLength / 1024)} KB</span>
                     ${entry.pageUrl ? `<div class="font-mono" dir="ltr" style="font-size:11px; margin-top:4px; word-break:break-all;">${escapeHtml(String(redactSensitiveData(entry.pageUrl)))}</div>` : ''}
                   </div>
                   ${
                     entry.embedded && entry.dataUri
                       ? `<figure class="visual-evidence-figure">
                            <img class="visual-evidence-img" src="${escapeHtml(entry.dataUri)}" alt="Captured screenshot ${escapeHtml(entry.fileName)}" />
                          </figure>`
                       : `<div class="visual-evidence-fallback">${escapeHtml(entry.omittedReason ?? (isArabic ? 'المعاينة غير متاحة.' : 'Preview unavailable.'))}</div>`
                   }
                 </div>
               `,
               )
               .join('')}
           </div>
         </section>`
      : '';

  return `<!DOCTYPE html>
${htmlOpenTag}
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; child-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none';">
  <title>${escapeHtml(model.title)}</title>
  <style>${getStandaloneReportCss()}</style>
</head>
<body dir="${dirAttr}" data-locale="${locale}" data-initial-view-mode="${activeVm.viewMode}">
  <div class="container">
    <!-- Pure-CSS Accessible View-Mode Switcher (Offline, Zero-JS, Script-Src 'none') -->
    <input type="radio" name="auditor-view-mode" id="vm-simple" class="vm-radio" ${activeVm.viewMode === 'simple' ? 'checked' : ''}>
    <input type="radio" name="auditor-view-mode" id="vm-technical" class="vm-radio" ${activeVm.viewMode === 'technical' ? 'checked' : ''}>
    <input type="radio" name="auditor-view-mode" id="vm-dual" class="vm-radio" ${activeVm.viewMode === 'dual' ? 'checked' : ''}>

    <div class="vm-switcher-bar no-print" role="region" aria-label="View Mode">
      <span style="font-weight:700; font-size:13px;">${escapeHtml(activeVm.labels.executiveSummary)} &mdash; ${escapeHtml(activeVm.labels.viewModeDualLabel)}</span>
      <div class="vm-labels">
        <label for="vm-simple" class="vm-tab vm-tab-simple">${escapeHtml(activeVm.labels.viewModeSimpleLabel)}</label>
        <label for="vm-technical" class="vm-tab vm-tab-technical">${escapeHtml(activeVm.labels.viewModeTechnicalLabel)}</label>
        <label for="vm-dual" class="vm-tab vm-tab-dual">${escapeHtml(activeVm.labels.viewModeDualLabel)}</label>
      </div>
    </div>

    <main class="report-main">
      <!-- Header / Cover -->
      <header class="report-header">
        <div class="brand-row">
          <span class="brand-title">Ultimate WordPress &amp; Website Auditor</span>
          <div class="brand-badges">
            <span class="status-badge ${escapeHtml(model.summary.scanStatus.toLowerCase())}">
              SCAN ${escapeHtml(statusUpper)}
            </span>
            ${
              isPartialCoverage
                ? `<span class="status-badge" style="background: var(--warning-bg); color: var(--warning); border-color: var(--warning);">PARTIAL BROWSER COVERAGE</span>`
                : !isFailedOrCancelled
                  ? `<span class="status-badge" style="background: var(--success-bg); color: var(--success); border-color: var(--success);">FULL COVERAGE</span>`
                  : ''
            }
          </div>
        </div>
        <h1 class="report-main-title">${escapeHtml(model.title)}</h1>
        <div class="site-target-row">
          <span>${isArabic ? 'الموقع:' : 'Site:'} <strong class="site-name">${escapeHtml(model.site.name)}</strong></span>
          <span>${isArabic ? 'الهدف:' : 'Target:'} <a href="${sanitizeUrl(String(redactSensitiveData(model.scanRun.targetUrl)))}" class="font-mono text-accent" dir="ltr" target="_blank" rel="noopener noreferrer">${escapeHtml(String(redactSensitiveData(model.scanRun.targetUrl)))}</a></span>
          <span>${isArabic ? 'المنصة:' : 'Platform:'} <strong>${escapeHtml(model.site.platformType)}</strong></span>
          <span>${isArabic ? 'البيئة:' : 'Env:'} <strong>${escapeHtml(model.site.environmentType)}</strong></span>
        </div>
        <div class="meta-grid">
          <div class="meta-item"><span class="meta-label">Report ID</span><span class="meta-value font-mono" dir="ltr">${escapeHtml(model.reportId)}</span></div>
          <div class="meta-item"><span class="meta-label">Scan Run ID</span><span class="meta-value font-mono" dir="ltr">${escapeHtml(model.scanRun.id)}</span></div>
          <div class="meta-item"><span class="meta-label">${isArabic ? 'تاريخ التوليد' : 'Generated At'}</span><span class="meta-value" dir="ltr">${formatDate(model.generatedAt)}</span></div>
          <div class="meta-item"><span class="meta-label">${isArabic ? 'المدة' : 'Scan Duration'}</span><span class="meta-value" dir="ltr">${formatDuration(model.summary.scanDurationMs)}</span></div>
        </div>
      </header>

      ${
        isFailedOrCancelled
          ? `<div class="alert-banner alert-warning" role="alert">
               <strong>&#9888; Warning: Incomplete / ${escapeHtml(statusUpper)} Scan Run</strong>
               <p>${isArabic ? 'تم إنشاء هذا التقرير من فحص انتهى بحالة غير مكتملة:' : 'This audit report was generated from a scan that terminated with status'} <strong>${escapeHtml(statusUpper)}</strong>.</p>
               <ul>
                 <li><strong>Audit Coverage:</strong> PARTIAL AUDIT (INTERRUPTED)</li>
                 <li><strong>Completed Engines:</strong> ${escapeHtml(completedEnginesText)}</li>
                 <li><strong>Interrupted Engine:</strong> ${escapeHtml(interruptedEngineText)}</li>
                 <li><strong>Findings Collected Prior to Interruption:</strong> ${model.summary.totalFindings} findings</li>
               </ul>
               <p>The findings and metrics below represent partial evidence collected before termination and do NOT constitute a complete security assessment.</p>
             </div>`
          : ''
      }

      ${
        isPartialCoverage
          ? `<div class="alert-banner alert-warning" role="alert">
               <strong>&#9888; Notice: Audit Completed with Partial Browser Coverage</strong>
               <p>This audit successfully crawled <strong>${model.summary.pagesScanned}</strong> pages, but evaluated <strong>${model.summary.browserPagesAudited ?? 0} of ${model.summary.browserCandidatesTotal ?? model.summary.browserPagesAudited ?? 0}</strong> browser candidate pages due to scan time constraints.</p>
               <ul>
                 <li><strong>Crawl &amp; Static Analyzers:</strong> Completed across all ${model.summary.pagesScanned} discovered pages.</li>
                 <li><strong>Browser &amp; Accessibility Engine:</strong> Partial coverage (${model.summary.browserPagesAudited ?? 0} audited${(model.summary.browserCandidatesSkipped ?? 0) > 0 ? `, ${model.summary.browserCandidatesSkipped} skipped due to time budget` : ''}).</li>
               </ul>
             </div>`
          : ''
      }

      ${
        hasBrowserUnavailable
          ? `<div class="alert-banner alert-warning" role="alert">
               <strong>&#9888; ${isArabic ? 'ملاحظة: تعذر تشغيل المتصفح الآلي' : 'Limitation Notice: Browser Engine Unavailable'}</strong>
               <p>${isArabic ? 'تعذر تشغيل متصفح Chromium أثناء الفحص؛ لذا اقتصرت النتائج على الفحوص الثابتة ولم تُفحص إمكانية الوصول أو الأداء المعملي أو لقطات الشاشة.' : 'A compatible Chromium-based browser was not available during this scan run. HTTP, WordPress, and security header analyzers completed; client-side runtime errors, WCAG accessibility, responsive layout shifts, and screenshots could not be evaluated.'}</p>
             </div>`
          : ''
      }

      <!-- Health Triad Overview -->
      <section class="section-card" aria-label="${escapeHtml(activeVm.labels.healthOverview)}">
        <h2 class="section-title">${escapeHtml(activeVm.labels.healthOverview)}</h2>
        <div class="triad-grid">
          <div class="triad-card">
            <div class="meta-label">${escapeHtml(activeVm.labels.healthIndexLabel)}</div>
            <div class="triad-value" dir="ltr">${escapeHtml(healthScoreDisplay)}</div>
            <div class="triad-sub"><strong>${escapeHtml(ho.healthBandLabel)}</strong></div>
          </div>
          <div class="triad-card">
            <div class="meta-label">${escapeHtml(activeVm.labels.auditCoverageLabel)}</div>
            <div class="triad-value" dir="ltr">${ho.coveragePercent}%</div>
            <div class="triad-sub">${escapeHtml(ho.coverageStatusLabel)}</div>
          </div>
          <div class="triad-card">
            <div class="meta-label">${escapeHtml(activeVm.labels.auditConfidenceLabel)}</div>
            <div class="triad-value" dir="ltr">${ho.confidenceScore}%</div>
            <div class="triad-sub">${escapeHtml(ho.confidenceBandLabel)}</div>
          </div>
        </div>
        <h3 class="meta-label" style="margin-bottom:8px;">${escapeHtml(activeVm.labels.dimensionBreakdown)}</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>${isArabic ? 'البُعد' : 'Dimension'}</th>
              <th>${isArabic ? 'الحالة' : 'Status'}</th>
              <th>${isArabic ? 'النسبة' : 'Coverage'}</th>
              <th>${isArabic ? 'الوزن' : 'Weight'}</th>
            </tr>
          </thead>
          <tbody>${dimensionsHtml}</tbody>
        </table>
        ${telemetryReasonsHtml}
        <p style="font-size:12px; color:var(--text-dim); margin-top:10px;">${escapeHtml(activeVm.disclosures.healthIndexDisclaimer)}</p>
      </section>

      <!-- Severity Summary Metrics -->
      <section class="summary-grid" aria-label="Findings Severity Summary">
        <div class="summary-card card-total"><div class="count" dir="ltr">${model.summary.totalFindings}</div><div class="label">${isArabic ? 'إجمالي الملاحظات' : 'Total Findings'}</div></div>
        <div class="summary-card card-critical"><div class="count" dir="ltr">${model.summary.bySeverity.critical}</div><div class="label">${isArabic ? 'حرج' : 'Critical'}</div></div>
        <div class="summary-card card-high"><div class="count" dir="ltr">${model.summary.bySeverity.high}</div><div class="label">${isArabic ? 'مرتفع' : 'High'}</div></div>
        <div class="summary-card card-medium"><div class="count" dir="ltr">${model.summary.bySeverity.medium}</div><div class="label">${isArabic ? 'متوسط' : 'Medium'}</div></div>
        <div class="summary-card card-low"><div class="count" dir="ltr">${model.summary.bySeverity.low}</div><div class="label">${isArabic ? 'منخفض' : 'Low'}</div></div>
        <div class="summary-card card-info"><div class="count" dir="ltr">${model.summary.bySeverity.info}</div><div class="label">${isArabic ? 'معلوماتي' : 'Info'}</div></div>
      </section>

      ${stackSectionHtml}

      <!-- 7 Shared Chart Analytics Section -->
      ${chartsSectionHtml}

      <!-- Scan Coverage & Category Breakdown -->
      <section class="section-card">
        <h2 class="section-title">${isArabic ? 'نطاق التنفيذ وتوزيع الفئات' : 'Scan Coverage & Distribution'}</h2>
        <div class="details-table-grid">
          <div>
            <h3 class="meta-label" style="margin-bottom:8px;">Execution Coverage</h3>
            <table class="data-table">
              <tbody>
                <tr><td>Target URL</td><td class="font-mono" dir="ltr">${escapeHtml(String(redactSensitiveData(model.scanRun.targetUrl)))}</td></tr>
                <tr><td>Scan Type</td><td>${escapeHtml(model.scanRun.scanType)}</td></tr>
                <tr><td>Scan Status</td><td><span class="status-badge ${escapeHtml(model.summary.scanStatus.toLowerCase())}">${escapeHtml(statusUpper)}</span></td></tr>
                <tr><td>Audit Coverage</td><td><strong>${
                  isFailedOrCancelled
                    ? 'PARTIAL AUDIT (INTERRUPTED)'
                    : isPartialCoverage
                      ? 'COMPLETED (PARTIAL BROWSER COVERAGE)'
                      : 'COMPLETE AUDIT (FULL COVERAGE)'
                }</strong></td></tr>
                ${isPartialCoverage && model.summary.coverageWarning ? `<tr><td>Coverage Notice</td><td style="color:var(--warning);">${escapeHtml(model.summary.coverageWarning)}</td></tr>` : ''}
                ${typeof model.summary.browserCandidatesTotal === 'number' && model.summary.browserCandidatesTotal > 0 ? `<tr><td>Browser Candidates</td><td class="font-mono" dir="ltr">${model.summary.browserPagesAudited ?? 0} of ${model.summary.browserCandidatesTotal} audited${(model.summary.browserCandidatesSkipped ?? 0) > 0 ? ` (${model.summary.browserCandidatesSkipped} skipped due to budget)` : ''}</td></tr>` : ''}
                <tr><td>Pages Crawled (Static Analysis)</td><td class="font-mono" dir="ltr">${model.summary.pagesScanned} pages (${model.summary.staticCoverageStatus === 'partial' ? 'partial' : '100%'} static coverage)</td></tr>
                <tr><td>Browser Pages Audited</td><td class="font-mono" dir="ltr">${model.summary.browserPagesAudited ?? 0} of ${model.summary.pagesScanned} pages (${Math.round(((model.summary.browserPagesAudited ?? 0) / Math.max(1, model.summary.pagesScanned)) * 100)}% browser coverage)</td></tr>
                <tr><td>Screenshots Captured</td><td class="font-mono" dir="ltr">${model.summary.screenshotsCaptured ?? 0}</td></tr>
                <tr><td>Pages Failed / Errored</td><td class="font-mono" dir="ltr">${model.summary.pagesFailed}</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3 class="meta-label" style="margin-bottom:8px;">Findings by Category &amp; Confidence</h3>
            <table class="data-table">
              <thead><tr><th>Category</th><th>Count</th></tr></thead>
              <tbody>${categoryHtml}</tbody>
              <tfoot>
                <tr>
                  <td style="font-weight:700; border-top:1px solid var(--border);">Verification State</td>
                  <td style="border-top:1px solid var(--border); font-size:12px;">
                    <span class="badge badge-conf conf-confirmed">${model.summary.confirmedCount} Confirmed</span>
                    <span class="badge badge-conf conf-firm">${model.summary.firmCount ?? 0} Firm</span>
                    <span class="badge badge-conf conf-potential">${model.summary.potentialCount} Potential</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      ${performanceSectionHtml}

      <!-- Actionable Findings & Bilingual Recommendations -->
      ${recommendationsHtml}

      ${visualGalleryHtml}

      ${consolidatedHtml}

      <!-- Raw Persisted Findings & Visual Screenshot Evidence -->
      <section class="section-card">
        <h2 class="section-title">${isArabic ? 'سجل الملاحظات التفصيلية والأدلة البصرية' : 'Detailed Findings'} (${model.findings.length})</h2>
        <div class="findings-list">${findingsListHtml}</div>
      </section>

      <!-- Limitations & Disclaimers -->
      <section class="section-card">
        <h2 class="section-title">${isArabic ? escapeHtml(activeVm.labels.knownLimitations) : 'Scan Limitations &amp; Disclaimers'}</h2>
        <div style="font-size:12px; line-height:1.65; color:var(--text-muted);">
          <p style="margin-bottom:8px;">${escapeHtml(activeVm.disclosures.readOnlyAuditNotice)}</p>
          <p style="margin-bottom:8px;">${escapeHtml(activeVm.disclosures.noComplianceCertificationNotice)}</p>
          <p style="margin-bottom:8px;">${escapeHtml(activeVm.disclosures.laboratoryContextNotice)}</p>
          <p>${escapeHtml(activeVm.disclosures.healthIndexDisclaimer)}</p>
        </div>
      </section>
    </main>

    <footer class="report-footer">
      <p><strong>Ultimate WordPress &amp; Website Auditor</strong> &bull; Version ${escapeHtml(model.version)}</p>
      <p dir="ltr">Report ID: <span class="font-mono">${escapeHtml(model.reportId)}</span> &bull; Generated: ${formatDate(model.generatedAt)}</p>
    </footer>
  </div>
</body>
</html>
`;
}
