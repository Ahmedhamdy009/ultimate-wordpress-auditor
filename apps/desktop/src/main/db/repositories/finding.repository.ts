import crypto from 'node:crypto';
import type { DatabaseConnection } from '../connection.js';
import {
  type FindingDTO,
  type FindingListResponseDTO,
  type FindingSeverity,
  type FindingConfidence,
  type FindingStatus,
} from '@auditor/shared';

interface FindingRow {
  id: string;
  scan_run_id: string;
  rule_id: string;
  category: string;
  title: string;
  description: string;
  severity: string;
  confidence: string;
  status: string;
  target_url: string;
  evidence_json: string | null;
  remediation: string | null;
  references_json: string | null;
  created_at: string;
}

export interface CreateFindingInput {
  scanRunId: string;
  ruleId: string;
  category: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  status?: FindingStatus;
  targetUrl: string;
  evidence?: Record<string, unknown> | string | null;
  remediation?: string | null;
  references?: string[] | null;
}

export class FindingRepository {
  private readonly connection: DatabaseConnection;

  constructor(connection: DatabaseConnection) {
    this.connection = connection;
  }

  private mapRowToDTO(row: FindingRow): FindingDTO {
    let evidence: Record<string, unknown> | string | null = null;
    if (row.evidence_json) {
      try {
        evidence = JSON.parse(row.evidence_json);
      } catch {
        evidence = row.evidence_json;
      }
    }

    let references: string[] | null = null;
    if (row.references_json) {
      try {
        references = JSON.parse(row.references_json);
      } catch {
        references = null;
      }
    }

    return {
      id: row.id,
      scanRunId: row.scan_run_id,
      ruleId: row.rule_id,
      category: row.category,
      title: row.title,
      description: row.description,
      severity: row.severity as FindingSeverity,
      confidence: row.confidence as FindingConfidence,
      status: row.status as FindingStatus,
      targetUrl: row.target_url,
      evidence,
      remediation: row.remediation,
      references,
      createdAt: row.created_at,
    };
  }

  /**
   * Creates a single finding record.
   */
  public create(data: CreateFindingInput): FindingDTO {
    const rawDb = this.connection.getRawDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const evidenceJson =
      data.evidence !== undefined && data.evidence !== null
        ? typeof data.evidence === 'string'
          ? data.evidence
          : JSON.stringify(data.evidence)
        : null;
    const referencesJson = data.references ? JSON.stringify(data.references) : null;
    const status = data.status ?? 'potential';

    rawDb
      .prepare(
        `INSERT INTO findings (
          id, scan_run_id, rule_id, category, title, description,
          severity, confidence, status, target_url, evidence_json,
          remediation, references_json, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?
        )`,
      )
      .run(
        id,
        data.scanRunId,
        data.ruleId,
        data.category,
        data.title,
        data.description,
        data.severity,
        data.confidence,
        status,
        data.targetUrl,
        evidenceJson,
        data.remediation ?? null,
        referencesJson,
        now,
      );

    return {
      id,
      scanRunId: data.scanRunId,
      ruleId: data.ruleId,
      category: data.category,
      title: data.title,
      description: data.description,
      severity: data.severity,
      confidence: data.confidence,
      status,
      targetUrl: data.targetUrl,
      evidence: data.evidence ?? null,
      remediation: data.remediation ?? null,
      references: data.references ?? null,
      createdAt: now,
    };
  }

