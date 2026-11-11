import React from 'react';
import { Badge } from '../common/Badge.js';
import { useHeartbeat } from '../../context/HeartbeatContext.js';

export interface HeaderProps {
  readonly activeViewTitle: string;
  readonly connected?: boolean;
  readonly latencyMs?: number | null;
}

export const Header: React.FC<HeaderProps> = ({
  activeViewTitle,
  connected: propConnected,
  latencyMs: propLatencyMs,
}) => {
  const heartbeat = useHeartbeat();
  const connected = propConnected !== undefined ? propConnected : heartbeat.connected;
  const latencyMs = propLatencyMs !== undefined ? propLatencyMs : heartbeat.latencyMs;

  return (
    <header className="auditor-header" role="banner">
      <div className="auditor-header__branding">
        <span className="auditor-header__logo">Ultimate WordPress &amp; Website Auditor</span>
        <Badge variant="neutral" size="sm">
          Phase 1.2.5 Desktop Shell
        </Badge>
      </div>

      <div className="auditor-header__status">
        <Badge variant="neutral" size="sm">
          View: {activeViewTitle}
        </Badge>
        {connected ? (
          <Badge variant="success" size="sm" title="Main process IPC link active">
            IPC Connected {latencyMs !== null ? `(${latencyMs}ms)` : ''}
          </Badge>
        ) : (
          <Badge variant="danger" size="sm" title="IPC bridge disconnected or unreachable">
            IPC Disconnected
          </Badge>
        )}
      </div>
    </header>
  );
};
