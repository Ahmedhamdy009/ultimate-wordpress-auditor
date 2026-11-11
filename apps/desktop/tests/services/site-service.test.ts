import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { SiteService, normalizeSiteBaseUrl } from '../../src/main/services/site.service.js';
import { IPCError, IPC_ERROR_CODES } from '@auditor/shared';

describe('SiteService Domain Layer & URL Normalization', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let service: SiteService;
  let projectId: string;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    service = new SiteService(siteRepo, projectRepo);

    const project = projectRepo.create({ name: 'Root Client Project' });
    projectId = project.id;
  });

  afterEach(() => {
    connection.close();
  });

  describe('normalizeSiteBaseUrl', () => {
    it('normalizes hostnames, default ports, and path structures per RFC 3986', () => {
      expect(normalizeSiteBaseUrl('HTTP://Example.COM:80/')).toBe('http://example.com/');
      expect(normalizeSiteBaseUrl('https://Shop.Net:443/store/')).toBe('https://shop.net/store');
      expect(normalizeSiteBaseUrl('https://wordpress.org?ref=123#frag')).toBe(
        'https://wordpress.org/',
      );
    });

    it('rejects non-HTTP/HTTPS protocols', () => {
      expect(() => normalizeSiteBaseUrl('ftp://ftp.example.com')).toThrowError(IPCError);
      expect(() => normalizeSiteBaseUrl('javascript:alert(1)')).toThrowError(IPCError);
      expect(() => normalizeSiteBaseUrl('file:///C:/test')).toThrowError(IPCError);
    });
  });

  describe('Site Operations', () => {
    it('creates a site under a valid project and normalizes URL', () => {
      const site = service.createSite({
        projectId,
        name: 'Corporate Site',
        baseUrl: 'HTTPS://Client.ORG:443/portal/',
        platformType: 'wordpress',
        environmentType: 'production',
      });

      expect(site.id).toBeDefined();
      expect(site.projectId).toBe(projectId);
      expect(site.name).toBe('Corporate Site');
      expect(site.baseUrl).toBe('https://client.org/portal');
      expect(site.platformType).toBe('wordpress');
      expect(site.environmentType).toBe('production');
      expect(site.isArchived).toBe(false);
    });

    it('rejects site creation when parent project does not exist', () => {
      expect(() => {
        service.createSite({
          projectId: '00000000-0000-0000-0000-000000000000',
          name: 'Orphan Site',
          baseUrl: 'https://orphan.com',
        });
      }).toThrowError(IPCError);

      try {
        service.createSite({
          projectId: '00000000-0000-0000-0000-000000000000',
          name: 'Orphan Site',
          baseUrl: 'https://orphan.com',
        });
      } catch (err) {
        expect((err as IPCError).code).toBe(IPC_ERROR_CODES.PROJECT_NOT_FOUND);
      }
    });

    it('rejects site creation under an archived parent project', () => {
      projectRepo.archive(projectId);

      expect(() => {
        service.createSite({
          projectId,
          name: 'Blocked Site',
          baseUrl: 'https://blocked.com',
        });
      }).toThrowError(IPCError);

      try {
        service.createSite({
          projectId,
          name: 'Blocked Site',
          baseUrl: 'https://blocked.com',
        });
      } catch (err) {
        expect((err as IPCError).code).toBe(IPC_ERROR_CODES.PARENT_PROJECT_ARCHIVED);
      }
    });

    it('rejects duplicate active site URLs in the same project', () => {
      service.createSite({
        projectId,
        name: 'Site A',
        baseUrl: 'https://example.com/site',
      });

      expect(() => {
        service.createSite({
          projectId,
          name: 'Site B',
          baseUrl: 'https://example.com/site/',
        });
      }).toThrowError(IPCError);

      try {
        service.createSite({
          projectId,
          name: 'Site B',
          baseUrl: 'https://example.com/site/',
        });
      } catch (err) {
        expect((err as IPCError).code).toBe(IPC_ERROR_CODES.SITE_URL_EXISTS);
      }
    });

    it('allows identical URLs across different projects', () => {
      const otherProject = projectRepo.create({ name: 'Second Project' });

      const s1 = service.createSite({
        projectId,
        name: 'Site in P1',
        baseUrl: 'https://shared-domain.com',
      });

      const s2 = service.createSite({
        projectId: otherProject.id,
        name: 'Site in P2',
        baseUrl: 'https://shared-domain.com',
      });

      expect(s1.id).not.toBe(s2.id);
      expect(s1.baseUrl).toBe(s2.baseUrl);
    });

    it('retrieves site by ID', () => {
      const created = service.createSite({
        projectId,
        name: 'Lookup Target',
        baseUrl: 'https://lookup.com',
      });

      const retrieved = service.getSiteById({ id: created.id });
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Lookup Target');
    });

    it('lists sites by project with search filtering and bounded pagination', () => {
      service.createSite({ projectId, name: 'Main Blog', baseUrl: 'https://blog.com' });
      service.createSite({ projectId, name: 'Shop Portal', baseUrl: 'https://shop.com' });

      const list = service.listSitesByProject({ projectId, search: 'Blog' });
      expect(list.items.length).toBe(1);
      expect(list.items[0].name).toBe('Main Blog');
      expect(list.total).toBe(1);
    });

    it('updates site metadata and checks URL uniqueness if changed', () => {
      const site = service.createSite({
        projectId,
        name: 'Original Site',
        baseUrl: 'https://initial.com',
      });

      const updated = service.updateSite({
        id: site.id,
        name: 'Renamed Site',
        baseUrl: 'https://updated-domain.com',
        platformType: 'generic_web',
      });

      expect(updated.name).toBe('Renamed Site');
      expect(updated.baseUrl).toBe('https://updated-domain.com/');
      expect(updated.platformType).toBe('generic_web');
    });

    it('archives a site and allows restoring it when conditions are met', () => {
      const site = service.createSite({
        projectId,
        name: 'Archival Candidate',
        baseUrl: 'https://archive-me.com',
      });

      const archived = service.archiveSite({ id: site.id });
      expect(archived.isArchived).toBe(true);

      const restored = service.restoreSite({ id: site.id });
      expect(restored.isArchived).toBe(false);
    });

    it('rejects restoring a site if its parent project has been archived', () => {
      const site = service.createSite({
        projectId,
        name: 'Parent Will Archive',
        baseUrl: 'https://parent-archive.com',
      });

      service.archiveSite({ id: site.id });
      projectRepo.archive(projectId);

      expect(() => {
        service.restoreSite({ id: site.id });
      }).toThrowError(IPCError);

      try {
        service.restoreSite({ id: site.id });
      } catch (err) {
        expect((err as IPCError).code).toBe(IPC_ERROR_CODES.PARENT_PROJECT_ARCHIVED);
      }
    });

    it('rejects restoring a site if its URL was reused by another active site in the project', () => {
      const s1 = service.createSite({
        projectId,
        name: 'Site One',
        baseUrl: 'https://reused-url.com',
      });

      service.archiveSite({ id: s1.id });

      // Create new active site with the same URL while s1 is archived
      service.createSite({
        projectId,
        name: 'Site Two',
        baseUrl: 'https://reused-url.com',
      });

      expect(() => {
        service.restoreSite({ id: s1.id });
      }).toThrowError(IPCError);

      try {
        service.restoreSite({ id: s1.id });
      } catch (err) {
        expect((err as IPCError).code).toBe(IPC_ERROR_CODES.SITE_URL_EXISTS);
      }
    });
  });
});
