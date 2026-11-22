import { describe, it, expect } from 'vitest';
import {
  FINDING_TRIAGE_STATUSES,
  FindingTriageStatusSchema,
  FindingTriageDTOSchema,
  FindingTriageEventDTOSchema,
  TriageUpdateRequestSchema,
  validateTriageTransition,
  IPC_ERROR_CODES,
  IPCError,
} from '../../src/index.js';

describe('Triage Schemas & Validation', () => {
  const validSiteId = '123e4567-e89b-12d3-a456-426614174000';
  const validFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('validates supported finding triage statuses', () => {
    expect(FINDING_TRIAGE_STATUSES).toEqual([
      'accepted_risk',
      'false_positive',
      'ignored',
      'confirmed',
      'active',
    ]);

    for (const status of FINDING_TRIAGE_STATUSES) {
      expect(FindingTriageStatusSchema.safeParse(status).success).toBe(true);
    }

    expect(FindingTriageStatusSchema.safeParse('invalid_status').success).toBe(false);
  });

  it('validates FindingTriageDTOSchema', () => {
    const validDTO = {
      siteId: validSiteId,
      findingFingerprint: validFingerprint,
      revision: 1,
      status: 'accepted_risk',
      previousStatus: 'active',
      reason: 'Valid justification',
      notes: 'Some notes',
      updatedBy: 'local_user',
      updatedAt: new Date().toISOString(),
    };

    const parsed = FindingTriageDTOSchema.safeParse(validDTO);
    expect(parsed.success).toBe(true);

    // Invalid revision < 1
    expect(FindingTriageDTOSchema.safeParse({ ...validDTO, revision: 0 }).success).toBe(false);

    // Invalid fingerprint length
    expect(
      FindingTriageDTOSchema.safeParse({ ...validDTO, findingFingerprint: 'abc' }).success,
    ).toBe(false);
  });

  it('validates FindingTriageEventDTOSchema', () => {
    const validEvent = {
      id: '123e4567-e89b-12d3-a456-426614174001',
      siteId: validSiteId,
      findingFingerprint: validFingerprint,
      revision: 1,
      status: 'accepted_risk',
      previousStatus: 'active',
      reason: 'Valid justification',
      notes: null,
      createdBy: 'local_user',
      createdAt: new Date().toISOString(),
    };

    const parsed = FindingTriageEventDTOSchema.safeParse(validEvent);
    expect(parsed.success).toBe(true);
  });

  it('validates TriageUpdateRequestSchema', () => {
    const validRequest = {
      siteId: validSiteId,
      findingFingerprint: validFingerprint,
      targetStatus: 'accepted_risk',
      expectedRevision: 0,
      expectedPreviousStatus: 'active',
      reason: 'Valid reason here',
    };

    const parsed = TriageUpdateRequestSchema.safeParse(validRequest);
    expect(parsed.success).toBe(true);

    // Negative revision rejected
    expect(
      TriageUpdateRequestSchema.safeParse({ ...validRequest, expectedRevision: -1 }).success,
    ).toBe(false);

    // Reason too short when provided (< 5 chars)
    expect(TriageUpdateRequestSchema.safeParse({ ...validRequest, reason: 'abc' }).success).toBe(
      false,
    );
  });

  it('enforces validateTriageTransition business logic', () => {
    // Redundant transition
    expect(() => validateTriageTransition('accepted_risk', 'accepted_risk', 'Some reason')).toThrow(
      IPCError,
    );

    // Missing reason for accepted_risk
    expect(() => validateTriageTransition('active', 'accepted_risk', null)).toThrowError(
      expect.objectContaining({ code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED }),
    );

    // Reason too short (< 5 chars) for false_positive
    expect(() => validateTriageTransition('active', 'false_positive', 'abcd')).toThrowError(
      expect.objectContaining({ code: IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED }),
    );

    // Valid transitions
    expect(() =>
      validateTriageTransition('active', 'accepted_risk', 'Justified by security review'),
    ).not.toThrow();
    expect(() =>
      validateTriageTransition('active', 'false_positive', 'Dev-only mock endpoint'),
    ).not.toThrow();
    expect(() => validateTriageTransition('active', 'ignored', null)).not.toThrow();
    expect(() => validateTriageTransition('active', 'confirmed', null)).not.toThrow();
  });
});
