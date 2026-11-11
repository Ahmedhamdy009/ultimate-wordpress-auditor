/**
 * Batch 4.4 Accessibility Analyzer.
 * Transforms raw axe-core execution results into normalized, deduplicated findings
 * conforming to @auditor/shared CreateFindingRequest and FindingDTO schemas.
 * Enforces strict separation of confirmed violations vs manual-review incomplete results,
 * maps WCAG success criteria, and redacts sensitive element evidence.
 */

import type { CreateFindingRequest, FindingSeverity } from '@auditor/shared';
import type {
  AccessibilityAuditorOptions,
  AccessibilityIncompleteResult,
  AccessibilityLimitsReached,
  AccessibilityRuleResult,
  AxeExecutionRawResults,
  AxeImpact,
} from './accessibility-types.js';
import {
  A11Y_DISCLAIMER,
  DEFAULT_MAX_EVIDENCE_BYTES,
  DEFAULT_MAX_INCOMPLETE,
  DEFAULT_MAX_NODES_PER_VIOLATION,
  DEFAULT_MAX_SNIPPET_LENGTH,
  DEFAULT_MAX_VIOLATIONS,
} from './accessibility-types.js';
import {
  boundEvidenceSize,
  IdentifierAliaser,
  sanitizeNodeResult,
} from './accessibility-sanitizer.js';
import { redactString } from './redactor.js';

/**
 * Standard WCAG Success Criteria references mapped from axe-core tags.
 */
const WCAG_CRITERIA_MAP: Readonly<Record<string, string>> = {
  wcag111: 'WCAG 1.1.1 Non-text Content (Level A)',
  wcag121: 'WCAG 1.2.1 Audio-only and Video-only (Prerecorded) (Level A)',
  wcag122: 'WCAG 1.2.2 Captions (Prerecorded) (Level A)',
  wcag131: 'WCAG 1.3.1 Info and Relationships (Level A)',
  wcag134: 'WCAG 1.3.4 Orientation (Level AA)',
  wcag135: 'WCAG 1.3.5 Identify Input Purpose (Level AA)',
  wcag141: 'WCAG 1.4.1 Use of Color (Level A)',
  wcag142: 'WCAG 1.4.2 Audio Control (Level A)',
  wcag143: 'WCAG 1.4.3 Contrast (Minimum) (Level AA)',
  wcag144: 'WCAG 1.4.4 Resize text (Level AA)',
  wcag146: 'WCAG 1.4.6 Contrast (Enhanced) (Level AAA)',
  wcag1412: 'WCAG 1.4.12 Text Spacing (Level AA)',
  wcag211: 'WCAG 2.1.1 Keyboard (Level A)',
  wcag213: 'WCAG 2.1.3 Keyboard (No Exception) (Level AAA)',
  wcag221: 'WCAG 2.2.1 Timing Adjustable (Level A)',
  wcag222: 'WCAG 2.2.2 Pause, Stop, Hide (Level A)',
  wcag224: 'WCAG 2.2.4 Interruptions (Level AAA)',
  wcag241: 'WCAG 2.4.1 Bypass Blocks (Level A)',
  wcag242: 'WCAG 2.4.2 Page Titled (Level A)',
  wcag244: 'WCAG 2.4.4 Link Purpose (In Context) (Level A)',
  wcag249: 'WCAG 2.4.9 Link Purpose (Link Only) (Level AAA)',
  wcag253: 'WCAG 2.5.3 Label in Name (Level A)',
  wcag258: 'WCAG 2.5.8 Target Size (Minimum) (Level AA)',
  wcag311: 'WCAG 3.1.1 Language of Page (Level A)',
  wcag312: 'WCAG 3.1.2 Language of Parts (Level AA)',
  wcag325: 'WCAG 3.2.5 Change on Request (Level AAA)',
  wcag332: 'WCAG 3.3.2 Labels or Instructions (Level A)',
  wcag411: 'WCAG 4.1.1 Parsing (Level A)',
  wcag412: 'WCAG 4.1.2 Name, Role, Value (Level A)',
};

/**
 * Maps axe-core impact levels to project standard FindingSeverity.
 */
