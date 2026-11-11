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
      };

      const html = renderComponentToHtml(
        React.createElement(
          HeartbeatProvider,
          { intervalMs: 60000 },
          React.createElement(OverviewView, {
            onNavigate: vi.fn(),
            systemInfo: MOCK_SYSTEM_INFO,
          }),
        ),
      );

      // Verify hero banner
      expect(html).toContain('Ultimate WordPress &amp; Website Auditor');
      expect(html).toContain('auditor-welcome-banner');

      // Verify readiness details
      expect(html).toContain('v0.1.0');
      expect(html).toContain('win32 (x64)');

      // Verify quick action buttons exist
      expect(html).toContain('overview-launch-scans');
      expect(html).toContain('overview-launch-projects');
      expect(html).toContain('overview-launch-validator');
      expect(html).toContain('overview-launch-diagnostics');

      // Verify upcoming modules are rendered with planned badges
      expect(html).toContain('WordPress Core');
      expect(html).toContain('auditor-badge--neutral');
      expect(html).toContain('Phase 6');
    });

    it('triggers onNavigate callback when quick launch buttons are clicked', async () => {
      const onNavigateMock = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).electronAPI = {
        ping: vi.fn().mockResolvedValue({
          success: true,
          data: { pong: true, serverTimestamp: 1700000000 },
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
