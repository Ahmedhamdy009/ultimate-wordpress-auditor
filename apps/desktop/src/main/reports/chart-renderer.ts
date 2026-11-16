import {
  CATEGORY_LABELS_I18N,
  DIMENSION_LABELS_I18N,
  DIMENSION_STATUS_LABELS_I18N,
  LABORATORY_CONTEXT_DISCLAIMER,
  REASON_CODE_LABELS_I18N,
  resolveBilingualText,
  SEVERITY_LABELS_I18N,
  type AuditChartSuite,
  type BilingualText,
  type ReportLocale,
} from '@auditor/shared';
import { escapeHtml, redactSensitiveData } from './security.js';

const CHART_SECTION_TEXT: Readonly<Record<string, BilingualText>> = {
  heading: {
    en: 'Visual Analytics & Telemetry Charts',
    ar: 'التحليلات الرسومية ومخططات القياس',
  },
  subtitle: {
    en: 'Generated directly from verified shared analytics specifications with explicit status for unavailable metrics.',
    ar: 'مُولّدة مباشرة من مواصفات التحليلات الموحدة المعتمدة مع توضيح أي مؤشرات غير متاحة أو مستبعدة.',
  },
  severityTitle: {
    en: 'Severity Distribution',
    ar: 'توزيع درجات الخطورة',
  },
  categoryTitle: {
    en: 'Findings by Canonical Category',
    ar: 'توزيع الملاحظات حسب الفئة',
  },
  coverageTitle: {
    en: 'D1–D4 Audit Coverage Dimensions',
    ar: 'أبعاد تغطية الفحص (D1–D4)',
  },
  labVitalsTitle: {
    en: 'Laboratory Web Vitals Profile',
    ar: 'ملف مؤشرات الأداء المعملية (Web Vitals)',
  },
  assetTitle: {
    en: 'Asset & Resource Payload Breakdown',
    ar: 'توزيع أحجام الأصول والموارد',
  },
  bottleneckTitle: {
    en: 'Diagnosed Performance Bottlenecks',
    ar: 'الاختناقات المحددة للأداء',
  },
  topPagesTitle: {
    en: 'Top Affected Pages (Weighted Risk)',
    ar: 'أكثر الصفحات تأثراً (حسب الوزن)',
  },
  unavailableNotice: {
    en: 'Metric data unavailable or not executed in this scan.',
    ar: 'بيانات هذا المخطط غير متاحة أو لم تُنفَّذ في هذا الفحص.',
  },
  excludedNotice: {
    en: 'Excluded from chart metric (non-target system/lifecycle findings).',
    ar: 'مستبعد من احتساب المخطط (ملاحظات نظامية أو محلولة).',
  },
  labDisclaimer: {
    en: LABORATORY_CONTEXT_DISCLAIMER,
    ar: 'قياسات الأداء تعكس جلسة متصفح معملية آلية ولا تمثل قياسات المستخدمين الفعلية (CrUX). مؤشر INP غير متاح في الفحص المعملي السلبي.',
  },
  confirmedShort: { en: 'Confirmed/Firm', ar: 'مؤكد/قوي' },
  provisionalShort: { en: 'Provisional', ar: 'مبدئي' },
  weightLabel: { en: 'Weight', ar: 'الوزن' },
  bytesUnavailableMode: {
    en: 'Exact byte-by-type telemetry was not recorded; showing count/flagged indicators only.',
    ar: 'لم تُسجل أحجام البايتات حسب النوع؛ يتم عرض أعداد الأصول المرصودة فقط.',
  },
};

const CHART_STATUS_LABELS: Readonly<Record<string, BilingualText>> = {
  measured: { en: 'Measured', ar: 'مقاس' },
  partial: { en: 'Partial', ar: 'جزئي' },
  approximated: { en: 'Approximated', ar: 'تقديري' },
  unavailable: { en: 'Unavailable', ar: 'غير متاح' },
  excluded: { en: 'Excluded', ar: 'مستبعد' },
};

