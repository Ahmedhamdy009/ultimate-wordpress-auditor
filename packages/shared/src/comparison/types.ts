/**
 * Finding Comparison & Verification Predicate Types.
 * Defines models for 5-part resolution verification, symmetric baseline verification,
 * diagnostic unchecked reason codes, and Tier 3 aggregate group outcomes.
 */

import type { FindingSeverity, FindingConfidence, FindingStatus } from '../schemas/finding.js';
import type { FindingTriageStatus } from '../schemas/triage.js';
import type { IdentityTier } from '../identity/types.js';

export const COMPARISON_CLASSIFICATIONS = [
  'RESOLVED',
  'NEW',
  'PERSISTENT',
  'UNCHECKED',
] as const;

export type ComparisonClassification = (typeof COMPARISON_CLASSIFICATIONS)[number];

export const NEW_FINDING_SUBTYPES = [
  'CONFIRMED_REGRESSION',
  'BASELINE_UNCOVERED',
  'UNVERIFIABLE_BASELINE',
] as const;

export type NewFindingSubtype = (typeof NEW_FINDING_SUBTYPES)[number];

export const UNCHECKED_REASON_CODES = [
  'PAGE_NOT_CRAWLED',
  'PAGE_FETCH_FAILED',
  'REDIRECTED_TARGET',
  'SOFT_404_DETECTED',
  'BROWSER_AUDIT_SKIPPED',
  'BROWSER_AUDIT_FAILED',
  'ENGINE_EXECUTION_FAILED',
  'MODULE_DISABLED_IN_CONFIG',
  'RULE_UNAVAILABLE',
  'RULE_EVALUATION_INCOMPLETE',
  'SCAN_PROFILE_INSUFFICIENT',
  'ANALYZER_VERSION_DRIFT',
  'AMBIGUOUS_IDENTITY_SHIFT',
  'INSUFFICIENT_HISTORICAL_TELEMETRY',
  'RULE_CATALOG_OVERFLOW',
  'TELEMETRY_UNVERIFIABLE',
  'PARTIAL_CRAWL_GRAPH',
  'AXE_RULE_EVALUATION_UNPROVEN',
] as const;

export type UncheckedReasonCode = (typeof UNCHECKED_REASON_CODES)[number];

export interface ResolutionVerificationContext {
  readonly targetUrl: string;
  readonly ruleId: string;
  readonly category: string;
  readonly isBrowserDependent: boolean;

  // Scan B (Retest / Follow-up Scan) Evidence
  readonly scanB: {
    readonly isTerminalSuccess: boolean;
    readonly crawledUrls?: readonly string[];
    readonly browserAuditedUrls?: readonly string[];
    readonly completedEngines?: readonly string[];
    readonly activeModules?: Record<string, boolean>;
    readonly registryVersion?: string;
    readonly ruleCatalog?: readonly string[];
    readonly omittedRuleIds?: readonly string[];
    readonly ruleOutcomeOnUrl?: 'CLEAN' | 'WITH_FINDINGS' | 'SKIPPED' | 'FAILED';
    readonly isUrlRedirected?: boolean;
    readonly isSoft404?: boolean;
    readonly isUrlRedirectedOrSoft404?: boolean;
    readonly hasFetchFailureOnUrl?: boolean;
    readonly profileDepth?: 'quick' | 'deep' | 'security' | 'performance' | 'seo' | 'full';
  };

  // Scan A (Baseline) Context
  readonly scanA?: {
    readonly profileDepth?: 'quick' | 'deep' | 'security' | 'performance' | 'seo' | 'full';
    readonly registryVersion?: string;
  };
}

export interface ResolutionPredicateResult {
  readonly isResolved: boolean;
  readonly classification: 'RESOLVED' | 'UNCHECKED';
  readonly uncheckedReason?: UncheckedReasonCode;
  readonly diagnosticDetail?: string;
}

export interface SymmetricBaselineContext {
  readonly targetUrl: string;
  readonly ruleId: string;
  readonly category: string;
  readonly isBrowserDependent: boolean;

  // Scan A (Baseline) Evidence
  readonly scanA: {
    readonly hasTelemetry: boolean;
    readonly isTerminalSuccess: boolean;
    readonly crawledUrls?: readonly string[];
    readonly browserAuditedUrls?: readonly string[];
    readonly completedEngines?: readonly string[];
    readonly activeModules?: Record<string, boolean>;
    readonly registryVersion?: string;
    readonly ruleCatalog?: readonly string[];
    readonly omittedRuleIds?: readonly string[];
    readonly ruleOutcomeOnUrl?: 'CLEAN' | 'WITH_FINDINGS' | 'SKIPPED' | 'FAILED';
    readonly isUrlRedirected?: boolean;
    readonly isSoft404?: boolean;
    readonly isUrlRedirectedOrSoft404?: boolean;
    readonly hasFetchFailureOnUrl?: boolean;
  };
}

