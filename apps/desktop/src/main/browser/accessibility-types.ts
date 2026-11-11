/**
 * Batch 4.4 Accessibility Types and Contracts.
 * Defines standard contracts for offline axe-core integration,
 * WCAG criteria mapping, evidence collection, and finding classification.
 */

import type { CreateFindingRequest } from '@auditor/shared';

export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical' | null;

export const DEFAULT_WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

export const BEST_PRACTICE_TAG = 'best-practice' as const;

export const SUPPORTED_WCAG_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag2aaa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
] as const;

export const DEFAULT_MAX_VIOLATIONS = 100;
export const DEFAULT_MAX_INCOMPLETE = 50;
export const DEFAULT_MAX_NODES_PER_VIOLATION = 20;
export const DEFAULT_MAX_SNIPPET_LENGTH = 500;
export const DEFAULT_MAX_EVIDENCE_BYTES = 65536;
export const DEFAULT_AUDIT_TIMEOUT_MS = 20000;

export const A11Y_DISCLAIMER =
  'Automated axe-core testing evaluates detectable accessibility rules and does NOT certify full WCAG compliance. Manual review is required for subjective and assistive technology criteria.' as const;

export interface AccessibilityCheckMessage {
  readonly id: string;
  readonly impact?: string;
  readonly message: string;
  readonly data?: unknown;
}

export interface AccessibilityNodeEvidence {
  readonly target: readonly string[];
  readonly targetSelector: string;
  readonly structuralLocator?: string;
  readonly selectorNotice?: string;
  readonly html: string;
  readonly failureSummary?: string;
  readonly impact?: AxeImpact;
  readonly any?: readonly AccessibilityCheckMessage[];
  readonly all?: readonly AccessibilityCheckMessage[];
  readonly none?: readonly AccessibilityCheckMessage[];
}

export interface AccessibilityRuleResult {
  readonly id: string;
  readonly description: string;
  readonly help: string;
  readonly helpUrl: string;
  readonly impact?: AxeImpact;
  readonly tags: readonly string[];
  readonly wcagCriteria: readonly string[];
  readonly nodes: readonly AccessibilityNodeEvidence[];
  readonly totalNodesDetected: number;
  readonly nodesTruncated: boolean;
}

export interface AccessibilityIncompleteResult {
  readonly id: string;
  readonly description: string;
  readonly help: string;
  readonly helpUrl: string;
  readonly impact?: AxeImpact;
  readonly tags: readonly string[];
  readonly wcagCriteria: readonly string[];
  readonly nodes: readonly AccessibilityNodeEvidence[];
  readonly totalNodesDetected: number;
  readonly nodesTruncated: boolean;
  readonly reviewReason?: string;
}

export interface AccessibilityAuditorOptions {
  /** WCAG and best-practice tags to run (default: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) */
  readonly tags?: readonly string[];
  /** Specific rule enables / disables */
  readonly rules?: Record<string, { enabled: boolean }>;
  /** Include best-practice rules alongside normative WCAG rules */
  readonly includeBestPractice?: boolean;
  /** Timeout in ms for axe execution (default: 20000) */
  readonly timeoutMs?: number;
  /** Maximum number of violation rules to retain (default: 100) */
  readonly maxViolations?: number;
  /** Maximum number of incomplete rules to retain (default: 50) */
  readonly maxIncomplete?: number;
  /** Maximum nodes retained per violation rule (default: 20) */
  readonly maxNodesPerViolation?: number;
  /** Maximum character length for HTML snippets (default: 500) */
  readonly maxSnippetLength?: number;
  /** Maximum serialized evidence bytes per finding (default: 65536) */
  readonly maxEvidenceBytes?: number;
  /** Scan run ID for finding tracking */
  readonly scanRunId?: string;
  /** Viewport profile label if evaluated under specific viewport */
  readonly viewportProfile?: string;
  /** Cancellation signal */
  readonly signal?: AbortSignal;
  /** Page ownership model: 'shared' (default) prevents closing the page; 'exclusive' permits closing page on cancellation */
  readonly pageOwnership?: 'shared' | 'exclusive';
  /** If true, explicitly closes the page upon timeout or cancellation (only when pageOwnership is 'exclusive') */
  readonly closePageOnCancel?: boolean;
}

export interface AccessibilityAuditMetrics {
  readonly violationsCount: number;
  readonly criticalCount: number;
  readonly seriousCount: number;
  readonly moderateCount: number;
  readonly minorCount: number;
  readonly incompleteCount: number;
  readonly passesCount: number;
  readonly inapplicableCount: number;
  readonly durationMs: number;
}

export interface AccessibilityLimitsReached {
  readonly violationsLimit: boolean;
  readonly incompleteLimit: boolean;
  readonly nodesLimit: boolean;
  readonly snippetLimit: boolean;
  readonly evidenceLimit: boolean;
  readonly timeout: boolean;
}

export interface AccessibilityAuditReport {
  readonly pageUrl: string;
  readonly wcagStandards: readonly string[];
  readonly violations: readonly AccessibilityRuleResult[];
  readonly incomplete: readonly AccessibilityIncompleteResult[];
  readonly findings: readonly CreateFindingRequest[];
  readonly metrics: AccessibilityAuditMetrics;
  readonly limitsReached: AccessibilityLimitsReached;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly disclaimer: string;
  readonly cancellationState?:
    | 'completed'
    | 'caller_timeout_renderer_pending'
    | 'caller_aborted_renderer_pending'
    | 'terminated_by_page_close'
    | 'overlapping_prevented';
  readonly error?: string;
}

export interface AxeExecutionRawResult {
  readonly id: string;
  readonly description: string;
  readonly help: string;
  readonly helpUrl: string;
  readonly impact?: AxeImpact;
  readonly tags: readonly string[];
  readonly nodes: ReadonlyArray<{
    readonly html: string;
    readonly target: readonly (string | readonly string[])[];
    readonly impact?: AxeImpact;
    readonly failureSummary?: string;
    readonly any?: ReadonlyArray<{
      readonly id: string;
      readonly impact: string;
      readonly message: string;
      readonly data?: unknown;
    }>;
    readonly all?: ReadonlyArray<{
      readonly id: string;
      readonly impact: string;
      readonly message: string;
      readonly data?: unknown;
    }>;
    readonly none?: ReadonlyArray<{
      readonly id: string;
      readonly impact: string;
      readonly message: string;
      readonly data?: unknown;
    }>;
  }>;
}

export interface AxeExecutionRawResults {
  readonly violations: readonly AxeExecutionRawResult[];
  readonly incomplete: readonly AxeExecutionRawResult[];
  readonly passes: readonly AxeExecutionRawResult[];
  readonly inapplicable: readonly AxeExecutionRawResult[];
}
