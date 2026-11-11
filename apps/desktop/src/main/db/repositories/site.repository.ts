import crypto from 'node:crypto';
import type { DatabaseConnection } from '../connection.js';
import type { EnvironmentType, PlatformType, SiteDTO, SiteListResponseDTO } from '@auditor/shared';

interface SiteRow {
  id: string;
  project_id: string;
  name: string;
  base_url: string;
  platform_type: string;
  environment_type: string;
  description: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

export class SiteRepository {
  private readonly connection: DatabaseConnection;

  constructor(connection: DatabaseConnection) {
    this.connection = connection;
  }

  private mapRowToDTO(row: SiteRow): SiteDTO {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      baseUrl: row.base_url,
      platformType: row.platform_type as PlatformType,
      environmentType: row.environment_type as EnvironmentType,
      description: row.description,
      isArchived: row.is_archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Checks whether an active site with the same base URL exists in the given project.
   */
  public isUrlTakenInProject(projectId: string, baseUrl: string, excludeId?: string): boolean {
    const rawDb = this.connection.getRawDb();
    const normalizedUrl = baseUrl.trim();
    if (excludeId) {
      const row = rawDb
        .prepare(
          `SELECT 1 FROM sites
           WHERE project_id = ? AND LOWER(base_url) = LOWER(?) AND is_archived = 0 AND id != ?
           LIMIT 1`,
        )
        .get(projectId, normalizedUrl, excludeId);
      return Boolean(row);
    }
    const row = rawDb
      .prepare(
        `SELECT 1 FROM sites
         WHERE project_id = ? AND LOWER(base_url) = LOWER(?) AND is_archived = 0
         LIMIT 1`,
      )
      .get(projectId, normalizedUrl);
    return Boolean(row);
  }

  /**
   * Creates a new site under a project.
   */
  public create(data: {
    projectId: string;
    name: string;
    baseUrl: string;
    platformType?: PlatformType;
    environmentType?: EnvironmentType;
    description?: string | null;
  }): SiteDTO {
    const rawDb = this.connection.getRawDb();

    // 1. Verify parent project exists and is not archived
    const project = rawDb
      .prepare('SELECT id, is_archived FROM projects WHERE id = ?')
      .get(data.projectId) as { id: string; is_archived: number } | undefined;

    if (!project) {
      throw new Error(
        `ERR_PROJECT_NOT_FOUND: Parent project with ID '${data.projectId}' not found`,
      );
    }

    if (project.is_archived === 1) {
      throw new Error(
        `ERR_PARENT_PROJECT_ARCHIVED: Cannot create a site under archived project '${data.projectId}'`,
      );
    }

    // 2. Verify active URL uniqueness within project
    const normalizedUrl = data.baseUrl.trim();
    if (this.isUrlTakenInProject(data.projectId, normalizedUrl)) {
      throw new Error(
        `ERR_SITE_URL_EXISTS: An active site with URL '${normalizedUrl}' already exists in this project`,
      );
    }

    const id = crypto.randomUUID();
    const trimmedName = data.name.trim();
    const platformType = data.platformType ?? 'wordpress';
    const environmentType = data.environmentType ?? 'production';
    const description =
      data.description !== undefined && data.description !== null && data.description.trim() !== ''
        ? data.description.trim()
        : null;
    const now = new Date().toISOString();

    try {
      rawDb
        .prepare(
          `INSERT INTO sites (id, project_id, name, base_url, platform_type, environment_type, description, is_archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          id,
          data.projectId,
          trimmedName,
          normalizedUrl,
          platformType,
          environmentType,
          description,
          now,
          now,
        );

      return {
        id,
        projectId: data.projectId,
        name: trimmedName,
        baseUrl: normalizedUrl,
        platformType,
        environmentType,
        description,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new Error(
          `ERR_SITE_URL_EXISTS: An active site with URL '${normalizedUrl}' already exists in this project`,
          { cause: err },
        );
      }
      throw err;
    }
  }

  /**
   * Retrieves a site by ID.
   */
  public getById(id: string): SiteDTO | null {
    const rawDb = this.connection.getRawDb();
    const row = rawDb.prepare('SELECT * FROM sites WHERE id = ?').get(id) as SiteRow | undefined;
    if (!row) {
      return null;
    }
    return this.mapRowToDTO(row);
  }

  /**
   * Lists sites belonging to a project with bounded pagination and optional filtering.
   */
  public listByProject(
    projectId: string,
    options: {
      includeArchived?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): SiteListResponseDTO {
    const rawDb = this.connection.getRawDb();

    // Verify project exists
    const projectExists = rawDb.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId);
    if (!projectExists) {
      throw new Error(`ERR_PROJECT_NOT_FOUND: Project with ID '${projectId}' not found`);
    }

    const limit = Math.max(1, Math.min(100, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    const includeArchived = options.includeArchived ?? false;
    const search = options.search?.trim();

    const whereClauses: string[] = ['project_id = ?'];
    const params: unknown[] = [projectId];

    if (!includeArchived) {
      whereClauses.push('is_archived = 0');
    }

    if (search && search.length > 0) {
      const escaped = search.replace(/[%_]/g, '\\$&').toLowerCase();
      whereClauses.push('(LOWER(name) LIKE ? OR LOWER(base_url) LIKE ?)');
      params.push(`%${escaped}%`, `%${escaped}%`);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    const countRow = rawDb
      .prepare(`SELECT COUNT(*) as total FROM sites ${whereSql}`)
      .get(...params) as { total: number };

    const total = Number(countRow?.total ?? 0);

    const rows = rawDb
      .prepare(
        `SELECT * FROM sites
         ${whereSql}
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as SiteRow[];

    return {
      items: rows.map(r => this.mapRowToDTO(r)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Updates an existing site.
   * Preserves omitted fields. Normalizes empty or null description to null.
   */
  public update(
    id: string,
    data: {
      name?: string;
      baseUrl?: string;
      platformType?: PlatformType;
      environmentType?: EnvironmentType;
      description?: string | null;
    },
  ): SiteDTO {
    const rawDb = this.connection.getRawDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`ERR_SITE_NOT_FOUND: Site with ID '${id}' not found`);
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    const now = new Date().toISOString();

    let newName = existing.name;
    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (trimmed.length === 0) {
        throw new Error('ERR_DATABASE_ERROR: Site name cannot be empty');
      }
      newName = trimmed;
      updates.push('name = ?');
      params.push(trimmed);
    }

    let newBaseUrl = existing.baseUrl;
    if (data.baseUrl !== undefined) {
      const trimmedUrl = data.baseUrl.trim();
      if (trimmedUrl.length === 0) {
        throw new Error('ERR_DATABASE_ERROR: Site base URL cannot be empty');
      }
      if (!existing.isArchived && this.isUrlTakenInProject(existing.projectId, trimmedUrl, id)) {
        throw new Error(
          `ERR_SITE_URL_EXISTS: An active site with URL '${trimmedUrl}' already exists in this project`,
        );
      }
      newBaseUrl = trimmedUrl;
      updates.push('base_url = ?');
      params.push(trimmedUrl);
    }

    let newPlatformType = existing.platformType;
    if (data.platformType !== undefined) {
      newPlatformType = data.platformType;
      updates.push('platform_type = ?');
      params.push(data.platformType);
    }

    let newEnvironmentType = existing.environmentType;
    if (data.environmentType !== undefined) {
      newEnvironmentType = data.environmentType;
      updates.push('environment_type = ?');
      params.push(data.environmentType);
    }

    let newDescription = existing.description;
    if (data.description !== undefined) {
      if (data.description === null || data.description.trim() === '') {
        newDescription = null;
      } else {
        newDescription = data.description.trim();
      }
      updates.push('description = ?');
      params.push(newDescription);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    try {
      rawDb.prepare(`UPDATE sites SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new Error(
          `ERR_SITE_URL_EXISTS: An active site with URL '${newBaseUrl}' already exists in this project`,
          { cause: err },
        );
      }
      throw err;
    }

    return {
      id,
      projectId: existing.projectId,
      name: newName,
      baseUrl: newBaseUrl,
      platformType: newPlatformType,
      environmentType: newEnvironmentType,
      description: newDescription,
      isArchived: existing.isArchived,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  }

  /**
   * Archives a site.
   */
  public archive(id: string): SiteDTO {
    const rawDb = this.connection.getRawDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`ERR_SITE_NOT_FOUND: Site with ID '${id}' not found`);
    }

    if (existing.isArchived) {
      return existing;
    }

    const now = new Date().toISOString();
    rawDb.prepare('UPDATE sites SET is_archived = 1, updated_at = ? WHERE id = ?').run(now, id);

    return {
      ...existing,
      isArchived: true,
      updatedAt: now,
    };
  }

  /**
   * Restores an archived site.
   * Rejects if parent project is archived.
   * Rejects if an active site with the same base URL already exists in the project.
   */
  public restore(id: string): SiteDTO {
    const rawDb = this.connection.getRawDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`ERR_SITE_NOT_FOUND: Site with ID '${id}' not found`);
    }

    if (!existing.isArchived) {
      return existing;
    }

    // 1. Verify parent project is not archived
    const project = rawDb
      .prepare('SELECT id, is_archived FROM projects WHERE id = ?')
      .get(existing.projectId) as { id: string; is_archived: number } | undefined;

    if (!project || project.is_archived === 1) {
      throw new Error(
        `ERR_PARENT_PROJECT_ARCHIVED: Cannot restore site '${id}' because its parent project is archived`,
      );
    }

    // 2. Verify active URL uniqueness
    if (this.isUrlTakenInProject(existing.projectId, existing.baseUrl, id)) {
      throw new Error(
        `ERR_SITE_URL_EXISTS: Cannot restore site. An active site with URL '${existing.baseUrl}' already exists in this project`,
      );
    }

    const now = new Date().toISOString();
    try {
      rawDb.prepare('UPDATE sites SET is_archived = 0, updated_at = ? WHERE id = ?').run(now, id);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new Error(
          `ERR_SITE_URL_EXISTS: Cannot restore site. An active site with URL '${existing.baseUrl}' already exists in this project`,
          { cause: err },
        );
      }
      throw err;
    }

    return {
      ...existing,
      isArchived: false,
      updatedAt: now,
    };
  }
}
