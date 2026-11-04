import { describe, it, expect } from 'vitest';
import {
  normalizeHost,
  parseHostAndPort,
  validateScanTarget,
  isUrlInScope,
  type Finding,
  type FindingSeverity,
  type FindingStatus,
} from '../src/index.js';

describe('Tooling & Scope Guard Foundation Tests', () => {
  describe('normalizeHost & parseHostAndPort', () => {
    it('normalizes full URLs and domains to lowercase hostnames', () => {
      expect(normalizeHost('https://example.com/some/path')).toBe('example.com');
      expect(normalizeHost('http://sub.example.com:8080/')).toBe('sub.example.com');
      expect(normalizeHost('Example.COM')).toBe('example.com');
    });

    it('parses host and port combinations accurately', () => {
      expect(parseHostAndPort('example.com:8080')).toEqual({ host: 'example.com', port: 8080 });
      expect(parseHostAndPort('https://sub.example.com:8443')).toEqual({
        host: 'sub.example.com',
        port: 8443,
      });
    });

    it('correctly handles IPv4 and IPv6 addresses with canonicalization', () => {
      expect(normalizeHost('192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeHost('[::1]')).toBe('[0000:0000:0000:0000:0000:0000:0000:0001]');
      expect(normalizeHost('::1')).toBe('[0000:0000:0000:0000:0000:0000:0000:0001]');
      expect(normalizeHost('0:0:0:0:0:0:0:1')).toBe('[0000:0000:0000:0000:0000:0000:0000:0001]');
      expect(normalizeHost('[::1]')).toBe(normalizeHost('0:0:0:0:0:0:0:1'));
      expect(normalizeHost('[2001:db8::1]')).toBe('[2001:0db8:0000:0000:0000:0000:0000:0001]');
      expect(normalizeHost('2001:db8::1')).toBe(normalizeHost('2001:0db8:0:0:0:0:0:1'));
    });

    it('strictly throws errors on malformed hosts or ports', () => {
      expect(() => normalizeHost('example.com:invalid')).toThrowError();
      expect(() => normalizeHost('example.com:99999')).toThrowError();
      expect(() => normalizeHost('[invalid-ipv6]')).toThrowError();
      expect(() => normalizeHost('')).toThrowError();
    });
  });

  describe('validateScanTarget', () => {
    it('accepts valid http and https targets without credentials', () => {
      expect(validateScanTarget('https://example.com').valid).toBe(true);
      expect(validateScanTarget('http://localhost:8000/wp').valid).toBe(true);
      expect(validateScanTarget('http://127.0.0.1:8080').valid).toBe(true);
      expect(validateScanTarget('http://[::1]:8080').valid).toBe(true);
    });

    it('strictly rejects URLs containing embedded credentials', () => {
      expect(validateScanTarget('https://admin:pass@example.com/wp').valid).toBe(false);
      expect(validateScanTarget('https://user@example.com').valid).toBe(false);
    });

    it('rejects unsafe and unsupported protocols', () => {
      expect(validateScanTarget('javascript:alert(1)').valid).toBe(false);
      expect(validateScanTarget('file:///C:/Windows/system32').valid).toBe(false);
      expect(validateScanTarget('ftp://example.com').valid).toBe(false);
      expect(validateScanTarget('not-a-url').valid).toBe(false);
    });
  });

  describe('isUrlInScope (Scope Guard Protection & Port Policy)', () => {
    const allowed = ['example.com', 'localhost'];

    it('permits in-scope domain targets on standard ports by default', () => {
      expect(isUrlInScope('https://example.com', allowed)).toBe(true);
      expect(isUrlInScope('https://example.com/wp-admin', allowed)).toBe(true);
      expect(isUrlInScope('https://blog.example.com/page', allowed)).toBe(true);
      expect(isUrlInScope('http://localhost/test', allowed)).toBe(true);
    });

    it('enforces port scope policy: rejects non-standard ports unless explicitly allowed', () => {
      // Default: non-standard port denied
      expect(isUrlInScope('http://localhost:3000/test', allowed)).toBe(false);

      // Allowed with explicit port in allowed list
      expect(isUrlInScope('http://localhost:3000/test', ['localhost:3000'])).toBe(true);

      // Allowed with allowAnyPort option
      expect(isUrlInScope('http://localhost:3000/test', allowed, { allowAnyPort: true })).toBe(
        true,
      );

      // Allowed with allowedPorts option
      expect(isUrlInScope('http://localhost:3000/test', allowed, { allowedPorts: [3000] })).toBe(
        true,
      );
    });

    it('strictly denies external out-of-scope URLs and URLs with credentials', () => {
      expect(isUrlInScope('https://external-tracker.com', allowed)).toBe(false);
      expect(isUrlInScope('https://attacker.com/evil', allowed)).toBe(false);
      expect(isUrlInScope('https://notexample.com', allowed)).toBe(false);
      expect(isUrlInScope('javascript:void(0)', allowed)).toBe(false);
      expect(isUrlInScope('https://admin:secret@example.com', allowed)).toBe(false);
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
