import crypto from 'node:crypto';
import path from 'node:path';
import type { DatabaseConnection } from '../connection.js';
import {
  type ReportDTO,
  type ReportListResponseDTO,
  type ReportFormat,
  type ReportStatus,
} from '@auditor/shared';

interface ReportRow {
  id: string;
  scan_run_id: string;
  title: string;
  format: string;
  status: string;
  summary_json: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
}

export class ReportRepository {
  private readonly connection: DatabaseConnection;

  constructor(connection: DatabaseConnection) {
    this.connection = connection;
  }

  private mapRowToDTO(row: ReportRow): ReportDTO {
    let summary: Record<string, unknown> | null = null;
    if (row.summary_json) {
      try {
        summary = JSON.parse(row.summary_json);
      } catch {
        summary = null;
      }
    }

    return {
      id: row.id,
      scanRunId: row.scan_run_id,
      title: row.title,
      format: row.format as ReportFormat,
      status: row.status as ReportStatus,
      summary,
      storagePath: row.storage_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Creates a new report record.
   */
  public create(data: {
    scanRunId: string;
    title: string;
    format: ReportFormat;
    summary?: Record<string, unknown> | null;
    storagePath?: string | null;
  }): ReportDTO {
    const rawDb = this.connection.getRawDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const summaryJson = data.summary ? JSON.stringify(data.summary) : null;
    const initialStatus: ReportStatus = data.storagePath ? 'generated' : 'pending';

    rawDb
      .prepare(
        `INSERT INTO reports (
          id, scan_run_id, title, format, status,
          summary_json, storage_path, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )`,
      )
      .run(
        id,
        data.scanRunId,
        data.title,
        data.format,
        initialStatus,
        summaryJson,
        data.storagePath ?? null,
        now,
        now,
      );

    return {
      id,
      scanRunId: data.scanRunId,
      title: data.title,
      format: data.format,
      status: initialStatus,
      summary: data.summary ?? null,
      storagePath: data.storagePath ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Retrieves a report by ID.
   */
  public getById(id: string): ReportDTO | null {
    const rawDb = this.connection.getRawDb();
    const row = rawDb.prepare('SELECT * FROM reports WHERE id = ? LIMIT 1').get(id) as
      ReportRow | undefined;

    return row ? this.mapRowToDTO(row) : null;
  }

  /**
   * Lists reports with optional filters and pagination.
   */
  public list(
    options: {
      scanRunId?: string;
      siteId?: string;
      status?: ReportStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): ReportListResponseDTO {
    const rawDb = this.connection.getRawDb();
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const offset = Math.max(0, options.offset ?? 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.scanRunId) {
      conditions.push('scan_run_id = ?');
      params.push(options.scanRunId);
    }
    if (options.siteId) {
      conditions.push('scan_run_id IN (SELECT id FROM scan_runs WHERE site_id = ?)');
      params.push(options.siteId);
    }
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = rawDb
      .prepare(`SELECT COUNT(*) as count FROM reports ${whereClause}`)
      .get(...params) as { count: number };
    const total = countRow ? Number(countRow.count) : 0;

    const rows = rawDb
      .prepare(
        `SELECT * FROM reports ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ReportRow[];

    return {
      items: rows.map(r => this.mapRowToDTO(r)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Updates report status, summary, and/or storagePath.
   */
  public updateStatus(
    id: string,
    status: ReportStatus,
    update?: {
      summary?: Record<string, unknown> | null;
      storagePath?: string | null;
    },
  ): ReportDTO {
    const rawDb = this.connection.getRawDb();
    const current = this.getById(id);
    if (!current) {
      throw new Error(`ERR_REPORT_NOT_FOUND: Report '${id}' not found`);
    }

    const now = new Date().toISOString();
    const summaryJson =
      update?.summary !== undefined
        ? update.summary
          ? JSON.stringify(update.summary)
          : null
        : current.summary
          ? JSON.stringify(current.summary)
          : null;

    const storagePath =
      update?.storagePath !== undefined ? update.storagePath : current.storagePath;

    rawDb
      .prepare(
        `UPDATE reports
         SET status = ?,
             summary_json = ?,
             storage_path = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(status, summaryJson, storagePath, now, id);

    const updated = this.getById(id);
    if (!updated) {
      throw new Error(`ERR_REPORT_NOT_FOUND: Report '${id}' missing after update`);
    }
    return updated;
  }

  /**
   * Counts reports for a scan run.
   */
  public countByScanRunId(scanRunId: string): number {
    const rawDb = this.connection.getRawDb();
    const row = rawDb
      .prepare('SELECT COUNT(*) as count FROM reports WHERE scan_run_id = ?')
      .get(scanRunId) as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  }

  /**
   * Deletes a report record by ID.
   * Returns true if deleted, false if not found.
   */
  public delete(id: string): boolean {
    const rawDb = this.connection.getRawDb();
    const result = rawDb.prepare('DELETE FROM reports WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Retrieves all non-null storage paths referenced by active reports in SQLite.
   * Used for safe filesystem orphan reconciliation.
   */
  public getAllStoragePaths(): Set<string> {
    const rawDb = this.connection.getRawDb();
    const rows = rawDb
      .prepare('SELECT storage_path FROM reports WHERE storage_path IS NOT NULL')
      .all() as Array<{ storage_path: string }>;
    return new Set(rows.map(r => path.resolve(r.storage_path)));
  }
}