const ASSET_BUCKET_LABELS: Readonly<Record<string, BilingualText>> = {
  document: { en: 'HTML Documents', ar: 'مستندات HTML' },
  script: { en: 'JavaScript', ar: 'ملفات JavaScript' },
  stylesheet: { en: 'Stylesheets (CSS)', ar: 'ملفات CSS' },
  image: { en: 'Images', ar: 'الصور' },
  font: { en: 'Fonts', ar: 'الخطوط' },
  other: { en: 'Other Resources', ar: 'موارد أخرى' },
  flagged_heavy: { en: 'Flagged Heavy Assets', ar: 'أصول ثقيلة مرصودة' },
};

const RATING_LABELS: Readonly<Record<string, BilingualText>> = {
  good: { en: 'Good', ar: 'جيد' },
  needs_improvement: { en: 'Needs Improvement', ar: 'يحتاج تحسين' },
  poor: { en: 'Poor', ar: 'ضعيف' },
  unavailable: { en: 'Unavailable', ar: 'غير متاح' },
  unsupported_in_lab: { en: 'Unsupported in Lab', ar: 'غير متاح معملياً' },
};

function t(entry: BilingualText | undefined, locale: ReportLocale, fallback = ''): string {
  return resolveBilingualText(entry, locale, fallback).text;
}

