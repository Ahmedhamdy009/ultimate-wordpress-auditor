/**
 * Finding Comparison & Verification Predicate Types.
 * Defines models for 5-part resolution verification, symmetric baseline verification,
 * diagnostic unchecked reason codes, and Tier 3 aggregate group outcomes.
 */

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
