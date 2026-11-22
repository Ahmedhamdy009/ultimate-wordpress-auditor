/**
 * Rule Catalog & Omission Telemetry Engine.
 * Constructs bounded, deterministic catalog arrays for scan run persistence,
 * respecting the 200-entry / 8KB catalog budget and 50-entry / 2KB omission telemetry budget.
 */

import { z } from 'zod';
import type { RuleCatalogMetadata } from './types.js';

export const MAX_RULE_CATALOG_ENTRIES = 200;
export const MAX_RULE_CATALOG_BYTES = 8192; // 8 KB

export const MAX_OMITTED_RULE_ENTRIES = 50;
export const MAX_OMITTED_RULE_BYTES = 2048; // 2 KB

const RULE_ID_SYNTAX = /^[A-Za-z0-9_-]+$/;

export const RuleIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(RULE_ID_SYNTAX, 'Rule ID must contain only ASCII alphanumeric characters, underscores, or hyphens');

export function isValidRuleId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return false;
  return RULE_ID_SYNTAX.test(trimmed);
}

export interface BuildCatalogResult {
  readonly admittedRuleIds: readonly string[];
  readonly metadata: RuleCatalogMetadata;
  readonly ruleIndexMap: ReadonlyMap<string, number>;
  readonly invalidRuleCount: number;
  readonly duplicateRuleCount: number;
}

/**
 * Builds the admitted rule catalog and bounded omission telemetry from raw candidate rule IDs.
 */
export function buildRuleCatalog(
  rawCandidateRuleIds: Iterable<unknown>,
  registryVersion: string,
): BuildCatalogResult {
  const validRuleSet = new Set<string>();
  let invalidRuleCount = 0;
  let totalCandidates = 0;

  for (const raw of rawCandidateRuleIds) {
    totalCandidates++;
    if (isValidRuleId(raw)) {
      validRuleSet.add(raw.trim());
    } else {
      invalidRuleCount++;
    }
  }

  const duplicateRuleCount = totalCandidates - invalidRuleCount - validRuleSet.size;
  const sortedCandidates = Array.from(validRuleSet).sort();

  // 1. Admit into ruleCatalog (max 200 entries, max 8192 bytes)
  const admitted: string[] = [];
  let admittedBytes = 2; // "[]"

  let idx = 0;
  while (idx < sortedCandidates.length) {
    const candidate = sortedCandidates[idx];
    if (admitted.length >= MAX_RULE_CATALOG_ENTRIES) {
      break;
    }
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8') + (admitted.length > 0 ? 1 : 0);
    if (admittedBytes + candidateBytes > MAX_RULE_CATALOG_BYTES) {
      break;
    }
    admitted.push(candidate);
    admittedBytes += candidateBytes;
    idx++;
  }

  const omittedCandidates = sortedCandidates.slice(idx);
  const isCatalogTruncated = omittedCandidates.length > 0;

  // 2. Admit into omittedRuleIds (max 50 entries, max 2048 bytes)
  const omittedAdmitted: string[] = [];
  let omittedBytes = 2; // "[]"

  let oIdx = 0;
  while (oIdx < omittedCandidates.length) {
    const candidate = omittedCandidates[oIdx];
    if (omittedAdmitted.length >= MAX_OMITTED_RULE_ENTRIES) {
      break;
    }
    const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8') + (omittedAdmitted.length > 0 ? 1 : 0);
    if (omittedBytes + candidateBytes > MAX_OMITTED_RULE_BYTES) {
      break;
    }
    omittedAdmitted.push(candidate);
    omittedBytes += candidateBytes;
    oIdx++;
  }

  const unrecordedOmittedCount = omittedCandidates.length - omittedAdmitted.length;
  const isOmissionIdentityTruncated = unrecordedOmittedCount > 0;

  const ruleIndexMap = new Map<string, number>();
  admitted.forEach((id, index) => ruleIndexMap.set(id, index));

  const metadata: RuleCatalogMetadata = {
    registryVersion,
    admittedCount: admitted.length,
    omittedCount: omittedCandidates.length,
    unrecordedOmittedCount,
    isCatalogTruncated,
    isOmissionIdentityTruncated,
    firstOmittedRuleId: isCatalogTruncated ? omittedCandidates[0] : undefined,
    lastRecordedOmittedRuleId: omittedAdmitted.length > 0 ? omittedAdmitted[omittedAdmitted.length - 1] : undefined,
    omittedRuleIds: omittedAdmitted,
  };

  return {
    admittedRuleIds: Object.freeze(admitted),
    metadata,
    ruleIndexMap,
    invalidRuleCount,
    duplicateRuleCount,
  };
}
