import crypto from 'node:crypto';
import type { DatabaseConnection } from '../connection.js';
import {
  type ScanRunDTO,
  type ScanRunListResponseDTO,
  type ScanRunStatus,
  type ScanRunType,
  type ScanRunSummaryDTO,
  type ScanRunErrorDTO,
  isValidScanRunTransition,
} from '@auditor/shared';

interface ScanRunRow {
  id: string;
  site_id: string;
  scan_type: string;
  status: string;
  target_url: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  duration_ms: number | null;
  config_json: string;
  summary_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
}

export class ScanRunRepository {
  private readonly connection: DatabaseConnection;

  constructor(connection: DatabaseConnection) {
    this.connection = connection;
  }

  private mapRowToDTO(row: ScanRunRow): ScanRunDTO {
    let config: Record<string, unknown> = {};
    if (row.config_json) {
      try {
        config = JSON.parse(row.config_json);
      } catch {
        config = {};
      }
    }

    let summary: ScanRunSummaryDTO | null = null;
    if (row.summary_json) {
      try {
        summary = JSON.parse(row.summary_json);
      } catch {
        summary = null;
      }
    }

    let error: ScanRunErrorDTO | null = null;
    if (row.error_json) {
      try {
        error = JSON.parse(row.error_json);
      } catch {
        error = null;
      }
    }

    return {
      id: row.id,
      siteId: row.site_id,
      scanType: row.scan_type as ScanRunType,
      status: row.status as ScanRunStatus,
      targetUrl: row.target_url,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      durationMs: row.duration_ms,
      config,
      summary,
      error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Creates a new scan run in 'pending' status.
   */
  public create(data: {
    siteId: string;
    scanType: ScanRunType;
    targetUrl: string;
    config?: Record<string, unknown>;
  }): ScanRunDTO {
    const rawDb = this.connection.getRawDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const configJson = JSON.stringify(data.config ?? {});

    rawDb
      .prepare(
        `INSERT INTO scan_runs (
          id, site_id, scan_type, status, target_url,
          started_at, completed_at, cancelled_at, duration_ms,
          config_json, summary_json, error_json,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'pending', ?,
          NULL, NULL, NULL, NULL,
          ?, NULL, NULL,
          ?, ?
        )`,
      )
      .run(id, data.siteId, data.scanType, data.targetUrl, configJson, now, now);

    return {
      id,
      siteId: data.siteId,
      scanType: data.scanType,
      status: 'pending',
      targetUrl: data.targetUrl,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      durationMs: null,
      config: data.config ?? {},
      summary: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Retrieves a scan run by ID.
   */
  public getById(id: string): ScanRunDTO | null {
    const rawDb = this.connection.getRawDb();
    const row = rawDb.prepare('SELECT * FROM scan_runs WHERE id = ? LIMIT 1').get(id) as
      ScanRunRow | undefined;

    return row ? this.mapRowToDTO(row) : null;
  }

  /**
   * Lists scan runs with optional filters and pagination.
   */
  public list(
    options: {
      siteId?: string;
      status?: ScanRunStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): ScanRunListResponseDTO {
    const rawDb = this.connection.getRawDb();
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const offset = Math.max(0, options.offset ?? 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.siteId) {
      conditions.push('site_id = ?');
      params.push(options.siteId);
    }

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = rawDb
      .prepare(`SELECT COUNT(*) as count FROM scan_runs ${whereClause}`)
      .get(...params) as { count: number };
    const total = countRow ? Number(countRow.count) : 0;

    const rows = rawDb
      .prepare(
        `SELECT * FROM scan_runs ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ScanRunRow[];

    return {
      items: rows.map(r => this.mapRowToDTO(r)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Updates scan run status enforcing state machine invariants.
   */
  public updateStatus(
    id: string,
    update: {
      status: ScanRunStatus;
      summary?: ScanRunSummaryDTO | null;
      error?: ScanRunErrorDTO | null;
      durationMs?: number | null;
      startedAt?: string | null;
      completedAt?: string | null;
      cancelledAt?: string | null;
    },
  ): ScanRunDTO {
    const rawDb = this.connection.getRawDb();
    const current = this.getById(id);
    if (!current) {
      throw new Error(`ERR_SCAN_RUN_NOT_FOUND: Scan run '${id}' not found`);
    }

    if (!isValidScanRunTransition(current.status, update.status)) {
      throw new Error(
        `ERR_SCAN_RUN_INVALID_TRANSITION: Cannot transition scan run from '${current.status}' to '${update.status}'`,
      );
    }

    const now = new Date().toISOString();
    const startedAt = update.startedAt !== undefined ? update.startedAt : current.startedAt;
    const completedAt = update.completedAt !== undefined ? update.completedAt : current.completedAt;
    const cancelledAt = update.cancelledAt !== undefined ? update.cancelledAt : current.cancelledAt;
    const durationMs = update.durationMs !== undefined ? update.durationMs : current.durationMs;

    const summaryJson =
      update.summary !== undefined
        ? update.summary
          ? JSON.stringify(update.summary)
          : null
        : current.summary
          ? JSON.stringify(current.summary)
          : null;

    const errorJson =
      update.error !== undefined
        ? update.error
          ? JSON.stringify(update.error)
          : null
        : current.error
          ? JSON.stringify(current.error)
          : null;

    rawDb
      .prepare(
        `UPDATE scan_runs
         SET status = ?,
             started_at = ?,
             completed_at = ?,
             cancelled_at = ?,
             duration_ms = ?,
             summary_json = ?,
             error_json = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        update.status,
        startedAt,
        completedAt,
        cancelledAt,
        durationMs,
        summaryJson,
        errorJson,
        now,
        id,
      );

    const updated = this.getById(id);
    if (!updated) {
      throw new Error(`ERR_SCAN_RUN_NOT_FOUND: Scan run '${id}' missing after update`);
    }
    return updated;
  }

  /**
   * Counts scan runs associated with a specific site.
   */
  public countBySiteId(siteId: string): number {
    const rawDb = this.connection.getRawDb();
    const row = rawDb
      .prepare('SELECT COUNT(*) as count FROM scan_runs WHERE site_id = ?')
      .get(siteId) as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  }

  /**
   * Finds any active (pending or running) scan run for a given site.
   */
  public findActiveBySiteId(siteId: string): ScanRunDTO | null {
    const rawDb = this.connection.getRawDb();
    const row = rawDb
      .prepare(
        `SELECT * FROM scan_runs
         WHERE site_id = ? AND status IN ('pending', 'running')
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(siteId) as ScanRunRow | undefined;

    return row ? this.mapRowToDTO(row) : null;
  }

  /**
   * Recovers orphaned scan runs that were left in 'pending' or 'running' state
   * due to application crash, abrupt process exit, or system restart.
   * Marks them as 'failed' with ERR_SCAN_INTERRUPTED_BY_SHUTDOWN.
   */
  public recoverInterruptedScans(
    reason = 'Scan execution interrupted by application restart',
  ): number {
    const rawDb = this.connection.getRawDb();
    const now = new Date().toISOString();
    const errorJson = JSON.stringify({
      code: 'ERR_SCAN_INTERRUPTED_BY_SHUTDOWN',
      message: reason,
    });

    const activeRows = rawDb
      .prepare(
        `SELECT id, started_at FROM scan_runs
         WHERE status IN ('pending', 'running')`,
      )
      .all() as Array<{ id: string; started_at: string | null }>;

    if (activeRows.length === 0) {
      return 0;
    }

    const updateStmt = rawDb.prepare(
      `UPDATE scan_runs
       SET status = 'failed',
           completed_at = ?,
           duration_ms = ?,
           error_json = ?,
           updated_at = ?
       WHERE id = ?`,
    );

    const tx = rawDb.transaction(() => {
      for (const row of activeRows) {
        let durationMs: number | null = null;
        if (row.started_at) {
          const started = new Date(row.started_at).getTime();
          const current = new Date(now).getTime();
          durationMs = Math.max(0, current - started);
        }
        updateStmt.run(now, durationMs, errorJson, now, row.id);
      }
    });

    tx();
    return activeRows.length;
  }
}
