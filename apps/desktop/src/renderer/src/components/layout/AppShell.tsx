import React from 'react';
import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';
import { Viewport } from './Viewport.js';
import { StatusBar } from './StatusBar.js';
import { useAuditUi } from '../../context/AuditUiContext.js';
import type { ViewId } from '../../types/navigation.js';
import type { AppSystemInfoResponse } from '@auditor/shared';

export interface AppShellProps {
  readonly activeView: ViewId;
  readonly activeViewTitle: string;
  readonly onSelectView: (view: ViewId) => void;
  readonly systemInfo: AppSystemInfoResponse | null;
  readonly connected?: boolean;
  readonly latencyMs?: number | null;
  readonly children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  activeView,
  activeViewTitle,
  onSelectView,
  systemInfo,
  connected,
  latencyMs,
  children,
}) => {
  const { locale, direction } = useAuditUi();

  return (
    <div className="auditor-shell" dir={direction} lang={locale}>
      <Header connected={connected} latencyMs={latencyMs} activeViewTitle={activeViewTitle} />
      <div className="auditor-workspace">
        <Sidebar activeView={activeView} onSelectView={onSelectView} />
        <Viewport>{children}</Viewport>
      </div>
      <StatusBar
        connected={connected}
        latencyMs={latencyMs}
        activeViewTitle={activeViewTitle}
        systemInfo={systemInfo}
      />
    </div>
  );
};
