import React, { useState } from 'react';
import { AppShell } from './components/layout/AppShell.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import { OverviewView } from './components/views/OverviewView.js';
import { ScansView } from './components/views/ScansView.js';
import { ProjectsView } from './components/views/ProjectsView.js';
import { ReportsView } from './components/views/ReportsView.js';
import { TargetValidatorView } from './components/views/TargetValidatorView.js';
import { SystemDiagnosticsView } from './components/views/SystemDiagnosticsView.js';
import { HeartbeatProvider } from './context/HeartbeatContext.js';
import { useSystemInfo } from './hooks/useSystemInfo.js';
import { ACTIVE_NAV_ITEMS, type ViewId } from './types/navigation.js';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewId>('overview');

  // Verified system metadata from Main process
  const {
    systemInfo,
    loading: systemInfoLoading,
    error: systemInfoError,
    reload: reloadSystemInfo,
  } = useSystemInfo();

  const activeItem = ACTIVE_NAV_ITEMS.find(item => item.id === activeView);
  const activeViewTitle = activeItem ? activeItem.label : 'Dashboard';

  const renderActiveView = (): React.ReactNode => {
    switch (activeView) {
      case 'overview':
        return <OverviewView onNavigate={setActiveView} systemInfo={systemInfo} />;
      case 'scans':
        return <ScansView onNavigate={setActiveView} />;
      case 'projects':
        return <ProjectsView />;
      case 'reports':
        return <ReportsView />;
      case 'target-validator':
        return <TargetValidatorView />;
      case 'system-diagnostics':
        return (
          <SystemDiagnosticsView
            systemInfo={systemInfo}
            systemInfoLoading={systemInfoLoading}
            systemInfoError={systemInfoError}
            onReload={reloadSystemInfo}
          />
        );
      default:
        return <OverviewView onNavigate={setActiveView} systemInfo={systemInfo} />;
    }
  };

  return (
    <HeartbeatProvider enabled={true} intervalMs={10000}>
      <AppShell
        activeView={activeView}
        activeViewTitle={activeViewTitle}
        onSelectView={setActiveView}
        systemInfo={systemInfo}
      >
        <ErrorBoundary fallbackTitle="View Rendering Failed">{renderActiveView()}</ErrorBoundary>
      </AppShell>
    </HeartbeatProvider>
  );
};
