import crypto from 'node:crypto';
import type { DatabaseConnection } from '../connection.js';
import type { ArchiveProjectResultDTO, ProjectDTO, ProjectListResponseDTO } from '@auditor/shared';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  is_archived: number;
  created_at: string;
  updated_at: string;
  site_count?: number;
}

export class ProjectRepository {
  private readonly connection: DatabaseConnection;

  constructor(connection: DatabaseConnection) {
    this.connection = connection;
  }

  private mapRowToDTO(row: ProjectRow): ProjectDTO {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isArchived: row.is_archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.site_count !== undefined ? { siteCount: Number(row.site_count) } : {}),
    };
  }

  /**
   * Checks whether an active (non-archived) project with the same name already exists.
   */
  public isNameTaken(name: string, excludeId?: string): boolean {
    const rawDb = this.connection.getRawDb();
    const trimmed = name.trim();
    if (excludeId) {
      const row = rawDb
        .prepare(
          'SELECT 1 FROM projects WHERE LOWER(name) = LOWER(?) AND is_archived = 0 AND id != ? LIMIT 1',
        )
        .get(trimmed, excludeId);
      return Boolean(row);
    }
    const row = rawDb
      .prepare('SELECT 1 FROM projects WHERE LOWER(name) = LOWER(?) AND is_archived = 0 LIMIT 1')
      .get(trimmed);
    return Boolean(row);
  }

  /**
   * Creates a new project.
   */
  public create(data: { name: string; description?: string | null }): ProjectDTO {
    const rawDb = this.connection.getRawDb();
    const trimmedName = data.name.trim();

    if (this.isNameTaken(trimmedName)) {
      throw new Error(
        `ERR_PROJECT_NAME_EXISTS: An active project named '${trimmedName}' already exists`,
      );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const description =
      data.description !== undefined && data.description !== null && data.description.trim() !== ''
        ? data.description.trim()
        : null;

    try {
      rawDb
        .prepare(
          `INSERT INTO projects (id, name, description, is_archived, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?)`,
        )
        .run(id, trimmedName, description, now, now);

      return {
        id,
        name: trimmedName,
        description,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
        siteCount: 0,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new Error(
          `ERR_PROJECT_NAME_EXISTS: An active project named '${trimmedName}' already exists`,
          {
            cause: err,
          },
        );
      }
      throw err;
    }
  }

  /**
   * Retrieves a project by ID, including its active site count.
   */
  public getById(id: string): ProjectDTO | null {
    const rawDb = this.connection.getRawDb();
    const row = rawDb
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM sites s WHERE s.project_id = p.id AND s.is_archived = 0) AS site_count
         FROM projects p
         WHERE p.id = ?`,
      )
      .get(id) as ProjectRow | undefined;

    if (!row) {
      return null;
    }
    return this.mapRowToDTO(row);
  }

  /**
   * Lists projects with bounded pagination, optional search, and archive filtering.
   */
  public list(
    options: {
      includeArchived?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): ProjectListResponseDTO {
    const rawDb = this.connection.getRawDb();
    const limit = Math.max(1, Math.min(100, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    const includeArchived = options.includeArchived ?? false;
    const search = options.search?.trim();

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (!includeArchived) {
      whereClauses.push('p.is_archived = 0');
    }

    if (search && search.length > 0) {
      whereClauses.push('LOWER(p.name) LIKE ?');
      // Escape SQL LIKE wildcards % and _
      const escaped = search.replace(/[%_]/g, '\\$&');
      params.push(`%${escaped.toLowerCase()}%`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = rawDb
      .prepare(`SELECT COUNT(*) as total FROM projects p ${whereSql}`)
      .get(...params) as { total: number };

    const total = Number(countRow?.total ?? 0);

    const rows = rawDb
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM sites s WHERE s.project_id = p.id AND s.is_archived = 0) AS site_count
         FROM projects p
         ${whereSql}
         ORDER BY p.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ProjectRow[];

    return {
      items: rows.map(r => this.mapRowToDTO(r)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Updates an existing project.
   * Preserves description if omitted. Normalizes empty or null to null.
   */
  public update(
    id: string,
    data: {
      name?: string;
      description?: string | null;
    },
  ): ProjectDTO {
    const rawDb = this.connection.getRawDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`ERR_PROJECT_NOT_FOUND: Project with ID '${id}' not found`);
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    const now = new Date().toISOString();

    let newName = existing.name;
    if (data.name !== undefined) {
      const trimmedName = data.name.trim();
      if (trimmedName.length === 0) {
        throw new Error('ERR_DATABASE_ERROR: Project name cannot be empty');
      }
      if (!existing.isArchived && this.isNameTaken(trimmedName, id)) {
        throw new Error(
          `ERR_PROJECT_NAME_EXISTS: An active project named '${trimmedName}' already exists`,
        );
      }
      newName = trimmedName;
      updates.push('name = ?');
      params.push(trimmedName);
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
      rawDb.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new Error(
          `ERR_PROJECT_NAME_EXISTS: An active project named '${newName}' already exists`,
          {
            cause: err,
          },
        );
      }
      throw err;
    }

    return {
      id,
      name: newName,
      description: newDescription,
      isArchived: existing.isArchived,
      createdAt: existing.createdAt,
      updatedAt: now,
      siteCount: existing.siteCount,
    };
  }

  /**
   * Atomically archives a project and its active child sites inside a single transaction.
   */
  public archive(id: string): ArchiveProjectResultDTO {
    const rawDb = this.connection.getRawDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`ERR_PROJECT_NOT_FOUND: Project with ID '${id}' not found`);
    }

    if (existing.isArchived) {
      return {
        archivedProjectId: id,
        archivedSiteCount: 0,
      };
    }

    return this.connection.transaction(() => {
      const now = new Date().toISOString();

      // Archive project
      rawDb
        .prepare('UPDATE projects SET is_archived = 1, updated_at = ? WHERE id = ?')
        .run(now, id);

      // Cascade archival to active child sites only
      const result = rawDb
        .prepare(
          'UPDATE sites SET is_archived = 1, updated_at = ? WHERE project_id = ? AND is_archived = 0',
        )
        .run(now, id);

      return {
        archivedProjectId: id,
        archivedSiteCount: Number(result.changes),
      };
    });
  }

  /**
   * Restores an archived project.
   * Checks for active-name collisions.
   * Does NOT automatically restore child sites.
   */
  public restore(id: string): ProjectDTO {
    const rawDb = this.connection.getRawDb();
    const existing = this.getById(id);
    if (!existing) {
      throw new Error(`ERR_PROJECT_NOT_FOUND: Project with ID '${id}' not found`);
    }

    if (!existing.isArchived) {
      return existing;
    }

    if (this.isNameTaken(existing.name, id)) {
      throw new Error(
        `ERR_PROJECT_NAME_EXISTS: Cannot restore project. An active project named '${existing.name}' already exists`,
      );
    }

    const now = new Date().toISOString();
    try {
      rawDb
        .prepare('UPDATE projects SET is_archived = 0, updated_at = ? WHERE id = ?')
        .run(now, id);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        throw new Error(
          `ERR_PROJECT_NAME_EXISTS: Cannot restore project. An active project named '${existing.name}' already exists`,
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
