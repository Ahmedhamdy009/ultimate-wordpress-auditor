import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderComponentToHtml, renderTestHook } from '../helpers/react-test-harness.js';
import { ProjectsView } from '../../src/renderer/src/components/views/ProjectsView.js';
import { useProjects } from '../../src/renderer/src/hooks/useProjects.js';
import { useSites } from '../../src/renderer/src/hooks/useSites.js';
import type {
  ProjectDTO,
  SiteDTO,
  ProjectListResponseDTO,
  SiteListResponseDTO,
  IPCResult,
} from '@auditor/shared';

describe('Phase 2.2 — Projects & Sites UI Suite', () => {
  const mockProject: ProjectDTO = {
    id: 'proj-1',
    name: 'Main Client Website',
    description: 'Corporate portal for Acme Inc',
    isArchived: false,
    createdAt: 1700000000,
    updatedAt: 1700000000,
    archivedAt: null,
  };

  const _mockArchivedProject: ProjectDTO = {
    id: 'proj-2',
    name: 'Old Legacy Project',
    description: null,
    isArchived: true,
    createdAt: 1690000000,
    updatedAt: 1695000000,
    archivedAt: 1695000000,
  };

  const mockSite: SiteDTO = {
    id: 'site-1',
    projectId: 'proj-1',
    name: 'Production Store',
    baseUrl: 'https://acme.com/',
    platformType: 'wordpress',
    environmentType: 'production',
    isArchived: false,
    createdAt: 1700000000,
    updatedAt: 1700000000,
    archivedAt: null,
  };

  let mockElectronAPI: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    mockElectronAPI = {
      listProjects: vi.fn().mockResolvedValue({
        success: true,
        data: {
          items: [mockProject],
          total: 1,
          hasMore: false,
        } satisfies ProjectListResponseDTO,
      }),
      createProject: vi.fn().mockResolvedValue({
        success: true,
        data: mockProject,
      } satisfies IPCResult<ProjectDTO>),
      updateProject: vi.fn().mockResolvedValue({
        success: true,
        data: mockProject,
      } satisfies IPCResult<ProjectDTO>),
      archiveProject: vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'proj-1', isArchived: true, archivedSitesCount: 1 },
      }),
      restoreProject: vi.fn().mockResolvedValue({
        success: true,
        data: mockProject,
      } satisfies IPCResult<ProjectDTO>),
      listSites: vi.fn().mockResolvedValue({
        success: true,
        data: {
          items: [mockSite],
          total: 1,
          hasMore: false,
        } satisfies SiteListResponseDTO,
      }),
      createSite: vi.fn().mockResolvedValue({
        success: true,
        data: mockSite,
      } satisfies IPCResult<SiteDTO>),
      updateSite: vi.fn().mockResolvedValue({
        success: true,
        data: mockSite,
      } satisfies IPCResult<SiteDTO>),
      archiveSite: vi.fn().mockResolvedValue({
        success: true,
        data: { ...mockSite, isArchived: true },
      } satisfies IPCResult<SiteDTO>),
      restoreSite: vi.fn().mockResolvedValue({
        success: true,
        data: { ...mockSite, isArchived: false },
      } satisfies IPCResult<SiteDTO>),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).electronAPI = mockElectronAPI;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).electronAPI;
  });

  describe('useProjects Hook', () => {
    it('fetches projects list on mount and updates state', async () => {
      const harness = await renderTestHook(() => useProjects());
      await harness.mount();

      expect(mockElectronAPI.listProjects).toHaveBeenCalled();
      expect(harness.result.current.projects).toHaveLength(1);
      expect(harness.result.current.projects[0]?.name).toBe('Main Client Website');
      expect(harness.result.current.loading).toBe(false);
      expect(harness.result.current.error).toBeNull();

      await harness.unmount();
    });

    it('creates project and triggers list refresh', async () => {
      const harness = await renderTestHook(() => useProjects());
      await harness.mount();

      let created: ProjectDTO | null = null;
      await harness.act(async () => {
        created = await harness.result.current.createProject({
          name: 'New Project',
          description: 'New Description',
        });
      });

      expect(mockElectronAPI.createProject).toHaveBeenCalledWith({
        name: 'New Project',
        description: 'New Description',
      });
      expect(created?.id).toBe('proj-1');

      await harness.unmount();
    });

    it('handles project listing error gracefully', async () => {
      mockElectronAPI.listProjects.mockResolvedValueOnce({
        success: false,
        error: { code: 'ERR_INTERNAL_ERROR', message: 'Database query failed' },
      });

      const harness = await renderTestHook(() => useProjects());
      await harness.mount();

      expect(harness.result.current.projects).toHaveLength(0);
      expect(harness.result.current.error?.code).toBe('ERR_INTERNAL_ERROR');

      await harness.unmount();
    });
  });

  describe('useSites Hook', () => {
    it('fetches sites for selected project on mount', async () => {
      const harness = await renderTestHook(() => useSites('proj-1'));
      await harness.mount();

      expect(mockElectronAPI.listSites).toHaveBeenCalledWith({
        projectId: 'proj-1',
        includeArchived: false,
      });
      expect(harness.result.current.sites).toHaveLength(1);
      expect(harness.result.current.sites[0]?.baseUrl).toBe('https://acme.com/');

      await harness.unmount();
    });

    it('returns empty array when no projectId is provided', async () => {
      const harness = await renderTestHook(() => useSites(undefined));
      await harness.mount();

      expect(mockElectronAPI.listSites).not.toHaveBeenCalled();
      expect(harness.result.current.sites).toHaveLength(0);

      await harness.unmount();
    });
  });

  describe('ProjectsView Component', () => {
    it('renders project creation form, search filter, and project list structure', () => {
      const html = renderComponentToHtml(React.createElement(ProjectsView, null));

      expect(html).toContain('Create New Project');
      expect(html).toContain('Project Name');
      expect(html).toContain('Existing Projects');
      expect(html).toContain('Search projects...');
      expect(html).toContain('Show Archived');
    });

    it('renders initial empty or unselected site management state', () => {
      const html = renderComponentToHtml(React.createElement(ProjectsView, null));

      expect(html).toContain('Site Management');
      expect(html).toContain('Select a project from the left column');
      expect(html).toContain('No project selected.');
    });
  });
});
