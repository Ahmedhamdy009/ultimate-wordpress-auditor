import { describe, it, expect } from 'vitest';
import {
  normalizeHost,
  parseHostAndPort,
  validateScanTarget,
  isUrlInScope,
  isValidIPv4,
  isValidIPv6,
  canonicalizeIPv6,
} from '../src/index.js';

describe('Shared Scope Guard Tests', () => {
  describe('Pure TypeScript IPv4 & IPv6 Validators (Zero Node Built-ins)', () => {
    it('validates IPv4 addresses accurately', () => {
      expect(isValidIPv4('127.0.0.1')).toBe(true);
      expect(isValidIPv4('192.168.1.1')).toBe(true);
      expect(isValidIPv4('255.255.255.255')).toBe(true);
      expect(isValidIPv4('0.0.0.0')).toBe(true);

      // Rejections
      expect(isValidIPv4('256.0.0.1')).toBe(false);
      expect(isValidIPv4('192.168.1')).toBe(false);
      expect(isValidIPv4('192.168.1.1.1')).toBe(false);
      expect(isValidIPv4('01.02.03.04')).toBe(false); // leading zero
      expect(isValidIPv4('not-an-ip')).toBe(false);
      expect(isValidIPv4('')).toBe(false);
    });

    it('validates Full and Compressed IPv6 addresses (RFC 4291 / RFC 5952)', () => {
      // Loopback
      expect(isValidIPv6('::1')).toBe(true);
      expect(isValidIPv6('::')).toBe(true);

      // Full 8-group addresses
      expect(isValidIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
      expect(isValidIPv6('fe80:0000:0000:0000:0204:61ff:fe9d:f156')).toBe(true);

      // Compressed IPv6
      expect(isValidIPv6('2001:db8::1')).toBe(true);
      expect(isValidIPv6('1::')).toBe(true);
      expect(isValidIPv6('::ffff')).toBe(true);
      expect(isValidIPv6('fe80::1')).toBe(true);

      // IPv4-mapped IPv6
      expect(isValidIPv6('::ffff:192.168.1.1')).toBe(true);
      expect(isValidIPv6('::ffff:127.0.0.1')).toBe(true);
      expect(isValidIPv6('2001:db8::192.0.2.1')).toBe(true);
    });

    it('strictly rejects malformed and invalid IPv6 addresses', () => {
      // Multiple double colons (::)
      expect(isValidIPv6('1::2::3')).toBe(false);
      expect(isValidIPv6('2001::db8::1')).toBe(false);

      // Triple colons
      expect(isValidIPv6(':::')).toBe(false);
      expect(isValidIPv6('1:::2')).toBe(false);

      // Invalid characters
      expect(isValidIPv6('2001:xyz::1')).toBe(false);
      expect(isValidIPv6('not:an:ipv6:address:here:0:0:0')).toBe(false);

      // Group lengths > 4 hex chars
      expect(isValidIPv6('2001:00db8::1')).toBe(false);

      // Too many groups without :: (9 groups)
      expect(isValidIPv6('2001:db8:1:2:3:4:5:6:7')).toBe(false);

      // Too few groups without :: (7 groups)
      expect(isValidIPv6('2001:db8:1:2:3:4:5')).toBe(false);

      // Invalid IPv4 tail in mapped form
      expect(isValidIPv6('::ffff:999.1.1.1')).toBe(false);
      expect(isValidIPv6('::ffff:192.168.1')).toBe(false);

      // Empty or non-string
      expect(isValidIPv6('')).toBe(false);
    });
  });

  describe('canonicalizeIPv6 (8-group 16-bit hex canonicalization)', () => {
    it('unifies loopback representations ::1 and 0:0:0:0:0:0:0:1', () => {
      const canonical = '0000:0000:0000:0000:0000:0000:0000:0001';
      expect(canonicalizeIPv6('::1')).toBe(canonical);
      expect(canonicalizeIPv6('0:0:0:0:0:0:0:1')).toBe(canonical);
      expect(canonicalizeIPv6('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(canonical);
      expect(canonicalizeIPv6('::1')).toBe(canonicalizeIPv6('0:0:0:0:0:0:0:1'));
    });

    it('unifies compressed and full representations of global IPv6 addresses', () => {
      const canonical = '2001:0db8:0000:0000:0000:0000:0000:0001';
      expect(canonicalizeIPv6('2001:db8::1')).toBe(canonical);
      expect(canonicalizeIPv6('2001:0db8:0:0:0:0:0:1')).toBe(canonical);
      expect(canonicalizeIPv6('2001:db8:0:0:0:0:0:1')).toBe(canonical);
      expect(canonicalizeIPv6('2001:db8::1')).toBe(canonicalizeIPv6('2001:0db8:0:0:0:0:0:1'));
    });

    it('unifies equivalent IPv4-mapped representations', () => {
      const canonical = '0000:0000:0000:0000:0000:ffff:c0a8:0101';
      expect(canonicalizeIPv6('::ffff:192.168.1.1')).toBe(canonical);
      expect(canonicalizeIPv6('0:0:0:0:0:ffff:c0a8:0101')).toBe(canonical);
      expect(canonicalizeIPv6('0:0:0:0:0:ffff:192.168.1.1')).toBe(canonical);
      expect(canonicalizeIPv6('::ffff:192.168.1.1')).toBe(
        canonicalizeIPv6('0:0:0:0:0:ffff:c0a8:0101'),
      );
    });

    it('throws error when attempting to canonicalize invalid IPv6', () => {
      expect(() => canonicalizeIPv6('invalid-ipv6')).toThrow();
      expect(() => canonicalizeIPv6('1::2::3')).toThrow();
    });
  });

  describe('normalizeHost & parseHostAndPort', () => {
    it('normalizes domain names and URLs to lowercase hostnames', () => {
      expect(normalizeHost('https://example.com/some/path')).toBe('example.com');
      expect(normalizeHost('http://sub.example.com:8080/')).toBe('sub.example.com');
      expect(normalizeHost('Example.COM')).toBe('example.com');
      expect(normalizeHost('sub.domain.com')).toBe('sub.domain.com');
    });

    it('normalizes IPv4 addresses and retains valid ports in parser', () => {
      expect(normalizeHost('192.168.1.1')).toBe('192.168.1.1');
      expect(normalizeHost('http://192.168.1.1:8080/')).toBe('192.168.1.1');
      expect(parseHostAndPort('192.168.1.1:8080')).toEqual({
        host: '192.168.1.1',
        port: 8080,
      });
    });

    it('canonicalizes IPv6 addresses to invariant bracketed representations', () => {
      const canonicalLoopback = '[0000:0000:0000:0000:0000:0000:0000:0001]';
      const canonicalGlobal = '[2001:0db8:0000:0000:0000:0000:0000:0001]';

      // Loopback equivalence
      expect(normalizeHost('[::1]')).toBe(canonicalLoopback);
      expect(normalizeHost('::1')).toBe(canonicalLoopback);
      expect(normalizeHost('0:0:0:0:0:0:0:1')).toBe(canonicalLoopback);
      expect(normalizeHost('[0:0:0:0:0:0:0:1]')).toBe(canonicalLoopback);
      expect(normalizeHost('http://[::1]:8000/wp')).toBe(canonicalLoopback);
      expect(normalizeHost('[::1]')).toBe(normalizeHost('0:0:0:0:0:0:0:1'));

      // Global IPv6 equivalence
      expect(normalizeHost('[2001:db8::1]')).toBe(canonicalGlobal);
      expect(normalizeHost('2001:db8::1')).toBe(canonicalGlobal);
      expect(normalizeHost('2001:0db8:0:0:0:0:0:1')).toBe(canonicalGlobal);
      expect(normalizeHost('[2001:0db8:0:0:0:0:0:1]')).toBe(canonicalGlobal);
      expect(normalizeHost('2001:db8::1')).toBe(normalizeHost('2001:0db8:0:0:0:0:0:1'));

      // IPv6 with explicit ports in parser
      expect(parseHostAndPort('[::1]:8080')).toEqual({
        host: canonicalLoopback,
        port: 8080,
      });
      expect(parseHostAndPort('[2001:db8::1]:8443')).toEqual({
        host: canonicalGlobal,
        port: 8443,
      });
      expect(parseHostAndPort('[0:0:0:0:0:0:0:1]:8080')).toEqual({
        host: canonicalLoopback,
        port: 8080,
      });
    });

    it('strictly rejects invalid hosts and malformed ports instead of silent fallback', () => {
      expect(() => normalizeHost('example.com:invalid')).toThrowError(/Invalid non-numeric port/);
      expect(() => normalizeHost('example.com:99999')).toThrowError(/Port number out of range/);
      expect(() => normalizeHost('example.com:0')).toThrowError(/Port number out of range/);
      expect(() => normalizeHost('[invalid-ipv6]')).toThrowError(
        /Invalid IPv6 address inside brackets/,
      );
      expect(() => normalizeHost('[2001:db8::1')).toThrowError(/Missing closing bracket/);
      expect(() => normalizeHost('invalid:::ipv6')).toThrowError();
      expect(() => normalizeHost('')).toThrowError(/Host specification cannot be empty/);
    });
  });

  describe('validateScanTarget', () => {
    it('accepts valid http and https targets without credentials', () => {
      expect(validateScanTarget('https://example.com').valid).toBe(true);
      expect(validateScanTarget('http://localhost:8000/wp').valid).toBe(true);
      expect(validateScanTarget('http://192.168.1.1:8080').valid).toBe(true);
      expect(validateScanTarget('http://[::1]:8080').valid).toBe(true);
      expect(validateScanTarget('http://[0:0:0:0:0:0:0:1]:8080').valid).toBe(true);
    });

    it('strictly rejects URLs containing embedded credentials (username/password)', () => {
      const resWithPass = validateScanTarget('https://admin:pass@example.com/wp');
      expect(resWithPass.valid).toBe(false);
      expect(resWithPass.reason).toContain('embedded credentials');

      const resWithUserOnly = validateScanTarget('https://user@example.com');
      expect(resWithUserOnly.valid).toBe(false);
      expect(resWithUserOnly.reason).toContain('embedded credentials');

      const resWithTokenInUser = validateScanTarget('https://secret_token@example.com/api');
      expect(resWithTokenInUser.valid).toBe(false);
      expect(resWithTokenInUser.reason).toContain('embedded credentials');
    });

    it('rejects unsafe and unsupported protocols', () => {
      expect(validateScanTarget('javascript:alert(1)').valid).toBe(false);
      expect(validateScanTarget('file:///C:/Windows/system32').valid).toBe(false);
      expect(validateScanTarget('ftp://example.com').valid).toBe(false);
      expect(validateScanTarget('not-a-url').valid).toBe(false);
    });
  });

  describe('isUrlInScope (Port Scope Policy, Precedence & Boundaries)', () => {
    const allowed = ['example.com', 'localhost'];

    it('permits in-scope domain targets on standard ports by default', () => {
      expect(isUrlInScope('https://example.com', allowed)).toBe(true);
      expect(isUrlInScope('https://example.com:443', allowed)).toBe(true);
      expect(isUrlInScope('http://example.com', allowed)).toBe(true);
      expect(isUrlInScope('http://example.com:80', allowed)).toBe(true);
      expect(isUrlInScope('https://blog.example.com/page', allowed)).toBe(true);
    });

    it('strictly denies non-standard ports by default when not declared in scope', () => {
      expect(isUrlInScope('https://example.com:8443', allowed)).toBe(false);
      expect(isUrlInScope('http://example.com:8080', allowed)).toBe(false);
    });

    it('strictly denies protocol/port mismatches (e.g. http:443 and https:80)', () => {
      expect(isUrlInScope('http://example.com:443', allowed)).toBe(false);
      expect(isUrlInScope('https://example.com:80', allowed)).toBe(false);
    });

    it('permits non-standard ports when explicitly declared in allowedHosts entry', () => {
      const allowedWithPorts = ['example.com:8443', 'localhost:8080'];
      expect(isUrlInScope('https://example.com:8443', allowedWithPorts)).toBe(true);
      expect(isUrlInScope('http://localhost:8080/test', allowedWithPorts)).toBe(true);
      expect(isUrlInScope('https://example.com', allowedWithPorts)).toBe(false);
    });

    it('strictly enforces Port Precedence: explicit host port is never overridden by allowedPorts', () => {
      const mixedScope = ['api.example.com:8443', 'web.example.com'];
      const policy = { allowedPorts: [8080] };

      expect(isUrlInScope('https://api.example.com:8443', mixedScope, policy)).toBe(true);
      expect(isUrlInScope('https://api.example.com:8080', mixedScope, policy)).toBe(false);
      expect(isUrlInScope('http://web.example.com:8080', mixedScope, policy)).toBe(true);
      expect(isUrlInScope('http://web.example.com:9000', mixedScope, policy)).toBe(false);
    });

    it('permits any port on allowed hosts when allowAnyPort is enabled', () => {
      const allowedHosts = ['example.com:8443', 'web.example.com'];
      expect(isUrlInScope('https://example.com:9999', allowedHosts, { allowAnyPort: true })).toBe(
        true,
      );
      expect(
        isUrlInScope('http://web.example.com:12345', allowedHosts, { allowAnyPort: true }),
      ).toBe(true);
    });

    it('strictly denies targets containing embedded credentials regardless of host match', () => {
      expect(isUrlInScope('https://admin:pass@example.com', allowed)).toBe(false);
      expect(isUrlInScope('https://user@example.com/page', allowed)).toBe(false);
    });

    it('strictly denies external out-of-scope URLs and domain spoofing', () => {
      expect(isUrlInScope('https://external-tracker.com', allowed)).toBe(false);
      expect(isUrlInScope('https://attacker.com/evil', allowed)).toBe(false);
      expect(isUrlInScope('https://notexample.com', allowed)).toBe(false);
      expect(isUrlInScope('https://evil-example.com', allowed)).toBe(false);
      expect(isUrlInScope('https://example.com.evil.com', allowed)).toBe(false);
      expect(isUrlInScope('javascript:void(0)', allowed)).toBe(false);
    });

    it('properly evaluates IPv4 target scopes with ports', () => {
      const ipScope = ['192.168.1.10'];
      expect(isUrlInScope('http://192.168.1.10:80', ipScope)).toBe(true);
      expect(isUrlInScope('http://192.168.1.10:8080', ipScope)).toBe(false);
    });

    it('strictly unifies equivalent IPv6 representations in isUrlInScope matching', () => {
      // 1. Allowing [::1] allows access to [0:0:0:0:0:0:0:1]
      expect(isUrlInScope('http://[0:0:0:0:0:0:0:1]', ['[::1]'])).toBe(true);
      expect(isUrlInScope('http://[::1]', ['[0:0:0:0:0:0:0:1]'])).toBe(true);
      expect(isUrlInScope('http://[0:0:0:0:0:0:0:1]:80', ['::1'])).toBe(true);

      // 2. Allowing full form allows compressed form
      expect(isUrlInScope('https://[2001:db8::1]', ['[2001:0db8:0:0:0:0:0:1]'])).toBe(true);
      expect(isUrlInScope('https://[2001:0db8:0:0:0:0:0:1]', ['[2001:db8::1]'])).toBe(true);

      // 3. Equivalent IPv4-mapped representations match
      expect(isUrlInScope('http://[::ffff:192.168.1.1]', ['[0:0:0:0:0:ffff:c0a8:0101]'])).toBe(
        true,
      );
      expect(isUrlInScope('http://[0:0:0:0:0:ffff:c0a8:0101]', ['[::ffff:192.168.1.1]'])).toBe(
        true,
      );

      // 4. Distinct IPv6 addresses do NOT match
      expect(isUrlInScope('http://[::2]', ['[::1]'])).toBe(false);
      expect(isUrlInScope('http://[2001:db8::2]', ['[2001:db8::1]'])).toBe(false);

      // 5. Port scope precedence is preserved with IPv6
      expect(isUrlInScope('http://[0:0:0:0:0:0:0:1]:8080', ['[::1]:8080'])).toBe(true);
      expect(isUrlInScope('http://[0:0:0:0:0:0:0:1]:80', ['[::1]:8080'])).toBe(false);
      expect(
        isUrlInScope('http://[0:0:0:0:0:0:0:1]:8080', ['[::1]'], { allowedPorts: [8080] }),
      ).toBe(true);
      expect(
        isUrlInScope('http://[0:0:0:0:0:0:0:1]:9000', ['[::1]'], { allowedPorts: [8080] }),
      ).toBe(false);
    });
  });
});
