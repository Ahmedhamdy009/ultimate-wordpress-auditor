import { describe, it, expect } from 'vitest';
import {
  buildRuleCatalog,
  isValidRuleId,
  MAX_RULE_CATALOG_ENTRIES,
  MAX_RULE_CATALOG_BYTES,
  MAX_OMITTED_RULE_ENTRIES,
} from '@auditor/shared';

describe('Rule Catalog & Omission Telemetry Engine', () => {
  describe('Rule ID Syntax Validation', () => {
    it('accepts valid rule IDs', () => {
      expect(isValidRuleId('SEC_HEADER_CSP_MISSING')).toBe(true);
      expect(isValidRuleId('rule-123_abc')).toBe(true);
      expect(isValidRuleId('A11Y_CONTRAST_RATIO')).toBe(true);
    });

    it('rejects invalid or malformed rule IDs', () => {
      expect(isValidRuleId('')).toBe(false);
      expect(isValidRuleId('   ')).toBe(false);
      expect(isValidRuleId(null)).toBe(false);
      expect(isValidRuleId(123)).toBe(false);
      expect(isValidRuleId('RULE WITH SPACES')).toBe(false);
      expect(isValidRuleId('RULE_WITH_SPECIAL_CHARS!@#')).toBe(false);
      expect(isValidRuleId('a'.repeat(65))).toBe(false); // exceeds 64 chars
    });
  });

  describe('buildRuleCatalog Bounding & Budgets', () => {
    it('builds a sorted catalog within 200 entries and 8KB budget', () => {
      const candidates = ['RULE_B', 'RULE_A', 'RULE_C', 'RULE_A', 'INVALID CHARS!'];
      const res = buildRuleCatalog(candidates, '2026.11-v1');

      expect(res.admittedRuleIds).toEqual(['RULE_A', 'RULE_B', 'RULE_C']);
      expect(res.invalidRuleCount).toBe(1);
      expect(res.duplicateRuleCount).toBe(1);
      expect(res.metadata.admittedCount).toBe(3);
      expect(res.metadata.omittedCount).toBe(0);
      expect(res.metadata.isCatalogTruncated).toBe(false);
      expect(res.ruleIndexMap.get('RULE_A')).toBe(0);
      expect(res.ruleIndexMap.get('RULE_B')).toBe(1);
      expect(res.ruleIndexMap.get('RULE_C')).toBe(2);
    });

    it('enforces 200-rule limit and splits excess into omittedRuleIds', () => {
      const candidates: string[] = [];
      for (let i = 0; i < 280; i++) {
        candidates.push(`RULE_${String(i).padStart(4, '0')}`);
      }

      const res = buildRuleCatalog(candidates, '2026.11-v1');

      expect(res.admittedRuleIds.length).toBe(MAX_RULE_CATALOG_ENTRIES);
      expect(res.metadata.admittedCount).toBe(200);
      expect(res.metadata.omittedCount).toBe(80);
      expect(res.metadata.isCatalogTruncated).toBe(true);

      // Omission budget is max 50 entries
      expect(res.metadata.omittedRuleIds.length).toBe(MAX_OMITTED_RULE_ENTRIES);
      expect(res.metadata.unrecordedOmittedCount).toBe(30); // 80 - 50 = 30 unrecorded
      expect(res.metadata.isOmissionIdentityTruncated).toBe(true);
      expect(res.metadata.firstOmittedRuleId).toBe('RULE_0200');
      expect(res.metadata.lastRecordedOmittedRuleId).toBe('RULE_0249');
    });

    it('enforces byte budget for catalog serialization', () => {
      // Create long valid rule IDs (60 characters each)
      const longCandidates: string[] = [];
      for (let i = 0; i < 200; i++) {
        longCandidates.push(`RULE_${String(i).padStart(3, '0')}_${'X'.repeat(50)}`);
      }

      const res = buildRuleCatalog(longCandidates, '2026.11-v1');

      const serializedBytes = Buffer.byteLength(JSON.stringify(res.admittedRuleIds), 'utf8');
      expect(serializedBytes).toBeLessThanOrEqual(MAX_RULE_CATALOG_BYTES);
      expect(res.metadata.isCatalogTruncated).toBe(true);
    });
  });
});
