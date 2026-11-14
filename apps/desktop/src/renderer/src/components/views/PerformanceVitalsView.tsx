import React from 'react';
import type { FindingDTO, ScanRunDTO } from '@auditor/shared';
import { extractPerformanceSummary, LABORATORY_CONTEXT_DISCLAIMER } from '@auditor/shared';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';

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
  const summaryMetrics =
    (scanRun?.summary?.performanceMetrics as Record<string, unknown> | null | undefined) ?? null;
  const perfData = extractPerformanceSummary(summaryMetrics, findings);

  // Historical scans without performance metrics or findings render nothing
  if (!perfData) {
    return null;
  }

  const vitals = [perfData.ttfb, perfData.fcp, perfData.lcp, perfData.cls, perfData.tbt];

  return (
    <div className="auditor-perf-vitals-card" data-testid="performance-vitals-card">
      <div className="auditor-perf-header">
        <h3 className="auditor-perf-header__title">
          Laboratory Web Vitals &amp; Performance Diagnostics
        </h3>
        <Badge variant="info" size="sm">
          AUTOMATED CHROMIUM SESSION
        </Badge>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <Alert variant="info" title="Laboratory Context &amp; Methodology Disclaimer">
          {LABORATORY_CONTEXT_DISCLAIMER}
        </Alert>
      </div>

      {/* 5-tile Web Vitals Grid */}
      <div className="auditor-perf-grid">
        {vitals.map(v => {
          const ratingVariant = getRatingBadgeVariant(v.rating);
          const ratingLabel =
            v.rating === 'needs_improvement' ? 'NEEDS IMPROVEMENT' : v.rating.toUpperCase();
          const tileClass = `auditor-perf-tile auditor-perf-tile--${v.rating.replace(/_/g, '-')}`;
          const valStr =
            v.value !== null
              ? v.name === 'cls'
                ? v.value.toFixed(3)
                : `${Math.round(v.value)} ${v.unit}`
              : 'Unavailable';

          return (
            <div key={v.name} className={tileClass} data-testid={`vital-tile-${v.name}`}>
              <div className="auditor-perf-tile__top">
                <span className="auditor-perf-tile__label">{v.label}</span>
                <Badge variant={ratingVariant} size="sm">
                  {ratingLabel}
                </Badge>
              </div>
              <div className="auditor-perf-tile__value">{valStr}</div>
              <div className="auditor-perf-tile__target">Target: {v.targetLabel}</div>
              {v.name === 'lcp' && v.isCapped && (
                <div className="auditor-perf-tile__note">
                  &#9888; Capped by 5,000ms deadline ceiling
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Page Resource Metrics */}
      {perfData.resources && (
        <div className="auditor-perf-resources">
          <div className="auditor-perf-resources__title">Page Resource &amp; Asset Metrics</div>
          <div className="auditor-perf-resources__grid">
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">Total Transferred</span>
              <span className="auditor-perf-resources__stat-val">
                {typeof perfData.resources.totalTransferSizeBytes === 'number'
                  ? `${Math.round(perfData.resources.totalTransferSizeBytes / 1024)} KB`
                  : 'N/A'}
              </span>
            </div>
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">Render-Blocking</span>
              <span className="auditor-perf-resources__stat-val">
                {perfData.resources.renderBlockingCount ?? 0}
              </span>
            </div>
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">Scripts / Stylesheets</span>
              <span className="auditor-perf-resources__stat-val">
                {perfData.resources.scriptsCount ?? 0} / {perfData.resources.stylesheetsCount ?? 0}
              </span>
            </div>
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">Images (Oversized)</span>
              <span className="auditor-perf-resources__stat-val">
                {perfData.resources.imagesCount ?? 0} (
                {perfData.resources.oversizedImagesCount ?? 0} oversized)
              </span>
            </div>
            <div className="auditor-perf-resources__stat">
              <span className="auditor-perf-resources__stat-label">Uncompressed Assets</span>
              <span className="auditor-perf-resources__stat-val">
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
            Diagnosed Bottlenecks ({perfData.bottleneckDiagnoses.length})
          </div>
          <div>
            {perfData.bottleneckDiagnoses.map((b, idx) => {
              const isCausal = b.causality === 'causal';
              return (
                <div key={`${b.ruleId}-${idx}`} className="auditor-perf-bottlenecks__card">
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      marginBottom: '4px',
                    }}
                  >
                    <Badge variant="neutral" size="sm">
                      {b.classification}
                    </Badge>
                    <Badge variant={isCausal ? 'success' : 'neutral'} size="sm">
                      {isCausal ? 'Causal (Proven Cause)' : 'Correlational (Associated Indicator)'}
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
                  <div style={{ fontWeight: 600, fontSize: '13px', margin: '4px 0' }}>
                    {b.title}
                  </div>
                  {b.observedValueText && b.thresholdText && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--auditor-text-muted)',
                        fontFamily: 'monospace',
                      }}
                    >
                      Observed: <strong>{b.observedValueText}</strong> vs Budget:{' '}
                      <strong>{b.thresholdText}</strong>
                    </div>
                  )}
                  {b.limitationsNotice && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--auditor-warning-text)',
                        marginTop: '4px',
                      }}
                    >
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
