import { describe, it, expect } from 'vitest';
import {
  evaluateResolutionPredicate,
  type ResolutionVerificationContext,
} from '@auditor/shared';

describe('5-Part Resolution Verification Predicate (C1..C5)', () => {
  const baseValidContext: ResolutionVerificationContext = {
    targetUrl: 'https://example.com/about',
    ruleId: 'SEC_HEADER_CSP_MISSING',
    category: 'security',
    isBrowserDependent: false,
    scanB: {
      isTerminalSuccess: true,
      crawledUrls: ['https://example.com', 'https://example.com/about'],
      browserAuditedUrls: [],
      completedEngines: ['crawler', 'analyzers'],
      activeModules: { securityHeaders: true },
      registryVersion: '2026.11-v1',
      ruleCatalog: ['SEC_HEADER_CSP_MISSING', 'SEO_H1_MISSING'],
      ruleOutcomeOnUrl: 'CLEAN',
      isUrlRedirectedOrSoft404: false,
      hasFetchFailureOnUrl: false,
    },
  };

  it('classifies as RESOLVED when all C1..C5 conditions are satisfied', () => {
    const res = evaluateResolutionPredicate(baseValidContext);
    expect(res.isResolved).toBe(true);
    expect(res.classification).toBe('RESOLVED');
    expect(res.uncheckedReason).toBeUndefined();
  });

  describe('C1: URL Reachability & Response Integrity', () => {
    it('returns PAGE_NOT_CRAWLED when URL absent from crawledUrls', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        scanB: {
          ...baseValidContext.scanB,
          crawledUrls: ['https://example.com'], // /about missing
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('PAGE_NOT_CRAWLED');
    });

    it('returns PAGE_FETCH_FAILED when fetch failure recorded for URL', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        scanB: {
          ...baseValidContext.scanB,
          hasFetchFailureOnUrl: true,
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('PAGE_FETCH_FAILED');
    });

    it('returns SOFT_404_DETECTED when soft 404 detected', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        scanB: {
          ...baseValidContext.scanB,
          isSoft404: true,
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('SOFT_404_DETECTED');
    });

    it('returns REDIRECTED_TARGET when redirect detected', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        scanB: {
          ...baseValidContext.scanB,
          isUrlRedirected: true,
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('REDIRECTED_TARGET');
    });
  });

  describe('C2: Execution Dimension Sufficiency', () => {
    it('returns BROWSER_AUDIT_SKIPPED when browser-dependent rule lacked browser audit', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        isBrowserDependent: true,
        scanB: {
          ...baseValidContext.scanB,
          completedEngines: ['crawler', 'analyzers', 'browser'],
          browserAuditedUrls: ['https://example.com'], // /about not in browserAuditedUrls
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('BROWSER_AUDIT_SKIPPED');
    });
  });

  describe('C3: Engine & Module Execution Integrity', () => {
    it('returns ENGINE_EXECUTION_FAILED when responsible engine missing from completedEngines', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        scanB: {
          ...baseValidContext.scanB,
          completedEngines: ['other-analyzer'],
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('ENGINE_EXECUTION_FAILED');
    });

    it('returns MODULE_DISABLED_IN_CONFIG when module was disabled in Scan B', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        scanB: {
          ...baseValidContext.scanB,
          activeModules: { securityHeaders: false },
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('MODULE_DISABLED_IN_CONFIG');
    });
  });

  describe('C4: Rule Existence & Registry Integrity', () => {
    it('returns RULE_UNAVAILABLE when rule is not known in registry', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        ruleId: 'UNKNOWN_CUSTOM_RULE',
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('RULE_UNAVAILABLE');
    });

    it('returns RULE_CATALOG_OVERFLOW when rule was omitted due to catalog budget', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        scanB: {
          ...baseValidContext.scanB,
          ruleCatalog: ['OTHER_RULE'],
          omittedRuleIds: ['SEC_HEADER_CSP_MISSING'],
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('RULE_CATALOG_OVERFLOW');
    });
  });

  describe('C5: Affirmative Clean Evaluation', () => {
    it('returns RULE_EVALUATION_INCOMPLETE when rule execution outcome was SKIPPED', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        scanB: {
          ...baseValidContext.scanB,
          ruleOutcomeOnUrl: 'SKIPPED',
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('RULE_EVALUATION_INCOMPLETE');
    });

    it('returns RULE_EVALUATION_INCOMPLETE when rule execution outcome was FAILED', () => {
      const ctx: ResolutionVerificationContext = {
        ...baseValidContext,
        scanB: {
          ...baseValidContext.scanB,
          ruleOutcomeOnUrl: 'FAILED',
        },
      };
      const res = evaluateResolutionPredicate(ctx);
      expect(res.isResolved).toBe(false);
      expect(res.classification).toBe('UNCHECKED');
      expect(res.uncheckedReason).toBe('RULE_EVALUATION_INCOMPLETE');
    });
  });
});