  /**
   * Batch creates findings within an atomic database transaction.
   */
  public batchCreate(items: CreateFindingInput[]): FindingDTO[] {
    if (items.length === 0) {
      return [];
    }
    const rawDb = this.connection.getRawDb();
    const stmt = rawDb.prepare(
      `INSERT INTO findings (
        id, scan_run_id, rule_id, category, title, description,
        severity, confidence, status, target_url, evidence_json,
        remediation, references_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )`,
    );

    const results: FindingDTO[] = [];
    const insertTx = rawDb.transaction((findings: CreateFindingInput[]) => {
      const now = new Date().toISOString();
      for (const item of findings) {
        const id = crypto.randomUUID();
        const evidenceJson =
          item.evidence !== undefined && item.evidence !== null
            ? typeof item.evidence === 'string'
              ? item.evidence
              : JSON.stringify(item.evidence)
            : null;
        const referencesJson = item.references ? JSON.stringify(item.references) : null;
        const status = item.status ?? 'potential';

        stmt.run(
          id,
          item.scanRunId,
          item.ruleId,
          item.category,
          item.title,
          item.description,
          item.severity,
          item.confidence,
          status,
          item.targetUrl,
          evidenceJson,
          item.remediation ?? null,
          referencesJson,
          now,
        );

        results.push({
          id,
          scanRunId: item.scanRunId,
          ruleId: item.ruleId,
          category: item.category,
          title: item.title,
          description: item.description,
          severity: item.severity,
          confidence: item.confidence,
          status,
          targetUrl: item.targetUrl,
          evidence: item.evidence ?? null,
          remediation: item.remediation ?? null,
          references: item.references ?? null,
          createdAt: now,
        });
      }
    });

    insertTx(items);
    return results;
  }

  /**
   * Retrieves a finding by ID.
   */
  public getById(id: string): FindingDTO | null {
    const rawDb = this.connection.getRawDb();
    const row = rawDb.prepare('SELECT * FROM findings WHERE id = ? LIMIT 1').get(id) as
      FindingRow | undefined;

    return row ? this.mapRowToDTO(row) : null;
  }

  /**
   * Lists findings for a scan run with filtering and pagination.
   */
  public listByScanRunId(
    scanRunId: string,
    options: {
      severity?: FindingSeverity;
      category?: string;
      status?: FindingStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): FindingListResponseDTO {
    const rawDb = this.connection.getRawDb();
    const limit = Math.max(1, Math.min(options.limit ?? 50, 1000));
    const offset = Math.max(0, options.offset ?? 0);

    const conditions: string[] = ['scan_run_id = ?'];
    const params: unknown[] = [scanRunId];

    if (options.severity) {
      conditions.push('severity = ?');
      params.push(options.severity);
    }
    if (options.category) {
      conditions.push('category = ?');
      params.push(options.category);
    }
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countRow = rawDb
      .prepare(`SELECT COUNT(*) as count FROM findings ${whereClause}`)
      .get(...params) as { count: number };
    const total = countRow ? Number(countRow.count) : 0;

    const rows = rawDb
      .prepare(
        `SELECT * FROM findings ${whereClause}
         ORDER BY created_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as FindingRow[];

    return {
      items: rows.map(r => this.mapRowToDTO(r)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Counts findings for a scan run.
   */
  public countByScanRunId(scanRunId: string): number {
    const rawDb = this.connection.getRawDb();
    const row = rawDb
      .prepare('SELECT COUNT(*) as count FROM findings WHERE scan_run_id = ?')
      .get(scanRunId) as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  }

  /**
   * Aggregates finding counts grouped by severity for summary generation.
   */
  public getSeverityCounts(scanRunId: string): Record<string, number> {
    const rawDb = this.connection.getRawDb();
    const rows = rawDb
      .prepare(
        `SELECT severity, COUNT(*) as count
         FROM findings
         WHERE scan_run_id = ?
         GROUP BY severity`,
      )
      .all(scanRunId) as Array<{ severity: string; count: number }>;

    const counts: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    for (const r of rows) {
      const key = r.severity === 'informational' ? 'info' : r.severity;
      counts[key] = (counts[key] ?? 0) + Number(r.count);
    }

    return counts;
  }

  /**
   * Retrieves all findings belonging strictly to a scan run without pagination limits,
   * specifically used for comprehensive audit report generation.
   */
  public getAllByScanRunId(scanRunId: string): FindingDTO[] {
    const rawDb = this.connection.getRawDb();
    const rows = rawDb
      .prepare(
        `SELECT * FROM findings
         WHERE scan_run_id = ?
         ORDER BY 
           CASE severity
             WHEN 'critical' THEN 1
             WHEN 'high' THEN 2
             WHEN 'medium' THEN 3
             WHEN 'low' THEN 4
             ELSE 5
           END ASC,
           created_at ASC`,
      )
      .all(scanRunId) as FindingRow[];

    return rows.map(r => this.mapRowToDTO(r));
  }
}
