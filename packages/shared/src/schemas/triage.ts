import { z } from 'zod';
import { IPCError, IPC_ERROR_CODES } from '../ipc/errors.js';

export const FINDING_TRIAGE_STATUSES = [
  'accepted_risk',
  'false_positive',
  'ignored',
  'confirmed',
  'active',
] as const;

export type FindingTriageStatus = (typeof FINDING_TRIAGE_STATUSES)[number];

export const FindingTriageStatusSchema = z.enum(FINDING_TRIAGE_STATUSES);

export interface FindingTriageDTO {
  siteId: string;
  findingFingerprint: string;
  revision: number;
  status: FindingTriageStatus;
  previousStatus?: FindingTriageStatus | null;
  reason: string | null;
  notes: string | null;
  updatedBy: string;
  updatedAt: string;
}

export const FindingTriageDTOSchema = z.object({
  siteId: z.string().uuid('Invalid site ID format'),
  findingFingerprint: z
    .string()
    .length(64, 'Finding fingerprint must be exactly 64 hex characters'),
  revision: z.number().int().min(1, 'Triage revision must be at least 1'),
  status: FindingTriageStatusSchema,
  previousStatus: FindingTriageStatusSchema.nullable().optional(),
  reason: z.string().max(500).nullable(),
  notes: z.string().max(2000).nullable(),
  updatedBy: z.string().min(1).max(100),
  updatedAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
});

export interface FindingTriageEventDTO {
  id: string;
  siteId: string;
  findingFingerprint: string;
  revision: number;
  status: FindingTriageStatus;
  previousStatus: FindingTriageStatus | null;
  reason: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export const FindingTriageEventDTOSchema = z.object({
  id: z.string().uuid('Invalid triage event ID format'),
  siteId: z.string().uuid('Invalid site ID format'),
  findingFingerprint: z
    .string()
    .length(64, 'Finding fingerprint must be exactly 64 hex characters'),
  revision: z.number().int().min(1, 'Triage event revision must be at least 1'),
  status: FindingTriageStatusSchema,
  previousStatus: FindingTriageStatusSchema.nullable(),
  reason: z.string().max(500).nullable(),
  notes: z.string().max(2000).nullable(),
  createdBy: z.string().min(1).max(100),
  createdAt: z.string().datetime({ message: 'Invalid UTC ISO datetime' }),
});

export const TriageUpdateRequestSchema = z.object({
  siteId: z.string().uuid('Invalid site ID format'),
  findingFingerprint: z
    .string()
    .length(64, 'Finding fingerprint must be a 64-character SHA-256 hash'),
  targetStatus: FindingTriageStatusSchema,
  expectedRevision: z.number().int().min(0, 'Expected revision cannot be negative'),
  expectedPreviousStatus: FindingTriageStatusSchema,
  reason: z.string().trim().min(5).max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  userId: z.string().trim().min(1).max(100).optional().default('local_user'),
});

export type TriageUpdateRequest = z.input<typeof TriageUpdateRequestSchema>;
export type TriageUpdateOutput = z.output<typeof TriageUpdateRequestSchema>;

/**
 * Validates transition legality and mandatory rationale requirements according
 * to Section 7.4 of the Historical Comparison & Retesting Architecture.
 */
export function validateTriageTransition(
  actualPreviousStatus: FindingTriageStatus,
  targetStatus: FindingTriageStatus,
  reason?: string | null,
): void {
  if (actualPreviousStatus === targetStatus) {
    throw new IPCError(
      `Invalid triage transition: finding is already in status '${targetStatus}'`,
      IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
    );
  }

  if (targetStatus === 'accepted_risk' || targetStatus === 'false_positive') {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 5 || trimmedReason.length > 500) {
      throw new IPCError(
        `Transition to '${targetStatus}' strictly requires a justified reason (5 to 500 characters)`,
        IPC_ERROR_CODES.PAYLOAD_VALIDATION_FAILED,
      );
    }
  }
}
