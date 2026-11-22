/**
 * Rule Registry, Catalog & Execution Telemetry Types.
 * Defines models for immutable rule registries, compact catalog indexing,
 * dual-budget omission telemetry, and strict discriminated unions for execution evidence.
 */

export interface ReadOnlyRuleRegistry {
  readonly version: string;
  readonly size: number;
  has(ruleId: string): boolean;
  getRuleIds(): readonly string[];
}

export type RuleExecutionOutcome = 'CLEAN' | 'WITH_FINDINGS' | 'SKIPPED' | 'FAILED';

export type RuleSkipReasonCode =
  | 'INAPPLICABLE_SCHEME'          // e.g. HSTS rule evaluated on http:// URL
  | 'UNAVAILABLE_TLS_METADATA'     // Response headers/socket lacked TLS handshake data
  | 'NON_HTML_DOCUMENT'            // Crawled target is binary, image, or non-HTML resource
  | 'NO_MATCHING_ELEMENTS'         // Target selectors/tags absent in DOM
  | 'MODULE_CONFIG_DISABLED'       // Audit module disabled in ScanConfig.auditModules
  | 'FEATURE_FLAG_DISABLED'        // Specific rule toggle disabled in scan options
  | 'CONTENT_TYPE_EXCLUDED'        // Excluded by analyzer mime-type filter
  | 'CROSS_ORIGIN_RESTRICTED'      // Element targets domain outside authorized crawl scope
  | 'PARENT_MODULE_SKIPPED'        // Preceding stage skipped
  | 'MALFORMED_HEADER';            // Malformed header syntax prevents directive extraction

export type RuleFailureCode =
  | 'ANALYZER_EXCEPTION'           // Catch block intercepted unhandled error during evaluation
  | 'DOM_PARSER_ERROR'             // HTML parser failed AST generation
  | 'TIMEOUT_EXCEEDED'             // Rule execution exceeded per-page time slice
  | 'RESOURCE_LIMIT_EXCEEDED'      // Page finding limit (max 50) or DOM node limit reached
  | 'PARENT_MODULE_FAILED'         // Module crashed before rule could finish
  | 'CATALOG_OVERFLOW_OMITTED';    // Evaluated but omitted from compact catalog

export interface RuleExecutionRecordClean {
  readonly ruleId?: string;
  readonly ruleIdx?: number;
  readonly outcome: 'CLEAN';
  readonly skipReason?: never;
  readonly failureCode?: never;
}

export interface RuleExecutionRecordWithFindings {
  readonly ruleId?: string;
  readonly ruleIdx?: number;
  readonly outcome: 'WITH_FINDINGS';
  readonly skipReason?: never;
  readonly failureCode?: never;
}

export interface RuleExecutionRecordSkipped {
  readonly ruleId?: string;
  readonly ruleIdx?: number;
  readonly outcome: 'SKIPPED';
  readonly skipReason: RuleSkipReasonCode;
  readonly failureCode?: never;
}

export interface RuleExecutionRecordFailed {
  readonly ruleId?: string;
  readonly ruleIdx?: number;
  readonly outcome: 'FAILED';
  readonly skipReason?: never;
  readonly failureCode: RuleFailureCode;
}

export type RuleExecutionRecord =
  | RuleExecutionRecordClean
  | RuleExecutionRecordWithFindings
  | RuleExecutionRecordSkipped
  | RuleExecutionRecordFailed;

export interface SiteExecutionRecord {
  readonly ruleId: string;
  readonly outcome: RuleExecutionOutcome;
  readonly skipReason?: string;
  readonly failureCode?: string;
}

export interface RuleCatalogMetadata {
  readonly registryVersion: string;
  readonly admittedCount: number;
  readonly omittedCount: number;
  readonly unrecordedOmittedCount: number;
  readonly isCatalogTruncated: boolean;
  readonly isOmissionIdentityTruncated: boolean;
  readonly firstOmittedRuleId?: string;
  readonly lastRecordedOmittedRuleId?: string;
  readonly omittedRuleIds: string[];
}
