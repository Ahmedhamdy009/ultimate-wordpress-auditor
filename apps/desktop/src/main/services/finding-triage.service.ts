import crypto from 'node:crypto';
import type { DatabaseConnection } from '../db/connection.js';
import type { SiteRepository } from '../db/repositories/site.repository.js';
import {
  IPCError,
  IPC_ERROR_CODES,
  type FindingTriageDTO,
  type FindingTriageEventDTO,
  type FindingTriageStatus,
  type TriageUpdateRequest,
  validateTriageTransition,
} from '@auditor/shared';

interface FindingTriageRow {
  site_id: string;
  finding_fingerprint: string;
  revision: number;
  status: string;
  reason: string | null;
  notes: string | null;
  updated_by: string;
  updated_at: string;
}

interface FindingTriageEventRow {
  id: string;
  site_id: string;
  finding_fingerprint: string;
  revision: number;
  status: string;
  previous_status: string | null;
  reason: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface IFindingTriageService {
  updateTriage(request: TriageUpdateRequest): Promise<FindingTriageDTO>;
  getTriageState(siteId: string, findingFingerprint: string): FindingTriageDTO;
  listTriageBySite(siteId: string): FindingTriageDTO[];
  getTriageHistory(siteId: string, findingFingerprint: string): FindingTriageEventDTO[];
}

export class FindingTriageService implements IFindingTriageService {
  private readonly connection: DatabaseConnection;
  private readonly siteRepo?: SiteRepository;

  constructor(connection: DatabaseConnection, siteRepo?: SiteRepository) {
    this.connection = connection;
    this.siteRepo = siteRepo;
  }

