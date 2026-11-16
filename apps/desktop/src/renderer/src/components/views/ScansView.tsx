import React, { useState, useId, useMemo, useEffect, useRef } from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import { PerformanceVitalsView } from './PerformanceVitalsView.js';
import { ExecutiveSummaryCard } from '../dashboard/ExecutiveSummaryCard.js';
import { CoverageDimensionsPanel } from '../dashboard/CoverageDimensionsPanel.js';
import { AuditChartsGrid } from '../dashboard/AuditChartsGrid.js';
import { VisualEvidenceGallery } from '../dashboard/VisualEvidenceGallery.js';
import { FindingsExplorer } from '../dashboard/FindingsExplorer.js';
import { useAuditUi } from '../../context/AuditUiContext.js';
import { useScans } from '../../hooks/useScans.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useSites } from '../../hooks/useSites.js';
import { adaptScanRunForViewModel } from '../../utils/reportViewModelAdapter.js';
import type { ViewId } from '../../types/navigation.js';
import {
  classifyFindingConfidenceBucket,
  normalizeFindingCategoryId,
  normalizeFindingLifecycleStatus,
  type FindingDTO,
  type ScanRunDTO,
  type ReportFormat,
  type CreateScanRunDTO,
  type VisualEvidenceEntryDTO,
} from '@auditor/shared';
import type { ElectronAPI } from '../../../../common/ipc/contracts.js';

export interface ScansViewProps {
  readonly onNavigate?: (view: ViewId) => void;
  readonly initialScans?: readonly ScanRunDTO[];
  readonly initialActiveScan?: ScanRunDTO | null;
  readonly initialScanRunId?: string;
  readonly initialSelectedScanFindings?: readonly FindingDTO[];
  readonly initialVisualEvidence?: Readonly<Record<string, VisualEvidenceEntryDTO>>;
}

type ScanProfile = 'quick' | 'standard' | 'deep' | 'custom';

