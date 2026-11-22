import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { DatabaseConnection } from '../../src/main/db/connection.js';
import { MigrationRunner } from '../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../src/main/db/repositories/site.repository.js';
import { FindingTriageService } from '../../src/main/services/finding-triage.service.js';
import { IPC_ERROR_CODES } from '@auditor/shared';

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
});
