/**
 * 5-Part Resolution & Symmetric Baseline Verification Predicates.
 * Enforces strict non-reproduction proof for RESOLVED classifications and
 * symmetric baseline verification for CONFIRMED_REGRESSION classifications.
 */

import { isRuleKnownInRegistryVersion } from '../rules/registry.js';
import type {
  ResolutionPredicateResult,
  ResolutionVerificationContext,
  SymmetricBaselineContext,
  SymmetricBaselineResult,
  Tier3GroupComparisonResult,
} from './types.js';

const PROFILE_DEPTH_HIERARCHY: Record<string, number> = {
  quick: 1,
  security: 2,
  performance: 2,
  seo: 2,
  deep: 3,
  full: 3,
};

/**
 * Evaluates the 5-part Resolution Verification Predicate (C1..C5) for an absent finding in Scan B.
 */
export function evaluateResolutionPredicate(
  context: ResolutionVerificationContext,
): ResolutionPredicateResult {
  const { targetUrl, ruleId, category, isBrowserDependent, scanB, scanA } = context;

  // Scan B must be terminal success
  if (!scanB.isTerminalSuccess) {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'ENGINE_EXECUTION_FAILED',
      diagnosticDetail: 'Scan B did not terminate with successful status.',
    };
  }

  // ==========================================
  // Condition 1: URL Retrieval & Integrity (C1)
  // ==========================================
  if (scanB.hasFetchFailureOnUrl) {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'PAGE_FETCH_FAILED',
      diagnosticDetail: `Target URL ${targetUrl} encountered fetch/network failure in Scan B.`,
    };
  }

  if (scanB.isSoft404) {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'SOFT_404_DETECTED',
      diagnosticDetail: `Target URL ${targetUrl} returned soft-404 in Scan B.`,
    };
  }

  if (scanB.isUrlRedirected || scanB.isUrlRedirectedOrSoft404) {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'REDIRECTED_TARGET',
      diagnosticDetail: `Target URL ${targetUrl} redirected or returned soft-404 in Scan B.`,
    };
  }

  const crawledUrls = scanB.crawledUrls ?? [];
  const wasCrawled = crawledUrls.some(u => u.toLowerCase() === targetUrl.toLowerCase());
  if (!wasCrawled && crawledUrls.length > 0) {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'PAGE_NOT_CRAWLED',
      diagnosticDetail: `Target URL ${targetUrl} was not crawled in Scan B.`,
    };
  }

  // ==========================================
  // Condition 2: Engine Execution Integrity (C2)
  // ==========================================
  const completedEngines = scanB.completedEngines ?? [];
  if (completedEngines.length > 0 && !completedEngines.includes('analyzers')) {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'ENGINE_EXECUTION_FAILED',
      diagnosticDetail: 'Analyzer engine did not complete execution in Scan B.',
    };
  }

  if (isBrowserDependent) {
    if (completedEngines.length > 0 && !completedEngines.includes('browser')) {
      return {
        isResolved: false,
        classification: 'UNCHECKED',
        uncheckedReason: 'BROWSER_AUDIT_SKIPPED',
        diagnosticDetail: 'Browser engine was not executed in Scan B.',
      };
    }

    const browserAuditedUrls = scanB.browserAuditedUrls ?? [];
    const wasBrowserAudited = browserAuditedUrls.some(u => u.toLowerCase() === targetUrl.toLowerCase());
    if (!wasBrowserAudited && browserAuditedUrls.length > 0) {
      return {
        isResolved: false,
        classification: 'UNCHECKED',
        uncheckedReason: 'BROWSER_AUDIT_SKIPPED',
        diagnosticDetail: `Target URL ${targetUrl} did not receive browser audit in Scan B.`,
      };
    }
  }

  // ==========================================
  // Condition 3: Module & Rule Active (C3)
  // ==========================================
  const mappedModule =
    category === 'security'
      ? 'securityHeaders'
      : category === 'technical-seo'
        ? 'seo'
        : category;
  if (
    scanB.activeModules &&
    (scanB.activeModules[category] === false || scanB.activeModules[mappedModule] === false)
  ) {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'MODULE_DISABLED_IN_CONFIG',
      diagnosticDetail: `Audit module '${category}' was disabled in Scan B configuration.`,
    };
  }

  if (scanB.registryVersion && !isRuleKnownInRegistryVersion(ruleId, scanB.registryVersion)) {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'RULE_UNAVAILABLE',
      diagnosticDetail: `Rule '${ruleId}' is not registered in Scan B engine version '${scanB.registryVersion}'.`,
    };
  }

  // Catalog overflow check
  if (scanB.omittedRuleIds && scanB.omittedRuleIds.includes(ruleId)) {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'RULE_CATALOG_OVERFLOW',
      diagnosticDetail: `Rule '${ruleId}' overflowed Scan B rule catalog budget.`,
    };
  }

  // ==========================================
  // Condition 4: Affirmative Non-Reproduction Proof (C4)
  // ==========================================
  if (scanB.ruleOutcomeOnUrl !== 'CLEAN') {
    return {
      isResolved: false,
      classification: 'UNCHECKED',
      uncheckedReason: 'RULE_EVALUATION_INCOMPLETE',
      diagnosticDetail: `Rule '${ruleId}' did not evaluate with affirmative CLEAN outcome on ${targetUrl} (outcome: ${scanB.ruleOutcomeOnUrl ?? 'unrecorded'}).`,
    };
  }

  // ==========================================
  // Condition 5: Complete Compatibility Verification (C5)
  // ==========================================
  if (scanA?.profileDepth && scanB.profileDepth) {
    const depthA = PROFILE_DEPTH_HIERARCHY[scanA.profileDepth] ?? 2;
    const depthB = PROFILE_DEPTH_HIERARCHY[scanB.profileDepth] ?? 2;
    if (depthB < depthA) {
      return {
        isResolved: false,
        classification: 'UNCHECKED',
        uncheckedReason: 'SCAN_PROFILE_INSUFFICIENT',
        diagnosticDetail: `Scan B profile depth ('${scanB.profileDepth}') is lower than baseline Scan A depth ('${scanA.profileDepth}').`,
      };
    }
  }

  if (scanA?.registryVersion && scanB.registryVersion && scanA.registryVersion !== scanB.registryVersion) {
    // Flag major version mismatch as drift
    const majorA = scanA.registryVersion.split('.')[0];
    const majorB = scanB.registryVersion.split('.')[0];
    if (majorA !== majorB) {
      return {
        isResolved: false,
        classification: 'UNCHECKED',
        uncheckedReason: 'ANALYZER_VERSION_DRIFT',
        diagnosticDetail: `Analyzer major version drift between Scan A (${scanA.registryVersion}) and Scan B (${scanB.registryVersion}).`,
      };
    }
  }

  // All 5 conditions satisfied
  return {
    isResolved: true,
    classification: 'RESOLVED',
  };
}

