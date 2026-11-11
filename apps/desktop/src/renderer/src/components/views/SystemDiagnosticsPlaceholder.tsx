import React from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import type { AppSystemInfoResponse, IPCSerializedError } from '@auditor/shared';

export interface SystemDiagnosticsPlaceholderProps {
  readonly systemInfo: AppSystemInfoResponse | null;
  readonly systemInfoLoading: boolean;
  readonly systemInfoError: IPCSerializedError | null;
  readonly connected: boolean;
  readonly latencyMs: number | null;
  readonly onReload: () => void;
}

export const SystemDiagnosticsPlaceholder: React.FC<SystemDiagnosticsPlaceholderProps> = ({
  systemInfo,
  systemInfoLoading,
  systemInfoError,
  connected,
  latencyMs,
  onReload,
}) => {
  return (
    <div>
      <div className="auditor-view-header">
        <h1 className="auditor-view-title">System Diagnostics</h1>
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
        <Card
          title="Runtime Environment"
          subtitle="Contract: app:get-system-info"
          headerAction={
            <button
              type="button"
              className="auditor-button"
              onClick={onReload}
              disabled={systemInfoLoading}
            >
              {systemInfoLoading ? 'Refreshing...' : 'Reload Info'}
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
                <dt>Node.js Runtime</dt>
                <dd>
                  <code>{systemInfo.nodeVersion}</code>
                </dd>
              </div>
              <div className="auditor-meta-row">
                <dt>Chrome Engine</dt>
                <dd>
                  <code>{systemInfo.chromeVersion}</code>
                </dd>
              </div>
              <div className="auditor-meta-row">
                <dt>Platform (OS)</dt>
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

        <Card
          title="IPC Link Health &amp; Latency"
          subtitle="Contract: app:ping"
          headerAction={
            connected ? (
              <Badge variant="success">Connected</Badge>
            ) : (
              <Badge variant="danger">Disconnected</Badge>
            )
          }
        >
          <p>
            Continuous heartbeat actively measures round-trip latency across the context-isolated
            Preload bridge to the Main process IPC dispatcher.
          </p>
          <div className="auditor-meta-row">
            <span>Link Latency:</span>
            <strong>{latencyMs !== null ? `${latencyMs} ms` : 'Measuring...'}</strong>
          </div>
        </Card>
      </div>
    </div>
  );
};