function statusPill(status: string, locale: ReportLocale): string {
  const label = t(CHART_STATUS_LABELS[status], locale, status);
  return `<span class="chart-status-pill chart-status-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function formatReasonsHtml(reasonCodes: readonly string[], locale: ReportLocale): string {
  if (!reasonCodes || reasonCodes.length === 0) return '';
  const labels = reasonCodes.map(code => {
    const label = t(REASON_CODE_LABELS_I18N[code], locale, code.replace(/_/g, ' '));
    return `<li><code dir="ltr">${escapeHtml(code)}</code>: ${escapeHtml(label)}</li>`;
  });
  return `<ul class="chart-reasons-list">${labels.join('')}</ul>`;
}

function formatBytesKb(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'N/A';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

function severityFillColor(sev: string): string {
  switch (sev) {
    case 'critical':
      return '#ef4444';
    case 'high':
      return '#f97316';
    case 'medium':
      return '#f59e0b';
    case 'low':
      return '#3b82f6';
    default:
      return '#64748b';
  }
}

function renderHorizontalBarSvg(params: {
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
  readonly ariaLabel: string;
  readonly rows: readonly {
    readonly barX: number;
    readonly barY: number;
    readonly barWidth: number;
    readonly barHeight: number;
    readonly fill: string;
    readonly ratio: number;
  }[];
}): string {
  const maxBarTrack = Math.max(80, Math.round(params.viewBoxWidth * 0.65));
  const bars = params.rows
    .map(r => {
      const clampedRatio = Math.max(0, Math.min(1, r.ratio));
      const computedWidth =
        r.barWidth > 0 ? Math.min(maxBarTrack, r.barWidth) : Math.round(clampedRatio * maxBarTrack);
      const y = r.barY;
      const h = Math.max(10, Math.min(20, r.barHeight || 14));
      return `
        <rect x="0" y="${y}" width="${maxBarTrack}" height="${h}" rx="4" fill="rgba(148,163,184,0.16)" />
        <rect x="0" y="${y}" width="${computedWidth}" height="${h}" rx="4" fill="${escapeHtml(r.fill)}" />
      `;
    })
    .join('');

  return `<svg class="chart-svg" viewBox="0 0 ${maxBarTrack} ${Math.max(24, params.viewBoxHeight)}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(params.ariaLabel)}"><title>${escapeHtml(params.ariaLabel)}</title>${bars}</svg>`;
}

function renderSeverityChartCard(
  chart: AuditChartSuite['severityDistribution'],
  locale: ReportLocale,
): string {
  const title = t(CHART_SECTION_TEXT.severityTitle, locale);
  const body =
    chart.status === 'unavailable' || chart.items.every(i => i.totalCount === 0)
      ? `<p class="chart-empty-note">${escapeHtml(t(CHART_SECTION_TEXT.unavailableNotice, locale))}</p>`
      : `<div class="chart-rows">
          ${chart.items
            .map(item => {
              const sevLabel = t(SEVERITY_LABELS_I18N[item.severity], locale, item.severity);
              const pct = Math.round(item.percent);
              const trackSvg = renderHorizontalBarSvg({
                viewBoxWidth: 320,
                viewBoxHeight: 14,
                ariaLabel: `${sevLabel}: ${item.totalCount}`,
                rows: [
                  {
                    barX: 0,
                    barY: 0,
                    barWidth: Math.round(Math.max(0, Math.min(1, item.normalizedShare)) * 208),
                    barHeight: 12,
                    fill: severityFillColor(item.severity),
                    ratio: item.normalizedShare,
                  },
                ],
              });
              return `
                <div class="chart-row-item">
                  <div class="chart-row-meta">
                    <span class="chart-row-label">${escapeHtml(sevLabel)}</span>
                    <span class="chart-row-value font-mono" dir="ltr">${item.totalCount} (${pct}%)</span>
                  </div>
                  ${trackSvg}
                  <div class="chart-row-sub">
                    ${escapeHtml(t(CHART_SECTION_TEXT.confirmedShort, locale))}: <strong dir="ltr">${item.confirmedOrFirmCount}</strong> &bull;
                    ${escapeHtml(t(CHART_SECTION_TEXT.provisionalShort, locale))}: <strong dir="ltr">${item.provisionalCount}</strong>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>`;

  return `
    <figure class="chart-card" data-chart="severity_distribution">
      <div class="chart-card-head">
        <figcaption class="chart-card-title">${escapeHtml(title)}</figcaption>
        ${statusPill(chart.status, locale)}
      </div>
      ${body}
      ${formatReasonsHtml(chart.reasonCodes, locale)}
    </figure>
  `;
}

function renderCategoryChartCard(
  chart: AuditChartSuite['categoryBreakdown'],
  locale: ReportLocale,
): string {
  const title = t(CHART_SECTION_TEXT.categoryTitle, locale);
  const body =
    chart.items.length === 0
      ? `<p class="chart-empty-note">${escapeHtml(t(CHART_SECTION_TEXT.unavailableNotice, locale))}</p>`
      : `<div class="chart-rows">
          ${chart.items
            .map(item => {
              const catLabel = t(CATEGORY_LABELS_I18N[item.categoryId], locale, item.label);
              const fill = severityFillColor(item.highestSeverity);
              const trackSvg = renderHorizontalBarSvg({
                viewBoxWidth: 320,
                viewBoxHeight: 14,
                ariaLabel: `${catLabel}: ${item.activeCount}`,
                rows: [
                  {
                    barX: 0,
                    barY: 0,
                    barWidth: Math.round(Math.max(0, Math.min(1, item.normalizedShare)) * 208),
                    barHeight: 12,
                    fill,
                    ratio: item.normalizedShare,
                  },
                ],
              });
              return `
                <div class="chart-row-item">
                  <div class="chart-row-meta">
                    <span class="chart-row-label">${escapeHtml(catLabel)}</span>
                    <span class="chart-row-value font-mono" dir="ltr">${item.activeCount} (${Math.round(item.percent)}%)</span>
                  </div>
                  ${trackSvg}
                </div>
              `;
            })
            .join('')}
        </div>`;

  return `
    <figure class="chart-card" data-chart="category_breakdown">
      <div class="chart-card-head">
        <figcaption class="chart-card-title">${escapeHtml(title)}</figcaption>
        ${statusPill(chart.status, locale)}
      </div>
      ${body}
      ${formatReasonsHtml(chart.reasonCodes, locale)}
    </figure>
  `;
}

function renderCoverageDimensionsChartCard(
  chart: AuditChartSuite['coverageDimensions'],
  locale: ReportLocale,
): string {
  const title = t(CHART_SECTION_TEXT.coverageTitle, locale);
  const body = `<div class="chart-rows">
    ${chart.items
      .map(item => {
        const dimLabel = t(DIMENSION_LABELS_I18N[item.dimension], locale, item.label);
        const dimStatusLabel = t(
          DIMENSION_STATUS_LABELS_I18N[item.dimensionStatus],
          locale,
          item.dimensionStatus,
        );
        const fill =
          item.dimensionStatus === 'unavailable' || item.dimensionStatus === 'not_applicable'
            ? '#64748b'
            : item.dimensionStatus === 'approximated'
              ? '#f59e0b'
              : '#10b981';
        const trackSvg = renderHorizontalBarSvg({
          viewBoxWidth: 320,
          viewBoxHeight: 14,
          ariaLabel: `${dimLabel}: ${item.percent}%`,
          rows: [
            {
              barX: 0,
              barY: 0,
              barWidth: Math.round(Math.max(0, Math.min(1, item.ratio)) * 208),
              barHeight: 12,
              fill,
              ratio: item.ratio,
            },
          ],
        });
        return `
          <div class="chart-row-item">
            <div class="chart-row-meta">
              <span class="chart-row-label">${escapeHtml(dimLabel)}</span>
              <span class="chart-row-value font-mono" dir="ltr">${item.percent}%</span>
            </div>
            ${trackSvg}
            <div class="chart-row-sub">
              <span>${escapeHtml(dimStatusLabel)}</span> &bull;
              <span>${escapeHtml(t(CHART_SECTION_TEXT.weightLabel, locale))}: <strong dir="ltr">${item.weight}%</strong></span>
            </div>
          </div>
        `;
      })
      .join('')}
  </div>`;

  return `
    <figure class="chart-card" data-chart="coverage_dimensions">
      <div class="chart-card-head">
        <figcaption class="chart-card-title">${escapeHtml(title)}</figcaption>
        ${statusPill(chart.status, locale)}
      </div>
      ${body}
      ${formatReasonsHtml(chart.reasonCodes, locale)}
    </figure>
  `;
}

function renderLabVitalsChartCard(
  chart: AuditChartSuite['labVitals'],
  locale: ReportLocale,
): string {
  const title = t(CHART_SECTION_TEXT.labVitalsTitle, locale);
  const rowsHtml = chart.items
    .map(item => {
      const ratingLabel = t(RATING_LABELS[item.rating], locale, item.rating);
      const valText =
        item.value === null
          ? t(RATING_LABELS.unavailable, locale, 'Unavailable')
          : item.metric === 'cls'
            ? item.value.toFixed(3)
            : `${Math.round(item.value)} ${item.unit}`;
      const fill =
        item.rating === 'good'
          ? '#10b981'
          : item.rating === 'needs_improvement'
            ? '#f59e0b'
            : item.rating === 'poor'
              ? '#ef4444'
              : '#64748b';
      const trackSvg = renderHorizontalBarSvg({
        viewBoxWidth: 320,
        viewBoxHeight: 14,
        ariaLabel: `${item.label}: ${valText}`,
        rows: [
          {
            barX: 0,
            barY: 0,
            barWidth: Math.round(Math.max(0, Math.min(1, item.normalizedRatio)) * 208),
            barHeight: 12,
            fill,
            ratio: item.normalizedRatio,
          },
        ],
      });
      return `
        <div class="chart-row-item">
          <div class="chart-row-meta">
            <span class="chart-row-label" dir="ltr">${escapeHtml(item.label)}</span>
            <span class="chart-row-value font-mono" dir="ltr">${escapeHtml(valText)}</span>
          </div>
          ${trackSvg}
          <div class="chart-row-sub">
            <span class="badge badge-rating rating-${escapeHtml(item.rating.replace(/_/g, '-'))}">${escapeHtml(ratingLabel)}</span>
            ${item.isCapped ? '<span class="chart-cap-note">(&ge;5000ms cap)</span>' : ''}
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <figure class="chart-card" data-chart="lab_vitals">
      <div class="chart-card-head">
        <figcaption class="chart-card-title">${escapeHtml(title)}</figcaption>
        ${statusPill(chart.status, locale)}
      </div>
      <div class="chart-rows">${rowsHtml}</div>
      <p class="chart-disclaimer-note">${escapeHtml(t(CHART_SECTION_TEXT.labDisclaimer, locale))}</p>
      ${formatReasonsHtml(chart.reasonCodes, locale)}
    </figure>
  `;
}

function renderAssetBreakdownChartCard(
  chart: AuditChartSuite['assetBreakdown'],
  locale: ReportLocale,
): string {
  const title = t(CHART_SECTION_TEXT.assetTitle, locale);
  const body =
    chart.status === 'unavailable' || chart.items.length === 0
      ? `<p class="chart-empty-note">${escapeHtml(t(CHART_SECTION_TEXT.unavailableNotice, locale))}</p>`
      : `<div class="chart-rows">
          ${chart.mode === 'counts_and_flagged_only' ? `<p class="chart-empty-note">${escapeHtml(t(CHART_SECTION_TEXT.bytesUnavailableMode, locale))}</p>` : ''}
          ${chart.items
            .map(item => {
              const bucketLabel = t(ASSET_BUCKET_LABELS[item.bucket], locale, item.bucket);
              const valLabel =
                item.bytes !== null
                  ? `${formatBytesKb(item.bytes)} (${Math.round(item.percent)}%)`
                  : `${item.count ?? 0}`;
              const trackSvg = renderHorizontalBarSvg({
                viewBoxWidth: 320,
                viewBoxHeight: 14,
                ariaLabel: `${bucketLabel}: ${valLabel}`,
                rows: [
                  {
                    barX: 0,
                    barY: 0,
                    barWidth: Math.round(Math.max(0, Math.min(1, item.normalizedShare)) * 208),
                    barHeight: 12,
                    fill: item.bucket === 'flagged_heavy' ? '#f59e0b' : '#38bdf8',
                    ratio: item.normalizedShare,
                  },
                ],
              });
              return `
                <div class="chart-row-item">
                  <div class="chart-row-meta">
                    <span class="chart-row-label">${escapeHtml(bucketLabel)}</span>
                    <span class="chart-row-value font-mono" dir="ltr">${escapeHtml(valLabel)}</span>
                  </div>
                  ${trackSvg}
                </div>
              `;
            })
            .join('')}
        </div>`;

  return `
    <figure class="chart-card" data-chart="asset_breakdown">
      <div class="chart-card-head">
        <figcaption class="chart-card-title">${escapeHtml(title)}</figcaption>
        ${statusPill(chart.status, locale)}
      </div>
      ${body}
      ${formatReasonsHtml(chart.reasonCodes, locale)}
    </figure>
  `;
}

function renderBottleneckChartCard(
  chart: AuditChartSuite['bottleneckSummary'],
  locale: ReportLocale,
): string {
  const title = t(CHART_SECTION_TEXT.bottleneckTitle, locale);
  const body =
    chart.items.length === 0
      ? `<p class="chart-empty-note">${escapeHtml(t(CHART_SECTION_TEXT.unavailableNotice, locale))}</p>`
      : `<div class="chart-rows">
          ${chart.items
            .map(item => {
              const trackSvg = renderHorizontalBarSvg({
                viewBoxWidth: 320,
                viewBoxHeight: 14,
                ariaLabel: `${item.classification}: ${item.observedValueText ?? item.severity}`,
                rows: [
                  {
                    barX: 0,
                    barY: 0,
                    barWidth: Math.round(Math.max(0, Math.min(1, item.normalizedRatio)) * 208),
                    barHeight: 12,
                    fill: severityFillColor(item.severity),
                    ratio: item.normalizedRatio,
                  },
                ],
              });
              return `
                <div class="chart-row-item">
                  <div class="chart-row-meta">
                    <span class="chart-row-label" dir="ltr">${escapeHtml(item.classification)}</span>
                    <span class="chart-row-value font-mono" dir="ltr">${escapeHtml(item.observedValueText ?? item.severity)}</span>
                  </div>
                  ${trackSvg}
                  <div class="chart-row-sub">
                    <span>${escapeHtml(item.causality.toUpperCase())}</span>
                    ${item.thresholdText ? ` &bull; <span dir="ltr">Budget: ${escapeHtml(item.thresholdText)}</span>` : ''}
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>`;

  return `
    <figure class="chart-card" data-chart="bottleneck_summary">
      <div class="chart-card-head">
        <figcaption class="chart-card-title">${escapeHtml(title)}</figcaption>
        ${statusPill(chart.status, locale)}
      </div>
      ${body}
      ${formatReasonsHtml(chart.reasonCodes, locale)}
    </figure>
  `;
}

function renderTopPagesChartCard(
  chart: AuditChartSuite['topAffectedPages'],
  locale: ReportLocale,
): string {
  const title = t(CHART_SECTION_TEXT.topPagesTitle, locale);
  const body =
    chart.items.length === 0
      ? `<p class="chart-empty-note">${escapeHtml(
          chart.status === 'excluded'
            ? t(CHART_SECTION_TEXT.excludedNotice, locale)
            : t(CHART_SECTION_TEXT.unavailableNotice, locale),
        )}</p>`
      : `<div class="chart-rows">
          ${chart.items
            .map(item => {
              const safeUrl = String(redactSensitiveData(item.targetUrl));
              const trackSvg = renderHorizontalBarSvg({
                viewBoxWidth: 320,
                viewBoxHeight: 14,
                ariaLabel: `${safeUrl}: ${item.activeCount}`,
                rows: [
                  {
                    barX: 0,
                    barY: 0,
                    barWidth: Math.round(Math.max(0, Math.min(1, item.normalizedRatio)) * 208),
                    barHeight: 12,
                    fill:
                      item.criticalCount > 0
                        ? '#ef4444'
                        : item.highCount > 0
                          ? '#f97316'
                          : '#38bdf8',
                    ratio: item.normalizedRatio,
                  },
                ],
              });
              return `
                <div class="chart-row-item">
                  <div class="chart-row-meta">
                    <span class="chart-row-label font-mono chart-url-truncate" dir="ltr">${escapeHtml(safeUrl)}</span>
                    <span class="chart-row-value font-mono" dir="ltr">${item.activeCount} (${Math.round(item.weightedScore)} pts)</span>
                  </div>
                  ${trackSvg}
                </div>
              `;
            })
            .join('')}
        </div>`;

  return `
    <figure class="chart-card chart-card-wide" data-chart="top_affected_pages">
      <div class="chart-card-head">
        <figcaption class="chart-card-title">${escapeHtml(title)}</figcaption>
        ${statusPill(chart.status, locale)}
      </div>
      ${body}
      ${formatReasonsHtml(chart.reasonCodes, locale)}
    </figure>
  `;
}

/**
 * Renders the approved 7-chart visual analytics section cleanly from `AuditChartSuite`
 * with zero duplicate arithmetic and full bilingual + CSP (`script-src 'none'`) compliance.
 */
export function renderAuditChartsSection(charts: AuditChartSuite, locale: ReportLocale): string {
  return `
    <section class="section-card charts-section" aria-label="${escapeHtml(t(CHART_SECTION_TEXT.heading, locale))}">
      <div class="section-head-stack">
        <h2 class="section-title">${escapeHtml(t(CHART_SECTION_TEXT.heading, locale))}</h2>
        <p class="section-subtitle">${escapeHtml(t(CHART_SECTION_TEXT.subtitle, locale))}</p>
      </div>
      <div class="charts-grid">
        ${renderSeverityChartCard(charts.severityDistribution, locale)}
        ${renderCategoryChartCard(charts.categoryBreakdown, locale)}
        ${renderCoverageDimensionsChartCard(charts.coverageDimensions, locale)}
        ${renderLabVitalsChartCard(charts.labVitals, locale)}
        ${renderAssetBreakdownChartCard(charts.assetBreakdown, locale)}
        ${renderBottleneckChartCard(charts.bottleneckSummary, locale)}
        ${renderTopPagesChartCard(charts.topAffectedPages, locale)}
      </div>
    </section>
  `;
}
