import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { FindingTriageService } from '../../src/main/services/finding-triage.service.js';
import { IPC_ERROR_CODES, IPCError, type FindingTriageDTO } from '@auditor/shared';

describe('FindingTriageService & Optimistic Concurrency Control (OCC)', () => {
  let connection: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let siteRepo: SiteRepository;
  let triageService: FindingTriageService;

  let testSiteId: string;
  let siteBId: string;
  const testFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  beforeEach(async () => {
    connection = new DatabaseConnection(':memory:', { isMemory: true });
    connection.open();

    const runner = new MigrationRunner(connection);
    await runner.migrate();

    projectRepo = new ProjectRepository(connection);
    siteRepo = new SiteRepository(connection);
    triageService = new FindingTriageService(connection, siteRepo);

    const project = projectRepo.create({ name: 'Triage Test Project' });
    const siteA = siteRepo.create({
      projectId: project.id,
      name: 'Site A',
      baseUrl: 'https://site-a.example.com',
    });
    const siteB = siteRepo.create({
      projectId: project.id,
      name: 'Site B',
      baseUrl: 'https://site-b.example.com',
    });

    testSiteId = siteA.id;
    siteBId = siteB.id;
  });

  afterEach(() => {
    if (connection && connection.isOpen()) {
      connection.close();
    }
  });

  describe('Virtual Default State', () => {
    it('returns virtual active status at revision 0 for unreviewed finding', () => {
      const state = triageService.getTriageState(testSiteId, testFingerprint);

      expect(state).toBeDefined();
      expect(state.siteId).toBe(testSiteId);
      expect(state.findingFingerprint).toBe(testFingerprint);
      expect(state.status).toBe('active');
      expect(state.revision).toBe(0);
      expect(state.reason).toBeNull();
      expect(state.notes).toBeNull();
    });

    it('returns empty history for unreviewed finding', () => {
      const history = triageService.getTriageHistory(testSiteId, testFingerprint);
      expect(history).toEqual([]);
    });
  });

  describe('First Triage Decision (Revision Lifecycle 0 -> 1)', () => {
    it('records first triage decision as revision 1 and writes immutable audit event', async () => {
      const result = await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Compensating WAF rule deployed on edge gateway',
        notes: 'Ticket SEC-1049',
        userId: 'auditor_alice',
      });

      expect(result.revision).toBe(1);
      expect(result.status).toBe('accepted_risk');
      expect(result.previousStatus).toBe('active');
      expect(result.reason).toBe('Compensating WAF rule deployed on edge gateway');
      expect(result.notes).toBe('Ticket SEC-1049');
      expect(result.updatedBy).toBe('auditor_alice');

      // Verify materialized state
      const state = triageService.getTriageState(testSiteId, testFingerprint);
      expect(state.revision).toBe(1);
      expect(state.status).toBe('accepted_risk');

      // Verify audit history
      const history = triageService.getTriageHistory(testSiteId, testFingerprint);
      expect(history.length).toBe(1);
      expect(history[0].revision).toBe(1);
      expect(history[0].status).toBe('accepted_risk');
      expect(history[0].previousStatus).toBe('active');
      expect(history[0].reason).toBe('Compensating WAF rule deployed on edge gateway');
      expect(history[0].createdBy).toBe('auditor_alice');
    });
  });

  describe('Optimistic Concurrency Control (OCC) Guarantees', () => {
    it('rejects stale update when expectedRevision does not match current state', async () => {
      // Step 1: User A updates from rev 0 -> rev 1
      await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Accepted by security team',
        userId: 'user_a',
      });

      // Step 2: User B tries to update using stale rev 0 -> must be rejected
      await expect(
        triageService.updateTriage({
          siteId: testSiteId,
          findingFingerprint: testFingerprint,
          targetStatus: 'false_positive',
          expectedRevision: 0,
          expectedPreviousStatus: 'active',
          reason: 'Actually a dev artifact',
          userId: 'user_b',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: IPC_ERROR_CODES.CONCURRENT_TRIAGE_CONFLICT,
        }),
      );

      // Verify state was NOT overwritten and remains User A's revision 1
      const state = triageService.getTriageState(testSiteId, testFingerprint);
      expect(state.revision).toBe(1);
      expect(state.status).toBe('accepted_risk');

      // Verify only 1 audit event exists
      const history = triageService.getTriageHistory(testSiteId, testFingerprint);
      expect(history.length).toBe(1);
    });

    it('rejects update when expectedPreviousStatus does not match stored status', async () => {
      // Step 1: Set to accepted_risk
      await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Initial risk acceptance',
      });

      // Step 2: Attempt update with correct revision (1) but wrong previous status ('false_positive')
      await expect(
        triageService.updateTriage({
          siteId: testSiteId,
          findingFingerprint: testFingerprint,
          targetStatus: 'ignored',
          expectedRevision: 1,
          expectedPreviousStatus: 'false_positive',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: IPC_ERROR_CODES.CONCURRENT_TRIAGE_CONFLICT,
        }),
      );
    });
  });

  describe('State Machine & Transition Rules', () => {
    it('requires 5..500 character reason when transitioning to accepted_risk or false_positive', async () => {
      // Missing reason on accepted_risk
      await expect(
        triageService.updateTriage({
          siteId: testSiteId,
          findingFingerprint: testFingerprint,
          targetStatus: 'accepted_risk',
          expectedRevision: 0,
          expectedPreviousStatus: 'active',
          reason: '',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
        }),
      );

      // Too short reason (< 5 chars)
      await expect(
        triageService.updateTriage({
          siteId: testSiteId,
          findingFingerprint: testFingerprint,
          targetStatus: 'false_positive',
          expectedRevision: 0,
          expectedPreviousStatus: 'active',
          reason: 'abc',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
        }),
      );
    });

    it('rejects redundant transition to the same status', async () => {
      await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'ignored',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
      });

      await expect(
        triageService.updateTriage({
          siteId: testSiteId,
          findingFingerprint: testFingerprint,
          targetStatus: 'ignored',
          expectedRevision: 1,
          expectedPreviousStatus: 'ignored',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
        }),
      );
    });

    it('reverts triage back to active, incrementing revision and logging revocation', async () => {
      // Step 1: Set to accepted_risk (rev 1)
      await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Risk accepted temporarily',
      });

      // Step 2: Clear triage decision / revert to active (rev 2)
      const reverted = await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'active',
        expectedRevision: 1,
        expectedPreviousStatus: 'accepted_risk',
      });

      expect(reverted.revision).toBe(2);
      expect(reverted.status).toBe('active');
      expect(reverted.previousStatus).toBe('accepted_risk');
      expect(reverted.reason).toBe('Triage decision revoked');

      // Verify materialized state
      const state = triageService.getTriageState(testSiteId, testFingerprint);
      expect(state.revision).toBe(2);
      expect(state.status).toBe('active');

      // Verify complete history is preserved
      const history = triageService.getTriageHistory(testSiteId, testFingerprint);
      expect(history.length).toBe(2);
      expect(history[0].revision).toBe(1);
      expect(history[0].status).toBe('accepted_risk');
      expect(history[1].revision).toBe(2);
      expect(history[1].status).toBe('active');
      expect(history[1].reason).toBe('Triage decision revoked');
    });
  });

  describe('Site Isolation & Integrity', () => {
    it('isolates triage decisions between distinct sites with the same finding fingerprint', async () => {
      // Triage on Site A
      await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Accepted on site A only',
      });

      // Site A has rev 1 accepted_risk
      const stateA = triageService.getTriageState(testSiteId, testFingerprint);
      expect(stateA.revision).toBe(1);
      expect(stateA.status).toBe('accepted_risk');

      // Site B remains unaffected at virtual default rev 0 active
      const stateB = triageService.getTriageState(siteBId, testFingerprint);
      expect(stateB.revision).toBe(0);
      expect(stateB.status).toBe('active');

      // History for Site B is empty
      expect(triageService.getTriageHistory(siteBId, testFingerprint)).toEqual([]);
    });

    it('rejects triage operation on non-existent site', async () => {
      await expect(
        triageService.updateTriage({
          siteId: crypto.randomUUID(),
          findingFingerprint: testFingerprint,
          targetStatus: 'ignored',
          expectedRevision: 0,
          expectedPreviousStatus: 'active',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: IPC_ERROR_CODES.SITE_NOT_FOUND,
        }),
      );
    });

    it('lists all triage entries for a site', async () => {
      const fingerprint2 = 'f'.repeat(64);

      await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'confirmed',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
      });

      await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: fingerprint2,
        targetStatus: 'ignored',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
      });

      const list = triageService.listTriageBySite(testSiteId);
      expect(list.length).toBe(2);
      expect(
        list.some(t => t.findingFingerprint === testFingerprint && t.status === 'confirmed'),
      ).toBe(true);
      expect(list.some(t => t.findingFingerprint === fingerprint2 && t.status === 'ignored')).toBe(
        true,
      );
    });

    it('preserves triage records intact when site is archived', async () => {
      await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Valid risk on active site',
      });

      // Archive site
      siteRepo.archive(testSiteId);

      // Verify triage state and history are intact and readable
      const state = triageService.getTriageState(testSiteId, testFingerprint);
      expect(state.revision).toBe(1);
      expect(state.status).toBe('accepted_risk');

      const history = triageService.getTriageHistory(testSiteId, testFingerprint);
      expect(history.length).toBe(1);
    });
  });

  describe('Atomic Transaction Rollback & Failure Injection', () => {
    it('rolls back completely when finding_triage_events insert fails (Test A1: no state created, no orphan events)', async () => {
      const rawDb = connection.getRawDb();

      // Inject failure on event insertion via temporary SQLite trigger
      rawDb.exec(`
        CREATE TRIGGER test_fail_events_insert
        BEFORE INSERT ON finding_triage_events
        BEGIN
          SELECT RAISE(ABORT, 'Simulated failure during event insertion');
        END;
      `);

      try {
        await expect(
          triageService.updateTriage({
            siteId: testSiteId,
            findingFingerprint: testFingerprint,
            targetStatus: 'accepted_risk',
            expectedRevision: 0,
            expectedPreviousStatus: 'active',
            reason: 'Valid justification that should fail',
            userId: 'auditor_test',
          }),
        ).rejects.toThrow(/Simulated failure during event insertion/);

        // Verify 1: No event was inserted into finding_triage_events
        const eventCount = (
          rawDb
            .prepare(
              'SELECT COUNT(*) as count FROM finding_triage_events WHERE site_id = ? AND finding_fingerprint = ?',
            )
            .get(testSiteId, testFingerprint) as { count: number }
        ).count;
        expect(eventCount).toBe(0);

        // Verify 2: No row was inserted into finding_triage
        const triageCount = (
          rawDb
            .prepare(
              'SELECT COUNT(*) as count FROM finding_triage WHERE site_id = ? AND finding_fingerprint = ?',
            )
            .get(testSiteId, testFingerprint) as { count: number }
        ).count;
        expect(triageCount).toBe(0);

        // Verify 3: Virtual state returns default active revision 0
        const state = triageService.getTriageState(testSiteId, testFingerprint);
        expect(state.revision).toBe(0);
        expect(state.status).toBe('active');
        expect(state.reason).toBeNull();

        // Verify 4: Audit history remains completely empty
        const history = triageService.getTriageHistory(testSiteId, testFingerprint);
        expect(history).toEqual([]);
      } finally {
        rawDb.exec('DROP TRIGGER IF EXISTS test_fail_events_insert;');
      }

      // Verify 5: Database remains healthy and subsequent triage succeeds
      const success = await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Valid justification after trigger cleanup',
        userId: 'auditor_test',
      });
      expect(success.revision).toBe(1);
      expect(success.status).toBe('accepted_risk');
    });

    it('rolls back event insert when finding_triage insert fails (Test A2: initial upsert failure)', async () => {
      const rawDb = connection.getRawDb();

      // Inject failure on finding_triage initial INSERT
      rawDb.exec(`
        CREATE TRIGGER test_fail_triage_insert
        BEFORE INSERT ON finding_triage
        BEGIN
          SELECT RAISE(ABORT, 'Simulated failure during finding_triage insert');
        END;
      `);

      try {
        await expect(
          triageService.updateTriage({
            siteId: testSiteId,
            findingFingerprint: testFingerprint,
            targetStatus: 'accepted_risk',
            expectedRevision: 0,
            expectedPreviousStatus: 'active',
            reason: 'Valid justification on insert',
            userId: 'auditor_test',
          }),
        ).rejects.toThrow(/Simulated failure during finding_triage insert/);

        // Step 4 (event insert) was executed in transaction before Step 5 (triage insert).
        // Rollback MUST remove the event. Verify no orphan events exist!
        const events = rawDb
          .prepare(
            'SELECT * FROM finding_triage_events WHERE site_id = ? AND finding_fingerprint = ?',
          )
          .all(testSiteId, testFingerprint);
        expect(events.length).toBe(0);

        const triageRows = rawDb
          .prepare(
            'SELECT * FROM finding_triage WHERE site_id = ? AND finding_fingerprint = ?',
          )
          .all(testSiteId, testFingerprint);
        expect(triageRows.length).toBe(0);
      } finally {
        rawDb.exec('DROP TRIGGER IF EXISTS test_fail_triage_insert;');
      }
    });

    it('rolls back event insert and preserves prior state when finding_triage update fails (Test A2: update upsert failure)', async () => {
      // 1. Establish prior revision 1 state
      const initial = await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Initial risk acceptance',
        userId: 'auditor_alice',
      });
      expect(initial.revision).toBe(1);

      const rawDb = connection.getRawDb();

      // 2. Inject failure on finding_triage UPDATE
      rawDb.exec(`
        CREATE TRIGGER test_fail_triage_update
        BEFORE UPDATE ON finding_triage
        BEGIN
          SELECT RAISE(ABORT, 'Simulated failure during finding_triage update');
        END;
      `);

      try {
        // Attempt transition rev 1 -> 2
        await expect(
          triageService.updateTriage({
            siteId: testSiteId,
            findingFingerprint: testFingerprint,
            targetStatus: 'active',
            expectedRevision: 1,
            expectedPreviousStatus: 'accepted_risk',
            reason: 'Attempted revocation that must abort',
            userId: 'auditor_bob',
          }),
        ).rejects.toThrow(/Simulated failure during finding_triage update/);

        // Verify: Step 4 executed (would have inserted event for rev 2),
        // but Step 5 failed and rolled back. Event for rev 2 MUST NOT exist!
        const events = rawDb
          .prepare(
            'SELECT revision, status FROM finding_triage_events WHERE site_id = ? AND finding_fingerprint = ? ORDER BY revision ASC',
          )
          .all(testSiteId, testFingerprint) as Array<{ revision: number; status: string }>;
        expect(events.length).toBe(1);
        expect(events[0].revision).toBe(1);
        expect(events[0].status).toBe('accepted_risk');

        // Materialized state must remain at revision 1
        const state = triageService.getTriageState(testSiteId, testFingerprint);
        expect(state.revision).toBe(1);
        expect(state.status).toBe('accepted_risk');
        expect(state.reason).toBe('Initial risk acceptance');
        expect(state.updatedBy).toBe('auditor_alice');
      } finally {
        rawDb.exec('DROP TRIGGER IF EXISTS test_fail_triage_update;');
      }

      // Verify subsequent update succeeds normally to rev 2
      const recovered = await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'active',
        expectedRevision: 1,
        expectedPreviousStatus: 'accepted_risk',
        reason: 'Clean revocation after trigger dropped',
        userId: 'auditor_bob',
      });
      expect(recovered.revision).toBe(2);
      expect(recovered.status).toBe('active');
    });
  });

  describe('OCC Genuine Concurrent Write Contention', () => {
    it('handles simultaneous competing writes from revision 0: exactly one succeeds and one rejects with CONCURRENT_TRIAGE_CONFLICT', async () => {
      const reqAlice = {
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk' as const,
        expectedRevision: 0,
        expectedPreviousStatus: 'active' as const,
        reason: 'Security exception approved by Alice',
        notes: 'Ticket SEC-101',
        userId: 'alice',
      };

      const reqBob = {
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'false_positive' as const,
        expectedRevision: 0,
        expectedPreviousStatus: 'active' as const,
        reason: 'False positive confirmed by Bob in staging',
        notes: 'Ticket SEC-102',
        userId: 'bob',
      };

      // Dispatch competing write operations concurrently
      const [resultAlice, resultBob] = await Promise.allSettled([
        triageService.updateTriage(reqAlice),
        triageService.updateTriage(reqBob),
      ]);

      const fulfilled = [resultAlice, resultBob].filter(
        (r): r is PromiseFulfilledResult<FindingTriageDTO> => r.status === 'fulfilled',
      );
      const rejected = [resultAlice, resultBob].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      // 1. Exactly one must succeed, exactly one must fail
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // 2. The winner advances revision to 1
      const winner = fulfilled[0].value;
      expect(winner.revision).toBe(1);
      expect(['accepted_risk', 'false_positive']).toContain(winner.status);

      // 3. The loser receives ERR_CONCURRENT_TRIAGE_CONFLICT
      const loserErr = rejected[0].reason;
      expect(loserErr).toBeInstanceOf(IPCError);
      expect(loserErr.code).toBe(IPC_ERROR_CODES.CONCURRENT_TRIAGE_CONFLICT);

      // 4. Stored materialized state matches winner at revision 1
      const state = triageService.getTriageState(testSiteId, testFingerprint);
      expect(state.revision).toBe(1);
      expect(state.status).toBe(winner.status);
      expect(state.updatedBy).toBe(winner.updatedBy);

      // 5. Stored audit history contains EXACTLY ONE event (revision 1)
      const history = triageService.getTriageHistory(testSiteId, testFingerprint);
      expect(history.length).toBe(1);
      expect(history[0].revision).toBe(1);
      expect(history[0].status).toBe(winner.status);
      expect(history[0].createdBy).toBe(winner.updatedBy);

      // 6. Losing user refreshes with new revision and successfully applies subsequent triage
      const retryReq = {
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'ignored' as const,
        expectedRevision: 1,
        expectedPreviousStatus: winner.status,
        notes: 'Refreshed decision after conflict resolution',
        userId: winner.updatedBy === 'alice' ? 'bob' : 'alice',
      };

      const retried = await triageService.updateTriage(retryReq);
      expect(retried.revision).toBe(2);
      expect(retried.status).toBe('ignored');
      expect(retried.previousStatus).toBe(winner.status);

      const finalHistory = triageService.getTriageHistory(testSiteId, testFingerprint);
      expect(finalHistory.length).toBe(2);
      expect(finalHistory[1].revision).toBe(2);
    });

    it('handles simultaneous competing writes from revision 1 -> 2: exactly one succeeds to revision 2', async () => {
      // Establish revision 1 first
      await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Initial risk acceptance',
        userId: 'admin',
      });

      // Two users concurrently attempt to change from accepted_risk (rev 1)
      const op1 = {
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'active' as const,
        expectedRevision: 1,
        expectedPreviousStatus: 'accepted_risk' as const,
        reason: 'Revocation by user 1',
        userId: 'user1',
      };

      const op2 = {
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'false_positive' as const,
        expectedRevision: 1,
        expectedPreviousStatus: 'accepted_risk' as const,
        reason: 'Reclassified as false positive by user 2',
        userId: 'user2',
      };

      const [res1, res2] = await Promise.allSettled([
        triageService.updateTriage(op1),
        triageService.updateTriage(op2),
      ]);

      const fulfilled = [res1, res2].filter(
        (r): r is PromiseFulfilledResult<FindingTriageDTO> => r.status === 'fulfilled',
      );
      const rejected = [res1, res2].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(fulfilled[0].value.revision).toBe(2);
      expect(rejected[0].reason.code).toBe(IPC_ERROR_CODES.CONCURRENT_TRIAGE_CONFLICT);

      // Event history must contain exactly 2 events (rev 1 and rev 2)
      const history = triageService.getTriageHistory(testSiteId, testFingerprint);
      expect(history.length).toBe(2);
      expect(history[0].revision).toBe(1);
      expect(history[1].revision).toBe(2);
    });
  });

  describe('Backup & Restore State and Audit Trail Preservation', () => {
    const backupDir = path.join('D:\\ahmed\\.tmp\\test-triage-backup');
    const backupDest = path.join(backupDir, 'triage-preserved-backup.db');

    beforeEach(() => {
      fs.mkdirSync(backupDir, { recursive: true });
      if (fs.existsSync(backupDest)) {
        fs.unlinkSync(backupDest);
      }
    });

    afterEach(() => {
      try {
        if (fs.existsSync(backupDir)) {
          fs.rmSync(backupDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore file lock cleanup on Windows
      }
    });

    it('creates hot backup and verifies full triage state, revision history, triggers, and constraints on restored database', async () => {
      // 1. Create complete triage lifecycle: rev 1 (accepted_risk) -> rev 2 (reverted to active)
      const rev1 = await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'accepted_risk',
        expectedRevision: 0,
        expectedPreviousStatus: 'active',
        reason: 'Compensating control deployed at ingress',
        notes: 'Ticket #4042',
        userId: 'sec_lead',
      });
      expect(rev1.revision).toBe(1);

      const rev2 = await triageService.updateTriage({
        siteId: testSiteId,
        findingFingerprint: testFingerprint,
        targetStatus: 'active',
        expectedRevision: 1,
        expectedPreviousStatus: 'accepted_risk',
        reason: 'Compensating control removed after upstream patch',
        notes: 'Ticket #4042 closed',
        userId: 'sec_lead',
      });
      expect(rev2.revision).toBe(2);

      // 2. Perform hot online backup using connection layer
      await connection.backup(backupDest);
      expect(fs.existsSync(backupDest)).toBe(true);

      // 3. Open restored connection to the backup file
      const restoredConn = new DatabaseConnection(backupDest);
      restoredConn.open();

      try {
        // (a) Verify integrity check passes
        const check = restoredConn.quickCheck();
        expect(check.ok).toBe(true);
        expect(check.errors).toEqual([]);

        // (b) Verify foreign_keys pragma is enabled on restored connection
        const fkPragma = restoredConn.getRawDb().pragma('foreign_keys', { simple: true });
        expect(fkPragma).toBe(1);

        // (c) Verify restored FindingTriageService retrieves identical materialized state
        const restoredSiteRepo = new SiteRepository(restoredConn);
        const restoredTriageService = new FindingTriageService(restoredConn, restoredSiteRepo);

        const restoredState = restoredTriageService.getTriageState(testSiteId, testFingerprint);
        expect(restoredState.siteId).toBe(testSiteId);
        expect(restoredState.findingFingerprint).toBe(testFingerprint);
        expect(restoredState.revision).toBe(2);
        expect(restoredState.status).toBe('active');
        expect(restoredState.reason).toBe('Compensating control removed after upstream patch');
        expect(restoredState.notes).toBe('Ticket #4042 closed');
        expect(restoredState.updatedBy).toBe('sec_lead');

        // (d) Verify restored audit trail is complete and ordered
        const restoredHistory = restoredTriageService.getTriageHistory(testSiteId, testFingerprint);
        expect(restoredHistory.length).toBe(2);

        expect(restoredHistory[0].revision).toBe(1);
        expect(restoredHistory[0].status).toBe('accepted_risk');
        expect(restoredHistory[0].previousStatus).toBe('active');
        expect(restoredHistory[0].reason).toBe('Compensating control deployed at ingress');
        expect(restoredHistory[0].notes).toBe('Ticket #4042');
        expect(restoredHistory[0].createdBy).toBe('sec_lead');

        expect(restoredHistory[1].revision).toBe(2);
        expect(restoredHistory[1].status).toBe('active');
        expect(restoredHistory[1].previousStatus).toBe('accepted_risk');
        expect(restoredHistory[1].reason).toBe('Compensating control removed after upstream patch');
        expect(restoredHistory[1].notes).toBe('Ticket #4042 closed');
        expect(restoredHistory[1].createdBy).toBe('sec_lead');

        // (e) Verify SQLite triggers preventing UPDATE / DELETE on finding_triage_events are active
        const rawRestoredDb = restoredConn.getRawDb();
        const firstEventId = restoredHistory[0].id;

        expect(() => {
          rawRestoredDb
            .prepare('UPDATE finding_triage_events SET status = ? WHERE id = ?')
            .run('ignored', firstEventId);
        }).toThrow(/finding_triage_events records are append-only and cannot be updated/);

        expect(() => {
          rawRestoredDb
            .prepare('DELETE FROM finding_triage_events WHERE id = ?')
            .run(firstEventId);
        }).toThrow(/finding_triage_events records are append-only and cannot be deleted/);

        // (f) Verify subsequent triage operations work properly on the restored database
        const rev3 = await restoredTriageService.updateTriage({
          siteId: testSiteId,
          findingFingerprint: testFingerprint,
          targetStatus: 'false_positive',
          expectedRevision: 2,
          expectedPreviousStatus: 'active',
          reason: 'Verified as false positive on restored node',
          userId: 'auditor_carol',
        });
        expect(rev3.revision).toBe(3);
        expect(rev3.status).toBe('false_positive');

        const postRestoreHistory = restoredTriageService.getTriageHistory(
          testSiteId,
          testFingerprint,
        );
        expect(postRestoreHistory.length).toBe(3);
        expect(postRestoreHistory[2].revision).toBe(3);
      } finally {
        restoredConn.close();
      }
    });

    it('creates hot backup from file-backed WAL database and preserves complete triage data and triggers across restore', async () => {
      const sourceDbPath = path.join(backupDir, 'source-file-backed.db');
      const fileBackupDest = path.join(backupDir, 'file-backed-backup.db');

      const sourceConn = new DatabaseConnection(sourceDbPath);
      sourceConn.open();

      try {
        const runner = new MigrationRunner(sourceConn);
        await runner.migrate();

        const pRepo = new ProjectRepository(sourceConn);
        const sRepo = new SiteRepository(sourceConn);
        const tService = new FindingTriageService(sourceConn, sRepo);

        const project = pRepo.create({ name: 'File Backup Project' });
        const site = sRepo.create({
          projectId: project.id,
          name: 'File Backup Site',
          baseUrl: 'https://file-backup.example.com',
        });

        // Add 2 triage decisions
        await tService.updateTriage({
          siteId: site.id,
          findingFingerprint: testFingerprint,
          targetStatus: 'accepted_risk',
          expectedRevision: 0,
          expectedPreviousStatus: 'active',
          reason: 'Initial risk acceptance on disk DB',
          userId: 'disk_user',
        });

        await tService.updateTriage({
          siteId: site.id,
          findingFingerprint: testFingerprint,
          targetStatus: 'confirmed',
          expectedRevision: 1,
          expectedPreviousStatus: 'accepted_risk',
          reason: 'Reclassified to confirmed after pen-test',
          userId: 'disk_user',
        });

        // Backup while source connection is active (hot backup)
        await sourceConn.backup(fileBackupDest);
        expect(fs.existsSync(fileBackupDest)).toBe(true);

        // Open restored connection
        const restoredFileConn = new DatabaseConnection(fileBackupDest);
        restoredFileConn.open();

        try {
          expect(restoredFileConn.quickCheck().ok).toBe(true);
          expect(restoredFileConn.getRawDb().pragma('foreign_keys', { simple: true })).toBe(1);

          const restoredTService = new FindingTriageService(
            restoredFileConn,
            new SiteRepository(restoredFileConn),
          );
          const state = restoredTService.getTriageState(site.id, testFingerprint);
          expect(state.revision).toBe(2);
          expect(state.status).toBe('confirmed');

          const history = restoredTService.getTriageHistory(site.id, testFingerprint);
          expect(history.length).toBe(2);
          expect(history[0].status).toBe('accepted_risk');
          expect(history[1].status).toBe('confirmed');

          // Verify triggers on restored file DB
          expect(() => {
            restoredFileConn
              .getRawDb()
              .prepare('DELETE FROM finding_triage_events WHERE id = ?')
              .run(history[0].id);
          }).toThrow(/finding_triage_events records are append-only and cannot be deleted/);
        } finally {
          restoredFileConn.close();
        }
      } finally {
        sourceConn.close();
      }
    });
  });
});
