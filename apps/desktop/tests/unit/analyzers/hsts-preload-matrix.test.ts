import { describe, it, expect } from 'vitest';
import { SecurityHeadersAnalyzer } from '../../../src/main/scanner/analyzers/security-headers-analyzer.js';
import type { CrawledPageResult } from '../../../src/main/scanner/crawler/types.js';

describe('SecurityHeadersAnalyzer — HSTS & Preload Execution Matrix', () => {
  const analyzer = new SecurityHeadersAnalyzer();

  const makePage = (hstsHeader?: string, isHttps = true): CrawledPageResult => ({
    requestedUrl: isHttps ? 'https://example.com/test' : 'http://example.com/test',
    status: 200,
    headers: hstsHeader ? { 'strict-transport-security': hstsHeader } : {},
    durationMs: 50,
    encodedBodyBytes: 100,
    decompressedBodyBytes: 200,
    findings: [],
    links: [],
    assets: [],
    forms: [],
  });

  it('Scenario 1: Preload present, max-age < 1 year -> emits SEC_HEADER_HSTS_PRELOAD_INELIGIBLE', () => {
    const page = makePage('max-age=15768000; includeSubDomains; preload'); // 6 months
    const res = analyzer.analyzePage(page, { authorizedOrigin: 'https://example.com', entryUrl: 'https://example.com' });

    const ineligibleFinding = res.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_INELIGIBLE');
    expect(ineligibleFinding).toBeDefined();

    const ineligibleExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_PRELOAD_INELIGIBLE');
    expect(ineligibleExec?.outcome).toBe('WITH_FINDINGS');

    const eligibleExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE');
    expect(eligibleExec?.outcome).toBe('SKIPPED');
  });

  it('Scenario 2: Preload present, max-age >= 1 year, includeSubDomains -> emits SEC_HEADER_HSTS_PRELOAD_ELIGIBLE', () => {
    const page = makePage('max-age=31536000; includeSubDomains; preload'); // 1 year
    const res = analyzer.analyzePage(page, { authorizedOrigin: 'https://example.com', entryUrl: 'https://example.com' });

    const eligibleFinding = res.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE');
    expect(eligibleFinding).toBeDefined();

    const eligibleExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE');
    expect(eligibleExec?.outcome).toBe('WITH_FINDINGS');

    const ineligibleExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_PRELOAD_INELIGIBLE');
    expect(ineligibleExec?.outcome).toBe('CLEAN');
  });

  it('Scenario 3: Preload absent, max-age >= 1 year, includeSubDomains -> emits SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED', () => {
    const page = makePage('max-age=31536000; includeSubDomains'); // preload absent
    const res = analyzer.analyzePage(page, { authorizedOrigin: 'https://example.com', entryUrl: 'https://example.com' });

    const notDeclaredFinding = res.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED');
    expect(notDeclaredFinding).toBeDefined();

    const notDeclaredExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED');
    expect(notDeclaredExec?.outcome).toBe('WITH_FINDINGS');

    const eligibleExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE');
    expect(eligibleExec?.outcome).toBe('SKIPPED');
    expect(eligibleExec?.skipReason).toBe('NO_MATCHING_ELEMENTS');
  });

  it('Scenario 4: Preload absent, max-age < 1 year -> skips preload rules', () => {
    const page = makePage('max-age=15768000; includeSubDomains'); // 6 months, preload absent
    const res = analyzer.analyzePage(page, { authorizedOrigin: 'https://example.com', entryUrl: 'https://example.com' });

    const notDeclaredFinding = res.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED');
    expect(notDeclaredFinding).toBeUndefined();

    const notDeclaredExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED');
    expect(notDeclaredExec?.outcome).toBe('SKIPPED');
  });

  it('Scenario 5: Malformed HSTS header -> emits SEC_HEADER_HSTS_MALFORMED, skips all directive rules with MALFORMED_HEADER', () => {
    const page = makePage('max-age=unclosed"quote; includeSubDomains'); // malformed
    const res = analyzer.analyzePage(page, { authorizedOrigin: 'https://example.com', entryUrl: 'https://example.com' });

    const malformedFinding = res.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_MALFORMED');
    expect(malformedFinding).toBeDefined();

    // Directive findings must NOT be emitted
    expect(res.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_WEAK')).toBeUndefined();
    expect(res.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_NO_SUBDOMAINS')).toBeUndefined();
    expect(res.findings.find(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE')).toBeUndefined();

    // All directive rules must be marked SKIPPED with MALFORMED_HEADER
    const weakExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_WEAK');
    expect(weakExec?.outcome).toBe('SKIPPED');
    expect(weakExec?.skipReason).toBe('MALFORMED_HEADER');

    const subdomainsExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_NO_SUBDOMAINS');
    expect(subdomainsExec?.outcome).toBe('SKIPPED');
    expect(subdomainsExec?.skipReason).toBe('MALFORMED_HEADER');

    const preloadExec = res.ruleExecutions?.find(r => r.ruleId === 'SEC_HEADER_HSTS_PRELOAD_NOT_DECLARED');
    expect(preloadExec?.outcome).toBe('SKIPPED');
    expect(preloadExec?.skipReason).toBe('MALFORMED_HEADER');
  });
});
