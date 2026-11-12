import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import { useHeartbeat } from '../../context/HeartbeatContext.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useScans } from '../../hooks/useScans.js';
import type { ViewId } from '../../types/navigation.js';
import type { AppSystemInfoResponse, SiteDTO, ProjectDTO, ScanRunDTO } from '@auditor/shared';
import type { ElectronAPI } from '../../../../common/ipc/contracts.js';

export interface OverviewViewProps {
  readonly onNavigate: (view: ViewId, param?: string) => void;
  readonly systemInfo: AppSystemInfoResponse | null;
  readonly initialProjects?: readonly ProjectDTO[];
  readonly initialSites?: readonly SiteDTO[];
  readonly initialScans?: readonly ScanRunDTO[];
}

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

export const OverviewView: React.FC<OverviewViewProps> = ({
  onNavigate,
  systemInfo,
  initialProjects,
  initialSites,
  initialScans,
}) => {
  const { connected, latencyMs } = useHeartbeat();
  const {
    projects: fetchedProjects,
    loading: projectsLoading,
    error: projectsError,
    loadProjects,
  } = useProjects();
  const {
    scans: fetchedScans,
    loading: scansLoading,
    error: scansError,
    loadScans,
  } = useScans({
    initialScans,
    autoLoad: initialScans === undefined,
  });

  const projects = initialProjects ?? fetchedProjects;
  const scans = initialScans ?? fetchedScans;

  const [sites, setSites] = useState<readonly SiteDTO[]>(initialSites ?? []);
  const [sitesLoading, setSitesLoading] = useState<boolean>(initialSites === undefined);
  const [sitesError, setSitesError] = useState<string | null>(null);

  // Load registered sites
  const loadSites = useCallback(async () => {
    if (initialSites !== undefined) {
      setSitesLoading(false);
      return;
    }
    const api = getElectronAPI();
    if (!api) {
      setSitesLoading(false);
      return;
    }
    setSitesLoading(true);
    setSitesError(null);
    try {
      let projList: readonly ProjectDTO[] = projects;
      if (projList.length === 0) {
        const projRes = await api.listProjects({ limit: 100 });
        if (projRes.success && projRes.data) {
          projList = projRes.data.items;
        }
      }
      const siteResults = await Promise.all(
        projList.map((p: ProjectDTO) => api.listSites({ projectId: p.id, limit: 100 })),
      );
      const allSites = siteResults.flatMap(r => (r.success && r.data ? r.data.items : []));
      setSites(allSites);
    } catch (err) {
      setSitesError(err instanceof Error ? err.message : String(err));
    } finally {
      setSitesLoading(false);
    }
  }, [initialSites, projects]);

  useEffect(() => {
    loadSites();
  }, [loadSites]);

  const handleRetryAll = () => {
    loadProjects();
    loadScans();
    loadSites();
  };

  const isInitialLoading =
    (projectsLoading || scansLoading || sitesLoading) &&
    scans.length === 0 &&
    initialProjects === undefined &&
    initialScans === undefined;
  const hasError = projectsError || scansError || sitesError;

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

  // Aggregated persisted metrics
  const metrics = useMemo(() => {
    const totalScans = scans.length;
    const completedScans = scans.filter(s => s.status === 'completed');
    const failedScans = scans.filter(s => s.status === 'failed');
    const cancelledScans = scans.filter(s => s.status === 'cancelled');
    const runningScans = scans.filter(s => s.status === 'running');

    let totalFindings = 0;
    let criticalFindings = 0;
    let highFindings = 0;
    let mediumFindings = 0;
    let lowFindings = 0;
    let infoFindings = 0;

    for (const s of completedScans) {
      if (s.summary) {
        totalFindings += s.summary.totalFindings ?? 0;
        criticalFindings += s.summary.criticalCount ?? 0;
        highFindings += s.summary.highCount ?? 0;
        mediumFindings += s.summary.mediumCount ?? 0;
        lowFindings += s.summary.lowCount ?? 0;
        infoFindings += s.summary.infoCount ?? 0;
      }
    }

    return {
      totalProjects: projects.length,
      totalSites: sites.length,
      totalScans,
      completedScans: completedScans.length,
      failedScans: failedScans.length,
      cancelledScans: cancelledScans.length,
      runningScans: runningScans.length,
      totalFindings,
      criticalFindings,
      highFindings,
      mediumFindings,
      lowFindings,
      infoFindings,
    };
  }, [projects, sites, scans]);

  const recentScans = useMemo(() => scans.slice(0, 5), [scans]);

  return (
    <div className="auditor-overview-view" data-testid="overview-view">
      {/* Welcome Banner */}
      <section className="auditor-welcome-banner" aria-labelledby="overview-welcome-heading">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <h1 id="overview-welcome-heading" className="auditor-welcome-banner__title">
              Audit Operations Dashboard
            </h1>
            <p className="auditor-welcome-banner__subtitle">
              Local, privacy-preserving desktop workspace for WordPress and website technical
              audits.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Badge variant={connected ? 'success' : 'danger'}>
              {connected ? `IPC Connected (${latencyMs ?? 0}ms)` : 'IPC Disconnected'}
            </Badge>
            <Badge variant="neutral">v{systemInfo?.appVersion ?? '0.1.7'}</Badge>
          </div>
        </div>
      </section>

      {/* Error State */}
      {hasError && (
        <Alert variant="danger" title="Data Synchronization Notice">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{projectsError?.message || scansError?.message || sitesError}</span>
            <button
              type="button"
              className="auditor-button auditor-button--secondary auditor-button--sm"
              onClick={handleRetryAll}
            >
              Retry
            </button>
          </div>
        </Alert>
      )}

      {/* Initial Loading State */}
      {isInitialLoading ? (
        <Card title="Loading Workspace Diagnostics">
          <div className="auditor-empty-state" style={{ padding: '32px 16px' }}>
            Loading persisted project metrics, scan history, and findings...
          </div>
        </Card>
      ) : projects.length === 0 && scans.length === 0 ? (
        /* Empty State for New Installation */
        <Card title="Welcome to Your Audit Workspace">
          <div
            className="auditor-empty-state"
            style={{ padding: '40px 24px', textAlign: 'center' }}
          >
            <div style={{ fontSize: '36px', marginBottom: '16px' }}>🚀</div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
              No Audits Configured Yet
            </h2>
            <p
              style={{
                maxWidth: '520px',
                margin: '0 auto 24px auto',
                color: 'var(--auditor-text-muted, #94a3b8)',
                lineHeight: 1.6,
              }}
            >
              Get started by registering a website project. You can immediately run comprehensive
              technical SEO, security header, WCAG accessibility, and responsive layout audits.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <button
                type="button"
                className="auditor-button auditor-button--primary"
                onClick={() => onNavigate('projects')}
              >
                Create First Project &amp; Register Site
              </button>
              <button
                type="button"
                className="auditor-button auditor-button--secondary"
                onClick={() => onNavigate('target-validator')}
              >
                Validate Target Scope
              </button>
            </div>
          </div>
        </Card>
      ) : (
        /* Populated State */
        <>
          {/* Executive Metrics Grid */}
          <div className="auditor-grid-4" style={{ marginBottom: '24px' }}>
            {/* 1. Projects & Sites */}
            <Card
              title="Target Registry"
              subtitle="Registered workspaces and websites"
              headerAction={
                <button
                  type="button"
                  className="auditor-button auditor-button--secondary auditor-button--sm"
                  onClick={() => onNavigate('projects')}
                >
                  Manage
                </button>
              }
            >
              <div
                style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}
              >
                <span
                  style={{
                    fontSize: '32px',
                    fontWeight: 800,
                    color: 'var(--auditor-color-accent, #38bdf8)',
                  }}
                >
                  {metrics.totalSites}
                </span>
                <span style={{ fontSize: '14px', color: 'var(--auditor-text-muted, #94a3b8)' }}>
                  Sites
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--auditor-text-muted, #94a3b8)' }}>
                Across <strong>{metrics.totalProjects}</strong> project
                {metrics.totalProjects === 1 ? '' : 's'}
              </div>
            </Card>

            {/* 2. Audit Runs */}
            <Card
              title="Audit Execution"
              subtitle="Crawl and browser scan history"
              headerAction={
                <button
                  type="button"
                  className="auditor-button auditor-button--primary auditor-button--sm"
                  onClick={() => onNavigate('scans')}
                >
                  New Scan
                </button>
              }
            >
              <div
                style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}
              >
                <span style={{ fontSize: '32px', fontWeight: 800 }}>{metrics.totalScans}</span>
                <span style={{ fontSize: '14px', color: 'var(--auditor-text-muted, #94a3b8)' }}>
                  Total Runs
                </span>
              </div>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--auditor-text-muted, #94a3b8)',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <span style={{ color: 'var(--auditor-color-success, #10b981)' }}>
                  ✓ {metrics.completedScans} completed
                </span>
                {metrics.failedScans > 0 && (
                  <span style={{ color: 'var(--auditor-color-danger, #ef4444)' }}>
                    × {metrics.failedScans} failed
                  </span>
                )}
                {metrics.cancelledScans > 0 && (
                  <span style={{ color: 'var(--auditor-color-warning, #f59e0b)' }}>
                    ⊘ {metrics.cancelledScans} cancelled
                  </span>
                )}
              </div>
            </Card>

            {/* 3. Findings Scorecard */}
            <Card
              title="Findings Discovered"
              subtitle="Aggregated across completed scans"
              headerAction={
                <Badge variant={metrics.criticalFindings > 0 ? 'danger' : 'success'} size="sm">
                  {metrics.criticalFindings > 0
                    ? `${metrics.criticalFindings} Critical`
                    : '0 Critical'}
                </Badge>
              }
            >
              <div
                style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}
              >
                <span style={{ fontSize: '32px', fontWeight: 800 }}>{metrics.totalFindings}</span>
                <span style={{ fontSize: '14px', color: 'var(--auditor-text-muted, #94a3b8)' }}>
                  Issues
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <Badge variant="danger" size="sm">
                  {metrics.criticalFindings} Critical
                </Badge>
                <Badge variant="warning" size="sm">
                  {metrics.highFindings} High
                </Badge>
                <Badge variant="info" size="sm">
                  {metrics.mediumFindings + metrics.lowFindings} Med/Low
                </Badge>
              </div>
            </Card>

            {/* 4. Engine Sandbox */}
            <Card
              title="Audit Engine Sandbox"
              subtitle="Verified local runtime environment"
              headerAction={
                <Badge variant="success" size="sm">
                  Active
                </Badge>
              }
            >
              <dl className="auditor-meta-list" style={{ fontSize: '12px' }}>
                <div className="auditor-meta-row">
                  <dt>Engine</dt>
                  <dd>Chromium + axe-core</dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>Storage</dt>
                  <dd>SQLite WAL (Local D:)</dd>
                </div>
                <div className="auditor-meta-row">
                  <dt>SSRF Guard</dt>
                  <dd>IANA Registry Pinning</dd>
                </div>
              </dl>
            </Card>
          </div>

          {/* Recent Scans Activity Table */}
          <Card
            title="Recent Scan Activity"
            subtitle="Latest automated audit executions and findings inspection"
            headerAction={
              <button
                type="button"
                className="auditor-button auditor-button--secondary auditor-button--sm"
                onClick={() => onNavigate('scans')}
              >
                View All Scans
              </button>
            }
          >
            {recentScans.length === 0 ? (
              <div className="auditor-empty-state">No scan history recorded.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="auditor-table" style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: 'var(--auditor-bg-subtle, #1e293b)' }}>
                      <th style={{ textAlign: 'left', padding: '10px 12px' }}>Target Website</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px' }}>Project</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px' }}>Completed</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px' }}>Duration</th>
                      <th style={{ textAlign: 'left', padding: '10px 12px' }}>Findings</th>
                      <th style={{ textAlign: 'right', padding: '10px 12px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentScans.map(scan => {
                      const site = siteMap.get(scan.siteId);
                      const project = site ? projectMap.get(site.projectId) : undefined;
                      const siteName = site?.name || scan.targetUrl;
                      const findings = scan.summary?.totalFindings ?? 0;
                      const criticals = scan.summary?.criticalCount ?? 0;
                      const highs = scan.summary?.highCount ?? 0;

                      return (
                        <tr
                          key={scan.id}
                          style={{ borderBottom: '1px solid var(--auditor-border, #334155)' }}
                        >
                          <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                            <div>{siteName}</div>
                            <div
                              style={{
                                fontSize: '11px',
                                color: 'var(--auditor-text-muted, #94a3b8)',
                                fontWeight: 400,
                              }}
                            >
                              {scan.targetUrl}
                            </div>
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              color: 'var(--auditor-text-muted, #94a3b8)',
                            }}
                          >
                            {project ?? '—'}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <Badge
                              variant={
                                scan.status === 'completed'
                                  ? 'success'
                                  : scan.status === 'failed'
                                    ? 'danger'
                                    : scan.status === 'cancelled'
                                      ? 'warning'
                                      : 'info'
                              }
                              size="sm"
                            >
                              {scan.status.toUpperCase()}
                            </Badge>
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              color: 'var(--auditor-text-muted, #94a3b8)',
                            }}
                          >
                            {scan.completedAt
                              ? new Date(scan.completedAt).toLocaleString()
                              : 'In Progress'}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              color: 'var(--auditor-text-muted, #94a3b8)',
                            }}
                          >
                            {formatDuration(scan.durationMs)}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ fontWeight: 700, marginRight: '6px' }}>{findings}</span>
                            {criticals > 0 && (
                              <Badge variant="danger" size="sm">
                                {criticals} Crit
                              </Badge>
                            )}
                            {highs > 0 && (
                              <span style={{ marginLeft: '4px' }}>
                                <Badge variant="warning" size="sm">
                                  {highs} High
                                </Badge>
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                              <button
                                type="button"
                                className="auditor-button auditor-button--secondary auditor-button--sm"
                                onClick={() => onNavigate('scans', scan.id)}
                                title="Inspect Scan in Scans View"
                              >
                                Inspect
                              </button>
                              {scan.status === 'completed' && (
                                <button
                                  type="button"
                                  className="auditor-button auditor-button--primary auditor-button--sm"
                                  onClick={() => onNavigate('reports', scan.id)}
                                  title="Generate and Export Report for this scan"
                                >
                                  Report
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Quick Launchpad */}
          <div style={{ marginTop: '24px' }}>
            <Card
              title="Workflow Quick Launchpad"
              subtitle="Navigate directly to specialized testing and reporting tools"
            >
              <div className="auditor-form-actions" style={{ marginTop: '4px' }}>
                <button
                  type="button"
                  className="auditor-button auditor-button--primary"
                  onClick={() => onNavigate('scans')}
                >
                  Audit &amp; Scans
                </button>
                <button
                  type="button"
                  className="auditor-button auditor-button--secondary"
                  onClick={() => onNavigate('projects')}
                >
                  Projects &amp; Sites
                </button>
                <button
                  type="button"
                  className="auditor-button auditor-button--secondary"
                  onClick={() => onNavigate('reports')}
                >
                  Reports &amp; Exports
                </button>
                <button
                  type="button"
                  className="auditor-button auditor-button--secondary"
                  onClick={() => onNavigate('target-validator')}
                >
                  Target Scope Validator
                </button>
                <button
                  type="button"
                  className="auditor-button auditor-button--secondary"
                  onClick={() => onNavigate('system-diagnostics')}
                >
                  System Diagnostics
                </button>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
