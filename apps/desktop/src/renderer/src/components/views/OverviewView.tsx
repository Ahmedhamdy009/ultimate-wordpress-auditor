import React from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { useHeartbeat } from '../../context/HeartbeatContext.js';
import { UPCOMING_MODULES, type ViewId } from '../../types/navigation.js';
import type { AppSystemInfoResponse } from '@auditor/shared';

export interface OverviewViewProps {
  readonly onNavigate: (view: ViewId) => void;
  readonly systemInfo: AppSystemInfoResponse | null;
}

export const OverviewView: React.FC<OverviewViewProps> = ({ onNavigate, systemInfo }) => {
  const { connected, latencyMs } = useHeartbeat();

  return (
    <div>
      <section className="auditor-welcome-banner" aria-labelledby="overview-welcome-heading">
        <h1 id="overview-welcome-heading" className="auditor-welcome-banner__title">
          Ultimate WordPress &amp; Website Auditor
        </h1>
        <p className="auditor-welcome-banner__subtitle">
          Local, privacy-preserving desktop environment for technical and security auditing. Phase 1
          Desktop Application Shell initialized and verified.
        </p>
      </section>

      <div className="auditor-grid-2">
        {/* Live System & Link Readiness */}
        <Card
          title="System Readiness &amp; IPC Link"
          subtitle="Real-time Main process connection status"
          headerAction={
            connected ? (
              <Badge variant="success">IPC Connected</Badge>
            ) : (
              <Badge variant="danger">IPC Disconnected</Badge>
            )
          }
        >
          <dl className="auditor-meta-list">
            <div className="auditor-meta-row">
              <dt>IPC Heartbeat Latency</dt>
              <dd>
                <strong>{latencyMs !== null ? `${latencyMs} ms` : 'Offline / Measuring'}</strong>
              </dd>
            </div>
            <div className="auditor-meta-row">
              <dt>Desktop App Version</dt>
              <dd>
                <code>v{systemInfo?.appVersion ?? '0.1.0'}</code>
              </dd>
            </div>
            <div className="auditor-meta-row">
              <dt>Platform &amp; Architecture</dt>
              <dd>
                <code>
                  {systemInfo ? `${systemInfo.platform} (${systemInfo.arch})` : 'Detecting...'}
                </code>
              </dd>
            </div>
            <div className="auditor-meta-row">
              <dt>Security Sandbox</dt>
              <dd>
                <Badge variant="info" size="sm">
                  Context Isolated · CSP Active
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>

        {/* Quick Launchpad */}
        <Card
          title="Diagnostic Launchpad"
          subtitle="Navigate to active verification tools"
          headerAction={<Badge variant="neutral">Batch 1 &amp; 2 Ready</Badge>}
        >
          <p>
            Verify candidate scan targets against RFC 3986 normalization rules and Scope Guard
            boundary policies, or inspect deep runtime diagnostics.
          </p>
          <div className="auditor-form-actions">
            <button
              type="button"
              id="overview-launch-scans"
              className="auditor-button auditor-button--primary"
              onClick={() => onNavigate('scans')}
            >
              Audit &amp; Scans
            </button>
            <button
              type="button"
              id="overview-launch-projects"
              className="auditor-button auditor-button--secondary"
              onClick={() => onNavigate('projects')}
            >
              Projects &amp; Sites
            </button>
            <button
              type="button"
              id="overview-launch-validator"
              className="auditor-button auditor-button--secondary"
              onClick={() => onNavigate('target-validator')}
            >
              Target Validator
            </button>
            <button
              type="button"
              id="overview-launch-diagnostics"
              className="auditor-button auditor-button--secondary"
              onClick={() => onNavigate('system-diagnostics')}
            >
              Diagnostics
            </button>
          </div>
        </Card>
      </div>

      {/* Available Capabilities */}
      <div className="auditor-section-header">
        <h2 className="auditor-section-title">Active Core Capabilities</h2>
        <p className="auditor-view-description">
          Verified security controls, IPC link dispatchers, and URL normalization algorithms active
          in Phase 1.
        </p>
      </div>

      <div className="auditor-grid-2">
        <div className="auditor-capability-card">
          <div className="auditor-capability-title">
            <span>RFC 3986 Target Syntax Normalizer</span>
            <Badge variant="success" size="sm">
              Active
            </Badge>
          </div>
          <p className="auditor-capability-desc">
            Normalizes hostnames, default ports, and path structures to prevent URL obfuscation
            attacks.
          </p>
        </div>

        <div className="auditor-capability-card">
          <div className="auditor-capability-title">
            <span>Isomorphic Scope Guard</span>
            <Badge variant="success" size="sm">
              Active
            </Badge>
          </div>
          <p className="auditor-capability-desc">
            Enforces strict boundary containment, prohibiting scans outside explicitly authorized
            hosts.
          </p>
        </div>

        <div className="auditor-capability-card">
          <div className="auditor-capability-title">
            <span>Hardened IPC Bridge &amp; Sender Guard</span>
            <Badge variant="success" size="sm">
              Active
            </Badge>
          </div>
          <p className="auditor-capability-desc">
            Strict main-frame sender verification, concurrency limiter, and rate limiter preventing
            abuse.
          </p>
        </div>

        <div className="auditor-capability-card">
          <div className="auditor-capability-title">
            <span>Zero-Trust Content Security Policy</span>
            <Badge variant="success" size="sm">
              Active
            </Badge>
          </div>
          <p className="auditor-capability-desc">
            Prohibits unsafe inline scripts, inline styles, eval, and remote connections from the
            Renderer.
          </p>
        </div>
      </div>

      {/* Upcoming Modules Notice */}
      <div className="auditor-section-header">
        <h2 className="auditor-section-title">Upcoming Audit Engines</h2>
        <p className="auditor-view-description">
          Engine modules planned for subsequent phases. No mock or synthetic metrics are rendered.
        </p>
      </div>

      <div className="auditor-grid-3">
        {UPCOMING_MODULES.map(mod => (
          <div key={mod.id} className="auditor-capability-card">
            <div className="auditor-capability-title">
              <span>{mod.label}</span>
              <Badge variant="neutral" size="sm">
                {mod.phase}
              </Badge>
            </div>
            <p className="auditor-capability-desc">
              Engine implementation scheduled for {mod.phase}. Not operational in Phase 1.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
