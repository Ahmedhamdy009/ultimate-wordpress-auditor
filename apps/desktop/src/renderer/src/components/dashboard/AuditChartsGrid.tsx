import React from 'react';
import {
  CATEGORY_LABELS_I18N,
  DIMENSION_LABELS_I18N,
  DIMENSION_STATUS_LABELS_I18N,
  REASON_CODE_LABELS_I18N,
  SEVERITY_LABELS_I18N,
  resolveBilingualText,
  type AuditChartSuite,
  type ChartDataStatus,
  type ReportLocale,
  type ReportViewModel,
} from '@auditor/shared';
import { Card } from '../common/Card.js';
import { Badge, type BadgeVariant } from '../common/Badge.js';
import { useAuditUi, type DesktopLabelKey } from '../../context/AuditUiContext.js';

export interface AuditChartsGridProps {
  readonly viewModel: ReportViewModel;
}

function getChartStatusVariant(status: ChartDataStatus): BadgeVariant {
  switch (status) {
    case 'measured':
      return 'success';
    case 'partial':
    case 'approximated':
      return 'warning';
    case 'excluded':
      return 'info';
    case 'unavailable':
    default:
      return 'neutral';
  }
}

function getChartStatusLabelKey(status: ChartDataStatus): DesktopLabelKey {
  switch (status) {
    case 'measured':
      return 'chartStatusMeasured';
    case 'partial':
      return 'chartStatusPartial';
    case 'approximated':
      return 'chartStatusApproximated';
    case 'excluded':
      return 'chartStatusExcluded';
    case 'unavailable':
    default:
      return 'chartStatusUnavailable';
  }
}

function getSeverityBarClass(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'auditor-chart-fill--critical';
    case 'high':
      return 'auditor-chart-fill--high';
    case 'medium':
      return 'auditor-chart-fill--medium';
    case 'low':
      return 'auditor-chart-fill--low';
    default:
      return 'auditor-chart-fill--info';
  }
}

function getVitalBarClass(rating: string): string {
  switch (rating) {
    case 'good':
      return 'auditor-chart-fill--good';
    case 'needs_improvement':
      return 'auditor-chart-fill--medium';
    case 'poor':
      return 'auditor-chart-fill--critical';
    default:
      return 'auditor-chart-fill--muted';
  }
}

function getRatingLabelKey(rating: string): DesktopLabelKey {
  switch (rating) {
    case 'good':
      return 'ratingGood';
    case 'needs_improvement':
      return 'ratingNeedsImprovement';
    case 'poor':
      return 'ratingPoor';
    case 'unsupported_in_lab':
      return 'ratingUnsupportedInLab';
    case 'unavailable':
    default:
      return 'ratingUnavailable';
  }
}

function getAssetBucketLabelKey(bucket: string): DesktopLabelKey {
  switch (bucket) {
    case 'document':
      return 'assetDocument';
    case 'script':
      return 'assetScript';
    case 'stylesheet':
      return 'assetStylesheet';
    case 'image':
      return 'assetImage';
    case 'font':
      return 'assetFont';
    case 'flagged_heavy':
      return 'assetFlaggedHeavy';
    case 'other':
    default:
      return 'assetOther';
  }
}

