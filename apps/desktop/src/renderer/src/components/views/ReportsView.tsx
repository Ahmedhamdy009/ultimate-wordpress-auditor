import React, { useState, useId } from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import { useReports } from '../../hooks/useReports.js';
import type { ReportDTO, ReportFormat, ReportContentDTO } from '@auditor/shared';

export const ReportsView: React.FC = () => {
  const { reports, loading, error, createReport, deleteReport, getReportContent, clearError } =
    useReports();

  // Generator form state
  const [scanRunId, setScanRunId] = useState('');
  const [reportTitle, setReportTitle] = useState('');
  const [reportFormat, setReportFormat] = useState<ReportFormat>('html');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Content preview state
  const [selectedReport, setSelectedReport] = useState<ReportDTO | null>(null);
  const [reportContent, setReportContent] = useState<ReportContentDTO | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

  const scanRunIdField = useId();
  const titleField = useId();
  const formatField = useId();

  // Overview statistics
  const totalReports = reports.length;
  const htmlReports = reports.filter(r => r.format === 'html').length;
  const jsonReports = reports.filter(r => r.format === 'json').length;
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
        `Report "${result.title}" generated successfully! Saved to: ${result.storagePath ?? 'database'}`,
      );
      setReportTitle('');
      setScanRunId('');
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
                background: 'var(--auditor-bg-subtle)',
                borderRadius: '6px',
              }}
            >
              <div
                style={{ fontSize: '24px', fontWeight: 800, color: 'var(--auditor-color-accent)' }}
              >
                {totalReports}
              </div>
              <div
                style={{
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  color: 'var(--auditor-text-muted)',
                }}
              >
                Total Reports
              </div>
            </div>
            <div
              style={{
                textAlign: 'center',
                padding: '12px',
                background: 'var(--auditor-bg-subtle)',
                borderRadius: '6px',
              }}
            >
              <div style={{ fontSize: '24px', fontWeight: 800 }}>
                {htmlReports}{' '}
                <span
                  style={{ fontSize: '13px', fontWeight: 500, color: 'var(--auditor-text-muted)' }}
                >
                  HTML
                </span>{' '}
                / {jsonReports}{' '}
                <span
                  style={{ fontSize: '13px', fontWeight: 500, color: 'var(--auditor-text-muted)' }}
                >
                  JSON
                </span>
              </div>
              <div
                style={{
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  color: 'var(--auditor-text-muted)',
                }}
              >
                Formats Breakdown
              </div>
            </div>
          </div>
          {latestReport && (
            <div
              style={{ marginTop: '16px', fontSize: '12px', color: 'var(--auditor-text-muted)' }}
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
          <form onSubmit={handleGenerateReport} className="auditor-form">
            <div className="auditor-form-group">
              <label htmlFor={scanRunIdField} className="auditor-label">
                Scan Run UUID
              </label>
              <input
                id={scanRunIdField}
                type="text"
                className="auditor-input auditor-input--mono"
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                value={scanRunId}
                onChange={e => setScanRunId(e.target.value)}
                disabled={loading}
                required
              />
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
                  <option value="html">Standalone HTML Report</option>
                  <option value="json">Structured JSON Export</option>
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
        </Card>
      </div>

      {/* Reports Directory & History */}
      <Card
        title="Report History & Exports"
        subtitle={`${reports.length} report${reports.length === 1 ? '' : 's'} generated`}
      >
        {reports.length === 0 ? (
          <div className="auditor-empty-state">
            {loading
              ? 'Loading report history...'
              : 'No reports generated yet. Enter a Scan Run ID above to generate your first audit report.'}
          </div>
        ) : (
          <ul className="auditor-site-list" role="list">
            {reports.map(report => (
              <li key={report.id} className="auditor-site-item">
                <div className="auditor-site-item__main">
                  <div className="auditor-site-item__header">
                    <span className="auditor-site-item__name">{report.title}</span>
                    <Badge variant={report.format === 'html' ? 'info' : 'neutral'} size="sm">
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
                    <span style={{ fontSize: '11px', color: 'var(--auditor-text-muted)' }}>
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

      {/* Safe In-App Report Viewer Modal / Drawer */}
      {selectedReport && (
        <div style={{ marginTop: '24px' }}>
          <Card
            title={`Viewing Report: ${selectedReport.title}`}
            subtitle={`Format: ${selectedReport.format.toUpperCase()} | Location: ${selectedReport.storagePath ?? 'N/A'}`}
            headerAction={
              <button
                type="button"
                className="auditor-button auditor-button--secondary auditor-button--sm"
                onClick={() => {
                  setSelectedReport(null);
                  setReportContent(null);
                }}
              >
                Close Preview
              </button>
            }
          >
            {previewLoading ? (
              <div className="auditor-empty-state">Loading report contents...</div>
            ) : reportContent ? (
              <div>
                {reportContent.format === 'html' ? (
                  <iframe
                    title="Report HTML Preview"
                    srcDoc={reportContent.content}
                    sandbox=""
                    style={{
                      width: '100%',
                      height: '500px',
                      border: '1px solid var(--auditor-border, #e2e8f0)',
                      borderRadius: '6px',
                      backgroundColor: '#ffffff',
                    }}
                  />
                ) : (
                  <pre
                    style={{
                      background: 'var(--auditor-bg-subtle)',
                      padding: '16px',
                      borderRadius: '6px',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: '12px',
                      maxHeight: '400px',
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    <code>{reportContent.content}</code>
                  </pre>
                )}
              </div>
            ) : (
              <div className="auditor-empty-state">Could not load report content.</div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};