export function mapAxeImpactToSeverity(impact?: AxeImpact): FindingSeverity {
  switch (impact) {
    case 'critical':
      return 'critical';
    case 'serious':
      return 'high';
    case 'moderate':
      return 'medium';
    case 'minor':
      return 'low';
    default:
      return 'low';
  }
}

/**
 * Maps axe-core incomplete check impacts to appropriate conservative severity levels.
 * Incomplete results are unconfirmed tests requiring manual human review (neither proven to pass
 * nor proven to fail). They are mapped conservatively to prevent unverified checks from
 * inflating Critical or High severity defect indicators.
 */
export function mapAxeIncompleteImpactToSeverity(impact?: AxeImpact): FindingSeverity {
  switch (impact) {
    case 'critical':
      return 'medium';
    case 'serious':
      return 'low';
    case 'moderate':
      return 'low';
    case 'minor':
      return 'info';
    default:
      return 'low';
  }
}

/**
 * Extracts human-readable WCAG success criteria descriptions from axe tags.
 */
export function extractWcagCriteria(tags: readonly string[]): readonly string[] {
  const criteria: string[] = [];
  for (const tag of tags) {
    const mapped = WCAG_CRITERIA_MAP[tag.toLowerCase()];
    if (mapped && !criteria.includes(mapped)) {
      criteria.push(mapped);
    } else if (/^wcag\d{3,4}$/i.test(tag)) {
      const digits = tag.replace(/^wcag/i, '').split('');
      const sc = digits.length >= 3 ? `${digits[0]}.${digits[1]}.${digits.slice(2).join('')}` : tag;
      const generic = `WCAG ${sc} Success Criterion`;
      if (!criteria.includes(generic)) {
        criteria.push(generic);
      }
    }
  }
  return criteria;
}

/**
 * Determines whether a rule represents a non-normative best-practice rather than a strict WCAG rule.
 */
export function isBestPracticeOnly(tags: readonly string[]): boolean {
  const hasBestPractice = tags.some(t => t.toLowerCase() === 'best-practice');
  const hasWcag = tags.some(t => t.toLowerCase().startsWith('wcag'));
  return hasBestPractice && !hasWcag;
}

export class AccessibilityAnalyzer {
  private readonly options: Required<
    Pick<
      AccessibilityAuditorOptions,
      | 'maxViolations'
      | 'maxIncomplete'
      | 'maxNodesPerViolation'
      | 'maxSnippetLength'
      | 'maxEvidenceBytes'
    >
  > & {
    scanRunId: string;
    viewportProfile?: string;
  };

  constructor(options: AccessibilityAuditorOptions = {}) {
    this.options = {
      maxViolations: options.maxViolations ?? DEFAULT_MAX_VIOLATIONS,
      maxIncomplete: options.maxIncomplete ?? DEFAULT_MAX_INCOMPLETE,
      maxNodesPerViolation: options.maxNodesPerViolation ?? DEFAULT_MAX_NODES_PER_VIOLATION,
      maxSnippetLength: options.maxSnippetLength ?? DEFAULT_MAX_SNIPPET_LENGTH,
      maxEvidenceBytes: options.maxEvidenceBytes ?? DEFAULT_MAX_EVIDENCE_BYTES,
      scanRunId: options.scanRunId ?? '00000000-0000-0000-0000-000000000000',
      viewportProfile: options.viewportProfile,
    };
  }

