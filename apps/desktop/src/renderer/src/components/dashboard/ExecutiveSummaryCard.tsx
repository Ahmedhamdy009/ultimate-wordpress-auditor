import React from 'react';
import { CATEGORY_LABELS_I18N, resolveBilingualText, type ReportViewModel } from '@auditor/shared';
import { Card } from '../common/Card.js';
import { Badge, type BadgeVariant } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import { useAuditUi } from '../../context/AuditUiContext.js';

export interface ExecutiveSummaryCardProps {
  readonly viewModel: ReportViewModel;
  readonly totalPersistedFindings?: number;
  readonly isTruncated?: boolean;
}

function getHealthBandVariant(bandId: string): BadgeVariant {
  switch (bandId) {
    case 'healthy':
      return 'success';
    case 'needs_attention':
    case 'provisional_incomplete_scan':
      return 'warning';
    case 'issues_detected':
    case 'action_required':
      return 'danger';
    default:
      return 'neutral';
  }
}

function getScanStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'cancelled':
    case 'completed_partial':
    case 'timed_out':
      return 'warning';
    case 'running':
      return 'info';
    default:
      return 'neutral';
  }
}

function getConfidenceVariant(bandId: string): BadgeVariant {
  switch (bandId) {
    case 'high':
      return 'success';
    case 'moderate':
      return 'info';
    case 'low':
      return 'warning';
    default:
      return 'neutral';
  }
}

function formatScanDate(iso: string | null, locale: 'en' | 'ar'): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US');
  } catch {
    return iso;
  }
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms === undefined || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