function formatBytesDisplay(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'N/A';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function translateReason(code: string, locale: ReportLocale): string {
  return resolveBilingualText(REASON_CODE_LABELS_I18N[code], locale, code.replace(/_/g, ' ')).text;
}

const ChartSvgBar: React.FC<{
  readonly ratio: number;
  readonly fillClass: string;
  readonly ariaLabel: string;
  readonly markerGoodRatio?: number;
  readonly markerPoorRatio?: number;
}> = ({ ratio, fillClass, ariaLabel, markerGoodRatio, markerPoorRatio }) => {
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const width = clamped > 0 ? Math.max(4, Math.round(clamped * 240)) : 0;

  return (
    <svg
      className="auditor-chart-svg"
      viewBox="0 0 240 12"
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      <rect x={0} y={1} width={240} height={10} rx={4} className="auditor-svg-track" />
      {width > 0 && (
        <rect
          x={0}
          y={1}
          width={width}
          height={10}
          rx={4}
          className={`auditor-chart-fill ${fillClass}`}
        />
      )}
      {typeof markerGoodRatio === 'number' && markerGoodRatio > 0 && markerGoodRatio < 1 && (
        <line
          x1={Math.round(markerGoodRatio * 240)}
          y1={0}
          x2={Math.round(markerGoodRatio * 240)}
          y2={12}
          className="auditor-chart-marker-good"
        />
      )}
      {typeof markerPoorRatio === 'number' && markerPoorRatio > 0 && markerPoorRatio < 1 && (
        <line
          x1={Math.round(markerPoorRatio * 240)}
          y1={0}
          x2={Math.round(markerPoorRatio * 240)}
          y2={12}
          className="auditor-chart-marker-poor"
        />
      )}
    </svg>
  );
};

const ChartReasonsList: React.FC<{
  readonly reasonCodes: readonly string[];
  readonly locale: ReportLocale;
}> = ({ reasonCodes, locale }) => {
  if (!reasonCodes || reasonCodes.length === 0) return null;
  return (
    <ul className="auditor-chart-reasons">
      {reasonCodes.map(code => (
        <li key={code}>
          <code dir="ltr">{code}</code>: {translateReason(code, locale)}
        </li>
      ))}
    </ul>
  );
};

export const AuditChartsGrid: React.FC<AuditChartsGridProps> = ({ viewModel }) => {
  const { locale, direction, tDesktop } = useAuditUi();
  const charts: AuditChartSuite = viewModel.charts;

  return (
    <div dir={direction} lang={locale} data-testid="audit-charts-suite">
      <Card title={viewModel.labels.chartsSection} subtitle={tDesktop('labVsFieldBadge')}>
        <div className="auditor-charts-grid">
          {/* 1. Severity Distribution */}
          <figure className="auditor-chart-card" data-testid="chart-severity-distribution">
            <div className="auditor-chart-card__head">
              <figcaption className="auditor-chart-card__title">
                {tDesktop('chartSeverityTitle')}
              </figcaption>
              <Badge variant={getChartStatusVariant(charts.severityDistribution.status)} size="sm">
                {tDesktop(getChartStatusLabelKey(charts.severityDistribution.status))}
              </Badge>
            </div>
            {charts.severityDistribution.status === 'unavailable' ||
            charts.severityDistribution.items.every(i => i.totalCount === 0) ? (
              <p className="auditor-chart-empty">
                {charts.severityDistribution.status === 'excluded'
                  ? tDesktop('chartExcludedNote')
                  : tDesktop('chartNoDataUnavailable')}
              </p>
            ) : (
              <div className="auditor-chart-rows">
                {charts.severityDistribution.items.map(item => {
                  const sevLabel = resolveBilingualText(
                    SEVERITY_LABELS_I18N[item.severity],
                    locale,
                    item.severity,
                  ).text;
                  const pct = Math.round(item.percent);
                  return (
                    <div key={item.severity} className="auditor-chart-row">
                      <div className="auditor-chart-row__meta">
                        <span>{sevLabel}</span>
                        <span className="auditor-chart-row__val" dir="ltr">
                          {item.totalCount} ({pct}%)
                        </span>
                      </div>
                      <ChartSvgBar
                        ratio={item.normalizedShare}
                        fillClass={getSeverityBarClass(item.severity)}
                        ariaLabel={`${sevLabel}: ${item.totalCount} (${pct}%)`}
                      />
                      <div className="auditor-chart-row__sub">
                        <span>
                          {tDesktop('filterConfirmedFirm')}:{' '}
                          <strong dir="ltr">{item.confirmedOrFirmCount}</strong>
                        </span>
                        <span>
                          {tDesktop('filterProvisional')}:{' '}
                          <strong dir="ltr">{item.provisionalCount}</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <ChartReasonsList
              reasonCodes={charts.severityDistribution.reasonCodes}
              locale={locale}
            />
          </figure>

          {/* 2. Category Breakdown */}
          <figure className="auditor-chart-card" data-testid="chart-category-breakdown">
            <div className="auditor-chart-card__head">
              <figcaption className="auditor-chart-card__title">
                {tDesktop('chartCategoryTitle')}
              </figcaption>
              <Badge variant={getChartStatusVariant(charts.categoryBreakdown.status)} size="sm">
                {tDesktop(getChartStatusLabelKey(charts.categoryBreakdown.status))}
              </Badge>
            </div>
            {charts.categoryBreakdown.items.length === 0 ? (
              <p className="auditor-chart-empty">
                {charts.categoryBreakdown.status === 'excluded'
                  ? tDesktop('chartExcludedNote')
                  : tDesktop('chartNoDataUnavailable')}
              </p>
            ) : (
              <div className="auditor-chart-rows">
                {charts.categoryBreakdown.items.map(item => {
                  const catLabel = resolveBilingualText(
                    CATEGORY_LABELS_I18N[item.categoryId],
                    locale,
                    item.label,
                  ).text;
                  const pct = Math.round(item.percent);
                  return (
                    <div key={item.categoryId} className="auditor-chart-row">
                      <div className="auditor-chart-row__meta">
                        <span>{catLabel}</span>
                        <span className="auditor-chart-row__val" dir="ltr">
                          {item.activeCount} ({pct}%)
                        </span>
                      </div>
                      <ChartSvgBar
                        ratio={item.normalizedShare}
                        fillClass={getSeverityBarClass(item.highestSeverity)}
                        ariaLabel={`${catLabel}: ${item.activeCount} (${pct}%)`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <ChartReasonsList reasonCodes={charts.categoryBreakdown.reasonCodes} locale={locale} />
          </figure>

          {/* 3. Coverage Dimensions */}
          <figure className="auditor-chart-card" data-testid="chart-coverage-dimensions">
            <div className="auditor-chart-card__head">
              <figcaption className="auditor-chart-card__title">
                {tDesktop('chartCoverageTitle')}
              </figcaption>
              <Badge variant={getChartStatusVariant(charts.coverageDimensions.status)} size="sm">
                {tDesktop(getChartStatusLabelKey(charts.coverageDimensions.status))}
              </Badge>
            </div>
            <div className="auditor-chart-rows">
              {charts.coverageDimensions.items.map(item => {
                const dimLabel = resolveBilingualText(
                  DIMENSION_LABELS_I18N[item.dimension],
                  locale,
                  item.label,
                ).text;
                const dimStatusLabel = resolveBilingualText(
                  DIMENSION_STATUS_LABELS_I18N[item.dimensionStatus],
                  locale,
                  item.dimensionStatus,
                ).text;
                const fillClass =
                  item.dimensionStatus === 'exact'
                    ? 'auditor-chart-fill--good'
                    : item.dimensionStatus === 'approximated'
                      ? 'auditor-chart-fill--medium'
                      : 'auditor-chart-fill--muted';
                const isUnavailable =
                  item.dimensionStatus === 'unavailable' ||
                  item.dimensionStatus === 'not_applicable';

                return (
                  <div key={item.dimension} className="auditor-chart-row">
                    <div className="auditor-chart-row__meta">
                      <span>{dimLabel}</span>
                      <span className="auditor-chart-row__val" dir="ltr">
                        {isUnavailable ? dimStatusLabel : `${item.percent}%`}
                      </span>
                    </div>
                    <ChartSvgBar
                      ratio={isUnavailable ? 0 : item.ratio}
                      fillClass={fillClass}
                      ariaLabel={`${dimLabel}: ${isUnavailable ? dimStatusLabel : `${item.percent}%`}`}
                    />
                    <div className="auditor-chart-row__sub">
                      <span>{dimStatusLabel}</span>
                      <span>
                        {tDesktop('dimensionWeightLabel')}:{' '}
                        <strong dir="ltr">{item.weight}%</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <ChartReasonsList reasonCodes={charts.coverageDimensions.reasonCodes} locale={locale} />
          </figure>

          {/* 4. Lab Performance Metrics */}
          <figure className="auditor-chart-card" data-testid="chart-lab-vitals">
            <div className="auditor-chart-card__head">
              <figcaption className="auditor-chart-card__title">
                {tDesktop('chartLabVitalsTitle')}
              </figcaption>
              <Badge variant={getChartStatusVariant(charts.labVitals.status)} size="sm">
                {tDesktop(getChartStatusLabelKey(charts.labVitals.status))}
              </Badge>
            </div>
            <div className="auditor-chart-rows">
              {charts.labVitals.items.map(item => {
                const valText =
                  item.value === null
                    ? item.rating === 'unsupported_in_lab'
                      ? tDesktop('ratingUnsupportedInLab')
                      : tDesktop('ratingUnavailable')
                    : item.metric === 'cls'
                      ? item.value.toFixed(3)
                      : `${Math.round(item.value)} ${item.unit}`;
                const ratingText = tDesktop(getRatingLabelKey(item.rating));
                return (
                  <div key={item.metric} className="auditor-chart-row">
                    <div className="auditor-chart-row__meta">
                      <span dir="ltr">{item.label}</span>
                      <span className="auditor-chart-row__val" dir="ltr">
                        {valText}
                      </span>
                    </div>
                    <ChartSvgBar
                      ratio={item.value === null ? 0 : item.normalizedRatio}
                      fillClass={getVitalBarClass(item.rating)}
                      ariaLabel={`${item.label}: ${valText} (${ratingText})`}
                      markerGoodRatio={item.goodThresholdRatio}
                      markerPoorRatio={item.poorThresholdRatio}
                    />
                    <div className="auditor-chart-row__sub">
                      <span>{ratingText}</span>
                      {item.metric === 'inp' && <span>{tDesktop('inpUnavailableInLab')}</span>}
                      {item.isCapped && <span>{tDesktop('lcpCappedNote')}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="auditor-chart-disclaimer">
              {viewModel.disclosures.laboratoryContextNotice}
            </p>
            <ChartReasonsList reasonCodes={charts.labVitals.reasonCodes} locale={locale} />
          </figure>

          {/* 5. Asset Breakdown */}
          <figure className="auditor-chart-card" data-testid="chart-asset-breakdown">
            <div className="auditor-chart-card__head">
              <figcaption className="auditor-chart-card__title">
                {tDesktop('chartAssetTitle')}
              </figcaption>
              <Badge variant={getChartStatusVariant(charts.assetBreakdown.status)} size="sm">
                {tDesktop(getChartStatusLabelKey(charts.assetBreakdown.status))}
              </Badge>
            </div>
            {charts.assetBreakdown.status === 'unavailable' ||
            charts.assetBreakdown.items.length === 0 ? (
              <p className="auditor-chart-empty">{tDesktop('chartNoDataUnavailable')}</p>
            ) : (
              <div className="auditor-chart-rows">
                {charts.assetBreakdown.mode === 'counts_and_flagged_only' && (
                  <p className="auditor-chart-empty">{tDesktop('chartBytesUnavailableNote')}</p>
                )}
                {charts.assetBreakdown.items.map(item => {
                  const bucketLabel = tDesktop(getAssetBucketLabelKey(item.bucket));
                  const valLabel =
                    item.bytes !== null
                      ? `${formatBytesDisplay(item.bytes)} (${Math.round(item.percent)}%)`
                      : `${item.count ?? 0}`;
                  return (
                    <div key={item.bucket} className="auditor-chart-row">
                      <div className="auditor-chart-row__meta">
                        <span>{bucketLabel}</span>
                        <span className="auditor-chart-row__val" dir="ltr">
                          {valLabel}
                        </span>
                      </div>
                      <ChartSvgBar
                        ratio={item.normalizedShare}
                        fillClass={
                          item.bucket === 'flagged_heavy'
                            ? 'auditor-chart-fill--medium'
                            : 'auditor-chart-fill--accent'
                        }
                        ariaLabel={`${bucketLabel}: ${valLabel}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <ChartReasonsList reasonCodes={charts.assetBreakdown.reasonCodes} locale={locale} />
          </figure>

          {/* 6. Bottleneck Summary */}
          <figure className="auditor-chart-card" data-testid="chart-bottleneck-summary">
            <div className="auditor-chart-card__head">
              <figcaption className="auditor-chart-card__title">
                {tDesktop('chartBottleneckTitle')}
              </figcaption>
              <Badge variant={getChartStatusVariant(charts.bottleneckSummary.status)} size="sm">
                {tDesktop(getChartStatusLabelKey(charts.bottleneckSummary.status))}
              </Badge>
            </div>
            {charts.bottleneckSummary.items.length === 0 ? (
              <p className="auditor-chart-empty">{tDesktop('chartNoDataUnavailable')}</p>
            ) : (
              <div className="auditor-chart-rows">
                {charts.bottleneckSummary.items.map((item, idx) => (
                  <div key={`${item.ruleId}-${idx}`} className="auditor-chart-row">
                    <div className="auditor-chart-row__meta">
                      <code dir="ltr">{item.classification}</code>
                      <span className="auditor-chart-row__val" dir="ltr">
                        {item.observedValueText ?? item.severity}
                      </span>
                    </div>
                    <ChartSvgBar
                      ratio={item.normalizedRatio}
                      fillClass={getSeverityBarClass(item.severity)}
                      ariaLabel={`${item.classification}: ${item.observedValueText ?? item.severity}`}
                    />
                    <div className="auditor-chart-row__sub">
                      <span>
                        {item.causality === 'causal'
                          ? tDesktop('causalLabel')
                          : tDesktop('correlationalLabel')}
                      </span>
                      {item.thresholdText && (
                        <span dir="ltr">
                          {tDesktop('observedVsBudgetLabel')}: {item.thresholdText}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <ChartReasonsList reasonCodes={charts.bottleneckSummary.reasonCodes} locale={locale} />
          </figure>

          {/* 7. Top Affected Pages */}
          <figure
            className="auditor-chart-card auditor-chart-card--wide"
            data-testid="chart-top-affected-pages"
          >
            <div className="auditor-chart-card__head">
              <figcaption className="auditor-chart-card__title">
                {tDesktop('chartTopPagesTitle')}
              </figcaption>
              <Badge variant={getChartStatusVariant(charts.topAffectedPages.status)} size="sm">
                {tDesktop(getChartStatusLabelKey(charts.topAffectedPages.status))}
              </Badge>
            </div>
            {charts.topAffectedPages.items.length === 0 ? (
              <p className="auditor-chart-empty">
                {charts.topAffectedPages.status === 'excluded'
                  ? tDesktop('chartExcludedNote')
                  : tDesktop('chartNoDataUnavailable')}
              </p>
            ) : (
              <div className="auditor-chart-rows">
                {charts.topAffectedPages.items.map(item => {
                  const fillClass =
                    item.criticalCount > 0
                      ? 'auditor-chart-fill--critical'
                      : item.highCount > 0
                        ? 'auditor-chart-fill--high'
                        : 'auditor-chart-fill--accent';
                  return (
                    <div key={item.targetUrl} className="auditor-chart-row">
                      <div className="auditor-chart-row__meta">
                        <code className="auditor-chart-url" dir="ltr" title={item.targetUrl}>
                          {item.targetUrl}
                        </code>
                        <span className="auditor-chart-row__val" dir="ltr">
                          {item.activeCount} ({Math.round(item.weightedScore)} pts)
                        </span>
                      </div>
                      <ChartSvgBar
                        ratio={item.normalizedRatio}
                        fillClass={fillClass}
                        ariaLabel={`${item.targetUrl}: ${item.activeCount}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <ChartReasonsList reasonCodes={charts.topAffectedPages.reasonCodes} locale={locale} />
          </figure>
        </div>
      </Card>
    </div>
  );
};
