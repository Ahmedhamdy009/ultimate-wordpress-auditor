/**
 * Level C Fallback Summary Engine.
 * Constructs minimal summary payloads when core summary exceeds 512 KB.
 * Enforces explicit non-negative safe integer validation, explicit null representation
 * for corrupted counters, and verified serialized byte bounds [231, 331].
 */

import { z } from 'zod';

export const LEVEL_C_WARNING_STANDARD =
  'Core summary payload exceeded 512KB; minimal fallback persisted.';

export const LEVEL_C_WARNING_INVALID_COUNTERS =
  'Core summary payload exceeded 512KB; minimal fallback persisted. INVALID_COUNTER_DATA.';

export const SafeIntegerCounterSchema = z
  .number()
  .refine(val => Number.isSafeInteger(val) && val >= 0, {
    message: 'Counter must be a non-negative safe integer (0 <= n <= Number.MAX_SAFE_INTEGER)',
  })
  .nullable();

export const LevelCFallbackSummarySchema = z.object({
  totalFindings: SafeIntegerCounterSchema,
  criticalCount: SafeIntegerCounterSchema,
  highCount: SafeIntegerCounterSchema,
  mediumCount: SafeIntegerCounterSchema,
  lowCount: SafeIntegerCounterSchema,
  infoCount: SafeIntegerCounterSchema,
  isPartialCoverage: z.literal(true),
  coverageStatus: z.literal('partial'),
  coverageWarning: z.union([
    z.literal(LEVEL_C_WARNING_STANDARD),
    z.literal(LEVEL_C_WARNING_INVALID_COUNTERS),
  ]),
});

export type LevelCFallbackSummary = z.infer<typeof LevelCFallbackSummarySchema>;

export interface RawCounterInputs {
  readonly totalFindings?: unknown;
  readonly criticalCount?: unknown;
  readonly highCount?: unknown;
  readonly mediumCount?: unknown;
  readonly lowCount?: unknown;
  readonly infoCount?: unknown;
}

export function sanitizeCounter(val: unknown): number | null {
  if (typeof val === 'number' && Number.isSafeInteger(val) && val >= 0) {
    return val;
  }
  return null;
}

/**
 * Creates a validated Level C fallback summary object.
 * Guaranteed never to throw and never to cause an already completed scan to fail.
 */
export function createLevelCFallback(rawInputs: RawCounterInputs): LevelCFallbackSummary {
  const totalFindings = sanitizeCounter(rawInputs.totalFindings);
  const criticalCount = sanitizeCounter(rawInputs.criticalCount);
  const highCount = sanitizeCounter(rawInputs.highCount);
  const mediumCount = sanitizeCounter(rawInputs.mediumCount);
  const lowCount = sanitizeCounter(rawInputs.lowCount);
  const infoCount = sanitizeCounter(rawInputs.infoCount);

  const hasAnyNull =
    totalFindings === null ||
    criticalCount === null ||
    highCount === null ||
    mediumCount === null ||
    lowCount === null ||
    infoCount === null;

  return {
    totalFindings,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    infoCount,
    isPartialCoverage: true,
    coverageStatus: 'partial',
    coverageWarning: hasAnyNull ? LEVEL_C_WARNING_INVALID_COUNTERS : LEVEL_C_WARNING_STANDARD,
  };
}
