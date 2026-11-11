import React from 'react';
import type { AppSystemInfoResponse } from '@auditor/shared';
import { useHeartbeat } from '../../context/HeartbeatContext.js';

export interface StatusBarProps {
  readonly activeViewTitle: string;
  readonly systemInfo: AppSystemInfoResponse | null;
  readonly connected?: boolean;
  readonly latencyMs?: number | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  activeViewTitle,
  systemInfo,
  connected: propConnected,
  latencyMs: propLatencyMs,
}) => {
  const heartbeat = useHeartbeat();
  const connected = propConnected !== undefined ? propConnected : heartbeat.connected;
  const latencyMs = propLatencyMs !== undefined ? propLatencyMs : heartbeat.latencyMs;

  const dotClass = connected
    ? 'auditor-statusbar__dot auditor-statusbar__dot--connected'
    : 'auditor-statusbar__dot auditor-statusbar__dot--disconnected';

  return (
    <footer className="auditor-statusbar" role="status" aria-label="System Status Bar">
      <div className="auditor-statusbar__section">
        <span className="auditor-statusbar__item">
          <span className={dotClass} aria-hidden="true" />
          <span>{connected ? 'IPC Connected' : 'IPC Offline'}</span>
          {latencyMs !== null && <span>({latencyMs}ms)</span>}
        </span>
        <span className="auditor-statusbar__item">
          <span>View: {activeViewTitle}</span>
        </span>
      </div>

      <div className="auditor-statusbar__section">
        {systemInfo && (
          <>
            <span className="auditor-statusbar__item">
              <span>App: v{systemInfo.appVersion}</span>
            </span>
            <span className="auditor-statusbar__item">
              <span>Electron: {systemInfo.electronVersion}</span>
            </span>
            <span className="auditor-statusbar__item">
              <span>Node: {systemInfo.nodeVersion}</span>
            </span>
            <span className="auditor-statusbar__item">
              <span>Chrome: {systemInfo.chromeVersion}</span>
            </span>
            <span className="auditor-statusbar__item">
              <span>
                {systemInfo.platform} ({systemInfo.arch})
              </span>
            </span>
          </>
        )}
        {!systemInfo && (
          <span className="auditor-statusbar__item">
            <span>Runtime Metadata Loading...</span>
          </span>
        )}
      </div>
    </footer>
  );
};