/**
 * Evaluates Symmetric Baseline Verification for newly discovered findings in Scan B.
 */
export function evaluateSymmetricBaseline(
  context: SymmetricBaselineContext,
): SymmetricBaselineResult {
  const { targetUrl, ruleId, category, isBrowserDependent, scanA } = context;

  // 1. If Scan A predates telemetry, baseline is unverifiable
  if (!scanA.hasTelemetry) {
    return {
      newSubtype: 'UNVERIFIABLE_BASELINE',
      confidence: 0.5,
      diagnosticDetail: 'Baseline Scan A predates URL and rule telemetry.',
    };
  }

  if (!scanA.isTerminalSuccess) {
    return {
      newSubtype: 'BASELINE_UNCOVERED',
      confidence: 0.5,
      diagnosticDetail: 'Baseline Scan A did not complete successfully.',
    };
  }

  // 2. Check URL retrieval in Scan A
  if (scanA.hasFetchFailureOnUrl || scanA.isUrlRedirectedOrSoft404) {
    return {
      newSubtype: 'BASELINE_UNCOVERED',
      confidence: 0.5,
      diagnosticDetail: `Target URL ${targetUrl} was not cleanly fetched in Scan A.`,
    };
  }

  const crawledUrls = scanA.crawledUrls ?? [];
  const wasCrawled = crawledUrls.some(u => u.toLowerCase() === targetUrl.toLowerCase());
  if (!wasCrawled && crawledUrls.length > 0) {
    return {
      newSubtype: 'BASELINE_UNCOVERED',
      confidence: 0.5,
      diagnosticDetail: `Target URL ${targetUrl} was not crawled in Scan A.`,
    };
  }

  // 3. Check browser audit in Scan A if browser-dependent
  if (isBrowserDependent) {
    const browserAuditedUrls = scanA.browserAuditedUrls ?? [];
    const wasBrowserAudited = browserAuditedUrls.some(u => u.toLowerCase() === targetUrl.toLowerCase());
    if (!wasBrowserAudited) {
      return {
        newSubtype: 'BASELINE_UNCOVERED',
        confidence: 0.5,
        diagnosticDetail: `Target URL ${targetUrl} was not browser-audited in Scan A.`,
      };
    }
  }

  // 4. Check active modules in Scan A
  const mappedModuleA =
    category === 'security'
      ? 'securityHeaders'
      : category === 'technical-seo'
        ? 'seo'
        : category;
  if (
    scanA.activeModules &&
    (scanA.activeModules[category] === false || scanA.activeModules[mappedModuleA] === false)
  ) {
    return {
      newSubtype: 'BASELINE_UNCOVERED',
      confidence: 0.5,
      diagnosticDetail: `Module '${category}' was disabled in Scan A.`,
    };
  }

  // 5. Check affirmative clean evaluation in Scan A
  if (scanA.ruleOutcomeOnUrl === 'CLEAN') {
    return {
      newSubtype: 'CONFIRMED_REGRESSION',
      confidence: 1.0,
      diagnosticDetail: `Scan A actively evaluated rule '${ruleId}' on ${targetUrl} and found zero occurrences.`,
    };
  }

  return {
    newSubtype: 'BASELINE_UNCOVERED',
    confidence: 0.5,
    diagnosticDetail: `Scan A did not record affirmative CLEAN outcome for rule '${ruleId}' on ${targetUrl}.`,
  };
}

