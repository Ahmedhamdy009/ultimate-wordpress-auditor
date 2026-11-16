import React from 'react';
import {
  DIMENSION_STATUS_LABELS_I18N,
  resolveBilingualText,
  type DimensionViewModel,
  type ReportViewModel,
  type ScanRunDTO,
} from '@auditor/shared';
import { Card } from '../common/Card.js';
import { Badge, type BadgeVariant } from '../common/Badge.js';
import { useAuditUi } from '../../context/AuditUiContext.js';
import { extractDimensionTelemetryCounts } from '../../utils/reportViewModelAdapter.js';

export interface CoverageDimensionsPanelProps {
  readonly viewModel: ReportViewModel;
  readonly scanRun: ScanRunDTO;
}

function getDimensionStatusVariant(status: DimensionViewModel['status']): BadgeVariant {
  switch (status) {
    case 'exact':
      return 'success';
    case 'approximated':
      return 'warning';
    case 'unavailable':
      return 'danger';
    case 'not_applicable':
    default:
      return 'neutral';
  }
}

export const CoverageDimensionsPanel: React.FC<CoverageDimensionsPanelProps> = ({
  viewModel,
  scanRun,
}) => {
  const { locale, direction, tDesktop } = useAuditUi();
  const { healthOverview, labels } = viewModel;

  return (
    <div dir={direction} lang={locale} data-testid="coverage-dimensions-panel">
      <Card
        title={labels.dimensionBreakdown}
        subtitle={`${labels.auditCoverageLabel}: ${healthOverview.coveragePercent}% (${healthOverview.coverageStatusLabel})`}
      >
        <div className="auditor-dimensions-grid">
          {healthOverview.dimensions.map(dim => {
            const counts = extractDimensionTelemetryCounts(scanRun, dim);
            const isAvailableRatio =
              dim.status !== 'unavailable' && dim.status !== 'not_applicable';
            const unitLabel =
              counts.unitKind === 'modules'
                ? tDesktop('modulesUnitLabel')
                : tDesktop('pagesUnitLabel');

            return (
              <div
                key={dim.id}
                className={`auditor-dimension-card auditor-dimension-card--${dim.status}`}
                data-testid={`coverage-dimension-${dim.id}`}
              >
                <div className="auditor-dimension-card__header">
                  <div className="auditor-dimension-card__title">{dim.label}</div>
                  <Badge variant={getDimensionStatusVariant(dim.status)} size="sm">
                    {dim.statusLabel}
                  </Badge>
                </div>

                <div className="auditor-dimension-card__metrics">
                  <div className="auditor-dimension-metric">
                    <span className="auditor-dimension-metric__label">
                      {tDesktop('coverageRatioLabel')}
                    </span>
                    <strong className="auditor-dimension-metric__val" dir="ltr">
                      {isAvailableRatio
                        ? `${dim.percent}% (${dim.ratio.toFixed(2)})`
                        : dim.status === 'not_applicable'
                          ? 'N/A'
                          : tDesktop('unavailableValue')}
                    </strong>
                  </div>

                  <div className="auditor-dimension-metric">
                    <span className="auditor-dimension-metric__label">
                      {tDesktop('executedChecksLabel')} / {tDesktop('eligibleChecksLabel')}
                    </span>
                    <strong className="auditor-dimension-metric__val" dir="ltr">
                      {counts.executed !== null ? counts.executed : tDesktop('unavailableValue')} /{' '}
                      {counts.eligible !== null ? counts.eligible : tDesktop('unavailableValue')}{' '}
                      {counts.executed !== null || counts.eligible !== null ? unitLabel : ''}
                    </strong>
                  </div>

                  <div className="auditor-dimension-metric">
                    <span className="auditor-dimension-metric__label">
                      {tDesktop('dimensionWeightLabel')}
                    </span>
                    <strong className="auditor-dimension-metric__val" dir="ltr">
                      {dim.weight}%
                    </strong>
                  </div>
                </div>

                {/* Proportional coverage bar using SVG (strictly CSP-compliant without inline style attributes) */}
                <div className="auditor-dimension-bar">
                  <svg
                    className="auditor-dimension-bar__svg"
                    viewBox="0 0 200 10"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`${dim.label}: ${isAvailableRatio ? `${dim.percent}%` : dim.statusLabel}`}
                  >
                    <title>
                      {`${dim.label}: ${isAvailableRatio ? `${dim.percent}%` : dim.statusLabel}`}
                    </title>
                    <rect
                      x={0}
                      y={0}
                      width={200}
                      height={10}
                      rx={5}
                      className="auditor-svg-track"
                    />
                    {isAvailableRatio && dim.ratio > 0 && (
                      <rect
                        x={0}
                        y={0}
                        width={Math.max(4, Math.round(dim.ratio * 200))}
                        height={10}
                        rx={5}
                        className={`auditor-svg-fill auditor-svg-fill--${dim.status}`}
                      />
                    )}
                  </svg>
                </div>

                {/* Sub-modules breakdown for D3 / D4 */}
                {counts.subModules.length > 0 && (
                  <div className="auditor-dimension-submodules">
                    <div className="auditor-dimension-submodules__title">
                      {tDesktop('subchecksLabel')}
                    </div>
                    <div className="auditor-dimension-submodules__list">
                      {counts.subModules.map(mod => {
                        const modStatusText = resolveBilingualText(
                          DIMENSION_STATUS_LABELS_I18N[mod.status],
                          locale,
                          mod.status,
                        ).text;
                        return (
                          <span key={mod.name} className="auditor-submodule-pill">
                            <code dir="ltr">{mod.name}</code>:{' '}
                            <span dir="ltr">
                              {mod.status === 'unavailable' || mod.status === 'not_applicable'
                                ? modStatusText
                                : `${mod.percent}% (${modStatusText})`}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Machine-readable reason codes translated via shared dictionary */}
                {dim.localizedReasons.length > 0 && (
                  <ul className="auditor-dimension-reasons">
                    {dim.localizedReasons.map(r => (
                      <li key={r.code}>
                        <code dir="ltr">{r.code}</code> — {r.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};