export const ExecutiveSummaryCard: React.FC<ExecutiveSummaryCardProps> = ({
  viewModel,
  totalPersistedFindings,
  isTruncated = false,
}) => {
  const { locale, direction, tDesktop } = useAuditUi();
  const { healthOverview, scanMeta, site, executiveSummary, detectedStack, disclosures, labels } =
    viewModel;

  const hasAnyStackSignal =
    detectedStack.isWordPress ||
    detectedStack.isElementor ||
    detectedStack.isElementorPro ||
    detectedStack.isWooCommerce ||
    detectedStack.hasRestApi ||
    detectedStack.hasXmlRpc ||
    detectedStack.detectedThemes.length > 0 ||
    detectedStack.detectedPlugins.length > 0 ||
    detectedStack.cdnOrCacheHints.length > 0 ||
    detectedStack.serverHints.length > 0;

  const isHistoricalOrPartial =
    healthOverview.coverageApproximated ||
    healthOverview.provisional ||
    scanMeta.isPartialAudit ||
    scanMeta.isPartialCoverage ||
    healthOverview.dimensions.some(d => d.status === 'approximated' || d.status === 'unavailable');

  const displayDate = scanMeta.completedAt ?? scanMeta.startedAt;

  return (
    <div
      className="auditor-exec-dashboard"
      dir={direction}
      lang={locale}
      data-testid="executive-summary-dashboard"
    >
      <Card
        title={labels.executiveSummary}
        subtitle={`${site.name} — ${scanMeta.targetUrl}`}
        headerAction={
          <div className="auditor-badge-group">
            <Badge variant={getScanStatusVariant(scanMeta.status)} size="sm">
              {scanMeta.statusLabel}
            </Badge>
            <Badge variant={getHealthBandVariant(healthOverview.healthBand)} size="sm">
              {healthOverview.healthBandLabel}
            </Badge>
            {healthOverview.provisional && (
              <Badge variant="warning" size="sm">
                {tDesktop('provisionalBadge')}
              </Badge>
            )}
          </div>
        }
      >
        {/* Health Triad Row */}
        <div className="auditor-triad-grid" data-testid="health-triad-grid">
          {/* 1. Health Index */}
          <div
            className={`auditor-triad-tile auditor-triad-tile--${getHealthBandVariant(healthOverview.healthBand)}`}
            data-testid="triad-health-index"
          >
            <div className="auditor-triad-tile__label">{labels.healthIndexLabel}</div>
            <div className="auditor-triad-tile__value" dir="ltr">
              {healthOverview.healthIndexScore !== null
                ? `${healthOverview.healthIndexScore}/100`
                : tDesktop('unavailableValue')}
            </div>
            <div className="auditor-triad-tile__meta">
              <Badge variant={getHealthBandVariant(healthOverview.healthBand)} size="sm">
                {healthOverview.healthBandLabel}
              </Badge>
              {healthOverview.provisional && (
                <Badge variant="warning" size="sm">
                  {tDesktop('provisionalBadge')}
                </Badge>
              )}
            </div>
          </div>

          {/* 2. Audit Coverage */}
          <div className="auditor-triad-tile auditor-triad-tile--info" data-testid="triad-coverage">
            <div className="auditor-triad-tile__label">{labels.auditCoverageLabel}</div>
            <div className="auditor-triad-tile__value" dir="ltr">
              {healthOverview.coveragePercent}%
            </div>
            <div className="auditor-triad-tile__meta">
              <Badge variant={healthOverview.coverageApproximated ? 'warning' : 'info'} size="sm">
                {healthOverview.coverageStatusLabel}
              </Badge>
              {healthOverview.coverageApproximated && (
                <Badge variant="warning" size="sm">
                  {tDesktop('approximatedBadge')}
                </Badge>
              )}
            </div>
          </div>

          {/* 3. Audit Confidence */}
          <div
            className={`auditor-triad-tile auditor-triad-tile--${getConfidenceVariant(healthOverview.confidenceBand)}`}
            data-testid="triad-confidence"
          >
            <div className="auditor-triad-tile__label">{labels.auditConfidenceLabel}</div>
            <div className="auditor-triad-tile__value" dir="ltr">
              {healthOverview.confidenceScore}%
            </div>
            <div className="auditor-triad-tile__meta">
              <Badge variant={getConfidenceVariant(healthOverview.confidenceBand)} size="sm">
                {healthOverview.confidenceBandLabel}
              </Badge>
            </div>
          </div>
        </div>

        {/* Scan Metadata & Verification Totals */}
        <div className="auditor-exec-meta-grid">
          <div className="auditor-exec-meta-box">
            <div className="auditor-exec-meta-box__item">
              <span className="auditor-exec-meta-box__label">{tDesktop('targetWebsiteLabel')}</span>
              <code className="auditor-exec-meta-box__code" dir="ltr">
                {scanMeta.targetUrl}
              </code>
            </div>
            <div className="auditor-exec-meta-box__item">
              <span className="auditor-exec-meta-box__label">{tDesktop('scanDateLabel')}</span>
              <span dir="ltr">{formatScanDate(displayDate, locale)}</span>
            </div>
            <div className="auditor-exec-meta-box__item">
              <span className="auditor-exec-meta-box__label">{tDesktop('scanDurationLabel')}</span>
              <span dir="ltr">{formatDurationMs(scanMeta.durationMs)}</span>
            </div>
            <div className="auditor-exec-meta-box__item">
              <span className="auditor-exec-meta-box__label">{tDesktop('scanStatusLabel')}</span>
              <Badge variant={getScanStatusVariant(scanMeta.status)} size="sm">
                {scanMeta.statusLabel}
              </Badge>
            </div>
          </div>

          <div className="auditor-exec-meta-box">
            <div className="auditor-exec-meta-box__item">
              <span className="auditor-exec-meta-box__label">
                {tDesktop('rawFindingsCountLabel')}
              </span>
              <strong dir="ltr">
                {executiveSummary.totalRawFindings}
                {isTruncated && totalPersistedFindings !== undefined
                  ? ` / ${totalPersistedFindings}`
                  : ''}
              </strong>
            </div>
            <div className="auditor-exec-meta-box__item">
              <span className="auditor-exec-meta-box__label">
                {tDesktop('consolidatedGroupsLabel')}
              </span>
              <strong dir="ltr">{executiveSummary.uniqueRecommendationsCount}</strong>
            </div>
            <div className="auditor-exec-meta-box__item">
              <span className="auditor-exec-meta-box__label">
                {tDesktop('confirmedFindingsLabel')} / {tDesktop('firmFindingsLabel')} /{' '}
                {tDesktop('potentialFindingsLabel')}
              </span>
              <div className="auditor-badge-group" dir="ltr">
                <Badge variant="success" size="sm">
                  {executiveSummary.confirmedCount}
                </Badge>
                <Badge variant="info" size="sm">
                  {executiveSummary.firmCount}
                </Badge>
                <Badge variant="neutral" size="sm">
                  {executiveSummary.potentialCount}
                </Badge>
              </div>
            </div>
            {executiveSummary.byCategory.length > 0 && (
              <div className="auditor-exec-meta-box__item">
                <span className="auditor-exec-meta-box__label">
                  {tDesktop('filterCategoryLabel')}
                </span>
                <div className="auditor-badge-group">
                  {executiveSummary.byCategory.slice(0, 4).map(cat => (
                    <Badge key={cat.category} variant="neutral" size="sm">
                      {
                        resolveBilingualText(CATEGORY_LABELS_I18N[cat.category], locale, cat.label)
                          .text
                      }{' '}
                      ({cat.count})
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Detected Technology Stack (Evidence-Gated) */}
        <div className="auditor-stack-panel" data-testid="detected-stack-panel">
          <div className="auditor-stack-panel__title">{labels.detectedStackSection}</div>
          {!hasAnyStackSignal ? (
            <div className="auditor-stack-panel__empty">{tDesktop('noStackDetected')}</div>
          ) : (
            <div className="auditor-stack-panel__grid">
              {detectedStack.isWordPress && (
                <div className="auditor-stack-chip">
                  <span className="auditor-stack-chip__label">{tDesktop('wpPlatformLabel')}</span>
                  <Badge variant="info" size="sm">
                    {detectedStack.wordPressVersion
                      ? `${tDesktop('wpVersionLabel')} ${detectedStack.wordPressVersion}`
                      : detectedStack.wordPressConfidence}
                  </Badge>
                </div>
              )}
              {detectedStack.isElementor && (
                <div className="auditor-stack-chip">
                  <span className="auditor-stack-chip__label">
                    {detectedStack.isElementorPro
                      ? tDesktop('elementorProLabel')
                      : tDesktop('elementorLabel')}
                  </span>
                  <Badge variant="info" size="sm">
                    {detectedStack.isElementorPro ? 'Elementor Pro' : 'Elementor'}
                  </Badge>
                </div>
              )}
              {detectedStack.isWooCommerce && (
                <div className="auditor-stack-chip">
                  <span className="auditor-stack-chip__label">{tDesktop('wooCommerceLabel')}</span>
                  <Badge variant="info" size="sm">
                    WooCommerce
                  </Badge>
                </div>
              )}
              {detectedStack.hasRestApi && (
                <div className="auditor-stack-chip">
                  <span className="auditor-stack-chip__label">{tDesktop('restApiLabel')}</span>
                  <Badge variant="neutral" size="sm" className="auditor-ltr-inline">
                    /wp-json/
                  </Badge>
                </div>
              )}
              {detectedStack.hasXmlRpc && (
                <div className="auditor-stack-chip">
                  <span className="auditor-stack-chip__label">{tDesktop('xmlRpcLabel')}</span>
                  <Badge variant="warning" size="sm" className="auditor-ltr-inline">
                    xmlrpc.php
                  </Badge>
                </div>
              )}
              {detectedStack.detectedThemes.length > 0 && (
                <div className="auditor-stack-chip">
                  <span className="auditor-stack-chip__label">{tDesktop('themesLabel')}</span>
                  <code className="auditor-ltr-inline" dir="ltr">
                    {detectedStack.detectedThemes.join(', ')}
                  </code>
                </div>
              )}
              {detectedStack.detectedPlugins.length > 0 && (
                <div className="auditor-stack-chip">
                  <span className="auditor-stack-chip__label">{tDesktop('pluginsLabel')}</span>
                  <code className="auditor-ltr-inline" dir="ltr">
                    {detectedStack.detectedPlugins.join(', ')}
                  </code>
                </div>
              )}
              {detectedStack.cdnOrCacheHints.length > 0 && (
                <div className="auditor-stack-chip">
                  <span className="auditor-stack-chip__label">{tDesktop('cdnCacheLabel')}</span>
                  <code className="auditor-ltr-inline" dir="ltr">
                    {detectedStack.cdnOrCacheHints.join(', ')}
                  </code>
                </div>
              )}
              {detectedStack.serverHints.length > 0 && (
                <div className="auditor-stack-chip">
                  <span className="auditor-stack-chip__label">{tDesktop('serverHintsLabel')}</span>
                  <code className="auditor-ltr-inline" dir="ltr">
                    {detectedStack.serverHints.join(', ')}
                  </code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Measurement Limitations & Telemetry Disclosures */}
        <div className="auditor-disclosures-panel" data-testid="measurement-limitations-panel">
          <Alert
            variant={isHistoricalOrPartial ? 'warning' : 'info'}
            title={tDesktop('measurementLimitationsHeading')}
          >
            <p className="auditor-disclosure-text">{disclosures.healthIndexDisclaimer}</p>
            <p className="auditor-disclosure-text">{disclosures.readOnlyAuditNotice}</p>
            <p className="auditor-disclosure-text">{disclosures.noComplianceCertificationNotice}</p>
            {isHistoricalOrPartial && (
              <p className="auditor-disclosure-text">{tDesktop('historicalCompatibilityNotice')}</p>
            )}
            {healthOverview.telemetryReasons.length > 0 && (
              <div className="auditor-telemetry-reasons">
                <div className="auditor-telemetry-reasons__title">
                  {tDesktop('telemetryReasonsHeading')}
                </div>
                <ul className="auditor-telemetry-reasons__list">
                  {healthOverview.telemetryReasons.map(reason => (
                    <li key={reason.code}>
                      <code dir="ltr">{reason.code}</code>: {reason.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Alert>
        </div>
      </Card>
    </div>
  );
};