function getElectronAPI(): ElectronAPI | undefined {
  const g = globalThis as unknown as { electronAPI?: ElectronAPI };
  return (typeof window !== 'undefined' && window.electronAPI) || g.electronAPI;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  if (ms < 60000) return `${seconds}s`;
  const minutes = Math.floor(ms / 60000);
  const remSec = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${remSec}s`;
}

function getStatusBadgeVariant(
  status: string,
): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'warning';
    case 'running':
    case 'crawling':
    case 'analyzing':
    case 'persisting':
      return 'info';
    default:
      return 'neutral';
  }
}

export function getFindingConfidenceBadgeProps(confidence: string): {
  variant: 'success' | 'info' | 'neutral';
  label: string;
} {
  const bucket = classifyFindingConfidenceBucket(confidence);
  if (bucket === 'confirmed') {
    return { variant: 'success', label: 'Confirmed' };
  }
  if (bucket === 'firm') {
    return { variant: 'info', label: 'Firm' };
  }
  return { variant: 'neutral', label: 'Potential' };
}

export function getFindingStatusBadgeProps(
  status: string | null | undefined,
  confidence?: string | null,
): {
  variant: 'success' | 'warning' | 'neutral';
  label: string;
} {
  const normalized = normalizeFindingLifecycleStatus(status, confidence);
  if (normalized === 'confirmed' || normalized === 'resolved' || normalized === 'fixed') {
    return {
      variant: 'success',
      label: `Status: ${normalized.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
    };
  }
  if (
    normalized === 'potential' ||
    normalized === 'needs_manual_review' ||
    normalized === 'retest_required'
  ) {
    const text =
      normalized === 'needs_manual_review'
        ? 'Needs Manual Review'
        : normalized.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
      variant: 'warning',
      label: `Status: ${text}`,
    };
  }
  return {
    variant: 'neutral',
    label: `Status: ${normalized.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
  };
}

export function isWordPressCategoryFinding(finding: {
  category?: string | null;
  ruleId?: string | null;
}): boolean {
  return normalizeFindingCategoryId(finding) === 'wordpress';
}

export const ScansView: React.FC<ScansViewProps> = ({
  onNavigate,
  initialScans,
  initialActiveScan,
  initialScanRunId,
  initialSelectedScanFindings,
  initialVisualEvidence,
}) => {
  const { locale, viewMode } = useAuditUi();
  // Hooks for scan, project, and site data
  const {
    scans,
    activeScan,
    progress,
    findings: hookFindings,
    findingsScanId,
    totalFindings: hookTotalFindings,
    selectedScanId: hookSelectedScanId,
    loading: scansLoading,
    isScanning,
    findingsLoading,
    error: scansError,
    findingsError,
    createScan,
    cancelScan,
    selectScan,
    clearError,
    clearFindingsError,
    clearActiveScan,
    loadFindings,
  } = useScans({
    initialScans,
    initialActiveScan,
  });

  useEffect(() => {
    if (initialScanRunId && initialSelectedScanFindings === undefined) {
      void selectScan(initialScanRunId);
    }
  }, [initialScanRunId, initialSelectedScanFindings, selectScan]);

  const effectiveSelectedScanId =
    hookSelectedScanId ??
    (initialSelectedScanFindings !== undefined ? (initialScanRunId ?? null) : null);
  const effectiveFindings =
    hookSelectedScanId !== null
      ? hookFindings
      : initialSelectedScanFindings !== undefined
        ? initialSelectedScanFindings
        : hookFindings;
  const effectiveTotalFindings =
    hookSelectedScanId !== null
      ? hookTotalFindings
      : initialSelectedScanFindings !== undefined
        ? initialSelectedScanFindings.length
        : hookTotalFindings;
  const effectiveFindingsScanId =
    hookSelectedScanId !== null
      ? findingsScanId
      : initialSelectedScanFindings !== undefined
        ? (initialScanRunId ?? null)
        : findingsScanId;
  const findings = effectiveFindings;
  const totalFindings = effectiveTotalFindings;
  const selectedScanId = effectiveSelectedScanId;

  const { projects } = useProjects();

  // Launcher state
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [targetUrlOverride, setTargetUrlOverride] = useState<string>('');
  const [profile, setProfile] = useState<ScanProfile>('standard');
  const [maxPages, setMaxPages] = useState<number>(25);
  const [maxDepth, setMaxDepth] = useState<number>(3);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(120);
  const [enableBrowserAudit, setEnableBrowserAudit] = useState<boolean>(true);
  const [maxBrowserPages, setMaxBrowserPages] = useState<number>(5);
  const [captureScreenshots, setCaptureScreenshots] = useState<boolean>(true);
  const [moduleHttp, setModuleHttp] = useState<boolean>(true);
  const [moduleWordpress, setModuleWordpress] = useState<boolean>(true);
  const [moduleSecurityHeaders, setModuleSecurityHeaders] = useState<boolean>(true);
  const [moduleCookies, setModuleCookies] = useState<boolean>(true);
  const [moduleSeo, setModuleSeo] = useState<boolean>(true);
  const [moduleRuntimeErrors, setModuleRuntimeErrors] = useState<boolean>(true);
  const [moduleNetworkResources, setModuleNetworkResources] = useState<boolean>(true);
  const [moduleResponsiveLayout, setModuleResponsiveLayout] = useState<boolean>(true);
  const [moduleLayoutStability, setModuleLayoutStability] = useState<boolean>(true);
  const [moduleAccessibility, setModuleAccessibility] = useState<boolean>(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Sites for the currently selected project
  const { sites } = useSites(selectedProjectId || undefined);

  // Auto-select first project if available and none selected
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  // Auto-select first site of project
  useEffect(() => {
    if (sites.length > 0) {
      const activeSites = sites.filter(s => !s.isArchived);
      if (
        activeSites.length > 0 &&
        (!selectedSiteId || !activeSites.some(s => s.id === selectedSiteId))
      ) {
        setSelectedSiteId(activeSites[0].id);
        setTargetUrlOverride(activeSites[0].baseUrl);
      }
    } else {
      setSelectedSiteId('');
      setTargetUrlOverride('');
    }
  }, [sites, selectedSiteId]);

  const handleSiteChange = (siteId: string) => {
    setSelectedSiteId(siteId);
    const site = sites.find(s => s.id === siteId);
    if (site) {
      setTargetUrlOverride(site.baseUrl);
    }
  };

  // Profile presets handler
  const handleProfileSelect = (selectedProfile: ScanProfile) => {
    setProfile(selectedProfile);
    if (selectedProfile === 'quick') {
      setMaxPages(10);
      setMaxDepth(2);
      setTimeoutSeconds(60);
      setMaxBrowserPages(2);
      setCaptureScreenshots(false);
      setEnableBrowserAudit(true);
      setModuleHttp(true);
      setModuleWordpress(true);
      setModuleSecurityHeaders(true);
      setModuleCookies(true);
      setModuleSeo(true);
      setModuleRuntimeErrors(true);
      setModuleNetworkResources(true);
      setModuleResponsiveLayout(true);
      setModuleLayoutStability(false);
      setModuleAccessibility(true);
    } else if (selectedProfile === 'standard') {
      setMaxPages(25);
      setMaxDepth(3);
      setTimeoutSeconds(120);
      setMaxBrowserPages(5);
      setCaptureScreenshots(true);
      setEnableBrowserAudit(true);
      setModuleHttp(true);
      setModuleWordpress(true);
      setModuleSecurityHeaders(true);
      setModuleCookies(true);
      setModuleSeo(true);
      setModuleRuntimeErrors(true);
      setModuleNetworkResources(true);
      setModuleResponsiveLayout(true);
      setModuleLayoutStability(true);
      setModuleAccessibility(true);
    } else if (selectedProfile === 'deep') {
      setMaxPages(100);
      setMaxDepth(5);
      setTimeoutSeconds(300);
      setMaxBrowserPages(15);
      setCaptureScreenshots(true);
      setEnableBrowserAudit(true);
      setModuleHttp(true);
      setModuleWordpress(true);
      setModuleSecurityHeaders(true);
      setModuleCookies(true);
      setModuleSeo(true);
      setModuleRuntimeErrors(true);
      setModuleNetworkResources(true);
      setModuleResponsiveLayout(true);
      setModuleLayoutStability(true);
      setModuleAccessibility(true);
    }
  };

  // Scan History Filters
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all');
  const [historySiteFilter, setHistorySiteFilter] = useState<string>('all');

  // Visual Evidence state for currently inspected scan (strictly scanRunId-guarded)
  const [visualEvidence, setVisualEvidence] = useState<
    Readonly<Record<string, VisualEvidenceEntryDTO>>
  >(initialVisualEvidence ?? {});
  const [visualEvidenceLoading, setVisualEvidenceLoading] = useState<boolean>(false);
  const visualEvidenceReqRef = useRef<number>(0);

  // Report generation state
  const [reportGeneratingScanId, setReportGeneratingScanId] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string>('');
  const [reportFormat, setReportFormat] = useState<ReportFormat>('html');
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportSuccessMessage, setReportSuccessMessage] = useState<string | null>(null);
  const [reportErrorMessage, setReportErrorMessage] = useState<string | null>(null);

  // Form field IDs for accessibility
  const projectFieldId = useId();
  const siteFieldId = useId();
  const targetUrlFieldId = useId();
  const maxPagesFieldId = useId();
  const maxDepthFieldId = useId();
  const timeoutFieldId = useId();
  const reportTitleFieldId = useId();
  const reportFormatFieldId = useId();

  // Overview metrics
  const totalScans = scans.length;
  const runningScansCount = scans.filter(
    s => s.status === 'running' || s.status === 'pending',
  ).length;
  const completedScansCount = scans.filter(s => s.status === 'completed').length;
  const terminalFailedOrCancelledCount = scans.filter(
    s => s.status === 'failed' || s.status === 'cancelled',
  ).length;

  // Filtered scans
  const filteredScans = useMemo(() => {
    return scans.filter(s => {
      if (historyStatusFilter !== 'all' && s.status !== historyStatusFilter) {
        return false;
      }
      if (historySiteFilter !== 'all' && s.siteId !== historySiteFilter) {
        return false;
      }
      return true;
    });
  }, [scans, historyStatusFilter, historySiteFilter]);

  // Selected scan for inspector
  const inspectedScan = useMemo(() => {
    return scans.find(s => s.id === selectedScanId) ?? null;
  }, [scans, selectedScanId]);

  useEffect(() => {
    if (initialVisualEvidence !== undefined) {
      setVisualEvidence(initialVisualEvidence);
      setVisualEvidenceLoading(false);
      return;
    }

    if (!selectedScanId) {
      visualEvidenceReqRef.current++;
      setVisualEvidence({});
      setVisualEvidenceLoading(false);
      return;
    }

    const api = getElectronAPI();
    if (!api || typeof api.getScanVisualEvidence !== 'function') {
      setVisualEvidence({});
      setVisualEvidenceLoading(false);
      return;
    }

    const reqId = ++visualEvidenceReqRef.current;
    setVisualEvidence({});
    setVisualEvidenceLoading(true);

    void api
      .getScanVisualEvidence({ scanRunId: selectedScanId })
      .then(res => {
        if (reqId !== visualEvidenceReqRef.current) return;
        if (res.success && res.data && res.data.scanRunId === selectedScanId) {
          setVisualEvidence(res.data.entries);
        } else {
          setVisualEvidence({});
        }
      })
      .catch(() => {
        if (reqId === visualEvidenceReqRef.current) {
          setVisualEvidence({});
        }
      })
      .finally(() => {
        if (reqId === visualEvidenceReqRef.current) {
          setVisualEvidenceLoading(false);
        }
      });
  }, [selectedScanId, initialVisualEvidence]);

  const inspectedSite = useMemo(() => {
    if (!inspectedScan) return null;
    return sites.find(s => s.id === inspectedScan.siteId) ?? null;
  }, [inspectedScan, sites]);

  const inspectedViewModel = useMemo(() => {
    if (!inspectedScan || findingsLoading) return null;
    if (effectiveFindingsScanId !== null && effectiveFindingsScanId !== inspectedScan.id) {
      return null;
    }
    return adaptScanRunForViewModel({
      scanRun: inspectedScan,
      site: inspectedSite,
      findings,
      locale,
      viewMode,
    });
  }, [
    inspectedScan,
    inspectedSite,
    findings,
    findingsLoading,
    effectiveFindingsScanId,
    locale,
    viewMode,
  ]);

  // Handle launch scan
  const handleStartScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setActionSuccessMessage(null);
    clearError();

    if (!selectedSiteId) {
      setValidationError('Please select an active site to scan.');
      return;
    }

    if (maxPages < 1 || maxPages > 100) {
      setValidationError('Maximum pages must be between 1 and 100.');
      return;
    }

    if (maxDepth < 1 || maxDepth > 5) {
      setValidationError('Maximum crawl depth must be between 1 and 5.');
      return;
    }

    if (timeoutSeconds < 10 || timeoutSeconds > 300) {
      setValidationError('Scan timeout must be between 10 and 300 seconds.');
      return;
    }

    const payload: CreateScanRunDTO = {
      siteId: selectedSiteId,
      targetUrl: targetUrlOverride.trim() || undefined,
      scanType: 'full',
      config: {
        maxPages,
        maxDepth,
        maxConcurrency: 2,
        requestTimeoutMs: 10000,
        maxDurationMs: timeoutSeconds * 1000,
        enableBrowserAudit,
        maxBrowserPages,
        captureScreenshots,
        auditModules: {
          http: moduleHttp,
          wordpress: moduleWordpress,
          securityHeaders: moduleSecurityHeaders,
          cookies: moduleCookies,
          seo: moduleSeo,
          runtimeErrors: moduleRuntimeErrors,
          networkResources: moduleNetworkResources,
          responsiveLayout: moduleResponsiveLayout,
          layoutStability: moduleLayoutStability,
          screenshots: captureScreenshots,
          accessibility: moduleAccessibility,
        },
      },
    };

    const run = await createScan(payload);
    if (run) {
      setActionSuccessMessage(
        `Audit scan initiated successfully for site. Active run ID: ${run.id}`,
      );
    }
  };

  // Handle cancel scan
  const handleCancelScan = async (scanId: string) => {
    if (!window.confirm('Are you sure you want to cancel this scan in progress?')) {
      return;
    }
    setActionSuccessMessage(null);
    const ok = await cancelScan(scanId);
    if (ok) {
      setActionSuccessMessage('Scan cancellation signal dispatched successfully.');
    }
  };

  // Open inline report generator
  const handleOpenReportGenerator = (scan: ScanRunDTO) => {
    setReportGeneratingScanId(scan.id);
    setReportTitle(
      `Audit Report — ${scan.targetUrl ? new URL(scan.targetUrl).hostname : 'Site'} — ${new Date().toLocaleDateString()}`,
    );
    setReportFormat('html');
    setReportSuccessMessage(null);
    setReportErrorMessage(null);
  };

  // Execute report generation
  const handleGenerateReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportGeneratingScanId) return;

    const api = getElectronAPI();
    if (!api) return;

    setReportLoading(true);
    setReportErrorMessage(null);
    setReportSuccessMessage(null);

    try {
      const res = await api.createReport({
        scanRunId: reportGeneratingScanId,
        title: reportTitle.trim() || `Audit Report — ${new Date().toLocaleDateString()}`,
        format: reportFormat,
        locale,
        viewMode,
      });

      if (res.success) {
        setReportSuccessMessage(
          `Report "${res.data.title}" generated successfully! Saved to: ${res.data.storagePath ?? 'database'}`,
        );
      } else {
        setReportErrorMessage(res.error.message);
      }
    } catch {
      setReportErrorMessage('Transport error occurred while generating report.');
    } finally {
      setReportLoading(false);
    }
  };

  // Calculate live progress percentage
  const progressPercent = useMemo(() => {
    if (!activeScan) return 0;
    if (activeScan.status === 'completed') return 100;
    if (activeScan.status === 'failed' || activeScan.status === 'cancelled') return 100;
    if (!progress) return 10;
    const targetPages = (activeScan.config?.maxPages as number) || maxPages || 25;
    return Math.min(95, Math.max(10, Math.round((progress.pagesAttempted / targetPages) * 100)));
  }, [activeScan, progress, maxPages]);

  return (
    <div className="auditor-scans-view">
      {/* Welcome & Security Banner */}
      <section className="auditor-welcome-banner" aria-labelledby="scans-heading">
        <h1 id="scans-heading" className="auditor-welcome-banner__title">
          Audit &amp; Scans
        </h1>
        <p className="auditor-welcome-banner__subtitle">
          Bounded, safe external crawl and vulnerability analysis pipeline. Strictly bounded by
          domain scope, socket IP pinning, and resource ceilings.
        </p>
      </section>

      {/* Global Alerts */}
      {actionSuccessMessage && (
        <Alert
          variant="success"
          title="Operation Succeeded"
          onDismiss={() => setActionSuccessMessage(null)}
        >
          {actionSuccessMessage}
        </Alert>
      )}

      {validationError && (
        <Alert
          variant="danger"
          title="Configuration Error"
          onDismiss={() => setValidationError(null)}
        >
          {validationError}
        </Alert>
      )}

      {scansError && (
        <Alert variant="danger" title={`Scan Error: ${scansError.code}`} onDismiss={clearError}>
          {scansError.message}
        </Alert>
      )}

      {/* Top Metrics Row */}
      <div className="auditor-stats-grid" style={{ marginBottom: '24px' }}>
        <div className="auditor-stat-card">
          <div className="auditor-stat-card__value">{totalScans}</div>
          <div className="auditor-stat-card__label">Total Scans</div>
        </div>
        <div className="auditor-stat-card">
          <div
            className="auditor-stat-card__value"
            style={{ color: 'var(--auditor-accent-primary)' }}
          >
            {runningScansCount}
          </div>
          <div className="auditor-stat-card__label">Active Running</div>
        </div>
        <div className="auditor-stat-card">
          <div
            className="auditor-stat-card__value"
            style={{ color: 'var(--auditor-success-border)' }}
          >
            {completedScansCount}
          </div>
          <div className="auditor-stat-card__label">Completed</div>
        </div>
        <div className="auditor-stat-card">
          <div
            className="auditor-stat-card__value"
            style={{ color: 'var(--auditor-warning-border)' }}
          >
            {terminalFailedOrCancelledCount}
          </div>
          <div className="auditor-stat-card__label">Failed / Cancelled</div>
        </div>
      </div>

      <div className="auditor-grid-2" style={{ marginBottom: '24px' }}>
        {/* Scan Launcher Form */}
        <Card title="Scan Launcher" subtitle="Configure and execute an authorized site audit">
          <form className="auditor-form" onSubmit={handleStartScan}>
            <div className="auditor-form-group">
              <label htmlFor={projectFieldId} className="auditor-label">
                Target Project
              </label>
              <select
                id={projectFieldId}
                className="auditor-select"
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
                disabled={isScanning || scansLoading}
              >
                {projects.length === 0 ? (
                  <option value="">No projects registered</option>
                ) : (
                  projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="auditor-form-group">
              <label htmlFor={siteFieldId} className="auditor-label">
                Target Site
              </label>
              <select
                id={siteFieldId}
                className="auditor-select"
                value={selectedSiteId}
                onChange={e => handleSiteChange(e.target.value)}
                disabled={isScanning || scansLoading || sites.length === 0}
              >
                {sites.length === 0 ? (
                  <option value="">No sites in selected project</option>
                ) : (
                  sites
                    .filter(s => !s.isArchived)
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.baseUrl})
                      </option>
                    ))
                )}
              </select>
            </div>

            <div className="auditor-form-group">
              <label htmlFor={targetUrlFieldId} className="auditor-label">
                Target Entry URL
              </label>
              <input
                id={targetUrlFieldId}
                type="url"
                className="auditor-input auditor-input--mono"
                value={targetUrlOverride}
                onChange={e => {
                  setTargetUrlOverride(e.target.value);
                  setProfile('custom');
                }}
                placeholder="https://example.com"
                disabled={isScanning || scansLoading}
              />
              <span className="auditor-help-text">
                Must match the authorized scope of the selected site.
              </span>
            </div>

            {/* Profile Presets */}
            <div className="auditor-form-group">
              <label className="auditor-label">Scan Profile Preset</label>
              <div className="auditor-preset-group">
                <button
                  type="button"
                  className={`auditor-preset-button ${profile === 'quick' ? 'auditor-preset-button--active' : ''}`}
                  onClick={() => handleProfileSelect('quick')}
                  disabled={isScanning}
                >
                  Quick (10 pages)
                </button>
                <button
                  type="button"
                  className={`auditor-preset-button ${profile === 'standard' ? 'auditor-preset-button--active' : ''}`}
                  onClick={() => handleProfileSelect('standard')}
                  disabled={isScanning}
                >
                  Standard (25 pages)
                </button>
                <button
                  type="button"
                  className={`auditor-preset-button ${profile === 'deep' ? 'auditor-preset-button--active' : ''}`}
                  onClick={() => handleProfileSelect('deep')}
                  disabled={isScanning}
                >
                  Deep (100 pages)
                </button>
                <button
                  type="button"
                  className={`auditor-preset-button ${profile === 'custom' ? 'auditor-preset-button--active' : ''}`}
                  onClick={() => setProfile('custom')}
                  disabled={isScanning}
                >
                  Custom
                </button>
              </div>
            </div>

            {/* Crawl Limit Parameters */}
            <div className="auditor-grid-3">
              <div className="auditor-form-group">
                <label htmlFor={maxPagesFieldId} className="auditor-label">
                  Max Pages (1–100)
                </label>
                <input
                  id={maxPagesFieldId}
                  type="number"
                  min={1}
                  max={100}
                  className="auditor-input"
                  value={maxPages}
                  onChange={e => {
                    setMaxPages(Number(e.target.value));
                    setProfile('custom');
                  }}
                  disabled={isScanning || profile !== 'custom'}
                />
              </div>

              <div className="auditor-form-group">
                <label htmlFor={maxDepthFieldId} className="auditor-label">
                  Max Depth (1–5)
                </label>
                <input
                  id={maxDepthFieldId}
                  type="number"
                  min={1}
                  max={5}
                  className="auditor-input"
                  value={maxDepth}
                  onChange={e => {
                    setMaxDepth(Number(e.target.value));
                    setProfile('custom');
                  }}
                  disabled={isScanning || profile !== 'custom'}
                />
              </div>

              <div className="auditor-form-group">
                <label htmlFor={timeoutFieldId} className="auditor-label">
                  Timeout (10–300s)
                </label>
                <input
                  id={timeoutFieldId}
                  type="number"
                  min={10}
                  max={300}
                  className="auditor-input"
                  value={timeoutSeconds}
                  onChange={e => {
                    setTimeoutSeconds(Number(e.target.value));
                    setProfile('custom');
                  }}
                  disabled={isScanning || profile !== 'custom'}
                />
              </div>
            </div>

            {/* Audit Modules & Browser Capabilities */}
            {profile === 'custom' && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '12px 16px',
                  backgroundColor: 'var(--auditor-bg-surface-subtle)',
                  borderRadius: 'var(--auditor-radius-md)',
                  border: '1px solid var(--auditor-border-subtle)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>
                  Browser Audit &amp; Analysis Modules
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '8px',
                    marginBottom: '12px',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enableBrowserAudit}
                      onChange={e => setEnableBrowserAudit(e.target.checked)}
                      disabled={isScanning}
                    />
                    Enable Playwright Browser
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={captureScreenshots}
                      onChange={e => setCaptureScreenshots(e.target.checked)}
                      disabled={isScanning || !enableBrowserAudit}
                    />
                    Capture Screenshots
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={moduleAccessibility}
                      onChange={e => setModuleAccessibility(e.target.checked)}
                      disabled={isScanning}
                    />
                    WCAG Accessibility
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={moduleResponsiveLayout}
                      onChange={e => setModuleResponsiveLayout(e.target.checked)}
                      disabled={isScanning}
                    />
                    Responsive Layout
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={moduleLayoutStability}
                      onChange={e => setModuleLayoutStability(e.target.checked)}
                      disabled={isScanning}
                    />
                    Layout Stability (CLS)
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={moduleRuntimeErrors}
                      onChange={e => setModuleRuntimeErrors(e.target.checked)}
                      disabled={isScanning}
                    />
                    Runtime JS Errors
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={moduleNetworkResources}
                      onChange={e => setModuleNetworkResources(e.target.checked)}
                      disabled={isScanning}
                    />
                    Network Resource Errors
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={moduleSecurityHeaders}
                      onChange={e => setModuleSecurityHeaders(e.target.checked)}
                      disabled={isScanning}
                    />
                    Security Headers &amp; TLS
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={moduleWordpress}
                      onChange={e => setModuleWordpress(e.target.checked)}
                      disabled={isScanning}
                    />
                    WordPress Detection
                  </label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={moduleSeo}
                      onChange={e => setModuleSeo(e.target.checked)}
                      disabled={isScanning}
                    />
                    SEO &amp; Metadata
                  </label>
                </div>
              </div>
            )}

            {/* Backend Concurrency Notice */}
            <div
              style={{
                fontSize: '11px',
                color: 'var(--auditor-text-muted)',
                backgroundColor: 'var(--auditor-bg-surface-subtle)',
                padding: '8px 12px',
                borderRadius: '4px',
                marginBottom: '16px',
                borderLeft: '3px solid var(--auditor-border-focus)',
              }}
            >
              <strong>Backend Concurrency Policy:</strong> Max 2 concurrent scans globally, max 1
              scan per site.
            </div>

            <div className="auditor-form-actions">
              <button
                type="submit"
                id="scans-start-button"
                className="auditor-button auditor-button--primary"
                disabled={isScanning || scansLoading || !selectedSiteId}
              >
                {isScanning ? 'Scan in Progress...' : 'Start Audit Scan'}
              </button>
            </div>
          </form>
        </Card>

        {/* Active Scan Monitor */}
        <Card
          title="Active Scan Monitor"
          subtitle={
            activeScan
              ? `Monitoring scan: ${activeScan.id.substring(0, 8)}...`
              : 'Real-time crawler and analyzer pipeline metrics'
          }
          headerAction={
            activeScan ? (
              <div style={{ display: 'flex', gap: '6px' }}>
                <Badge variant={getStatusBadgeVariant(activeScan.status)}>
                  {activeScan.status.toUpperCase()}
                </Badge>
                {activeScan.status === 'completed' &&
                  (activeScan.summary?.coverageStatus === 'partial' ||
                    activeScan.summary?.isPartialCoverage === true ||
                    (activeScan.summary?.browserCandidatesSkipped ?? 0) > 0 ||
                    (progress?.browserCandidatesSkipped ?? 0) > 0 ||
                    ((activeScan.summary?.browserPagesAudited ?? 0) > 0 &&
                      (activeScan.summary?.pagesScanned ?? 0) >
                        (activeScan.summary?.browserPagesAudited ?? 0))) && (
                    <Badge variant="warning">
                      PARTIAL BROWSER COVERAGE ({activeScan.summary?.browserPagesAudited ?? 0}/
                      {activeScan.summary?.pagesScanned ?? 0})
                    </Badge>
                  )}
              </div>
            ) : (
              <Badge variant="neutral">IDLE</Badge>
            )
          }
        >
          {activeScan ? (
            <div>
              {/* Progress Bar */}
              <div className="auditor-progress-bar">
                <div
                  className={`auditor-progress-bar__fill ${
                    isScanning
                      ? 'auditor-progress-bar__fill--animated'
                      : activeScan.status === 'completed'
                        ? 'auditor-progress-bar__fill--completed'
                        : activeScan.status === 'failed'
                          ? 'auditor-progress-bar__fill--failed'
                          : 'auditor-progress-bar__fill--cancelled'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Progress Metrics Grid */}
              <dl className="auditor-meta-list">
                <div className="auditor-meta-row">
                  <dt>Pipeline Stage</dt>
                  <dd>
                    <Badge
                      variant={getStatusBadgeVariant(progress?.stage ?? activeScan.status)}
                      size="sm"
                    >
                      {progress?.stage ?? activeScan.status}
                    </Badge>
                  </dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Active Engine</dt>
                  <dd>
                    <Badge variant="info" size="sm">
                      {progress?.currentEngine
                        ? progress.currentEngine.toUpperCase()
                        : isScanning
                          ? 'CRAWLER'
                          : '—'}
                    </Badge>
                  </dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Browser Audited</dt>
                  <dd>
                    <strong>
                      {progress?.browserPagesAudited ??
                        activeScan.summary?.browserPagesAudited ??
                        0}
                    </strong>
                    {Boolean(
                      progress?.browserCandidatesTotal ||
                      activeScan.summary?.browserCandidatesTotal,
                    ) && (
                      <span>
                        {' '}
                        of{' '}
                        {progress?.browserCandidatesTotal ??
                          activeScan.summary?.browserCandidatesTotal}{' '}
                        candidates
                      </span>
                    )}{' '}
                    <span style={{ fontSize: '11px', color: 'var(--auditor-text-muted)' }}>
                      (Screenshots:{' '}
                      {progress?.screenshotsCaptured ??
                        activeScan.summary?.screenshotsCaptured ??
                        0}
                      {(progress?.browserCandidatesSkipped ??
                        activeScan.summary?.browserCandidatesSkipped ??
                        0) > 0
                        ? ` • ${progress?.browserCandidatesSkipped ?? activeScan.summary?.browserCandidatesSkipped} skipped`
                        : ''}
                      )
                    </span>
                  </dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Viewports &amp; A11y</dt>
                  <dd>
                    {progress?.viewportsCompleted ?? 0} profiles &bull;{' '}
                    {progress?.accessibilityAuditsCompleted ?? 0} checks
                  </dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Pages Ingested</dt>
                  <dd>
                    <strong>{progress?.pagesAttempted ?? 0}</strong>{' '}
                    <span style={{ fontSize: '11px', color: 'var(--auditor-text-muted)' }}>
                      (OK: {progress?.pagesSucceeded ?? 0}, Fail: {progress?.pagesFailed ?? 0})
                    </span>
                  </dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Queue Pending</dt>
                  <dd>{progress?.pagesPending ?? 0} pages</dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Discovered URLs</dt>
                  <dd>{progress?.uniqueUrlsDiscovered ?? 0} unique</dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Findings Produced</dt>
                  <dd>
                    <strong style={{ color: 'var(--auditor-accent-primary)' }}>
                      {progress?.findingsProduced ?? 0}
                    </strong>
                  </dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Elapsed Time</dt>
                  <dd>{formatDuration(progress?.elapsedMs ?? activeScan.durationMs)}</dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Active URL</dt>
                  <dd>
                    <span
                      className="auditor-url-truncate"
                      title={progress?.currentUrl ?? activeScan.targetUrl}
                    >
                      {progress?.currentUrl ?? activeScan.targetUrl}
                    </span>
                  </dd>
                </div>
              </dl>

              {activeScan.status === 'completed' &&
                (activeScan.summary?.coverageStatus === 'partial' ||
                  (activeScan.summary?.browserCandidatesSkipped ?? 0) > 0 ||
                  (progress?.browserCandidatesSkipped ?? 0) > 0) && (
                  <div style={{ marginTop: '12px' }}>
                    <Alert variant="warning" title="Partial Browser Coverage Notice">
                      Scan completed crawling and static analysis, but gracefully concluded browser
                      auditing because remaining profile budget was reached.{' '}
                      {activeScan.summary?.browserCandidatesSkipped ??
                        progress?.browserCandidatesSkipped ??
                        0}{' '}
                      browser candidate page(s) were skipped. Visual, accessibility, and responsive
                      findings reflect audited pages only.
                    </Alert>
                  </div>
                )}

              {/* Active Scan Actions */}
              <div className="auditor-form-actions" style={{ marginTop: '16px' }}>
                {isScanning && (
                  <button
                    type="button"
                    id="scans-cancel-button"
                    className="auditor-button auditor-button--secondary"
                    style={{
                      color: 'var(--auditor-danger-border)',
                      borderColor: 'var(--auditor-danger-border)',
                    }}
                    onClick={() => handleCancelScan(activeScan.id)}
                  >
                    Cancel Scan
                  </button>
                )}
                {!isScanning && (
                  <>
                    <button
                      type="button"
                      className="auditor-button auditor-button--primary"
                      onClick={() => selectScan(activeScan.id)}
                    >
                      Inspect Findings
                    </button>
                    {(activeScan.status === 'completed' ||
                      Number(
                        (activeScan.error?.details as { partialFindingsPersisted?: number })
                          ?.partialFindingsPersisted,
                      ) > 0 ||
                      (activeScan.summary?.totalFindings ?? 0) > 0) && (
                      <button
                        type="button"
                        className="auditor-button auditor-button--secondary"
                        onClick={() => handleOpenReportGenerator(activeScan)}
                      >
                        Generate Report
                      </button>
                    )}
                  </>
                )}
                {!isScanning && (
                  <button
                    type="button"
                    className="auditor-button auditor-button--secondary"
                    onClick={clearActiveScan}
                  >
                    Dismiss Monitor
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="auditor-empty-state">
              No active scan running. Configure and launch a scan from the launcher to monitor
              real-time crawling and analysis.
            </div>
          )}
        </Card>
      </div>

      {/* Inline Report Generator (Modal / Card) */}
      {reportGeneratingScanId && (
        <Card
          title="Generate Audit Report"
          subtitle={`Create standalone export for scan ${reportGeneratingScanId.substring(0, 8)}...`}
          headerAction={
            <button
              type="button"
              className="auditor-button auditor-button--secondary"
              onClick={() => setReportGeneratingScanId(null)}
            >
              Close
            </button>
          }
        >
          {reportSuccessMessage && (
            <Alert
              variant="success"
              title="Report Generated"
              onDismiss={() => setReportSuccessMessage(null)}
            >
              <div>{reportSuccessMessage}</div>
              {onNavigate && (
                <div style={{ marginTop: '8px' }}>
                  <button
                    type="button"
                    className="auditor-button auditor-button--secondary"
                    onClick={() => onNavigate('reports')}
                  >
                    Go to Reports &amp; Exports View &rarr;
                  </button>
                </div>
              )}
            </Alert>
          )}

          {reportErrorMessage && (
            <Alert
              variant="danger"
              title="Generation Failed"
              onDismiss={() => setReportErrorMessage(null)}
            >
              {reportErrorMessage}
            </Alert>
          )}

          <form className="auditor-form" onSubmit={handleGenerateReportSubmit}>
            <div className="auditor-grid-2">
              <div className="auditor-form-group">
                <label htmlFor={reportTitleFieldId} className="auditor-label">
                  Report Title
                </label>
                <input
                  id={reportTitleFieldId}
                  type="text"
                  className="auditor-input"
                  value={reportTitle}
                  onChange={e => setReportTitle(e.target.value)}
                  disabled={reportLoading}
                  placeholder="e.g. Q4 Audit Report"
                />
              </div>

              <div className="auditor-form-group">
                <label htmlFor={reportFormatFieldId} className="auditor-label">
                  Export Format
                </label>
                <select
                  id={reportFormatFieldId}
                  className="auditor-select"
                  value={reportFormat}
                  onChange={e => setReportFormat(e.target.value as ReportFormat)}
                  disabled={reportLoading}
                >
                  <option value="html">Standalone HTML Report</option>
                  <option value="json">Structured JSON Export</option>
                </select>
              </div>
            </div>

            <div className="auditor-form-actions">
              <button
                type="submit"
                className="auditor-button auditor-button--primary"
                disabled={reportLoading}
              >
                {reportLoading ? 'Generating Report...' : 'Generate & Export'}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Findings Inspector Section */}
      {selectedScanId && (
        <Card
          title={`Findings Inspector (${findings.length}${totalFindings > findings.length ? ` of ${totalFindings}` : ''} findings)`}
          subtitle={
            inspectedScan
              ? `Target: ${inspectedScan.targetUrl} — Status: ${inspectedScan.status.toUpperCase()}`
              : `Scan Run ID: ${selectedScanId}`
          }
          headerAction={
            <div style={{ display: 'flex', gap: '8px' }}>
              {totalFindings > findings.length && (
                <button
                  type="button"
                  className="auditor-button auditor-button--secondary"
                  onClick={() =>
                    void loadFindings(selectedScanId, { limit: Math.min(totalFindings, 1000) })
                  }
                  disabled={findingsLoading}
                >
                  Load All ({totalFindings})
                </button>
              )}
              {inspectedScan &&
                (inspectedScan.status === 'completed' ||
                  findings.length > 0 ||
                  Number(
                    (inspectedScan.error?.details as { partialFindingsPersisted?: number })
                      ?.partialFindingsPersisted,
                  ) > 0) && (
                  <button
                    type="button"
                    className="auditor-button auditor-button--secondary"
                    onClick={() => handleOpenReportGenerator(inspectedScan)}
                  >
                    Generate Report
                  </button>
                )}
              <button
                type="button"
                className="auditor-button auditor-button--secondary"
                onClick={() => selectScan(null)}
              >
                Close Inspector
              </button>
            </div>
          }
        >
          {findingsLoading ? (
            <div className="auditor-empty-state">Loading findings from SQLite...</div>
          ) : (
            <div>
              {findingsError && (
                <div style={{ marginBottom: '16px' }}>
                  <Alert
                    variant="danger"
                    title={`Findings Retrieval Error: ${findingsError.code}`}
                    onDismiss={clearFindingsError}
                  >
                    {findingsError.message}
                  </Alert>
                </div>
              )}
              {/* Partial Findings Alert Banner for Interrupted / Non-completed Scans */}
              {inspectedScan && inspectedScan.status !== 'completed' && (
                <div style={{ marginBottom: '16px' }}>
                  <Alert
                    variant="warning"
                    title={`Partial Findings (${inspectedScan.status.toUpperCase()})`}
                  >
                    This scan terminated with status{' '}
                    <strong>{inspectedScan.status.toUpperCase()}</strong>
                    {inspectedScan.error?.code ? ` [${inspectedScan.error.code}]` : ''}. The{' '}
                    {findings.length} findings displayed below represent partial evidence safely
                    persisted prior to termination.
                  </Alert>
                </div>
              )}

              {/* Browser Unavailable Alert Banner */}
              {findings.some(f => f.ruleId === 'SYS_BROWSER_UNAVAILABLE') && (
                <div style={{ marginBottom: '16px' }}>
                  <Alert variant="warning" title="Browser Engine Unavailable During Scan">
                    A compatible Chromium-based browser was not available on this system. HTTP,
                    WordPress, and security header analyzers completed successfully; however,
                    client-side runtime errors, WCAG accessibility, responsive layout shifts, and
                    visual screenshots could not be evaluated. Install an approved Chromium browser
                    to unlock full browser-based audits.
                  </Alert>
                </div>
              )}

              {/* Executive Overview & D1–D4 Coverage (Shared Reporting Engine) */}
              {inspectedScan && inspectedViewModel && (
                <div className="auditor-inspection-stack">
                  <ExecutiveSummaryCard
                    viewModel={inspectedViewModel}
                    totalPersistedFindings={totalFindings}
                    isTruncated={totalFindings > findings.length}
                  />
                  <CoverageDimensionsPanel viewModel={inspectedViewModel} scanRun={inspectedScan} />
                  <AuditChartsGrid viewModel={inspectedViewModel} />
                </div>
              )}

              {/* Laboratory Performance Diagnostics & Web Vitals */}
              <PerformanceVitalsView scanRun={inspectedScan} findings={findings} />

              {/* Visual Evidence Gallery & Page Screenshots (DEF-004) */}
              <VisualEvidenceGallery
                visualEvidence={visualEvidence}
                visualEvidenceLoading={visualEvidenceLoading}
              />

              {/* Interactive Findings & Actionable Recommendations Explorer */}
              {inspectedViewModel && (
                <FindingsExplorer
                  viewModel={inspectedViewModel}
                  visualEvidence={visualEvidence}
                  visualEvidenceLoading={visualEvidenceLoading}
                />
              )}
            </div>
          )}
        </Card>
      )}

      {/* Scan History Table */}
      <Card
        title="Scan Run History"
        subtitle={`${filteredScans.length} scan runs recorded in workspace`}
      >
        {/* History Filter Bar */}
        <div className="auditor-filter-bar">
          <div className="auditor-filter-tabs">
            <button
              type="button"
              className={`auditor-filter-tab ${historyStatusFilter === 'all' ? 'auditor-filter-tab--active' : ''}`}
              onClick={() => setHistoryStatusFilter('all')}
            >
              All Statuses
            </button>
            <button
              type="button"
              className={`auditor-filter-tab ${historyStatusFilter === 'completed' ? 'auditor-filter-tab--active' : ''}`}
              onClick={() => setHistoryStatusFilter('completed')}
            >
              Completed
            </button>
            <button
              type="button"
              className={`auditor-filter-tab ${historyStatusFilter === 'running' ? 'auditor-filter-tab--active' : ''}`}
              onClick={() => setHistoryStatusFilter('running')}
            >
              Running
            </button>
            <button
              type="button"
              className={`auditor-filter-tab ${historyStatusFilter === 'failed' ? 'auditor-filter-tab--active' : ''}`}
              onClick={() => setHistoryStatusFilter('failed')}
            >
              Failed
            </button>
            <button
              type="button"
              className={`auditor-filter-tab ${historyStatusFilter === 'cancelled' ? 'auditor-filter-tab--active' : ''}`}
              onClick={() => setHistoryStatusFilter('cancelled')}
            >
              Cancelled
            </button>
          </div>

          {sites.length > 0 && (
            <select
              className="auditor-select"
              style={{ width: 'auto', minWidth: '160px' }}
              value={historySiteFilter}
              onChange={e => setHistorySiteFilter(e.target.value)}
            >
              <option value="all">All Sites</option>
              {sites.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Scan List */}
        {filteredScans.length === 0 ? (
          <div className="auditor-empty-state">
            {scansLoading
              ? 'Loading scan history...'
              : 'No scans match the current filter. Launch a new audit scan above.'}
          </div>
        ) : (
          <ul className="auditor-site-list" role="list">
            {filteredScans.map(scan => (
              <li key={scan.id} className="auditor-site-item">
                <div className="auditor-site-item__main">
                  <div className="auditor-site-item__header">
                    <span className="auditor-site-item__name">{scan.targetUrl}</span>
                    <Badge variant={getStatusBadgeVariant(scan.status)} size="sm">
                      {scan.status.toUpperCase()}
                    </Badge>
                    {scan.status === 'completed' &&
                      (scan.summary?.coverageStatus === 'partial' ||
                        scan.summary?.isPartialCoverage === true ||
                        (scan.summary?.browserCandidatesSkipped ?? 0) > 0 ||
                        ((scan.summary?.browserPagesAudited ?? 0) > 0 &&
                          (scan.summary?.pagesScanned ?? 0) >
                            (scan.summary?.browserPagesAudited ?? 0))) && (
                        <Badge variant="warning" size="sm">
                          PARTIAL COVERAGE ({scan.summary?.browserPagesAudited ?? 0}/
                          {scan.summary?.pagesScanned ?? 0})
                        </Badge>
                      )}
                    {scan.status === 'completed' &&
                      scan.summary?.coverageStatus === 'full' &&
                      !scan.summary?.isPartialCoverage &&
                      !(scan.summary?.browserCandidatesSkipped ?? 0) &&
                      ((scan.summary?.browserPagesAudited ?? 0) === 0 ||
                        (scan.summary?.browserPagesAudited ?? 0) >=
                          (scan.summary?.pagesScanned ?? 0)) && (
                        <Badge variant="neutral" size="sm">
                          FULL COVERAGE
                        </Badge>
                      )}
                    <span style={{ fontSize: '11px', color: 'var(--auditor-text-muted)' }}>
                      Duration: {formatDuration(scan.durationMs)}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--auditor-text-muted)' }}>
                      {new Date(scan.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="auditor-site-item__url">
                    Scan ID: <code>{scan.id}</code>
                  </div>

                  {/* Findings breakdown badges */}
                  {((scan.summary?.totalFindings ?? 0) > 0 ||
                    Number(
                      (scan.error?.details as { partialFindingsPersisted?: number })
                        ?.partialFindingsPersisted,
                    ) > 0) && (
                    <div className="auditor-badge-group" style={{ marginTop: '6px' }}>
                      <Badge
                        variant={scan.status === 'completed' ? 'neutral' : 'warning'}
                        size="sm"
                      >
                        {scan.status === 'completed'
                          ? `Findings: ${scan.summary?.totalFindings}`
                          : `Partial Findings: ${
                              (scan.error?.details as { partialFindingsPersisted?: number })
                                ?.partialFindingsPersisted ??
                              scan.summary?.totalFindings ??
                              0
                            }`}
                      </Badge>
                      {(scan.summary?.criticalCount ?? 0) > 0 && (
                        <Badge variant="danger" size="sm">
                          {scan.summary?.criticalCount} Critical
                        </Badge>
                      )}
                      {(scan.summary?.highCount ?? 0) > 0 && (
                        <Badge variant="danger" size="sm">
                          {scan.summary?.highCount} High
                        </Badge>
                      )}
                      {(scan.summary?.mediumCount ?? 0) > 0 && (
                        <Badge variant="warning" size="sm">
                          {scan.summary?.mediumCount} Medium
                        </Badge>
                      )}
                      {(scan.summary?.lowCount ?? 0) > 0 && (
                        <Badge variant="info" size="sm">
                          {scan.summary?.lowCount} Low
                        </Badge>
                      )}
                    </div>
                  )}

                  {scan.error && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--auditor-danger-border)',
                        marginTop: '4px',
                      }}
                    >
                      Error: [{scan.error.code}] {scan.error.message}
                    </div>
                  )}
                </div>

                <div className="auditor-site-item__actions">
                  <button
                    type="button"
                    className="auditor-button auditor-button--secondary"
                    onClick={() => selectScan(scan.id)}
                  >
                    Inspect Findings
                  </button>
                  {(scan.status === 'completed' ||
                    Number(
                      (scan.error?.details as { partialFindingsPersisted?: number })
                        ?.partialFindingsPersisted,
                    ) > 0 ||
                    (scan.summary?.totalFindings ?? 0) > 0) && (
                    <button
                      type="button"
                      className="auditor-button auditor-button--secondary"
                      onClick={() => handleOpenReportGenerator(scan)}
                    >
                      Report
                    </button>
                  )}
                  {(scan.status === 'running' || scan.status === 'pending') && (
                    <button
                      type="button"
                      className="auditor-button auditor-button--secondary"
                      style={{ color: 'var(--auditor-danger-border)' }}
                      onClick={() => handleCancelScan(scan.id)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
