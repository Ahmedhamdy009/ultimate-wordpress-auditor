import React, { useState, useId, useEffect, useMemo, useCallback } from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import { SecureReportPreview } from '../reports/SecureReportPreview.js';
import { useReports } from '../../hooks/useReports.js';
import { useProjects } from '../../hooks/useProjects.js';
import type { ViewId } from '../../types/navigation.js';
import type {
  ReportDTO,
  ReportFormat,
  ReportContentDTO,
  ScanRunDTO,
  SiteDTO,
} from '@auditor/shared';
import type { ElectronAPI } from '../../../../common/ipc/contracts.js';

export interface ReportsViewProps {
  readonly initialScanRunId?: string;
  readonly onNavigate?: (view: ViewId) => void;
}

function getElectronAPI(): ElectronAPI | undefined {
  const g = globalThis as unknown as { electronAPI?: ElectronAPI };
  return (typeof window !== 'undefined' && window.electronAPI) || g.electronAPI;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ initialScanRunId, onNavigate }) => {
  const { reports, loading, error, createReport, deleteReport, getReportContent, clearError } =
    useReports();

  const { projects } = useProjects();

  // Completed scans and sites state
  const [completedScans, setCompletedScans] = useState<readonly ScanRunDTO[]>([]);
  const [sites, setSites] = useState<readonly SiteDTO[]>([]);
  const [scansLoading, setScansLoading] = useState<boolean>(true);

  // Generator form state
  const [scanRunId, setScanRunId] = useState<string>(initialScanRunId ?? '');
  const [reportTitle, setReportTitle] = useState<string>('');
  const [reportFormat, setReportFormat] = useState<ReportFormat>('html');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Content preview state
  const [selectedReport, setSelectedReport] = useState<ReportDTO | null>(null);
  const [reportContent, setReportContent] = useState<ReportContentDTO | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

  const scanRunIdField = useId();
  const titleField = useId();
  const formatField = useId();

  // Load completed scans and sites for dropdown selection
  const loadScanOptions = useCallback(async () => {
    const api = getElectronAPI();
    if (!api) {
      setScansLoading(false);
      return;
    }
    setScansLoading(true);
    try {
      const [scansRes, projectsRes] = await Promise.all([
        api.listScanRuns({ status: 'completed', limit: 100 }),
        api.listProjects({ limit: 100 }),
      ]);
      if (scansRes.success && scansRes.data) {
        setCompletedScans(scansRes.data.items);
      }
      if (projectsRes.success && projectsRes.data) {
        const siteResults = await Promise.all(
          projectsRes.data.items.map(p => api.listSites({ projectId: p.id, limit: 100 })),
        );
        const allSites = siteResults.flatMap(r => (r.success && r.data ? r.data.items : []));
        setSites(allSites);
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setScansLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScanOptions();
  }, [loadScanOptions]);

  // Project and Site lookup maps
  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      map.set(p.id, p.name);
    }
    return map;
  }, [projects]);

  const siteMap = useMemo(() => {
    const map = new Map<string, SiteDTO>();
    for (const s of sites) {
      map.set(s.id, s);
    }
    return map;
  }, [sites]);

  // Handle external initialScanRunId updates
  useEffect(() => {
    if (initialScanRunId) {
      setScanRunId(initialScanRunId);
    }
  }, [initialScanRunId]);

  // When scan is selected, auto-populate title if empty
  const handleScanSelect = (selectedId: string) => {
    setScanRunId(selectedId);
    if (!selectedId) return;

    const scan = completedScans.find(s => s.id === selectedId);
    if (scan) {
      const site = siteMap.get(scan.siteId);
      const siteName = site?.name || new URL(scan.targetUrl).hostname;
      const dateStr = new Date().toLocaleDateString();
      setReportTitle(`${siteName} — Audit Report (${dateStr})`);
    }
  };

  // Overview statistics
  const totalReports = reports.length;
  const htmlReports = reports.filter(r => r.format === 'html').length;
  const jsonReports = reports.filter(r => r.format === 'json').length;
  const csvReports = reports.filter(r => r.format === 'csv').length;
  const latestReport = reports.length > 0 ? reports[0] : null;

  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanRunId.trim()) return;

    setSuccessMessage(null);
    clearError();

    const title = reportTitle.trim() || `Audit Report — ${new Date().toLocaleDateString()}`;
    const result = await createReport({
      scanRunId: scanRunId.trim(),
      title,
      format: reportFormat,
    });

    if (result) {
      setSuccessMessage(
        `Report "${result.title}" (${result.format.toUpperCase()}) generated successfully! Saved to: ${result.storagePath ?? 'database'}`,
      );
      setReportTitle('');
    }
  };

  const handleDelete = async (report: ReportDTO) => {
    if (
      !window.confirm(
        `Are you sure you want to delete report "${report.title}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setSuccessMessage(null);
    const ok = await deleteReport(report.id);
    if (ok) {
      setSuccessMessage(`Report "${report.title}" deleted.`);
      if (selectedReport?.id === report.id) {
        setSelectedReport(null);
        setReportContent(null);
      }
    }
  };

  const handleViewContent = async (report: ReportDTO) => {
    setSelectedReport(report);
    setPreviewLoading(true);
    setReportContent(null);

    const content = await getReportContent(report.id);
    setReportContent(content);
    setPreviewLoading(false);
  };

  return (
    <div className="auditor-reports-view">
      {/* Notifications */}
      {successMessage && (
        <Alert variant="success" title="Success" onDismiss={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      {error && (
        <Alert variant="danger" title={`Report Error: ${error.code}`} onDismiss={clearError}>
          {error.message}
        </Alert>
      )}

      {/* Overview Cards */}
      <div className="auditor-grid-2" style={{ marginBottom: '24px' }}>
        <Card
          title="Reporting Overview"
          subtitle="Persistent audit reports and standalone export files"
        >
          <div className="auditor-grid-2" style={{ gap: '16px' }}>
            <div
              style={{
                textAlign: 'center',
                padding: '12px',
                background: 'var(--auditor-bg-subtle, #1e293b)',
                borderRadius: '6px',
              }}
            >
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 800,
                  color: 'var(--auditor-color-accent, #38bdf8)',
                }}
              >
                {totalReports}
              </div>
              <div
                style={{
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  color: 'var(--auditor-text-muted, #94a3b8)',
                }}
              >
                Total Reports
              </div>
            </div>
            <div
              style={{
                textAlign: 'center',
                padding: '12px',
                background: 'var(--auditor-bg-subtle, #1e293b)',
                borderRadius: '6px',
              }}
            >
              <div style={{ fontSize: '20px', fontWeight: 800 }}>
                {htmlReports}{' '}
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--auditor-text-muted, #94a3b8)',
                  }}
                >
                  HTML
                </span>{' '}
                / {jsonReports}{' '}
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--auditor-text-muted, #94a3b8)',
                  }}
                >
                  JSON
                </span>{' '}
                / {csvReports}{' '}
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: 'var(--auditor-text-muted, #94a3b8)',
                  }}
                >
                  CSV
                </span>
              </div>
              <div
                style={{
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  color: 'var(--auditor-text-muted, #94a3b8)',
                }}
              >
                Formats Breakdown
              </div>
            </div>
          </div>
          {latestReport && (
            <div
              style={{
                marginTop: '16px',
                fontSize: '12px',
                color: 'var(--auditor-text-muted, #94a3b8)',
              }}
            >
              Latest Report: <strong>{latestReport.title}</strong> (
              {new Date(latestReport.createdAt).toLocaleString()})
            </div>
          )}
        </Card>

        {/* Generate Report Form */}
        <Card
          title="Generate New Report"
          subtitle="Transform persisted scan findings into standalone reports"
        >
          {completedScans.length === 0 && !scansLoading ? (
            <div className="auditor-empty-state" style={{ padding: '24px 16px' }}>
              <p style={{ marginBottom: '12px' }}>
                No completed scans are available to generate a report.
              </p>
              {onNavigate && (
                <button
                  type="button"
                  className="auditor-button auditor-button--primary auditor-button--sm"
                  onClick={() => onNavigate('scans')}
                >
                  Go to Audit &amp; Scans
                </button>
              )}
            </div>
          ) : (
            <form onSubmit={handleGenerateReport} className="auditor-form">
              <div className="auditor-form-group">
                <label htmlFor={scanRunIdField} className="auditor-label">
                  Select Completed Scan
                </label>
                <select
                  id={scanRunIdField}
                  className="auditor-select"
                  value={scanRunId}
                  onChange={e => handleScanSelect(e.target.value)}
                  disabled={loading || scansLoading}
                  required
                >
                  <option value="">
                    {scansLoading ? 'Loading completed scans...' : '-- Choose a completed scan --'}
                  </option>
                  {completedScans.map(scan => {
                    const site = siteMap.get(scan.siteId);
                    const projectName = site?.projectId
                      ? projectMap.get(site.projectId)
                      : undefined;
                    const siteName = site?.name || scan.targetUrl;
                    const findingsCount = scan.summary?.totalFindings ?? 0;
                    const dateStr = scan.completedAt
                      ? new Date(scan.completedAt).toLocaleDateString()
                      : 'Recent';

                    return (
                      <option key={scan.id} value={scan.id}>
                        {projectName ? `[${projectName}] ` : ''}
                        {siteName} — {dateStr} ({findingsCount} findings)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="auditor-grid-2">
                <div className="auditor-form-group">
                  <label htmlFor={titleField} className="auditor-label">
                    Report Title (Optional)
                  </label>
                  <input
                    id={titleField}
                    type="text"
                    className="auditor-input"
                    placeholder="e.g. Q4 WordPress Audit"
                    value={reportTitle}
                    onChange={e => setReportTitle(e.target.value)}
                    disabled={loading}
                  />
                </div>

                <div className="auditor-form-group">
                  <label htmlFor={formatField} className="auditor-label">
                    Export Format
                  </label>
                  <select
                    id={formatField}
                    className="auditor-select"
                    value={reportFormat}
                    onChange={e => setReportFormat(e.target.value as ReportFormat)}
                    disabled={loading}
                  >
                    <option value="html">Standalone HTML Report (.html)</option>
                    <option value="json">Structured JSON Export (.json)</option>
                    <option value="csv">Tabular CSV Export (.csv)</option>
                  </select>
                </div>
              </div>

              <div className="auditor-form-actions">
                <button
                  type="submit"
                  className="auditor-button auditor-button--primary"
                  disabled={loading || !scanRunId.trim()}
                >
                  {loading ? 'Generating Report...' : 'Generate & Export'}
                </button>
              </div>
            </form>
          )}
        </Card>
      </div>

      {/* Reports Directory & History */}
      <Card
        title="Report History &amp; Exports"
        subtitle={`${reports.length} report${reports.length === 1 ? '' : 's'} generated`}
      >
        {reports.length === 0 ? (
          <div className="auditor-empty-state">
            {loading
              ? 'Loading report history...'
              : 'No reports generated yet. Select a completed scan above to generate your first audit report.'}
          </div>
        ) : (
          <ul className="auditor-site-list" role="list">
            {reports.map(report => (
              <li key={report.id} className="auditor-site-item">
                <div className="auditor-site-item__main">
                  <div className="auditor-site-item__header">
                    <span className="auditor-site-item__name">{report.title}</span>
                    <Badge
                      variant={
                        report.format === 'html'
                          ? 'info'
                          : report.format === 'csv'
                            ? 'warning'
                            : 'neutral'
                      }
                      size="sm"
                    >
                      {report.format.toUpperCase()}
                    </Badge>
                    <Badge
                      variant={
                        report.status === 'generated'
                          ? 'success'
                          : report.status === 'failed'
                            ? 'danger'
                            : 'neutral'
                      }
                      size="sm"
                    >
                      {report.status}
                    </Badge>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--auditor-text-muted, #94a3b8)',
                      }}
                    >
                      {new Date(report.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="auditor-site-item__url"
                    style={{ fontSize: '12px', marginTop: '4px' }}
                  >
                    Scan ID: <code>{report.scanRunId}</code>
                    {report.storagePath && (
                      <span style={{ marginLeft: '12px' }}>
                        File: <code>{report.storagePath}</code>
                      </span>
                    )}
                  </div>
                </div>

                <div className="auditor-badge-group">
                  {report.storagePath && (
                    <button
                      type="button"
                      className="auditor-button auditor-button--secondary auditor-button--sm"
                      onClick={() => handleViewContent(report)}
                      title="View Report Content"
                    >
                      View
                    </button>
                  )}
                  <button
                    type="button"
                    className="auditor-button auditor-button--danger auditor-button--sm"
                    onClick={() => handleDelete(report)}
                    title="Delete Report"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Sandboxed Report Viewer */}
      {selectedReport && (
        <div style={{ marginTop: '24px' }}>
          {previewLoading ? (
            <Card title={`Loading: ${selectedReport.title}`}>
              <div className="auditor-empty-state">Loading report contents...</div>
            </Card>
          ) : reportContent ? (
            <SecureReportPreview
              report={selectedReport}
              content={reportContent}
              onClose={() => {
                setSelectedReport(null);
                setReportContent(null);
              }}
            />
          ) : (
            <Card title="Error">
              <div className="auditor-empty-state">Could not load report content.</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