  /**
   * Executes an atomic triage state update governed by Optimistic Concurrency Control (OCC).
   *
   * Architectural Invariants:
   * 1. The Raw Finding remains 100% immutable in the findings table.
   * 2. If the stored revision or status differs from expected values, rolls back and rejects
   *    with ERR_CONCURRENT_TRIAGE_CONFLICT.
   * 3. Transitions to accepted_risk or false_positive strictly require a validated justification.
   * 4. An immutable audit record is appended to finding_triage_events within the atomic transaction.
   * 5. The materialized current state in finding_triage is atomically upserted with an incremented revision.
   * 6. Reversion to 'active' increments revision and records revocation without deleting history.
   */
  public async updateTriage(request: TriageUpdateRequest): Promise<FindingTriageDTO> {
    const { siteId, findingFingerprint, targetStatus, expectedRevision, expectedPreviousStatus } =
      request;

    if (this.siteRepo) {
      const site = this.siteRepo.getById(siteId);
      if (!site) {
        throw new IPCError(`Site '${siteId}' not found`, IPC_ERROR_CODES.SITE_NOT_FOUND);
      }
    }

    let reason = request.reason?.trim() ?? null;
    const notes = request.notes?.trim() ?? null;
    const userId = request.userId?.trim() || 'local_user';

    // If reverting to active and no reason provided, supply default audit trail rationale
    if (targetStatus === 'active' && (!reason || reason.length === 0)) {
      reason = 'Triage decision revoked';
    }

    const rawDb = this.connection.getRawDb();
    const now = new Date().toISOString();

    const executeTx = rawDb.transaction(() => {
      // Step 1: Read current materialized state with site isolation
      const current = rawDb
        .prepare(
          `SELECT site_id, finding_fingerprint, revision, status, reason, notes, updated_by, updated_at
           FROM finding_triage
           WHERE site_id = ? AND finding_fingerprint = ?`,
        )
        .get(siteId, findingFingerprint) as FindingTriageRow | undefined;

      const actualPreviousStatus: FindingTriageStatus =
        (current?.status as FindingTriageStatus) ?? 'active';
      const actualRevision = current ? current.revision : 0;

      // Step 2: Optimistic Concurrency Control Conflict Check
      if (actualRevision !== expectedRevision || actualPreviousStatus !== expectedPreviousStatus) {
        throw new IPCError(
          `Triage update conflict: finding state has been modified by another operation (expected rev ${expectedRevision}, actual rev ${actualRevision}; expected status '${expectedPreviousStatus}', actual status '${actualPreviousStatus}'). Please refresh.`,
          IPC_ERROR_CODES.CONCURRENT_TRIAGE_CONFLICT,
        );
      }

      // Step 3: Validate state transition and mandatory justification rules
      validateTriageTransition(actualPreviousStatus, targetStatus, reason);

      const nextRevision = actualRevision + 1;
      const eventId = crypto.randomUUID();

      // Step 4: Append immutable event to audit log
      rawDb
        .prepare(
          `INSERT INTO finding_triage_events (
            id, site_id, finding_fingerprint, revision, status, previous_status,
            reason, notes, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventId,
          siteId,
          findingFingerprint,
          nextRevision,
          targetStatus,
          actualPreviousStatus,
          reason,
          notes,
          userId,
          now,
        );

      // Step 5: Upsert materialized current state
      rawDb
        .prepare(
          `INSERT INTO finding_triage (
            site_id, finding_fingerprint, revision, status, reason, notes, updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(site_id, finding_fingerprint) DO UPDATE SET
            revision = excluded.revision,
            status = excluded.status,
            reason = excluded.reason,
            notes = excluded.notes,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
        )
        .run(siteId, findingFingerprint, nextRevision, targetStatus, reason, notes, userId, now);

      return {
        siteId,
        findingFingerprint,
        revision: nextRevision,
        status: targetStatus,
        previousStatus: actualPreviousStatus,
        reason,
        notes,
        updatedBy: userId,
        updatedAt: now,
      };
    });

    return executeTx();
  }

  /**
   * Retrieves the current materialized triage state for a given finding.
   * If the finding has never been reviewed, returns the virtual default state:
   * status = 'active', revision = 0.
   */
  public getTriageState(siteId: string, findingFingerprint: string): FindingTriageDTO {
    const rawDb = this.connection.getRawDb();
    const row = rawDb
      .prepare(
        `SELECT site_id, finding_fingerprint, revision, status, reason, notes, updated_by, updated_at
         FROM finding_triage
         WHERE site_id = ? AND finding_fingerprint = ?
         LIMIT 1`,
      )
      .get(siteId, findingFingerprint) as FindingTriageRow | undefined;

    if (!row) {
      return {
        siteId,
        findingFingerprint,
        revision: 0,
        status: 'active',
        reason: null,
        notes: null,
        updatedBy: 'system',
        updatedAt: new Date(0).toISOString(),
      };
    }

    return {
      siteId: row.site_id,
      findingFingerprint: row.finding_fingerprint,
      revision: row.revision,
      status: row.status as FindingTriageStatus,
      reason: row.reason,
      notes: row.notes,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Lists all materialized triage records for a specific site.
   */
  public listTriageBySite(siteId: string): FindingTriageDTO[] {
    const rawDb = this.connection.getRawDb();
    const rows = rawDb
      .prepare(
        `SELECT site_id, finding_fingerprint, revision, status, reason, notes, updated_by, updated_at
         FROM finding_triage
         WHERE site_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(siteId) as FindingTriageRow[];

    return rows.map(row => ({
      siteId: row.site_id,
      findingFingerprint: row.finding_fingerprint,
      revision: row.revision,
      status: row.status as FindingTriageStatus,
      reason: row.reason,
      notes: row.notes,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Retrieves the full append-only audit trail of triage events for a specific finding.
   */
  public getTriageHistory(siteId: string, findingFingerprint: string): FindingTriageEventDTO[] {
    const rawDb = this.connection.getRawDb();
    const rows = rawDb
      .prepare(
        `SELECT id, site_id, finding_fingerprint, revision, status, previous_status,
                reason, notes, created_by, created_at
         FROM finding_triage_events
         WHERE site_id = ? AND finding_fingerprint = ?
         ORDER BY revision ASC`,
      )
      .all(siteId, findingFingerprint) as FindingTriageEventRow[];

    return rows.map(row => ({
      id: row.id,
      siteId: row.site_id,
      findingFingerprint: row.finding_fingerprint,
      revision: row.revision,
      status: row.status as FindingTriageStatus,
      previousStatus: (row.previous_status as FindingTriageStatus) ?? null,
      reason: row.reason,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));
  }
}
