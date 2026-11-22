import { describe, it, expect } from 'vitest';
import { evaluateTier3GroupComparison } from '@auditor/shared';

describe('Tier 3 Aggregate Group Comparison Engine', () => {
  it('classifies as RESOLVED_GROUP when occurrences drop from N > 0 to 0 with proven coverage', () => {
    const res = evaluateTier3GroupComparison({
      countA: 5,
      countB: 0,
      scanAClean: false,
      scanBClean: true,
      scanBHasCoverage: true,
    });
    expect(res.outcome).toBe('RESOLVED_GROUP');
    expect(res.deltaCount).toBe(-5);
  });

  it('classifies as UNCHECKED_GROUP when occurrences drop to 0 but coverage was not proven in Scan B', () => {
    const res = evaluateTier3GroupComparison({
      countA: 5,
      countB: 0,
      scanAClean: false,
      scanBClean: true,
      scanBHasCoverage: false,
    });
    expect(res.outcome).toBe('UNCHECKED_GROUP');
  });

  it('classifies as CONFIRMED_REGRESSION_GROUP when count rises from 0 to N > 0 with proven baseline coverage', () => {
    const res = evaluateTier3GroupComparison({
      countA: 0,
      countB: 3,
      scanAClean: true,
      scanBClean: false,
      scanBHasCoverage: true,
    });
    expect(res.outcome).toBe('CONFIRMED_REGRESSION_GROUP');
    expect(res.deltaCount).toBe(3);
  });

  it('classifies as AGGREGATE_COUNT_REDUCED when count decreases but remains > 0', () => {
    const res = evaluateTier3GroupComparison({
      countA: 10,
      countB: 4,
      scanAClean: false,
      scanBClean: false,
      scanBHasCoverage: true,
    });
    expect(res.outcome).toBe('AGGREGATE_COUNT_REDUCED');
    expect(res.deltaCount).toBe(-6);
  });

  it('classifies as AGGREGATE_COUNT_INCREASED when count increases from baseline', () => {
    const res = evaluateTier3GroupComparison({
      countA: 2,
      countB: 8,
      scanAClean: false,
      scanBClean: false,
      scanBHasCoverage: true,
    });
    expect(res.outcome).toBe('AGGREGATE_COUNT_INCREASED');
    expect(res.deltaCount).toBe(6);
  });

  it('classifies as PERSISTENT_GROUP when count is unchanged and > 0', () => {
    const res = evaluateTier3GroupComparison({
      countA: 3,
      countB: 3,
      scanAClean: false,
      scanBClean: false,
      scanBHasCoverage: true,
    });
    expect(res.outcome).toBe('PERSISTENT_GROUP');
    expect(res.deltaCount).toBe(0);
  });
});