export interface SymmetricBaselineResult {
  readonly newSubtype: NewFindingSubtype;
  readonly confidence: number;
  readonly diagnosticDetail?: string;
}

export type Tier3GroupComparisonOutcome =
  | 'RESOLVED_GROUP'
  | 'CONFIRMED_REGRESSION_GROUP'
  | 'AGGREGATE_COUNT_REDUCED'
  | 'AGGREGATE_COUNT_INCREASED'
  | 'PERSISTENT_GROUP'
  | 'UNCHECKED_GROUP';

export interface Tier3GroupComparisonResult {
  readonly outcome: Tier3GroupComparisonOutcome;
  readonly countA: number;
  readonly countB: number;
  readonly deltaCount: number;
  readonly incrementsResolvedExecutiveMetric: boolean;
  readonly incrementsRegressionExecutiveMetric: boolean;
  readonly matchBasis: string;
  readonly uncheckedReason?: UncheckedReasonCode;
}

export const SCAN_COMPARABILITY_STATUSES = [
  'FULLY_COMPARABLE',
  'PARTIALLY_COMPARABLE',
  'INSUFFICIENTLY_COMPARABLE',
] as const;

export type ScanComparabilityStatus = (typeof SCAN_COMPARABILITY_STATUSES)[number];

export const SEVERITY_DRIFT_DIRECTIONS = [
  'ESCALATED',
  'DE-ESCALATED',
  'UNCHANGED',
] as const;

export type SeverityDriftDirection = (typeof SEVERITY_DRIFT_DIRECTIONS)[number];

export interface ComparisonEvidenceDiff {
  readonly baselineSelector?: string | null;
  readonly currentSelector?: string | null;
  readonly isSelectorShifted: boolean;
  readonly baselineLineNumber?: number | null;
  readonly currentLineNumber?: number | null;
  readonly isLineShifted: boolean;
}

export interface ProjectedFindingDTO {
  readonly id: string;
  readonly scanRunId: string;
  readonly ruleId: string;
  readonly category: string;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  readonly status: FindingStatus;
  readonly targetUrl: string;
  readonly fingerprint: string | null;
  readonly selector: string | null;
  readonly lineNumber: number | null;
}

export interface ComparisonFindingItemDTO {
  readonly fingerprint: string;
  readonly ruleId: string;
  readonly category: string;
  readonly targetUrl: string;
  readonly classification: ComparisonClassification;
  readonly newSubtype?: NewFindingSubtype;
  readonly uncheckedReason?: UncheckedReasonCode;
  readonly diagnosticDetail?: string;
  readonly baselineFindingId?: string;
  readonly currentFindingId?: string;
  readonly baselineSeverity?: FindingSeverity;
  readonly currentSeverity?: FindingSeverity;
  readonly severityDrift?: SeverityDriftDirection;
  readonly evidenceDiff?: ComparisonEvidenceDiff;
  readonly identityTier: IdentityTier;
  readonly matchConfidence: number;
  // Triage overlay (read-only, never mutates raw finding)
  readonly triageStatus?: FindingTriageStatus;
  readonly triageRevision?: number;
  readonly triageReason?: string | null;
  readonly triageNotes?: string | null;
  readonly triageUpdatedAt?: string;
}

export interface ComparisonScorecardDTO {
  readonly resolvedCount: number;
  readonly confirmedRegressionCount: number;
  readonly persistentCount: number;
  readonly uncheckedCount: number;
  readonly baselineUncoveredCount: number;
  readonly unverifiableBaselineCount: number;
  readonly escalatedCount: number;
  readonly deEscalatedCount: number;
  readonly totalBaselineFindings: number;
  readonly totalCurrentFindings: number;
  readonly netDelta: number;
}

export interface ScanComparabilityDimensionsResult {
  readonly urlScope: 'FULL' | 'PARTIAL' | 'DISJOINT';
  readonly browserScope: 'FULL' | 'PARTIAL' | 'NONE';
  readonly engineExecution: 'MATCH' | 'MISMATCH';
  readonly moduleConfiguration: 'MATCH' | 'SUBSET' | 'DISJOINT';
  readonly ruleAvailability: 'MATCH' | 'DRIFT';
  readonly ruleEvaluation: 'COMPLETE' | 'PARTIAL';
  readonly analyzerVersion: 'MATCH' | 'DRIFT';
  readonly scanProfile: 'MATCH' | 'DOWNGRADE' | 'UPGRADE';
}

export interface ScanComparisonDTO {
  readonly baselineScanId: string;
  readonly currentScanId: string;
  readonly siteId: string;
  readonly comparabilityStatus: ScanComparabilityStatus;
  readonly comparabilityDimensions: ScanComparabilityDimensionsResult;
  readonly comparabilityWarnings: readonly string[];
  readonly scorecard: ComparisonScorecardDTO;
  readonly findings: readonly ComparisonFindingItemDTO[];
  readonly comparedAt: string;
}

