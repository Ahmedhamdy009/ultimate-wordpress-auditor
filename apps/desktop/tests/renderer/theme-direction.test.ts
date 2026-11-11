import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import { ProjectsView } from '../../src/renderer/src/components/views/ProjectsView.js';
import type { ProjectListResponseDTO, SiteListResponseDTO } from '@auditor/shared';

describe('Phase 2.2 — Theme & Language Direction Verification', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).electronAPI = {
      listProjects: vi.fn().mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 'p-1',
              name: 'مشروع الفحص التجريبي',
              description: 'وصف المشروع بالعربية',
              isArchived: false,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        } satisfies ProjectListResponseDTO,
      }),
      listSites: vi.fn().mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 's-1',
              projectId: 'p-1',
              name: 'الموقع الرئيسي',
              baseUrl: 'https://example.com/',
              platformType: 'wordpress',
              environmentType: 'production',
              description: null,
              isArchived: false,
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        } satisfies SiteListResponseDTO,
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).electronAPI;
  });

  describe('CSS Token Architecture & Theme Support', () => {
    const desktopRoot = path.resolve(import.meta.dirname, '../..');
    const tokensCss = fs.readFileSync(
      path.join(desktopRoot, 'src/renderer/src/styles/tokens.css'),
      'utf-8',
    );
    const layoutCss = fs.readFileSync(
      path.join(desktopRoot, 'src/renderer/src/styles/layout.css'),
      'utf-8',
    );

    it('defines base dark mode tokens and explicit light mode token overrides', () => {
      // Dark mode default tokens under :root
      expect(tokensCss).toMatch(/:root\s*\{/);
      expect(tokensCss).toContain('--auditor-bg-base: #0b0f19;');
      expect(tokensCss).toContain('--auditor-text-primary: #f8fafc;');

      // Light mode overrides under :root[data-theme='light']
      expect(tokensCss).toMatch(/:root\[data-theme=['"]light['"]\]/);
      expect(tokensCss).toContain('--auditor-bg-base: #f8fafc;');
      expect(tokensCss).toContain('--auditor-text-primary: #0f172a;');
      expect(tokensCss).toContain('--auditor-bg-surface: #ffffff;');
      expect(tokensCss).toContain('--auditor-border-default: #cbd5e1;');
    });

    it('enforces bidirectional layout rules and logical CSS properties in layout.css', () => {
      expect(layoutCss).toContain("[dir='rtl']");
      expect(layoutCss).toContain("[dir='ltr']");
      expect(layoutCss).toContain('direction: rtl;');
      expect(layoutCss).toContain('direction: ltr;');

      // Logical layout properties used for sidebar border and button alignment
      expect(layoutCss).toContain('border-inline-end: 1px solid var(--auditor-border-subtle);');
      expect(layoutCss).toContain('text-align: start;');
    });
  });

  describe('DOM Rendering in RTL / Arabic Mode', () => {
    it('renders ProjectsView cleanly within an RTL container without broken elements', () => {
      const html = renderComponentToHtml(
        React.createElement('div', { dir: 'rtl', lang: 'ar' }, React.createElement(ProjectsView)),
      );

      expect(html).toContain('dir="rtl"');
      expect(html).toContain('lang="ar"');
      expect(html).toContain('Create New Project');
      expect(html).toContain('Existing Projects');
      expect(html).toContain('auditor-projects-view');
    });
  });

  describe('DOM Rendering in LTR / English Mode', () => {
    it('renders ProjectsView cleanly within an LTR container', () => {
      const html = renderComponentToHtml(
        React.createElement('div', { dir: 'ltr', lang: 'en' }, React.createElement(ProjectsView)),
      );

      expect(html).toContain('dir="ltr"');
      expect(html).toContain('lang="en"');
      expect(html).toContain('Create New Project');
      expect(html).toContain('Existing Projects');
    });
  });

  describe('Theme Attributes Compatibility', () => {
    it('renders cleanly under dark mode theme container', () => {
      const html = renderComponentToHtml(
        React.createElement('div', { 'data-theme': 'dark' }, React.createElement(ProjectsView)),
      );

      expect(html).toContain('data-theme="dark"');
      expect(html).toContain('auditor-card');
      expect(html).toContain('auditor-form');
    });

    it('renders cleanly under light mode theme container', () => {
      const html = renderComponentToHtml(
        React.createElement('div', { 'data-theme': 'light' }, React.createElement(ProjectsView)),
      );

      expect(html).toContain('data-theme="light"');
      expect(html).toContain('auditor-card');
      expect(html).toContain('auditor-form');
    });
  });
});