/**
 * Evaluates Tier 3 Aggregate Group comparison semantics across Scan A and Scan B.
 */
export function evaluateTier3GroupComparison(options: {
  readonly countA: number;
  readonly countB: number;
  readonly scanAClean: boolean;
  readonly scanBClean: boolean;
  readonly scanBHasCoverage: boolean;
}): Tier3GroupComparisonResult {
  const { countA, countB, scanAClean, scanBClean, scanBHasCoverage } = options;
  const deltaCount = countB - countA;

  // Case 1: Complete Eradication (countA > 0, countB = 0)
  if (countA > 0 && countB === 0) {
    if (scanBClean && scanBHasCoverage) {
      return {
        outcome: 'RESOLVED_GROUP',
        countA,
        countB,
        deltaCount,
        incrementsResolvedExecutiveMetric: true,
        incrementsRegressionExecutiveMetric: false,
        matchBasis: 'COMPLETE_GROUP_ERADICATION',
      };
    }
    return {
      outcome: 'UNCHECKED_GROUP',
      countA,
      countB,
      deltaCount,
      incrementsResolvedExecutiveMetric: false,
      incrementsRegressionExecutiveMetric: false,
      matchBasis: 'SCAN_B_COVERAGE_LACKING',
      uncheckedReason: 'PAGE_NOT_CRAWLED',
    };
  }

  // Case 2: Group Emergence (countA = 0, countB > 0)
  if (countA === 0 && countB > 0) {
    if (scanAClean) {
      return {
        outcome: 'CONFIRMED_REGRESSION_GROUP',
        countA,
        countB,
        deltaCount,
        incrementsResolvedExecutiveMetric: false,
        incrementsRegressionExecutiveMetric: true,
        matchBasis: 'NEW_REGRESSION_FROM_CLEAN_BASELINE',
      };
    }
    return {
      outcome: 'AGGREGATE_COUNT_INCREASED',
      countA,
      countB,
      deltaCount,
      incrementsResolvedExecutiveMetric: false,
      incrementsRegressionExecutiveMetric: false,
      matchBasis: 'UNVERIFIED_BASELINE_EMERGENCE',
    };
  }

  // Case 3: Group Parity (countA = countB > 0)
  if (countA > 0 && countA === countB) {
    return {
      outcome: 'PERSISTENT_GROUP',
      countA,
      countB,
      deltaCount: 0,
      incrementsResolvedExecutiveMetric: false,
      incrementsRegressionExecutiveMetric: false,
      matchBasis: 'AGGREGATE_COUNT_PARITY',
    };
  }

  // Case 4: Count Reduction (0 < countB < countA)
  if (countB > 0 && countB < countA) {
    return {
      outcome: 'AGGREGATE_COUNT_REDUCED',
      countA,
      countB,
      deltaCount,
      incrementsResolvedExecutiveMetric: false,
      incrementsRegressionExecutiveMetric: false,
      matchBasis: 'VOLUMETRIC_REDUCTION_NO_INDIVIDUAL_MATCH',
    };
  }

  // Case 5: Count Increase (countB > countA > 0)
  return {
    outcome: 'AGGREGATE_COUNT_INCREASED',
    countA,
    countB,
    deltaCount,
    incrementsResolvedExecutiveMetric: false,
    incrementsRegressionExecutiveMetric: false,
    matchBasis: 'VOLUMETRIC_ESCALATION_EXISTING_GROUP',
  };
}