  /**
   * Analyzes raw axe execution results and produces normalized reports and findings.
   */
  public analyze(params: { pageUrl: string; rawResults: AxeExecutionRawResults }): {
    violations: readonly AccessibilityRuleResult[];
    incomplete: readonly AccessibilityIncompleteResult[];
    findings: readonly CreateFindingRequest[];
    limitsReached: AccessibilityLimitsReached;
    metrics: {
      violationsCount: number;
      criticalCount: number;
      seriousCount: number;
      moderateCount: number;
      minorCount: number;
      incompleteCount: number;
      passesCount: number;
      inapplicableCount: number;
    };
  } {
    const { pageUrl, rawResults } = params;

    let violationsLimitHit = false;
    let incompleteLimitHit = false;
    let nodesLimitHit = false;
    let snippetLimitHit = false;

    // Ephemeral aliaser scoped to this audit run to preserve 1:1 cross-element correlation without leaking PII
    const aliaser = new IdentifierAliaser();

    // 1. Process Violations
    const rawViolations = rawResults.violations || [];
    const boundedViolations = rawViolations.slice(0, this.options.maxViolations);
    if (rawViolations.length > this.options.maxViolations) {
      violationsLimitHit = true;
    }

    const processedViolations: AccessibilityRuleResult[] = [];
    const findings: CreateFindingRequest[] = [];

    let criticalCount = 0;
    let seriousCount = 0;
    let moderateCount = 0;
    let minorCount = 0;

    for (const rawRule of boundedViolations) {
      const wcagCriteria = extractWcagCriteria(rawRule.tags);
      const isBestPractice = isBestPracticeOnly(rawRule.tags);
      const totalNodes = rawRule.nodes?.length ?? 0;
      const nodesTruncated = totalNodes > this.options.maxNodesPerViolation;
      if (nodesTruncated) {
        nodesLimitHit = true;
      }

      const retainedNodes = (rawRule.nodes || [])
        .slice(0, this.options.maxNodesPerViolation)
        .map(n => {
          if (n.html && n.html.length > this.options.maxSnippetLength) {
            snippetLimitHit = true;
          }
          return sanitizeNodeResult(n, this.options.maxSnippetLength, aliaser);
        });

      // Count severities
      const severity = mapAxeImpactToSeverity(rawRule.impact);
      switch (severity) {
        case 'critical':
          criticalCount++;
          break;
        case 'high':
          seriousCount++;
          break;
        case 'medium':
          moderateCount++;
          break;
        case 'low':
          minorCount++;
          break;
      }

      const ruleResult: AccessibilityRuleResult = {
        id: rawRule.id,
        description: redactString(rawRule.description, 1000),
        help: redactString(rawRule.help, 500),
        helpUrl: rawRule.helpUrl,
        impact: rawRule.impact ?? null,
        tags: rawRule.tags,
        wcagCriteria,
        nodes: retainedNodes,
        totalNodesDetected: totalNodes,
        nodesTruncated,
      };
      processedViolations.push(ruleResult);

      // Build CreateFindingRequest
      const category = isBestPractice ? 'accessibility-best-practice' : 'accessibility';

      const ruleTitle = rawRule.help || rawRule.id;
      const title = `[A11Y] ${ruleTitle}`;

      const references = [rawRule.helpUrl, ...wcagCriteria].filter(Boolean);

      const rawEvidence: Record<string, unknown> = {
        ruleId: rawRule.id,
        impact: rawRule.impact ?? null,
        tags: rawRule.tags,
        wcagCriteria,
        isBestPractice,
        totalNodesDetected: totalNodes,
        nodesTruncated,
        viewportProfile: this.options.viewportProfile || 'default',
        nodes: retainedNodes,
        helpUrl: rawRule.helpUrl,
        disclaimer: A11Y_DISCLAIMER,
      };

      const boundedEvidence = boundEvidenceSize(rawEvidence, this.options.maxEvidenceBytes);

      const remediation = `Remediation guidance: ${rawRule.help}. Inspect target elements and ensure full conformance with ${
        wcagCriteria.length > 0 ? wcagCriteria.join(', ') : 'accessibility standards'
      }. Reference: ${rawRule.helpUrl}`;

      const finding: CreateFindingRequest = {
        scanRunId: this.options.scanRunId,
        ruleId: isBestPractice ? `a11y-bp-${rawRule.id}` : `a11y-${rawRule.id}`,
        category,
        title: title.slice(0, 255),
        description: redactString(rawRule.description, 5000),
        severity,
        confidence: 'confirmed',
        status: 'confirmed',
        targetUrl: pageUrl,
        evidence: boundedEvidence,
        remediation,
        references,
      };

      findings.push(finding);
    }

    // 2. Process Incomplete Results (Manual Review Required)
    const rawIncomplete = rawResults.incomplete || [];
    const boundedIncomplete = rawIncomplete.slice(0, this.options.maxIncomplete);
    if (rawIncomplete.length > this.options.maxIncomplete) {
      incompleteLimitHit = true;
    }

    const processedIncomplete: AccessibilityIncompleteResult[] = [];

    for (const rawRule of boundedIncomplete) {
      const wcagCriteria = extractWcagCriteria(rawRule.tags);
      const isBestPractice = isBestPracticeOnly(rawRule.tags);
      const totalNodes = rawRule.nodes?.length ?? 0;
      const nodesTruncated = totalNodes > this.options.maxNodesPerViolation;
      if (nodesTruncated) {
        nodesLimitHit = true;
      }

      const retainedNodes = (rawRule.nodes || [])
        .slice(0, this.options.maxNodesPerViolation)
        .map(n => sanitizeNodeResult(n, this.options.maxSnippetLength, aliaser));

      // Extract reason why manual review is needed
      let reviewReason = 'Automated check requires manual review.';
      if (retainedNodes.length > 0 && retainedNodes[0].failureSummary) {
        reviewReason = retainedNodes[0].failureSummary;
      } else if (
        retainedNodes.length > 0 &&
        retainedNodes[0].any &&
        retainedNodes[0].any.length > 0
      ) {
        reviewReason = retainedNodes[0].any[0].message;
      }

      const incompleteResult: AccessibilityIncompleteResult = {
        id: rawRule.id,
        description: redactString(rawRule.description, 1000),
        help: redactString(rawRule.help, 500),
        helpUrl: rawRule.helpUrl,
        impact: rawRule.impact ?? null,
        tags: rawRule.tags,
        wcagCriteria,
        nodes: retainedNodes,
        totalNodesDetected: totalNodes,
        nodesTruncated,
        reviewReason,
      };
      processedIncomplete.push(incompleteResult);

      // Create finding with status 'needs_manual_review' and confidence 'potential'
      const severity = mapAxeIncompleteImpactToSeverity(rawRule.impact);
      const title = `[A11Y Needs Review] ${rawRule.help || rawRule.id}`;
      const references = [rawRule.helpUrl, ...wcagCriteria].filter(Boolean);

      const rawEvidence: Record<string, unknown> = {
        ruleId: rawRule.id,
        impact: rawRule.impact ?? null,
        tags: rawRule.tags,
        wcagCriteria,
        isBestPractice,
        totalNodesDetected: totalNodes,
        nodesTruncated,
        reviewReason,
        requiresManualReview: true,
        isIncompleteCheck: true,
        verificationNotice:
          'Manual review required — automated verification incomplete. The automated scanner was unable to determine whether this element passes or fails (e.g. due to gradient overlays, background images, or dynamic DOM states).',
        viewportProfile: this.options.viewportProfile || 'default',
        nodes: retainedNodes,
        helpUrl: rawRule.helpUrl,
        disclaimer: A11Y_DISCLAIMER,
      };

      const boundedEvidence = boundEvidenceSize(rawEvidence, this.options.maxEvidenceBytes);

      const remediation = `Manual Review Required: ${reviewReason} Consult ${
        wcagCriteria.length > 0 ? wcagCriteria.join(', ') : 'accessibility guidelines'
      } to manually verify this element. Reference: ${rawRule.helpUrl}`;

      const finding: CreateFindingRequest = {
        scanRunId: this.options.scanRunId,
        ruleId: `a11y-review-${rawRule.id}`,
        category: 'accessibility',
        title: title.slice(0, 255),
        description: `Manual review required — automated verification incomplete: ${rawRule.description}. ${reviewReason}`,
        severity,
        confidence: 'potential',
        status: 'needs_manual_review',
        targetUrl: pageUrl,
        evidence: boundedEvidence,
        remediation,
        references,
      };

      findings.push(finding);
    }

    const passesCount = rawResults.passes?.length ?? 0;
    const inapplicableCount = rawResults.inapplicable?.length ?? 0;

    return {
      violations: processedViolations,
      incomplete: processedIncomplete,
      findings,
      limitsReached: {
        violationsLimit: violationsLimitHit,
        incompleteLimit: incompleteLimitHit,
        nodesLimit: nodesLimitHit,
        snippetLimit: snippetLimitHit,
        evidenceLimit: false,
        timeout: false,
      },
      metrics: {
        violationsCount: processedViolations.length,
        criticalCount,
        seriousCount,
        moderateCount,
        minorCount,
        incompleteCount: processedIncomplete.length,
        passesCount,
        inapplicableCount,
      },
    };
  }
}
