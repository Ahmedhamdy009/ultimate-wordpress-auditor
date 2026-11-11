import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import { Sidebar } from '../../src/renderer/src/components/layout/Sidebar.js';
import { Header } from '../../src/renderer/src/components/layout/Header.js';
import { StatusBar } from '../../src/renderer/src/components/layout/StatusBar.js';
import { AppShell } from '../../src/renderer/src/components/layout/AppShell.js';
import { ACTIVE_NAV_ITEMS, UPCOMING_MODULES } from '../../src/renderer/src/types/navigation.js';

describe('Phase 1.2.5.1 — Application Shell & Navigation', () => {
  describe('Sidebar Navigation', () => {
    it('renders all approved active navigation views', () => {
      const onSelect = vi.fn();
      const html = renderComponentToHtml(
        React.createElement(Sidebar, { activeView: 'overview', onSelectView: onSelect }),
      );

      expect(html).toContain('role="navigation"');
      expect(html).toContain('aria-label="Main Navigation"');

      for (const item of ACTIVE_NAV_ITEMS) {
        expect(html).toContain(item.label.replace('&', '&amp;'));
      }
    });

    it('marks current view as active with aria-current="page"', () => {
      const html = renderComponentToHtml(
        React.createElement(Sidebar, { activeView: 'target-validator', onSelectView: vi.fn() }),
      );

      expect(html).toContain('aria-current="page"');
      expect(html).toContain('auditor-nav-button--active');
    });

    it('strictly marks all upcoming modules as disabled with aria-disabled="true"', () => {
      const html = renderComponentToHtml(
        React.createElement(Sidebar, { activeView: 'overview', onSelectView: vi.fn() }),
      );

      for (const mod of UPCOMING_MODULES) {
        expect(html).toContain(mod.label.replace('&', '&amp;'));
      }

      // Verify disabled attributes
      const disabledMatches = html.match(/disabled=""/g) || [];
      expect(disabledMatches.length).toBe(UPCOMING_MODULES.length);

      const ariaDisabledMatches = html.match(/aria-disabled="true"/g) || [];
      expect(ariaDisabledMatches.length).toBe(UPCOMING_MODULES.length);
    });
  });

  describe('Header Component', () => {
    it('renders application branding and active view name', () => {
      const html = renderComponentToHtml(
        React.createElement(Header, {
          connected: true,
          latencyMs: 12,
          activeViewTitle: 'System Diagnostics',
        }),
      );

      expect(html).toContain('role="banner"');
      expect(html).toContain('Ultimate WordPress &amp; Website Auditor');
      expect(html).toContain('View: System Diagnostics');
      expect(html).toContain('IPC Connected (12ms)');
    });

    it('renders disconnected badge when connected=false', () => {
      const html = renderComponentToHtml(
        React.createElement(Header, {
          connected: false,
          latencyMs: null,
          activeViewTitle: 'Overview',
        }),
      );

      expect(html).toContain('IPC Disconnected');
      expect(html).toContain('auditor-badge--danger');
    });
  });

  describe('StatusBar Component', () => {
    it('renders verified system metadata fields when available', () => {
      const mockSystemInfo = {
        appVersion: '0.1.0',
        electronVersion: '44.10.2',
        chromeVersion: '130.0.6723.137',
        nodeVersion: '22.11.0',
        platform: 'win32' as const,
        arch: 'x64',
      };

      const html = renderComponentToHtml(
        React.createElement(StatusBar, {
          connected: true,
          latencyMs: 5,
          activeViewTitle: 'Overview',
          systemInfo: mockSystemInfo,
        }),
      );

      expect(html).toContain('role="status"');
      expect(html).toContain('IPC Connected');
      expect(html).toContain('(5ms)');
      expect(html).toContain('App: v0.1.0');
      expect(html).toContain('Electron: 44.10.2');
      expect(html).toContain('Node: 22.11.0');
      expect(html).toContain('Chrome: 130.0.6723.137');
      expect(html).toContain('win32 (x64)');
      // Strictly no fabricated fields
      expect(html).not.toContain('V8');
      expect(html).not.toContain('confinement');
    });

    it('renders loading state when systemInfo is null', () => {
      const html = renderComponentToHtml(
        React.createElement(StatusBar, {
          connected: false,
          latencyMs: null,
          activeViewTitle: 'Overview',
          systemInfo: null,
        }),
      );

      expect(html).toContain('Runtime Metadata Loading...');
      expect(html).toContain('IPC Offline');
    });
  });

  describe('AppShell Component', () => {
    it('composes Header, Sidebar, Viewport, and StatusBar', () => {
      const html = renderComponentToHtml(
        React.createElement(
          AppShell,
          {
            activeView: 'overview',
            activeViewTitle: 'Overview',
            onSelectView: vi.fn(),
            connected: true,
            latencyMs: 8,
            systemInfo: null,
          },
          React.createElement('div', { id: 'test-viewport-content' }, 'Main View Content'),
        ),
      );

      expect(html).toContain('class="auditor-shell"');
      expect(html).toContain('class="auditor-header"');
      expect(html).toContain('class="auditor-sidebar"');
      expect(html).toContain('class="auditor-viewport"');
      expect(html).toContain('id="test-viewport-content"');
      expect(html).toContain('class="auditor-statusbar"');
    });
  });
});
