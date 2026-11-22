import { describe, it, expect } from 'vitest';
import {
  evaluateSymmetricBaseline,
  type SymmetricBaselineContext,
} from '@auditor/shared';

describe('Symmetric Baseline Coverage Engine (NEW Finding Subtypes)', () => {
  const baseScanA: SymmetricBaselineContext['scanA'] = {
    hasTelemetry: true,
    isTerminalSuccess: true,
    crawledUrls: ['https://example.com/page-1'],
    browserAuditedUrls: ['https://example.com/page-1'],
    completedEngines: ['security-headers-analyzer'],
    activeModules: { securityHeaders: true },
    registryVersion: '2026.11-v1',
    ruleCatalog: ['SEC_HEADER_CSP_MISSING'],
    ruleOutcomeOnUrl: 'CLEAN',
    isUrlRedirectedOrSoft404: false,
    hasFetchFailureOnUrl: false,
  };

  it('classifies as CONFIRMED_REGRESSION when Scan A proved affirmative clean coverage', () => {
    const ctx: SymmetricBaselineContext = {
      targetUrl: 'https://example.com/page-1',
      ruleId: 'SEC_HEADER_CSP_MISSING',
      category: 'security',
      isBrowserDependent: false,
      scanA: baseScanA,
    };

    const res = evaluateSymmetricBaseline(ctx);
    expect(res.newSubtype).toBe('CONFIRMED_REGRESSION');
    expect(res.confidence).toBe(1.0);
  });

  it('classifies as UNVERIFIABLE_BASELINE when Scan A lacks telemetry (pre-v0.1.8 legacy scan)', () => {
    const ctx: SymmetricBaselineContext = {
      targetUrl: 'https://example.com/page-1',
      ruleId: 'SEC_HEADER_CSP_MISSING',
      category: 'security',
      isBrowserDependent: false,
      scanA: {
        ...baseScanA,
        hasTelemetry: false,
        crawledUrls: undefined,
      },
    };

    const res = evaluateSymmetricBaseline(ctx);
    expect(res.newSubtype).toBe('UNVERIFIABLE_BASELINE');
    expect(res.confidence).toBe(0.5);
  });

  it('classifies as BASELINE_UNCOVERED when Scan A did not crawl the target URL', () => {
    const ctx: SymmetricBaselineContext = {
      targetUrl: 'https://example.com/new-feature',
      ruleId: 'SEC_HEADER_CSP_MISSING',
      category: 'security',
      isBrowserDependent: false,
      scanA: {
        ...baseScanA,
        crawledUrls: ['https://example.com/page-1'], // new-feature missing
      },
    };

    const res = evaluateSymmetricBaseline(ctx);
    expect(res.newSubtype).toBe('BASELINE_UNCOVERED');
    expect(res.confidence).toBe(0.5);
  });

  it('classifies as BASELINE_UNCOVERED when module was disabled in Scan A', () => {
    const ctx: SymmetricBaselineContext = {
      targetUrl: 'https://example.com/page-1',
      ruleId: 'SEC_HEADER_CSP_MISSING',
      category: 'security',
      isBrowserDependent: false,
      scanA: {
        ...baseScanA,
        activeModules: { securityHeaders: false },
      },
    };

    const res = evaluateSymmetricBaseline(ctx);
    expect(res.newSubtype).toBe('BASELINE_UNCOVERED');
    expect(res.confidence).toBe(0.5);
  });
});
