import React from 'react';
import { Badge } from '../common/Badge.js';
import { useHeartbeat } from '../../context/HeartbeatContext.js';
import { useAuditUi } from '../../context/AuditUiContext.js';

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
  const { locale, viewMode, setLocale, setViewMode, tDesktop } = useAuditUi();
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
        {/* Language Switcher (EN LTR / AR RTL) */}
        <div
          className="auditor-segmented-control"
          role="group"
          aria-label={tDesktop('languageLabel')}
          data-testid="locale-switcher"
        >
          <button
            type="button"
            className={`auditor-segmented-btn ${locale === 'en' ? 'auditor-segmented-btn--active' : ''}`}
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
            data-testid="locale-toggle-en"
          >
            EN
          </button>
          <button
            type="button"
            className={`auditor-segmented-btn ${locale === 'ar' ? 'auditor-segmented-btn--active' : ''}`}
            aria-pressed={locale === 'ar'}
            onClick={() => setLocale('ar')}
            data-testid="locale-toggle-ar"
          >
            العربية
          </button>
        </div>

        {/* Audience View Mode Switcher (Simple / Technical / Dual) */}
        <div
          className="auditor-segmented-control"
          role="group"
          aria-label={tDesktop('viewModeLabel')}
          data-testid="viewmode-switcher"
        >
          <button
            type="button"
            className={`auditor-segmented-btn ${viewMode === 'simple' ? 'auditor-segmented-btn--active' : ''}`}
            aria-pressed={viewMode === 'simple'}
            onClick={() => setViewMode('simple')}
            data-testid="mode-toggle-simple"
          >
            {tDesktop('viewModeSimpleShort')}
          </button>
          <button
            type="button"
            className={`auditor-segmented-btn ${viewMode === 'technical' ? 'auditor-segmented-btn--active' : ''}`}
            aria-pressed={viewMode === 'technical'}
            onClick={() => setViewMode('technical')}
            data-testid="mode-toggle-technical"
          >
            {tDesktop('viewModeTechnicalShort')}
          </button>
          <button
            type="button"
            className={`auditor-segmented-btn ${viewMode === 'dual' ? 'auditor-segmented-btn--active' : ''}`}
            aria-pressed={viewMode === 'dual'}
            onClick={() => setViewMode('dual')}
            data-testid="mode-toggle-dual"
          >
            {tDesktop('viewModeDualShort')}
          </button>
        </div>

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
