import { describe, it, expect } from 'vitest';
import {
  normalizeHost,
  validateScanTarget,
  isUrlInScope,
  type Finding,
  type FindingSeverity,
  type FindingStatus,
} from '../src/index.js';

describe('Tooling & Scope Guard Foundation Tests', () => {
  describe('normalizeHost', () => {
    it('normalizes full URLs to hostnames', () => {
      expect(normalizeHost('https://example.com/some/path')).toBe('example.com');
      expect(normalizeHost('http://sub.example.com:8080/')).toBe('sub.example.com');
      expect(normalizeHost('Example.COM')).toBe('example.com');
    });
  });

  describe('validateScanTarget', () => {
    it('accepts valid http and https targets', () => {
      expect(validateScanTarget('https://example.com').valid).toBe(true);
      expect(validateScanTarget('http://localhost:8000/wp').valid).toBe(true);
    });

    it('rejects unsafe and unsupported protocols', () => {
      expect(validateScanTarget('javascript:alert(1)').valid).toBe(false);
      expect(validateScanTarget('file:///C:/Windows/system32').valid).toBe(false);
      expect(validateScanTarget('ftp://example.com').valid).toBe(false);
      expect(validateScanTarget('not-a-url').valid).toBe(false);
    });
  });

  describe('isUrlInScope (Scope Guard Protection)', () => {
    const allowed = ['example.com', 'localhost'];

    it('permits in-scope domain targets', () => {
      expect(isUrlInScope('https://example.com', allowed)).toBe(true);
      expect(isUrlInScope('https://example.com/wp-admin', allowed)).toBe(true);
      expect(isUrlInScope('https://blog.example.com/page', allowed)).toBe(true);
      expect(isUrlInScope('http://localhost:3000/test', allowed)).toBe(true);
    });

    it('strictly denies external out-of-scope URLs', () => {
      expect(isUrlInScope('https://external-tracker.com', allowed)).toBe(false);
      expect(isUrlInScope('https://attacker.com/evil', allowed)).toBe(false);
      expect(isUrlInScope('https://notexample.com', allowed)).toBe(false);
      expect(isUrlInScope('javascript:void(0)', allowed)).toBe(false);
    });
  });

  describe('Domain Schema Validation', () => {
    it('properly types a Finding object according to architecture specs', () => {
      const severity: FindingSeverity = 'high';
      const status: FindingStatus = 'potential';

      const sampleFinding: Finding = {
        id: 'finding-001',
        siteId: 'site-local-wp',
        scanRunId: 'scan-run-001',
        module: 'scope-guard',
        category: 'Scope Policy',
        title: 'Out-of-scope link observed',
        description: 'An external link was evaluated and blocked by ScopeGuard.',
        severity,
        confidence: 'high',
        status,
        affectedUrl: 'https://example.com/page',
        evidence: 'href="https://external-tracker.com"',
        source: 'Crawler',
        detectedAt: new Date().toISOString(),
        remediation: 'Verify link destination.',
        verificationSteps: 'Re-scan with updated scope configuration.',
      };

      expect(sampleFinding.id).toBe('finding-001');
      expect(sampleFinding.severity).toBe('high');
      expect(sampleFinding.status).toBe('potential');
    });
  });
});
