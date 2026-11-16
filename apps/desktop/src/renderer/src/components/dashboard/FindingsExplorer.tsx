import React, { useState, useMemo, useId } from 'react';
import {
  CATEGORY_LABELS_I18N,
  FINDING_CATEGORY_FILTER_ORDER,
  SEVERITY_LABELS_I18N,
  resolveEffectiveFindingClassification,
  resolveBilingualText,
  type AudiencePresentationBlock,
  type RecommendationViewModel,
  type ReportViewModel,
  type VisualEvidenceEntryDTO,
} from '@auditor/shared';
import { Card } from '../common/Card.js';
import { Badge, type BadgeVariant } from '../common/Badge.js';
import { useAuditUi } from '../../context/AuditUiContext.js';

export interface FindingsExplorerProps {
  readonly viewModel: ReportViewModel;
  readonly visualEvidence?: Readonly<Record<string, VisualEvidenceEntryDTO>>;
  readonly visualEvidenceLoading?: boolean;
  readonly initialExpandedIds?: readonly string[];
}

export type FindingsSortOption =
  'severity_desc' | 'severity_asc' | 'occurrences_desc' | 'category_asc' | 'rule_asc';

export type FindingsClassificationFilter =
  'all' | 'confirmed_or_firm' | 'provisional' | 'needs_manual_review' | 'excluded_lifecycle';

export interface FindingsFilterCriteria {
  readonly searchQuery: string;
  readonly severityFilter: string;
  readonly categoryFilter: string;
  readonly classificationFilter: FindingsClassificationFilter;
  readonly hasScreenshotOnly: boolean;
  readonly sortBy: FindingsSortOption;
}

const SEVERITY_WEIGHT: Readonly<Record<string, number>> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  informational: 1,
};

function getSeverityBadgeVariant(severity: string): BadgeVariant {
  switch (severity.toLowerCase()) {
    case 'critical':
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low':
      return 'info';
    default:
      return 'neutral';
  }
}

function getCauseConfidenceVariant(level: string): BadgeVariant {
  if (level === 'confirmed') return 'success';
  if (level === 'mixed') return 'info';
  return 'warning';
}

function normalizeSeverityKey(severity: string): string {
  const s = severity.trim().toLowerCase();
  return s === 'informational' ? 'info' : s;
}

function getScreenshotKeyFromEvidence(preservedEvidence: unknown): string | null {
  if (
    !preservedEvidence ||
    typeof preservedEvidence !== 'object' ||
    Array.isArray(preservedEvidence)
  ) {
    return null;
  }
  const ev = preservedEvidence as Record<string, unknown>;
  const sc = ev.screenshot;
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) {
    return null;
  }
  const scObj = sc as Record<string, unknown>;
  if (typeof scObj.fileName === 'string' && scObj.fileName.trim().length > 0) {
    return scObj.fileName.trim();
  }
  if (typeof scObj.id === 'string' && scObj.id.trim().length > 0) {
    return `${scObj.id.trim()}.png`;
  }
  return null;
}

function getScreenshotMetadata(preservedEvidence: unknown): Record<string, unknown> | null {
  if (
    !preservedEvidence ||
    typeof preservedEvidence !== 'object' ||
    Array.isArray(preservedEvidence)
  ) {
    return null;
  }
  const sc = (preservedEvidence as Record<string, unknown>).screenshot;
  return sc && typeof sc === 'object' && !Array.isArray(sc)
    ? (sc as Record<string, unknown>)
    : null;
}

function pickAudienceText(
  block: AudiencePresentationBlock,
  mode: 'simple' | 'technical' | 'dual',
): { readonly primary: string; readonly secondaryTechnical?: string } {
  if (mode === 'simple') {
    return { primary: block.simpleText ?? block.primaryText };
  }
  if (mode === 'technical') {
    return { primary: block.technicalText ?? block.primaryText };
  }
  const simple = block.simpleText ?? block.primaryText;
  const technical = block.technicalText;
  return {
    primary: simple,
    ...(technical && technical !== simple ? { secondaryTechnical: technical } : {}),
  };
}

