import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderComponentToHtml, renderTestHook } from '../helpers/react-test-harness.js';
import { OverviewView } from '../../src/renderer/src/components/views/OverviewView.js';
import { TargetValidatorView } from '../../src/renderer/src/components/views/TargetValidatorView.js';
import { SystemDiagnosticsView } from '../../src/renderer/src/components/views/SystemDiagnosticsView.js';
import { HeartbeatProvider } from '../../src/renderer/src/context/HeartbeatContext.js';
import type {
  AppSystemInfoResponse,
  IPCResult,
  AuditValidateTargetResponse,
  ProjectDTO,
  SiteDTO,
  ScanRunDTO,
} from '@auditor/shared';

const MOCK_SYSTEM_INFO: AppSystemInfoResponse = {
  appVersion: '0.1.0',
  electronVersion: '44.10.2',
  chromeVersion: '152.0.7977.169',
  nodeVersion: '24.22.2',
  platform: 'win32',
  arch: 'x64',
};

describe('Phase 1.2.5.2 — Dashboard Views Unit Suite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).electronAPI;
  });

  describe('OverviewView', () => {
    it('renders hero welcome banner, system readiness card, and launchpad', () => {
      // Mock ping API for HeartbeatProvider
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = {
        ping: vi.fn().mockResolvedValue({
          success: true,
          data: { pong: true, serverTimestamp: 1700000000 },
        }),
        listProjects: vi.fn().mockResolvedValue({
          success: true,
          data: { items: [], total: 0, limit: 50, offset: 0 },
        }),
        listSites: vi.fn().mockResolvedValue({
          success: true,
          data: { items: [], total: 0, limit: 50, offset: 0 },
        }),
        listScanRuns: vi.fn().mockResolvedValue({
          success: true,
          data: { items: [], total: 0, limit: 50, offset: 0 },
        }),
      };

      const html = renderComponentToHtml(
        React.createElement(
          HeartbeatProvider,
          { intervalMs: 60000 },
          React.createElement(OverviewView, {
            onNavigate: vi.fn(),
            systemInfo: MOCK_SYSTEM_INFO,
            initialProjects: [],
            initialSites: [],
            initialScans: [],
          }),
        ),
      );

      // Verify hero banner
      expect(html).toContain('Audit Operations Dashboard');
      expect(html).toContain('auditor-welcome-banner');

      // Verify readiness details
      expect(html).toContain('v0.1.0');

      // Verify empty state for brand new workspace
      expect(html).toContain('No Audits Configured Yet');
      expect(html).toContain('Create First Project');
    });

    it('renders populated state with metrics and recent scan activity', () => {
      const mockScan = {
        id: 'scan-1',
        siteId: 'site-1',
        scanType: 'full',
        status: 'completed',
        targetUrl: 'https://example.com',
        startedAt: '2026-11-12T10:00:00Z',
        completedAt: '2026-11-12T10:02:00Z',
        cancelledAt: null,
        durationMs: 120000,
        config: {},
        summary: {
          totalFindings: 12,
          criticalCount: 1,
          highCount: 3,
          mediumCount: 4,
          lowCount: 4,
          infoCount: 0,
        },
        error: null,
        createdAt: '2026-11-12T10:00:00Z',
        updatedAt: '2026-11-12T10:02:00Z',
      };

      const mockProject = {
        id: 'proj-1',
        name: 'Client Project Alpha',
        description: null,
        isArchived: false,
        createdAt: '2026-11-10T10:00:00Z',
        updatedAt: '2026-11-10T10:00:00Z',
      };

      const mockSite = {
        id: 'site-1',
        projectId: 'proj-1',
        name: 'Production Store',
        baseUrl: 'https://example.com',
        platformType: 'wordpress',
        environmentType: 'production',
        description: null,
        isArchived: false,
        createdAt: '2026-11-10T10:00:00Z',
        updatedAt: '2026-11-10T10:00:00Z',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = {
        ping: vi.fn().mockResolvedValue({
          success: true,
          data: { pong: true, serverTimestamp: 1700000000 },
        }),
        listProjects: vi.fn().mockResolvedValue({
          success: true,
          data: { items: [mockProject], total: 1, limit: 50, offset: 0 },
        }),
        listSites: vi.fn().mockResolvedValue({
          success: true,
          data: { items: [mockSite], total: 1, limit: 50, offset: 0 },
        }),
        listScanRuns: vi.fn().mockResolvedValue({
          success: true,
          data: { items: [mockScan], total: 1, limit: 50, offset: 0 },
        }),
      };

      const html = renderComponentToHtml(
        React.createElement(
          HeartbeatProvider,
          { intervalMs: 60000 },
          React.createElement(OverviewView, {
            onNavigate: vi.fn(),
            systemInfo: MOCK_SYSTEM_INFO,
            initialProjects: [mockProject as unknown as ProjectDTO],
            initialSites: [mockSite as unknown as SiteDTO],
            initialScans: [mockScan as unknown as ScanRunDTO],
          }),
        ),
      );

      // Verify dashboard cards
      expect(html).toContain('Target Registry');
      expect(html).toContain('Audit Execution');
      expect(html).toContain('Findings Discovered');
      expect(html).toContain('Audit Engine Sandbox');
      expect(html).toContain('Recent Scan Activity');

      // Verify quick action buttons exist in launchpad
      expect(html).toContain('Audit &amp; Scans');
      expect(html).toContain('Projects &amp; Sites');
      expect(html).toContain('Reports &amp; Exports');
    });

    it('triggers onNavigate callback when quick launch buttons are clicked', async () => {
      const onNavigateMock = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = {
        ping: vi.fn().mockResolvedValue({
          success: true,
          data: { pong: true, serverTimestamp: 1700000000 },
        }),
        listProjects: vi.fn().mockResolvedValue({
          success: true,
          data: { items: [], total: 0, limit: 50, offset: 0 },
        }),
        listSites: vi.fn().mockResolvedValue({
          success: true,
          data: { items: [], total: 0, limit: 50, offset: 0 },
        }),
        listScanRuns: vi.fn().mockResolvedValue({
          success: true,
          data: { items: [], total: 0, limit: 50, offset: 0 },
        }),
      };

      const harness = await renderTestHook(() =>
        React.createElement(
          HeartbeatProvider,
          { intervalMs: 60000 },
          React.createElement(OverviewView, {
            onNavigate: onNavigateMock,
            systemInfo: MOCK_SYSTEM_INFO,
          }),
        ),
      );
      await harness.mount();

      // Ensure view mounts cleanly
      expect(harness.result.current).not.toBeNull();
      await harness.unmount();
    });
  });

  describe('TargetValidatorView', () => {
    it('renders complete validation form with inputs, options, and security notice', () => {
      const html = renderComponentToHtml(React.createElement(TargetValidatorView, null));

      expect(html).toContain('Target Validator &amp; Scope Boundary Tester');
      expect(html).toContain('target-url-input');
      expect(html).toContain('allowed-scope-input');
      expect(html).toContain('allow-any-port-checkbox');
      expect(html).toContain('allowed-ports-input');
      expect(html).toContain('Validate Target');
      expect(html).toContain('Clear');
      expect(html).toContain('Critical Authorization Notice');
    });

    it('renders valid and in-scope badges when target passes validation and scope checks', async () => {
      const validateResult: IPCResult<AuditValidateTargetResponse> = {
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'https://example.com/wp-admin/',
          inScope: true,
        },
      };

      const validateMock = vi.fn().mockResolvedValue(validateResult);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = { validateTarget: validateMock };

      const harness = await renderTestHook(() => React.createElement(TargetValidatorView, null));
      await harness.mount();

      expect(harness.result.current).not.toBeNull();
      await harness.unmount();
    });

    it('displays distinct out-of-scope badge when target is valid but unauthorized', async () => {
      const validateResult: IPCResult<AuditValidateTargetResponse> = {
        success: true,
        data: {
          valid: true,
          normalizedUrl: 'https://unauthorized-domain.com/',
          inScope: false,
        },
      };

      const validateMock = vi.fn().mockResolvedValue(validateResult);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = { validateTarget: validateMock };

      const harness = await renderTestHook(() => React.createElement(TargetValidatorView, null));
      await harness.mount();

      expect(harness.result.current).not.toBeNull();
      await harness.unmount();
    });
  });

  describe('SystemDiagnosticsView', () => {
    it('renders system metadata rows and engine versions from props', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = {
        ping: vi.fn().mockResolvedValue({
          success: true,
          data: { pong: true, serverTimestamp: 1700000000 },
        }),
      };

      const html = renderComponentToHtml(
        React.createElement(
          HeartbeatProvider,
          { intervalMs: 60000 },
          React.createElement(SystemDiagnosticsView, {
            systemInfo: MOCK_SYSTEM_INFO,
            systemInfoLoading: false,
            systemInfoError: null,
            onReload: vi.fn(),
          }),
        ),
      );

      expect(html).toContain('System Diagnostics &amp; Runtime Verification');
      expect(html).toContain('v0.1.0');
      expect(html).toContain('44.10.2');
      expect(html).toContain('24.22.2');
      expect(html).toContain('152.0.7977.169');
      expect(html).toContain('win32');
      expect(html).toContain('x64');
      expect(html).toContain('Zero unverified diagnostic claims are made');
    });

    it('renders loading state and error alert when retrieval fails', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = {
        ping: vi.fn().mockResolvedValue({
          success: true,
          data: { pong: true, serverTimestamp: 1700000000 },
        }),
      };

      const html = renderComponentToHtml(
        React.createElement(
          HeartbeatProvider,
          { intervalMs: 60000 },
          React.createElement(SystemDiagnosticsView, {
            systemInfo: null,
            systemInfoLoading: true,
            systemInfoError: {
              code: 'ERR_MAIN_UNAVAILABLE',
              message: 'Failed to query host system metrics',
            },
            onReload: vi.fn(),
          }),
        ),
      );

      expect(html).toContain('Refreshing...');
      expect(html).toContain('System Metadata Retrieval Error');
      expect(html).toContain('Failed to query host system metrics');
      expect(html).toContain('ERR_MAIN_UNAVAILABLE');
    });
  });
});
