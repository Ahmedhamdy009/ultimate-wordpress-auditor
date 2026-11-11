import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';

describe('Project and Site Repositories', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const migrationRunner = new MigrationRunner(connection);
    await migrationRunner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
  });

  afterEach(() => {
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  describe('ProjectRepository', () => {
    it('creates a project and trims name and description', () => {
      const created = projectRepo.create({
        name: '  WordPress Security Audit  ',
        description: '  Primary corporate site  ',
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('WordPress Security Audit');
      expect(created.description).toBe('Primary corporate site');
      expect(created.isArchived).toBe(false);
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();
      expect(created.siteCount).toBe(0);

      const fetched = projectRepo.getById(created.id);
      expect(fetched).toEqual(created);
    });

    it('normalizes empty description to null on creation', () => {
      const p1 = projectRepo.create({ name: 'Proj 1', description: '   ' });
      expect(p1.description).toBeNull();

      const p2 = projectRepo.create({ name: 'Proj 2' });
      expect(p2.description).toBeNull();
    });

    it('enforces active-name uniqueness case-insensitively', () => {
      projectRepo.create({ name: 'Client Portal' });

      expect(() => {
        projectRepo.create({ name: 'client portal' });
      }).toThrow(/ERR_PROJECT_NAME_EXISTS/);

      expect(() => {
        projectRepo.create({ name: '  CLIENT PORTAL  ' });
      }).toThrow(/ERR_PROJECT_NAME_EXISTS/);
    });

    it('returns null when getting non-existent project', () => {
      expect(projectRepo.getById('00000000-0000-0000-0000-000000000000')).toBeNull();
    });

    it('lists projects with bounded pagination and search filtering', () => {
      for (let i = 1; i <= 5; i++) {
        projectRepo.create({ name: `Project ${i} Alpha`, description: `Desc ${i}` });
      }
      for (let i = 6; i <= 10; i++) {
        projectRepo.create({ name: `Project ${i} Beta`, description: `Desc ${i}` });
      }

      const all = projectRepo.list();
      expect(all.total).toBe(10);
      expect(all.items).toHaveLength(10);
      expect(all.limit).toBe(50);
      expect(all.offset).toBe(0);

      // Bounded pagination
      const paginated = projectRepo.list({ limit: 3, offset: 2 });
      expect(paginated.total).toBe(10);
      expect(paginated.items).toHaveLength(3);
      expect(paginated.offset).toBe(2);

      // Search filter
      const searchAlpha = projectRepo.list({ search: 'alpha' });
      expect(searchAlpha.total).toBe(5);
      expect(searchAlpha.items.every(p => p.name.includes('Alpha'))).toBe(true);

      // Search with SQL wildcards
      const searchSpecial = projectRepo.list({ search: 'Project %' });
      expect(searchSpecial.total).toBe(0); // Safely escaped, not treated as SQL wildcard
    });

    it('updates project fields and preserves omitted description', () => {
      const created = projectRepo.create({
        name: 'Initial Name',
        description: 'Important description',
      });

      // Update ONLY name (description omitted)
      const updatedNameOnly = projectRepo.update(created.id, {
        name: 'New Name',
      });

      expect(updatedNameOnly.name).toBe('New Name');
      expect(updatedNameOnly.description).toBe('Important description'); // Preserved!

      // Update ONLY description (name omitted)
      const updatedDescOnly = projectRepo.update(created.id, {
        description: 'Updated Description',
      });

      expect(updatedDescOnly.name).toBe('New Name'); // Preserved!
      expect(updatedDescOnly.description).toBe('Updated Description');

      // Clear description with null
      const clearedDesc = projectRepo.update(created.id, {
        description: null,
      });
      expect(clearedDesc.description).toBeNull();
    });

    it('rejects update with conflicting active project name', () => {
      const p1 = projectRepo.create({ name: 'Project One' });
      expect(p1.id).toBeDefined();
      const p2 = projectRepo.create({ name: 'Project Two' });

      expect(() => {
        projectRepo.update(p2.id, { name: 'PROJECT ONE' });
      }).toThrow(/ERR_PROJECT_NAME_EXISTS/);
    });

    it('atomically archives a project and cascades archival to active child sites', () => {
      const project = projectRepo.create({ name: 'Project Archival Test' });

      // Create two sites under this project
      const s1 = siteRepo.create({
        projectId: project.id,
        name: 'Site 1',
        baseUrl: 'https://site1.example.com',
      });
      const s2 = siteRepo.create({
        projectId: project.id,
        name: 'Site 2',
        baseUrl: 'https://site2.example.com',
      });

      // Pre-archive one site manually
      siteRepo.archive(s2.id);

      // Archive project
      const archiveResult = projectRepo.archive(project.id);
      expect(archiveResult.archivedProjectId).toBe(project.id);
      // Only site 1 was active, so active child sites count = 1
      expect(archiveResult.archivedSiteCount).toBe(1);

      const archivedProject = projectRepo.getById(project.id);
      expect(archivedProject?.isArchived).toBe(true);

      const archivedS1 = siteRepo.getById(s1.id);
      expect(archivedS1?.isArchived).toBe(true);

      // Excluded from default list
      const activeList = projectRepo.list();
      expect(activeList.items.some(p => p.id === project.id)).toBe(false);

      // Included when includeArchived = true
      const fullList = projectRepo.list({ includeArchived: true });
      expect(fullList.items.some(p => p.id === project.id)).toBe(true);

      // Now a new active project can be created with the same name!
      const newProjWithSameName = projectRepo.create({ name: 'Project Archival Test' });
      expect(newProjWithSameName.isArchived).toBe(false);
    });

    it('restores project without automatically restoring child sites', () => {
      const project = projectRepo.create({ name: 'Restore Test' });
      const site = siteRepo.create({
        projectId: project.id,
        name: 'Child Site',
        baseUrl: 'https://restore.example.com',
      });

      projectRepo.archive(project.id);

      const restoredProject = projectRepo.restore(project.id);
      expect(restoredProject.isArchived).toBe(false);

      // Child site must remain archived!
      const childSite = siteRepo.getById(site.id);
      expect(childSite?.isArchived).toBe(true);
    });

    it('rejects restoration if an active project with the same name now exists', () => {
      const p1 = projectRepo.create({ name: 'Colliding Name' });
      projectRepo.archive(p1.id);

      // Another active project is created with the same name
      projectRepo.create({ name: 'Colliding Name' });

      // Restoring p1 must fail due to collision
      expect(() => {
        projectRepo.restore(p1.id);
      }).toThrow(/ERR_PROJECT_NAME_EXISTS/);
    });
  });

  describe('SiteRepository', () => {
    let projectId: string;

    beforeEach(() => {
      const p = projectRepo.create({ name: 'Site Parent Project' });
      projectId = p.id;
    });

    it('creates a site under an active project with default platform and environment', () => {
      const site = siteRepo.create({
        projectId,
        name: 'Main WordPress Portal',
        baseUrl: 'https://example.com',
      });

      expect(site.id).toBeDefined();
      expect(site.projectId).toBe(projectId);
      expect(site.name).toBe('Main WordPress Portal');
      expect(site.baseUrl).toBe('https://example.com');
      expect(site.platformType).toBe('wordpress');
      expect(site.environmentType).toBe('production');
      expect(site.description).toBeNull();
      expect(site.isArchived).toBe(false);

      // Project siteCount should reflect 1 active site
      const project = projectRepo.getById(projectId);
      expect(project?.siteCount).toBe(1);
    });

    it('supports approved platform types (wordpress, generic_web, custom) and enforces CHECK constraint', () => {
      const genericSite = siteRepo.create({
        projectId,
        name: 'Generic Web App',
        baseUrl: 'https://generic.example.com',
        platformType: 'generic_web',
      });
      expect(genericSite.platformType).toBe('generic_web');

      const customSite = siteRepo.create({
        projectId,
        name: 'Custom CMS Site',
        baseUrl: 'https://custom.example.com',
        platformType: 'custom',
      });
      expect(customSite.platformType).toBe('custom');

      // Direct SQL attempt with unapproved platform type must fail SQLite CHECK constraint
      expect(() => {
        connection
          .getRawDb()
          .prepare(
            `INSERT INTO sites (id, project_id, name, base_url, platform_type, environment_type, is_archived, created_at, updated_at)
             VALUES ('unapproved-site-id', ?, 'Invalid Platform', 'https://invalid.example.com', 'other', 'production', 0, datetime('now'), datetime('now'))`,
          )
          .run(projectId);
      }).toThrow(/CHECK constraint failed/);
    });

    it('rejects site creation if parent project does not exist', () => {
      expect(() => {
        siteRepo.create({
          projectId: '00000000-0000-0000-0000-000000000000',
          name: 'Orphan Site',
          baseUrl: 'https://orphan.example.com',
        });
      }).toThrow(/ERR_PROJECT_NOT_FOUND/);
    });

    it('rejects site creation if parent project is archived', () => {
      projectRepo.archive(projectId);

      expect(() => {
        siteRepo.create({
          projectId,
          name: 'Site Under Archived',
          baseUrl: 'https://archived.example.com',
        });
      }).toThrow(/ERR_PARENT_PROJECT_ARCHIVED/);
    });

    it('enforces active-URL uniqueness within the same project', () => {
      siteRepo.create({
        projectId,
        name: 'Site A',
        baseUrl: 'https://mysite.com',
      });

      expect(() => {
        siteRepo.create({
          projectId,
          name: 'Site B with same URL',
          baseUrl: 'https://MYSITE.COM',
        });
      }).toThrow(/ERR_SITE_URL_EXISTS/);
    });

    it('allows same URL in different projects', () => {
      const otherProject = projectRepo.create({ name: 'Other Project' });

      siteRepo.create({
        projectId,
        name: 'Site in Proj 1',
        baseUrl: 'https://shared-url.com',
      });

      const site2 = siteRepo.create({
        projectId: otherProject.id,
        name: 'Site in Proj 2',
        baseUrl: 'https://shared-url.com',
      });

      expect(site2.id).toBeDefined();
    });

    it('lists sites by project with bounded pagination and search', () => {
      for (let i = 1; i <= 6; i++) {
        siteRepo.create({
          projectId,
          name: `Site ${i}`,
          baseUrl: `https://site-${i}.test.local`,
        });
      }

      const list = siteRepo.listByProject(projectId, { limit: 4, offset: 0 });
      expect(list.total).toBe(6);
      expect(list.items).toHaveLength(4);

      const searchByUrl = siteRepo.listByProject(projectId, { search: 'site-3' });
      expect(searchByUrl.total).toBe(1);
      expect(searchByUrl.items[0].baseUrl).toBe('https://site-3.test.local');
    });

    it('updates site and preserves omitted fields', () => {
      const site = siteRepo.create({
        projectId,
        name: 'Original Name',
        baseUrl: 'https://orig.example.com',
        description: 'Original Description',
      });

      const updated = siteRepo.update(site.id, {
        name: 'Modified Name',
      });

      expect(updated.name).toBe('Modified Name');
      expect(updated.baseUrl).toBe('https://orig.example.com'); // Preserved!
      expect(updated.description).toBe('Original Description'); // Preserved!
      expect(updated.platformType).toBe('wordpress'); // Preserved!
    });

    it('rejects site update with URL conflicting with another active site in the project', () => {
      siteRepo.create({
        projectId,
        name: 'Site 1',
        baseUrl: 'https://site1.example.com',
      });
      const s2 = siteRepo.create({
        projectId,
        name: 'Site 2',
        baseUrl: 'https://site2.example.com',
      });

      expect(() => {
        siteRepo.update(s2.id, { baseUrl: 'https://site1.example.com' });
      }).toThrow(/ERR_SITE_URL_EXISTS/);
    });

    it('archives site and allows reusing URL for new active site in the same project', () => {
      const site = siteRepo.create({
        projectId,
        name: 'Temporary Site',
        baseUrl: 'https://reuse.example.com',
      });

      siteRepo.archive(site.id);

      const archived = siteRepo.getById(site.id);
      expect(archived?.isArchived).toBe(true);

      // Now create new site with same URL
      const newSite = siteRepo.create({
        projectId,
        name: 'Replacement Site',
        baseUrl: 'https://reuse.example.com',
      });
      expect(newSite.isArchived).toBe(false);
    });

    it('rejects site restoration if parent project is archived', () => {
      const site = siteRepo.create({
        projectId,
        name: 'Site To Restore',
        baseUrl: 'https://site-parent-test.com',
      });

      siteRepo.archive(site.id);
      projectRepo.archive(projectId);

      expect(() => {
        siteRepo.restore(site.id);
      }).toThrow(/ERR_PARENT_PROJECT_ARCHIVED/);
    });

    it('rejects site restoration if active URL conflict exists', () => {
      const s1 = siteRepo.create({
        projectId,
        name: 'Old Site',
        baseUrl: 'https://conflict.example.com',
      });
      siteRepo.archive(s1.id);

      // Create new active site with same URL
      siteRepo.create({
        projectId,
        name: 'New Site',
        baseUrl: 'https://conflict.example.com',
      });

      // Restoration of s1 must fail
      expect(() => {
        siteRepo.restore(s1.id);
      }).toThrow(/ERR_SITE_URL_EXISTS/);
    });

    it('restores site successfully when parent is active and URL is available', () => {
      const site = siteRepo.create({
        projectId,
        name: 'Clean Restore',
        baseUrl: 'https://clean-restore.com',
      });

      siteRepo.archive(site.id);
      const restored = siteRepo.restore(site.id);
      expect(restored.isArchived).toBe(false);
    });
  });
});