export function filterAndSortRecommendations(
  recommendations: readonly RecommendationViewModel[],
  criteria: FindingsFilterCriteria,
): readonly RecommendationViewModel[] {
  const q = criteria.searchQuery.trim().toLowerCase();

  const filtered = recommendations.filter(rec => {
    if (
      criteria.severityFilter !== 'all' &&
      normalizeSeverityKey(rec.severity) !== criteria.severityFilter
    ) {
      return false;
    }
    if (criteria.categoryFilter !== 'all' && rec.category !== criteria.categoryFilter) {
      return false;
    }
    if (criteria.classificationFilter !== 'all') {
      if (criteria.classificationFilter === 'needs_manual_review') {
        if (rec.originalStatus.toLowerCase() !== 'needs_manual_review') return false;
      } else {
        const eff = resolveEffectiveFindingClassification(
          rec.originalStatus,
          rec.originalConfidence,
        );
        if (eff.classification !== criteria.classificationFilter) return false;
      }
    }
    if (criteria.hasScreenshotOnly) {
      const key = getScreenshotKeyFromEvidence(rec.preservedOriginalFinding.preservedEvidence);
      if (!key) return false;
    }
    if (q.length > 0) {
      const haystackParts = [
        rec.ruleId,
        rec.recommendationId,
        rec.problem.primaryText,
        rec.problem.simpleText ?? '',
        rec.problem.technicalText ?? '',
        rec.preservedOriginalFinding.title,
        ...rec.preservedOriginalFinding.findingIds,
        ...rec.exactLocation.urls,
        ...rec.exactLocation.selectors,
        ...rec.exactLocation.assetUrls,
      ];
      const matched = haystackParts.some(part => part.toLowerCase().includes(q));
      if (!matched) return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    switch (criteria.sortBy) {
      case 'severity_asc': {
        const diff =
          (SEVERITY_WEIGHT[normalizeSeverityKey(a.severity)] ?? 0) -
          (SEVERITY_WEIGHT[normalizeSeverityKey(b.severity)] ?? 0);
        return diff !== 0 ? diff : a.ruleId.localeCompare(b.ruleId);
      }
      case 'occurrences_desc': {
        const diff = b.occurrenceCount - a.occurrenceCount;
        return diff !== 0
          ? diff
          : (SEVERITY_WEIGHT[normalizeSeverityKey(b.severity)] ?? 0) -
              (SEVERITY_WEIGHT[normalizeSeverityKey(a.severity)] ?? 0);
      }
      case 'category_asc': {
        const diff = a.categoryLabel.localeCompare(b.categoryLabel);
        return diff !== 0 ? diff : a.ruleId.localeCompare(b.ruleId);
      }
      case 'rule_asc':
        return a.ruleId.localeCompare(b.ruleId);
      case 'severity_desc':
      default: {
        const diff =
          (SEVERITY_WEIGHT[normalizeSeverityKey(b.severity)] ?? 0) -
          (SEVERITY_WEIGHT[normalizeSeverityKey(a.severity)] ?? 0);
        return diff !== 0 ? diff : b.occurrenceCount - a.occurrenceCount;
      }
    }
  });
}

export const FindingsExplorer: React.FC<FindingsExplorerProps> = ({
  viewModel,
  visualEvidence = {},
  visualEvidenceLoading = false,
  initialExpandedIds,
}) => {
  const { locale, viewMode, direction, tDesktop } = useAuditUi();
  const recommendations = viewModel.recommendations;

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [classificationFilter, setClassificationFilter] =
    useState<FindingsClassificationFilter>('all');
  const [hasScreenshotOnly, setHasScreenshotOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<FindingsSortOption>('severity_desc');
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(initialExpandedIds ?? []),
  );
  const [activeScreenshot, setActiveScreenshot] = useState<{
    readonly entry: VisualEvidenceEntryDTO;
    readonly ruleId: string;
    readonly title: string;
  } | null>(null);

  const searchInputId = useId();
  const categorySelectId = useId();
  const classSelectId = useId();
  const sortSelectId = useId();
  const pageSizeSelectId = useId();

  const showTechnical = viewMode === 'technical' || viewMode === 'dual';

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const rec of recommendations) {
      const key = normalizeSeverityKey(rec.severity);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [recommendations]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const rec of recommendations) {
      counts[rec.category] = (counts[rec.category] ?? 0) + 1;
    }
    return counts;
  }, [recommendations]);

  const filteredAndSorted = useMemo(() => {
    return filterAndSortRecommendations(recommendations, {
      searchQuery,
      severityFilter,
      categoryFilter,
      classificationFilter,
      hasScreenshotOnly,
      sortBy,
    });
  }, [
    recommendations,
    searchQuery,
    severityFilter,
    categoryFilter,
    classificationFilter,
    hasScreenshotOnly,
    sortBy,
  ]);

  const totalItems = filteredAndSorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginatedItems = useMemo(
    () => filteredAndSorted.slice(startIndex, startIndex + pageSize),
    [filteredAndSorted, startIndex, pageSize],
  );

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const resetFilters = () => {
    setSearchQuery('');
    setSeverityFilter('all');
    setCategoryFilter('all');
    setClassificationFilter('all');
    setHasScreenshotOnly(false);
    setSortBy('severity_desc');
    setCurrentPage(1);
  };

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    severityFilter !== 'all' ||
    categoryFilter !== 'all' ||
    classificationFilter !== 'all' ||
    hasScreenshotOnly;

  return (
    <div
      className="auditor-findings-explorer"
      dir={direction}
      lang={locale}
      data-testid="findings-explorer"
    >
      <Card
        title={`${viewModel.labels.findingsAndRemediation} (${totalItems}${totalItems !== recommendations.length ? ` / ${recommendations.length}` : ''})`}
        subtitle={viewModel.disclosures.readOnlyAuditNotice}
      >
        {/* Filter, Search, and Sort Toolbar */}
        <div className="auditor-findings-toolbar">
          <div className="auditor-findings-toolbar__row">
            <div className="auditor-findings-search">
              <label htmlFor={searchInputId} className="auditor-sr-only">
                {tDesktop('searchFindingsPlaceholder')}
              </label>
              <input
                id={searchInputId}
                type="search"
                className="auditor-input"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder={tDesktop('searchFindingsPlaceholder')}
                data-testid="findings-search-input"
              />
            </div>

            <div className="auditor-findings-selects">
              <div className="auditor-inline-field">
                <label htmlFor={categorySelectId} className="auditor-label">
                  {tDesktop('filterCategoryLabel')}
                </label>
                <select
                  id={categorySelectId}
                  className="auditor-select"
                  value={categoryFilter}
                  onChange={e => {
                    setCategoryFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  data-testid="findings-category-select"
                >
                  <option value="all">
                    {tDesktop('filterAll')} ({recommendations.length})
                  </option>
                  {FINDING_CATEGORY_FILTER_ORDER.map(cat => {
                    const label = resolveBilingualText(
                      CATEGORY_LABELS_I18N[cat.id],
                      locale,
                      cat.label,
                    ).text;
                    return (
                      <option key={cat.id} value={cat.id}>
                        {label} ({categoryCounts[cat.id] ?? 0})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="auditor-inline-field">
                <label htmlFor={classSelectId} className="auditor-label">
                  {tDesktop('filterClassificationLabel')}
                </label>
                <select
                  id={classSelectId}
                  className="auditor-select"
                  value={classificationFilter}
                  onChange={e => {
                    setClassificationFilter(e.target.value as FindingsClassificationFilter);
                    setCurrentPage(1);
                  }}
                  data-testid="findings-classification-select"
                >
                  <option value="all">{tDesktop('filterAll')}</option>
                  <option value="confirmed_or_firm">{tDesktop('filterConfirmedFirm')}</option>
                  <option value="provisional">{tDesktop('filterProvisional')}</option>
                  <option value="needs_manual_review">{tDesktop('filterManualReview')}</option>
                  <option value="excluded_lifecycle">{tDesktop('chartStatusExcluded')}</option>
                </select>
              </div>

              <div className="auditor-inline-field">
                <label htmlFor={sortSelectId} className="auditor-label">
                  {tDesktop('sortByLabel')}
                </label>
                <select
                  id={sortSelectId}
                  className="auditor-select"
                  value={sortBy}
                  onChange={e => {
                    setSortBy(e.target.value as FindingsSortOption);
                    setCurrentPage(1);
                  }}
                  data-testid="findings-sort-select"
                >
                  <option value="severity_desc">{tDesktop('sortSeverityDesc')}</option>
                  <option value="severity_asc">{tDesktop('sortSeverityAsc')}</option>
                  <option value="occurrences_desc">{tDesktop('sortOccurrencesDesc')}</option>
                  <option value="category_asc">{tDesktop('sortCategoryAsc')}</option>
                  <option value="rule_asc">{tDesktop('sortRuleIdAsc')}</option>
                </select>
              </div>
            </div>
          </div>

          <div className="auditor-findings-toolbar__row">
            {/* Severity Filter Pills */}
            <div
              className="auditor-filter-tabs"
              role="group"
              aria-label={tDesktop('filterSeverityLabel')}
            >
              <button
                type="button"
                className={`auditor-filter-tab ${severityFilter === 'all' ? 'auditor-filter-tab--active' : ''}`}
                onClick={() => {
                  setSeverityFilter('all');
                  setCurrentPage(1);
                }}
              >
                {tDesktop('filterAll')} ({recommendations.length})
              </button>
              {(['critical', 'high', 'medium', 'low', 'info'] as const).map(sev => {
                const sevLabel = resolveBilingualText(SEVERITY_LABELS_I18N[sev], locale, sev).text;
                return (
                  <button
                    key={sev}
                    type="button"
                    data-testid={`severity-filter-${sev}`}
                    className={`auditor-filter-tab ${severityFilter === sev ? 'auditor-filter-tab--active' : ''}`}
                    onClick={() => {
                      setSeverityFilter(sev);
                      setCurrentPage(1);
                    }}
                  >
                    {sevLabel} ({severityCounts[sev] ?? 0})
                  </button>
                );
              })}
            </div>

            <div className="auditor-findings-toggles">
              <label className="auditor-checkbox-inline">
                <input
                  type="checkbox"
                  checked={hasScreenshotOnly}
                  onChange={e => {
                    setHasScreenshotOnly(e.target.checked);
                    setCurrentPage(1);
                  }}
                />
                <span>{tDesktop('filterHasScreenshot')}</span>
              </label>

              {hasActiveFilters && (
                <button
                  type="button"
                  className="auditor-button auditor-button--secondary auditor-button--sm"
                  onClick={resetFilters}
                  data-testid="findings-reset-filters"
                >
                  {tDesktop('resetFiltersLabel')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Findings List */}
        {paginatedItems.length === 0 ? (
          <div className="auditor-empty-state" data-testid="findings-empty-state">
            {tDesktop('noMatchingFindings')}
          </div>
        ) : (
          <div className="auditor-findings-list">
            {paginatedItems.map((rec: RecommendationViewModel) => {
              const isExpanded = expandedIds.has(rec.recommendationId);
              const problemText = pickAudienceText(rec.problem, viewMode);
              const impactText = pickAudienceText(rec.impact, viewMode);
              const screenshotKey = getScreenshotKeyFromEvidence(
                rec.preservedOriginalFinding.preservedEvidence,
              );
              const screenshotMeta = getScreenshotMetadata(
                rec.preservedOriginalFinding.preservedEvidence,
              );
              const visualEntry = screenshotKey ? visualEvidence[screenshotKey] : undefined;

              const rawEvidenceText =
                rec.preservedOriginalFinding.preservedEvidence !== null &&
                rec.preservedOriginalFinding.preservedEvidence !== undefined
                  ? typeof rec.preservedOriginalFinding.preservedEvidence === 'string'
                    ? rec.preservedOriginalFinding.preservedEvidence
                    : JSON.stringify(rec.preservedOriginalFinding.preservedEvidence, null, 2)
                  : null;

              return (
                <article
                  key={rec.recommendationId}
                  className={`auditor-rec-card auditor-rec-card--${normalizeSeverityKey(rec.severity)}`}
                  data-testid={`finding-card-${rec.recommendationId}`}
                >
                  <div className="auditor-rec-card__header">
                    <div className="auditor-rec-card__title-block">
                      <h3 className="auditor-rec-card__title">{problemText.primary}</h3>
                      {problemText.secondaryTechnical && showTechnical && (
                        <p className="auditor-rec-card__subtitle">
                          {problemText.secondaryTechnical}
                        </p>
                      )}
                    </div>

                    <div className="auditor-rec-card__badges">
                      <Badge variant={getSeverityBadgeVariant(rec.severity)} size="sm">
                        {rec.severityLabel}
                      </Badge>
                      <Badge variant="neutral" size="sm">
                        {rec.categoryLabel}
                      </Badge>
                      <Badge
                        variant={getCauseConfidenceVariant(rec.effectiveCauseConfidence)}
                        size="sm"
                      >
                        {rec.causeConfidenceLabel}
                      </Badge>
                      <Badge variant="neutral" size="sm">
                        {rec.originalStatusLabel}
                      </Badge>
                      {rec.occurrenceCount > 1 && (
                        <Badge variant="info" size="sm">
                          {viewModel.labels.occurrencesLabel}: {rec.occurrenceCount}
                        </Badge>
                      )}
                      {showTechnical && (
                        <Badge variant="neutral" size="sm" className="auditor-ltr-inline">
                          {rec.ruleId}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Quick Location Preview + Expand Toggle */}
                  <div className="auditor-rec-card__summary-bar">
                    <div className="auditor-rec-card__location-summary">
                      <span className="auditor-rec-card__location-label">
                        {viewModel.labels.affectedLocation}:
                      </span>{' '}
                      <span>
                        {showTechnical
                          ? rec.exactLocation.summaryText
                          : rec.exactLocation.urls.length > 1
                            ? `${rec.exactLocation.urls[0]} (+${rec.exactLocation.urls.length - 1})`
                            : (rec.exactLocation.urls[0] ?? rec.exactLocation.summaryText)}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="auditor-button auditor-button--secondary auditor-button--sm"
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpanded(rec.recommendationId)}
                      data-testid={`finding-toggle-${rec.recommendationId}`}
                    >
                      {isExpanded
                        ? tDesktop('collapseDetailsLabel')
                        : tDesktop('expandDetailsLabel')}
                    </button>
                  </div>

                  {/* Expanded Finding Details & Actionable Recommendations */}
                  {isExpanded && (
                    <div
                      className="auditor-rec-card__details"
                      data-testid={`finding-details-${rec.recommendationId}`}
                    >
                      {rec.fallbackNotice && (
                        <div className="auditor-rec-notice">{rec.fallbackNotice}</div>
                      )}

                      {/* Impact */}
                      <div className="auditor-rec-section">
                        <h4 className="auditor-rec-section__title">
                          {viewModel.labels.impactAnalysis}
                        </h4>
                        <p className="auditor-rec-section__text">{impactText.primary}</p>
                        {impactText.secondaryTechnical && showTechnical && (
                          <p className="auditor-rec-section__subtext">
                            {impactText.secondaryTechnical}
                          </p>
                        )}
                      </div>

                      {/* Exact Affected Locations & URLs */}
                      <div className="auditor-rec-section">
                        <h4 className="auditor-rec-section__title">
                          {viewModel.labels.affectedUrls} ({rec.exactLocation.urls.length})
                        </h4>
                        {rec.exactLocation.fallbackNotice && (
                          <p className="auditor-rec-section__subtext">
                            {rec.exactLocation.fallbackNotice}
                          </p>
                        )}
                        {rec.exactLocation.urls.length > 0 && (
                          <ul className="auditor-rec-list" dir="ltr">
                            {rec.exactLocation.urls.slice(0, 12).map(url => (
                              <li key={url}>
                                <code className="auditor-url-code">{url}</code>
                              </li>
                            ))}
                          </ul>
                        )}

                        {showTechnical && rec.exactLocation.selectors.length > 0 && (
                          <div className="auditor-rec-subblock">
                            <span className="auditor-rec-subblock__label">
                              {tDesktop('selectorsLabel')}:{' '}
                            </span>
                            <div className="auditor-code-chip-list" dir="ltr">
                              {rec.exactLocation.selectors.slice(0, 10).map(sel => (
                                <code key={sel} className="auditor-code-chip">
                                  {sel}
                                </code>
                              ))}
                            </div>
                          </div>
                        )}

                        {showTechnical && rec.exactLocation.assetUrls.length > 0 && (
                          <div className="auditor-rec-subblock">
                            <span className="auditor-rec-subblock__label">
                              {tDesktop('resourcesLabel')}:{' '}
                            </span>
                            <ul className="auditor-rec-list" dir="ltr">
                              {rec.exactLocation.assetUrls.slice(0, 8).map(asset => (
                                <li key={asset}>
                                  <code className="auditor-url-code">{asset}</code>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {showTechnical && rec.exactLocation.headerNames.length > 0 && (
                          <div className="auditor-rec-subblock">
                            <span className="auditor-rec-subblock__label">
                              {tDesktop('headersLabel')}:{' '}
                            </span>
                            <code dir="ltr">{rec.exactLocation.headerNames.join(', ')}</code>
                          </div>
                        )}

                        {showTechnical && rec.exactLocation.schemaTypes.length > 0 && (
                          <div className="auditor-rec-subblock">
                            <span className="auditor-rec-subblock__label">
                              {tDesktop('schemaTypesLabel')}:{' '}
                            </span>
                            <code dir="ltr">{rec.exactLocation.schemaTypes.join(', ')}</code>
                          </div>
                        )}
                      </div>

                      {/* Screenshot / Visual Evidence Preview */}
                      {(screenshotKey || visualEntry) && (
                        <div
                          className="auditor-rec-section"
                          data-testid={`finding-screenshot-${rec.recommendationId}`}
                        >
                          <h4 className="auditor-rec-section__title">
                            {tDesktop('screenshotPreviewLabel')}
                          </h4>
                          {visualEvidenceLoading ? (
                            <p className="auditor-rec-section__subtext">
                              Loading visual evidence...
                            </p>
                          ) : visualEntry?.embedded && visualEntry.dataUri ? (
                            <div className="auditor-screenshot-box">
                              <img
                                className="auditor-screenshot-thumb"
                                src={visualEntry.dataUri}
                                alt={`${tDesktop('screenshotPreviewLabel')} (${visualEntry.viewport ?? 'viewport'}) - ${rec.ruleId}`}
                              />
                              <div className="auditor-screenshot-meta">
                                <div dir="ltr" className="auditor-screenshot-filename">
                                  <code>{visualEntry.fileName}</code>
                                </div>
                                <div className="auditor-screenshot-stats" dir="ltr">
                                  {visualEntry.viewport ??
                                    String(screenshotMeta?.viewportProfile ?? 'standard')}{' '}
                                  &bull; {Math.round(visualEntry.byteLength / 1024)} KB
                                  {visualEntry.captureType ? ` • ${visualEntry.captureType}` : ''}
                                </div>
                                <button
                                  type="button"
                                  className="auditor-button auditor-button--secondary auditor-button--sm"
                                  onClick={() =>
                                    setActiveScreenshot({
                                      entry: visualEntry,
                                      ruleId: rec.ruleId,
                                      title: problemText.primary,
                                    })
                                  }
                                  data-testid={`open-screenshot-${rec.recommendationId}`}
                                >
                                  {tDesktop('openScreenshotModalLabel')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="auditor-screenshot-unavailable">
                              {visualEntry?.omittedReason ??
                                tDesktop('screenshotUnavailableFallback')}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Confirmed & Possible Causes */}
                      {(rec.confirmedCauses.length > 0 || rec.possibleCauses.length > 0) && (
                        <div className="auditor-rec-section">
                          {rec.confirmedCauses.length > 0 && (
                            <div className="auditor-rec-subblock">
                              <h4 className="auditor-rec-section__title">
                                {viewModel.labels.confirmedCauses}
                              </h4>
                              <ul className="auditor-rec-list">
                                {rec.confirmedCauses.map((cause, idx) => (
                                  <li key={idx}>{cause}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {rec.possibleCauses.length > 0 && (
                            <div className="auditor-rec-subblock">
                              <h4 className="auditor-rec-section__title">
                                {viewModel.labels.possibleCauses}
                              </h4>
                              <ul className="auditor-rec-list">
                                {rec.possibleCauses.map((cause, idx) => (
                                  <li key={idx}>{cause}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Ordered Remediation Steps */}
                      {rec.remediationSteps.length > 0 && (
                        <div className="auditor-rec-section">
                          <h4 className="auditor-rec-section__title">
                            {viewModel.labels.remediationSteps}
                          </h4>
                          <ol className="auditor-rec-ol">
                            {rec.remediationSteps.map(step => {
                              const stepText = pickAudienceText(step.text, viewMode);
                              return (
                                <li key={step.stepNumber}>
                                  <span>{stepText.primary}</span>
                                  {stepText.secondaryTechnical && showTechnical && (
                                    <div className="auditor-rec-step-tech">
                                      {stepText.secondaryTechnical}
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      )}

                      {/* Evidence-Gated Platform Guidance */}
                      {rec.platformGuidance.length > 0 && (
                        <div className="auditor-rec-section">
                          <h4 className="auditor-rec-section__title">
                            {viewModel.labels.platformSpecificGuidance}
                          </h4>
                          <div className="auditor-platform-guidance-list">
                            {rec.platformGuidance.map((pg, idx) => {
                              const pgSummary = pickAudienceText(pg.summary, viewMode);
                              return (
                                <div
                                  key={`${pg.platform}-${idx}`}
                                  className="auditor-platform-card"
                                >
                                  <div className="auditor-platform-card__head">
                                    <Badge variant="info" size="sm">
                                      {pg.platform.toUpperCase()}
                                    </Badge>
                                    <span className="auditor-platform-card__reason">
                                      {pg.evidenceReason}
                                    </span>
                                  </div>
                                  <p className="auditor-rec-section__text">{pgSummary.primary}</p>
                                  <ul className="auditor-rec-list">
                                    {pg.steps.map((st, sIdx) => (
                                      <li key={sIdx}>{st}</li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Code Examples (Technical / Dual Modes Only) */}
                      {showTechnical && rec.codeExamples.length > 0 && (
                        <div className="auditor-rec-section" data-testid="technical-code-examples">
                          <h4 className="auditor-rec-section__title">
                            {viewModel.labels.codeExampleLabel}
                          </h4>
                          {rec.codeExamples.map((ex, idx) => (
                            <div key={idx} className="auditor-code-example">
                              <div className="auditor-code-example__head">
                                <strong>{ex.title}</strong>
                                <Badge variant="neutral" size="sm">
                                  {ex.language}
                                </Badge>
                              </div>
                              <div className="auditor-code-example__disclaimer">
                                {ex.scopeDisclaimer}
                              </div>
                              <pre className="auditor-finding-card__code" dir="ltr">
                                <code>{ex.snippet}</code>
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Verification Steps */}
                      {rec.verificationSteps.length > 0 && (
                        <div className="auditor-rec-section">
                          <h4 className="auditor-rec-section__title">
                            {viewModel.labels.verificationSteps}
                          </h4>
                          <ol className="auditor-rec-ol">
                            {rec.verificationSteps.map(step => {
                              const vText = pickAudienceText(step.text, viewMode);
                              return (
                                <li key={step.stepNumber}>
                                  <span>{vText.primary}</span>
                                  {vText.secondaryTechnical && showTechnical && (
                                    <div className="auditor-rec-step-tech">
                                      {vText.secondaryTechnical}
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      )}

                      {/* Preserved Original Finding Metadata & Raw Evidence (Technical / Dual Only) */}
                      {showTechnical && (
                        <div
                          className="auditor-rec-section"
                          data-testid={`technical-raw-evidence-${rec.recommendationId}`}
                        >
                          <h4 className="auditor-rec-section__title">
                            {viewModel.labels.rawEvidenceLabel}
                          </h4>
                          <div className="auditor-tech-meta-grid">
                            <div>
                              <span className="auditor-rec-subblock__label">
                                {tDesktop('findingIdLabel')}:{' '}
                              </span>
                              <code dir="ltr">
                                {rec.preservedOriginalFinding.findingIds.join(', ') || rec.ruleId}
                              </code>
                            </div>
                            <div>
                              <span className="auditor-rec-subblock__label">
                                {tDesktop('ruleIdLabel')}:{' '}
                              </span>
                              <code dir="ltr">{rec.preservedOriginalFinding.ruleId}</code>
                            </div>
                            <div>
                              <span className="auditor-rec-subblock__label">
                                {tDesktop('originalSeverityConfidenceLabel')}:{' '}
                              </span>
                              <code dir="ltr">
                                {rec.preservedOriginalFinding.severity} /{' '}
                                {rec.preservedOriginalFinding.confidence} /{' '}
                                {rec.preservedOriginalFinding.status}
                              </code>
                            </div>
                          </div>
                          {rawEvidenceText && (
                            <pre className="auditor-finding-card__code" dir="ltr">
                              <code>{rawEvidenceText}</code>
                            </pre>
                          )}
                        </div>
                      )}

                      {/* Limitations & Technical References */}
                      {(rec.limitations.length > 0 ||
                        (showTechnical && rec.references.length > 0)) && (
                        <div className="auditor-rec-section">
                          {rec.limitations.length > 0 && (
                            <div className="auditor-rec-subblock">
                              <h4 className="auditor-rec-section__title">
                                {viewModel.labels.knownLimitations}
                              </h4>
                              <ul className="auditor-rec-list">
                                {rec.limitations.map((lim, idx) => (
                                  <li key={idx}>{lim}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {showTechnical && rec.references.length > 0 && (
                            <div className="auditor-rec-subblock">
                              <h4 className="auditor-rec-section__title">
                                {viewModel.labels.referencesLabel}
                              </h4>
                              <ul className="auditor-rec-list" dir="ltr">
                                {rec.references.map(ref => (
                                  <li key={ref.url}>
                                    <code>{ref.label}</code> — <code>{ref.url}</code>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {totalItems > 0 && (
          <div className="auditor-pagination-bar" data-testid="findings-pagination">
            <div className="auditor-pagination-bar__info" dir="ltr">
              {tDesktop('paginationShowing')} {startIndex + 1}–
              {Math.min(startIndex + pageSize, totalItems)} {tDesktop('paginationOf')} {totalItems}
            </div>

            <div className="auditor-pagination-bar__controls">
              <div className="auditor-inline-field">
                <label htmlFor={pageSizeSelectId} className="auditor-label">
                  {tDesktop('pageSizeLabel')}
                </label>
                <select
                  id={pageSizeSelectId}
                  className="auditor-select"
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>

              <button
                type="button"
                className="auditor-button auditor-button--secondary auditor-button--sm"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                data-testid="findings-prev-page"
              >
                {tDesktop('paginationPrev')}
              </button>
              <span className="auditor-pagination-page" dir="ltr">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                className="auditor-button auditor-button--secondary auditor-button--sm"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                data-testid="findings-next-page"
              >
                {tDesktop('paginationNext')}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Accessible Screenshot Lightbox Modal */}
      {activeScreenshot && activeScreenshot.entry.dataUri && (
        <div
          className="auditor-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={activeScreenshot.title}
          data-testid="screenshot-preview-modal"
        >
          <div className="auditor-modal-content">
            <div className="auditor-modal-header">
              <div>
                <h3 className="auditor-modal-title">{activeScreenshot.title}</h3>
                <div className="auditor-modal-subtitle" dir="ltr">
                  <code>{activeScreenshot.ruleId}</code> &bull;{' '}
                  <code>{activeScreenshot.entry.fileName}</code>
                  {activeScreenshot.entry.viewport ? ` • ${activeScreenshot.entry.viewport}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="auditor-button auditor-button--secondary auditor-button--sm"
                onClick={() => setActiveScreenshot(null)}
                data-testid="close-screenshot-modal"
              >
                {tDesktop('closeModalLabel')}
              </button>
            </div>
            <div className="auditor-modal-body">
              <img
                className="auditor-modal-image"
                src={activeScreenshot.entry.dataUri}
                alt={`${activeScreenshot.title} (${activeScreenshot.entry.fileName})`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
