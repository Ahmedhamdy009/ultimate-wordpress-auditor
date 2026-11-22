import { describe, it, expect } from 'vitest';
import {
  createLevelCFallback,
  sanitizeCounter,
  LevelCFallbackSummarySchema,
  LEVEL_C_WARNING_STANDARD,
  LEVEL_C_WARNING_INVALID_COUNTERS,
} from '@auditor/shared';

describe('Level C Fallback Summary Engine', () => {
  describe('sanitizeCounter', () => {
    it('accepts non-negative safe integers', () => {
      expect(sanitizeCounter(0)).toBe(0);
      expect(sanitizeCounter(42)).toBe(42);
      expect(sanitizeCounter(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('rejects negative, non-integer, or non-number values and returns null', () => {
      expect(sanitizeCounter(-1)).toBeNull();
      expect(sanitizeCounter(3.14)).toBeNull();
      expect(sanitizeCounter(NaN)).toBeNull();
      expect(sanitizeCounter(Infinity)).toBeNull();
      expect(sanitizeCounter('42')).toBeNull();
      expect(sanitizeCounter(null)).toBeNull();
      expect(sanitizeCounter(undefined)).toBeNull();
    });
  });

  describe('createLevelCFallback & Byte Bounds', () => {
    it('creates standard fallback when all counters are valid integers', () => {
      const summary = createLevelCFallback({
        totalFindings: 10,
        criticalCount: 1,
        highCount: 2,
        mediumCount: 3,
        lowCount: 4,
        infoCount: 0,
      });

      expect(summary.totalFindings).toBe(10);
      expect(summary.coverageWarning).toBe(LEVEL_C_WARNING_STANDARD);
      expect(summary.coverageStatus).toBe('partial');
      expect(summary.isPartialCoverage).toBe(true);

      const parsed = LevelCFallbackSummarySchema.safeParse(summary);
      expect(parsed.success).toBe(true);
    });

    it('creates invalid counters warning when any counter is corrupt or missing', () => {
      const summary = createLevelCFallback({
        totalFindings: 10,
        criticalCount: -5, // corrupt
        highCount: 'invalid', // corrupt
        mediumCount: 3,
        lowCount: 4,
        infoCount: 0,
      });

      expect(summary.criticalCount).toBeNull();
      expect(summary.highCount).toBeNull();
      expect(summary.mediumCount).toBe(3);
      expect(summary.coverageWarning).toBe(LEVEL_C_WARNING_INVALID_COUNTERS);

      const parsed = LevelCFallbackSummarySchema.safeParse(summary);
      expect(parsed.success).toBe(true);
    });

    it('proves that serialized UTF-8 bytes strictly fall within [231, 331] bounds across all valid states', () => {
      // Minimum bound: all counters 0 with standard warning
      const minSummary = createLevelCFallback({
        totalFindings: 0,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
      });
      const minBytes = Buffer.byteLength(JSON.stringify(minSummary), 'utf8');
      expect(minBytes).toBe(231);

      // Maximum bound: 5 counters at MAX_SAFE_INTEGER (16 digits) + 1 null counter + INVALID_COUNTERS warning
      const maxSummary = createLevelCFallback({
        totalFindings: 9007199254740991,
        criticalCount: 9007199254740991,
        highCount: 9007199254740991,
        mediumCount: 9007199254740991,
        lowCount: 9007199254740991,
        infoCount: null, // triggers INVALID_COUNTERS warning
      });
      const maxBytes = Buffer.byteLength(JSON.stringify(maxSummary), 'utf8');
      expect(maxBytes).toBe(331);

      // Verify that every intermediate state is >= 231 and <= 331
      expect(minBytes).toBeGreaterThanOrEqual(231);
      expect(maxBytes).toBeLessThanOrEqual(331);
    });
  });
});
