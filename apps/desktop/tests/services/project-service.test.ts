import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { ProjectService } from '../../src/main/services/project.service.js';
import { IPCError, IPC_ERROR_CODES } from '@auditor/shared';

describe('ProjectService Domain Layer', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let service: ProjectService;

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();
    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    service = new ProjectService(projectRepo);
  });

  afterEach(() => {
    connection.close();
  });

  it('creates a project with trimmed name and description', () => {
    const created = service.createProject({
      name: '  Alpha E-Commerce  ',
      description: '  Main store project  ',
    });

    expect(created.id).toBeDefined();
    expect(created.name).toBe('Alpha E-Commerce');
    expect(created.description).toBe('Main store project');
    expect(created.isArchived).toBe(false);
    expect(created.siteCount).toBe(0);
  });

  it('rejects duplicate active project names with ERR_PROJECT_NAME_EXISTS', () => {
    service.createProject({ name: 'Unique Project' });

    expect(() => {
      service.createProject({ name: 'unique project' });
    }).toThrowError(IPCError);

    try {
      service.createProject({ name: 'UNIQUE PROJECT' });
    } catch (err) {
      expect(err instanceof IPCError).toBe(true);
      expect((err as IPCError).code).toBe(IPC_ERROR_CODES.PROJECT_NAME_EXISTS);
    }
  });

  it('retrieves an existing project by ID and includes active site count', () => {
    const created = service.createProject({ name: 'Client Portal' });
    siteRepo.create({
      projectId: created.id,
      name: 'Production Blog',
      baseUrl: 'https://client.com',
    });

    const retrieved = service.getProjectById({ id: created.id });
    expect(retrieved.id).toBe(created.id);
    expect(retrieved.name).toBe('Client Portal');
    expect(retrieved.siteCount).toBe(1);
  });

  it('throws ERR_PROJECT_NOT_FOUND when retrieving nonexistent project', () => {
    expect(() => {
      service.getProjectById({ id: '00000000-0000-0000-0000-000000000000' });
    }).toThrowError(IPCError);

    try {
      service.getProjectById({ id: '00000000-0000-0000-0000-000000000000' });
    } catch (err) {
      expect((err as IPCError).code).toBe(IPC_ERROR_CODES.PROJECT_NOT_FOUND);
    }
  });

  it('lists projects with pagination and search', () => {
    service.createProject({ name: 'WordPress Core Audit' });
    service.createProject({ name: 'WooCommerce Store' });
    service.createProject({ name: 'Security Baseline' });

    const searchRes = service.listProjects({ search: 'Audit' });
    expect(searchRes.items.length).toBe(1);
    expect(searchRes.items[0].name).toBe('WordPress Core Audit');
    expect(searchRes.total).toBe(1);

    const paginated = service.listProjects({ limit: 2, offset: 0 });
    expect(paginated.items.length).toBe(2);
    expect(paginated.total).toBe(3);
  });

  it('updates project metadata and rejects name collisions with existing active projects', () => {
    const p1 = service.createProject({ name: 'Project 1' });
    const p2 = service.createProject({ name: 'Project 2' });

    const updated = service.updateProject({
      id: p1.id,
      name: 'Project 1 Renamed',
      description: 'Updated description',
    });
    expect(updated.name).toBe('Project 1 Renamed');
    expect(updated.description).toBe('Updated description');

    // Attempting to rename p2 to p1's name should fail
    expect(() => {
      service.updateProject({ id: p2.id, name: 'Project 1 Renamed' });
    }).toThrowError(IPCError);
  });

  it('atomically archives a project and cascades archival to active child sites', () => {
    const project = service.createProject({ name: 'Cascade Target' });
    const site1 = siteRepo.create({
      projectId: project.id,
      name: 'Site 1',
      baseUrl: 'https://site1.com',
    });
    const site2 = siteRepo.create({
      projectId: project.id,
      name: 'Site 2',
      baseUrl: 'https://site2.com',
    });

    const archiveResult = service.archiveProject({ id: project.id });
    expect(archiveResult.archivedProjectId).toBe(project.id);
    expect(archiveResult.archivedSiteCount).toBe(2);

    const projectAfter = service.getProjectById({ id: project.id });
    expect(projectAfter.isArchived).toBe(true);

    const site1After = siteRepo.getById(site1.id);
    const site2After = siteRepo.getById(site2.id);
    expect(site1After?.isArchived).toBe(true);
    expect(site2After?.isArchived).toBe(true);
  });

  it('restores an archived project without automatically restoring its child sites', () => {
    const project = service.createProject({ name: 'Restore Target' });
    const site = siteRepo.create({
      projectId: project.id,
      name: 'Child Site',
      baseUrl: 'https://child.com',
    });

    service.archiveProject({ id: project.id });

    const restored = service.restoreProject({ id: project.id });
    expect(restored.isArchived).toBe(false);

    // Child site remains archived per architecture specification
    const siteAfter = siteRepo.getById(site.id);
    expect(siteAfter?.isArchived).toBe(true);
  });

  it('rejects restoring a project if another active project now holds that name', () => {
    const p1 = service.createProject({ name: 'Contested Name' });
    service.archiveProject({ id: p1.id });

    // New project created with same name while p1 is archived
    service.createProject({ name: 'Contested Name' });

    expect(() => {
      service.restoreProject({ id: p1.id });
    }).toThrowError(IPCError);

    try {
      service.restoreProject({ id: p1.id });
    } catch (err) {
      expect((err as IPCError).code).toBe(IPC_ERROR_CODES.PROJECT_NAME_EXISTS);
    }
  });
});
