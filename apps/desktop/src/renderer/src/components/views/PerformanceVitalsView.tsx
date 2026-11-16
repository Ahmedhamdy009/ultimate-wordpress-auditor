import React from 'react';
import type { FindingDTO, ScanRunDTO } from '@auditor/shared';
import {
  UI_LABELS,
  extractPerformanceSummary,
  LABORATORY_CONTEXT_DISCLAIMER,
  resolveBilingualText,
} from '@auditor/shared';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import { useAuditUi } from '../../context/AuditUiContext.js';

export interface PerformanceVitalsViewProps {
  readonly scanRun?: ScanRunDTO | null;
  readonly findings?: readonly FindingDTO[] | null;
}

function getRatingBadgeVariant(
  rating: 'good' | 'needs_improvement' | 'poor' | 'unavailable',
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (rating) {
    case 'good':
      return 'success';
    case 'needs_improvement':
      return 'warning';
    case 'poor':
      return 'danger';
    case 'unavailable':
    default:
      return 'neutral';
  }
}

export const PerformanceVitalsView: React.FC<PerformanceVitalsViewProps> = ({
  scanRun,
  findings,
}) => {
  const { locale, direction, tDesktop } = useAuditUi();
  const isArabic = locale === 'ar';

  const summaryMetrics =
    (scanRun?.summary?.performanceMetrics as Record<string, unknown> | null | undefined) ?? null;
  const perfData = extractPerformanceSummary(summaryMetrics, findings);

  // Historical scans without performance metrics or findings render nothing
  if (!perfData) {
    return null;
  }

  const vitals = [perfData.ttfb, perfData.fcp, perfData.lcp, perfData.cls, perfData.tbt];
  const disclaimerText = isArabic
    ? resolveBilingualText(UI_LABELS.laboratoryContextNotice, 'ar').text
    : LABORATORY_CONTEXT_DISCLAIMER;

  return (
    <div
      className="auditor-perf-vitals-card"
      data-testid="performance-vitals-card"
      dir={direction}
      lang={locale}
    >
      <div className="auditor-perf-header">
        <h3 className="auditor-perf-header__title">
          {isArabic
            ? tDesktop('chartLabVitalsTitle')
            : 'Laboratory Web Vitals & Performance Diagnostics'}
        </h3>
        <Badge variant="info" size="sm">
          {isArabic ? tDesktop('labVsFieldBadge') : 'AUTOMATED CHROMIUM SESSION'}
        </Badge>
      </div>

      <div className="auditor-perf-alert-wrap">
        <Alert
          variant="info"
          title={
            isArabic
              ? 'سياق القياس المعملي ومنهجية الاختبار'
              : 'Laboratory Context & Methodology Disclaimer'
          }
        >
          {disclaimerText}
        </Alert>
      </div>

      {/* 5-tile Web Vitals Grid + explicit INP Unsupported-in-Lab disclosure */}
      <div className="auditor-perf-grid">
        {vitals.map(v => {
          const ratingVariant = getRatingBadgeVariant(v.rating);
          const ratingLabel = isArabic
            ? v.rating === 'good'
              ? tDesktop('ratingGood')
              : v.rating === 'needs_improvement'
                ? tDesktop('ratingNeedsImprovement')
                : v.rating === 'poor'
                  ? tDesktop('ratingPoor')
                  : tDesktop('ratingUnavailable')
            : v.rating === 'needs_improvement'
              ? 'NEEDS IMPROVEMENT'
              : v.rating.toUpperCase();
          const tileClass = `auditor-perf-tile auditor-perf-tile--${v.rating.replace(/_/g, '-')}`;
          const valStr =
            v.value !== null
              ? v.name === 'cls'
                ? v.value.toFixed(3)
                : `${Math.round(v.value)} ${v.unit}`
              : isArabic
                ? tDesktop('ratingUnavailable')
                : 'Unavailable';

          return (
            <div key={v.name} className={tileClass} data-testid={`vital-tile-${v.name}`}>
              <div className="auditor-perf-tile__top">
                <span className="auditor-perf-tile__label" dir="ltr">
                  {v.label}
                </span>
                <Badge variant={ratingVariant} size="sm">
                  {ratingLabel}
                </Badge>
              </div>
              <div className="auditor-perf-tile__value" dir="ltr">
                {valStr}
              </div>
              <div className="auditor-perf-tile__target" dir="ltr">
                Target: {v.targetLabel}
              </div>
              {v.name === 'lcp' && v.isCapped && (
                <div className="auditor-perf-tile__note">
                  &#9888;{' '}
                  {isArabic ? tDesktop('lcpCappedNote') : 'Capped by 5,000ms deadline ceiling'}
                </div>
              )}
            </div>
          );
        })}

        {/* Explicit INP Unsupported-in-Lab Tile (never invented) */}
        <div
          className="auditor-perf-tile auditor-perf-tile--unavailable"
          data-testid="vital-tile-inp"
        >
          <div className="auditor-perf-tile__top">
            <span className="auditor-perf-tile__label" dir="ltr">
              Interaction to Next Paint (INP)
            </span>
            <Badge variant="neutral" size="sm">
              {isArabic ? tDesktop('ratingUnsupportedInLab') : 'FIELD ONLY'}
            </Badge>
          </div>
          <div className="auditor-perf-tile__value" dir="ltr">
            N/A
          </div>
          <div className="auditor-perf-tile__target">{tDesktop('inpUnavailableInLab')}</div>
        </div>
      </div>

      {/* Page Resource Metrics */}
      {perfData.resources && (
        <div className="auditor-perf-resources">
          <div className="auditor-perf-resources__title">
            {isArabic ? tDesktop('chartAssetTitle') : 'Page Resource & Asset Metrics'}
          </div>
          <div className="auditor-perf-resources__grid">
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">
                {isArabic ? 'إجمالي المنقول' : 'Total Transferred'}
              </span>
              <span className="auditor-perf-resources__stat-val" dir="ltr">
                {typeof perfData.resources.totalTransferSizeBytes === 'number'
                  ? `${Math.round(perfData.resources.totalTransferSizeBytes / 1024)} KB`
                  : 'N/A'}
              </span>
            </div>
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">
                {isArabic ? 'موارد حاصرة للتصيير' : 'Render-Blocking'}
              </span>
              <span className="auditor-perf-resources__stat-val" dir="ltr">
                {perfData.resources.renderBlockingCount ?? 0}
              </span>
            </div>
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">
                {isArabic ? 'البرمجيات / الأنماط' : 'Scripts / Stylesheets'}
              </span>
              <span className="auditor-perf-resources__stat-val" dir="ltr">
                {perfData.resources.scriptsCount ?? 0} / {perfData.resources.stylesheetsCount ?? 0}
              </span>
            </div>
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">
                {isArabic ? 'الصور (الحجم الزائد)' : 'Images (Oversized)'}
              </span>
              <span className="auditor-perf-resources__stat-val" dir="ltr">
                {perfData.resources.imagesCount ?? 0} (
                {perfData.resources.oversizedImagesCount ?? 0} oversized)
              </span>
            </div>
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">
                {isArabic ? 'أصول غير مضغوطة' : 'Uncompressed Assets'}
              </span>
              <span className="auditor-perf-resources__stat-val" dir="ltr">
                {perfData.resources.uncompressedAssetsCount ?? 0}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Diagnosed Bottlenecks */}
      {perfData.bottleneckDiagnoses.length > 0 && (
        <div className="auditor-perf-bottlenecks">
          <div className="auditor-perf-bottlenecks__title">
            {isArabic
              ? `${tDesktop('chartBottleneckTitle')} (${perfData.bottleneckDiagnoses.length})`
              : `Diagnosed Bottlenecks (${perfData.bottleneckDiagnoses.length})`}
          </div>
          <div>
            {perfData.bottleneckDiagnoses.map((b, idx) => {
              const isCausal = b.causality === 'causal';
              return (
                <div key={`${b.ruleId}-${idx}`} className="auditor-perf-bottlenecks__card">
                  <div className="auditor-perf-badges-row">
                    <Badge variant="neutral" size="sm">
                      {b.classification}
                    </Badge>
                    <Badge variant={isCausal ? 'success' : 'neutral'} size="sm">
                      {isArabic
                        ? isCausal
                          ? tDesktop('causalLabel')
                          : tDesktop('correlationalLabel')
                        : isCausal
                          ? 'Causal (Proven Cause)'
                          : 'Correlational (Associated Indicator)'}
                    </Badge>
                    <Badge
                      variant={
                        b.severity === 'critical' || b.severity === 'high'
                          ? 'danger'
                          : b.severity === 'medium'
                            ? 'warning'
                            : 'neutral'
                      }
                      size="sm"
                    >
                      {b.severity.toUpperCase()}
                    </Badge>
                    <Badge
                      variant={b.confidence.toLowerCase() === 'confirmed' ? 'success' : 'warning'}
                      size="sm"
                    >
                      {b.confidence.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="auditor-perf-bottleneck-title">{b.title}</div>
                  {b.observedValueText && b.thresholdText && (
                    <div className="auditor-perf-bottleneck-metrics" dir="ltr">
                      Observed: <strong>{b.observedValueText}</strong> vs Budget:{' '}
                      <strong>{b.thresholdText}</strong>
                    </div>
                  )}
                  {b.limitationsNotice && (
                    <div className="auditor-perf-bottleneck-limit">
                      &#9888; {b.limitationsNotice}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
