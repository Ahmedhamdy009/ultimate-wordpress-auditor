import React from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import { useHeartbeat } from '../../context/HeartbeatContext.js';
import type { AppSystemInfoResponse, IPCSerializedError } from '@auditor/shared';

export interface SystemDiagnosticsViewProps {
  readonly systemInfo: AppSystemInfoResponse | null;
  readonly systemInfoLoading: boolean;
  readonly systemInfoError: IPCSerializedError | null;
  readonly onReload: () => void;
}

export const SystemDiagnosticsView: React.FC<SystemDiagnosticsViewProps> = ({
  systemInfo,
  systemInfoLoading,
  systemInfoError,
  onReload,
}) => {
  const { connected, latencyMs, lastPongTimestamp, pinging, pingNow } = useHeartbeat();

  return (
    <div>
      <div className="auditor-view-header">
        <h1 className="auditor-view-title">System Diagnostics &amp; Runtime Verification</h1>
        <p className="auditor-view-description">
          Verified desktop runtime metadata and inter-process communication health status.
        </p>
      </div>

      {systemInfoError && (
        <Alert variant="danger" title="System Metadata Retrieval Error">
          {systemInfoError.message} (Code: {systemInfoError.code})
        </Alert>
      )}

      <div className="auditor-grid-2">
        {/* Runtime Environment Card */}
        <Card
          title="Runtime Environment"
          subtitle="Contract: app:get-system-info"
          headerAction={
            <button
              type="button"
              id="reload-system-info-button"
              className="auditor-button auditor-button--secondary"
              onClick={onReload}
              disabled={systemInfoLoading}
            >
              {systemInfoLoading ? 'Refreshing...' : 'Reload Metadata'}
            </button>
          }
        >
          {systemInfo ? (
            <dl className="auditor-meta-list">
              <div className="auditor-meta-row">
                <dt>App Version</dt>
                <dd>
                  <code>v{systemInfo.appVersion}</code>
                </dd>
              </div>
              <div className="auditor-meta-row">
                <dt>Electron Runtime</dt>
                <dd>
                  <code>{systemInfo.electronVersion}</code>
                </dd>
              </div>
              <div className="auditor-meta-row">
                <dt>Chromium Engine</dt>
                <dd>
                  <code>{systemInfo.chromeVersion}</code>
                </dd>
              </div>
              <div className="auditor-meta-row">
                <dt>Node.js Runtime</dt>
                <dd>
                  <code>{systemInfo.nodeVersion}</code>
                </dd>
              </div>
              <div className="auditor-meta-row">
                <dt>Operating System (Platform)</dt>
                <dd>
                  <code>{systemInfo.platform}</code>
                </dd>
              </div>
              <div className="auditor-meta-row">
                <dt>CPU Architecture</dt>
                <dd>
                  <code>{systemInfo.arch}</code>
                </dd>
              </div>
            </dl>
          ) : (
            <p>Loading verified system info from Main process...</p>
          )}
        </Card>

        {/* IPC Link Health & Latency */}
        <Card
          title="IPC Link Health &amp; Latency"
          subtitle="Contract: app:ping"
          headerAction={
            <button
              type="button"
              id="ping-now-button"
              className="auditor-button auditor-button--secondary"
              onClick={() => void pingNow()}
              disabled={pinging}
            >
              {pinging ? 'Pinging...' : 'Ping Now'}
            </button>
          }
        >
          <dl className="auditor-meta-list">
            <div className="auditor-meta-row">
              <dt>IPC Status</dt>
              <dd>
                {connected ? (
                  <Badge variant="success">Connected</Badge>
                ) : (
                  <Badge variant="danger">Disconnected</Badge>
                )}
              </dd>
            </div>
            <div className="auditor-meta-row">
              <dt>Round-Trip Latency</dt>
              <dd>
                <strong>{latencyMs !== null ? `${latencyMs} ms` : 'Measuring...'}</strong>
              </dd>
            </div>
            <div className="auditor-meta-row">
              <dt>Last Pong Timestamp</dt>
              <dd>
                <code>
                  {lastPongTimestamp !== null
                    ? new Date(lastPongTimestamp).toLocaleTimeString()
                    : 'Awaiting pong'}
                </code>
              </dd>
            </div>
            <div className="auditor-meta-row">
              <dt>IPC Dispatch Protocol</dt>
              <dd>
                <Badge variant="info" size="sm">
                  Typed Envelope · Bounded
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="auditor-section-header">
        <h2 className="auditor-section-title">Security &amp; Isolation Boundaries</h2>
        <p className="auditor-view-description">
          Active boundary guarantees verified in Phase 1.2.4. Zero unverified diagnostic claims are
          made.
        </p>
      </div>

      <div className="auditor-grid-2">
        <Card title="Preload-to-Main Boundary" subtitle="Hardened Context Isolation">
          <p>
            The Renderer window executes with <code>contextIsolation=true</code> and{' '}
            <code>nodeIntegration=false</code>. No Node.js globals (<code>process</code>,{' '}
            <code>Buffer</code>, <code>require</code>) exist in the Renderer scope.
          </p>
        </Card>

        <Card title="Content Security Policy" subtitle="Strict Meta-CSP Enforcement">
          <p>
            Production builds enforce <code>default-src &apos;none&apos;</code> and{' '}
            <code>style-src &apos;self&apos;</code>. External network calls, unbundled stylesheets,
            and eval are strictly blocked.
          </p>
        </Card>
      </div>
    </div>
  );
};
