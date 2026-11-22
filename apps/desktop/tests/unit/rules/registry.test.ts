import { describe, it, expect } from 'vitest';
import {
  createImmutableRuleRegistry,
  KNOWN_RULE_IDS_V1,
  CURRENT_REGISTRY_VERSION,
  isRuleKnownInRegistryVersion,
  SYSTEM_RULE_REGISTRIES,
} from '@auditor/shared';

describe('Immutable Rule Registry', () => {
  it('creates an immutable registry containing sorted rule IDs', () => {
    const rawIds = ['RULE_B', 'RULE_A', 'RULE_C', 'RULE_A'];
    const reg = createImmutableRuleRegistry('2026.11-test', rawIds);

    expect(reg.version).toBe('2026.11-test');
    expect(reg.size).toBe(3);
    expect(reg.getRuleIds()).toEqual(['RULE_A', 'RULE_B', 'RULE_C']);
    expect(reg.has('RULE_A')).toBe(true);
    expect(reg.has('RULE_D')).toBe(false);
  });

  it('guarantees complete internal encapsulation and rejects mutation attempts', () => {
    const reg = createImmutableRuleRegistry('2026.11-test', ['RULE_1', 'RULE_2']);
    const ids = reg.getRuleIds();

    // Returned array is frozen
    expect(Object.isFrozen(ids)).toBe(true);
    expect(() => {
      // @ts-expect-error mutating frozen array
      ids.push('RULE_3');
    }).toThrow();

    // Registry object itself is frozen
    expect(Object.isFrozen(reg)).toBe(true);
    expect(() => {
      // @ts-expect-error modifying readonly property
      reg.size = 999;
    }).toThrow();

    // Registry still contains only original rules
    expect(reg.size).toBe(2);
    expect(reg.has('RULE_3')).toBe(false);
  });

  it('verifies KNOWN_RULE_IDS_V1 contains recognized system rules', () => {
    expect(KNOWN_RULE_IDS_V1.length).toBe(122);
    expect(Object.isFrozen(KNOWN_RULE_IDS_V1)).toBe(true);

    const systemReg = SYSTEM_RULE_REGISTRIES[CURRENT_REGISTRY_VERSION];
    expect(systemReg).toBeDefined();
    expect(systemReg.size).toBe(122);
  });

  it('checks rule identity in specified registry version', () => {
    expect(isRuleKnownInRegistryVersion('SEC_HEADER_CSP_MISSING', CURRENT_REGISTRY_VERSION)).toBe(true);
    expect(isRuleKnownInRegistryVersion('SEO_H1_MISSING', CURRENT_REGISTRY_VERSION)).toBe(true);
    expect(isRuleKnownInRegistryVersion('NON_EXISTENT_RULE_XYZ', CURRENT_REGISTRY_VERSION)).toBe(false);
    expect(isRuleKnownInRegistryVersion('SEO_H1_MISSING', 'unknown-version')).toBe(false);
  });
});
