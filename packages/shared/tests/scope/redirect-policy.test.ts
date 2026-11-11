import { describe, it, expect } from 'vitest';
import { evaluateRedirectPolicy } from '../../src/scope/redirect-policy.js';

describe('Redirect Policy Engine (Multi-Dimensional Authorization)', () => {
  const allowedHosts = ['example.com', 'api.example.com'];

  describe('In-Scope Same-Host Redirects', () => {
    it('allows valid relative path redirect', () => {
      const decision = evaluateRedirectPolicy(
        'https://example.com/blog',
        '/blog/post-1',
        allowedHosts,
      );
      expect(decision.allowed).toBe(true);
      expect(decision.targetUrl).toBe('https://example.com/blog/post-1');
      expect(decision.isExternal).toBe(false);
      expect(decision.isCrossHost).toBe(false);
      expect(decision.nextHopCount).toBe(2);
    });

    it('allows valid absolute URL redirect to same origin', () => {
      const decision = evaluateRedirectPolicy(
        'https://example.com/page1',
        'https://example.com/page2',
        allowedHosts,
      );
      expect(decision.allowed).toBe(true);
      expect(decision.targetUrl).toBe('https://example.com/page2');
      expect(decision.isExternal).toBe(false);
    });

    it('allows HTTP to HTTPS upgrade', () => {
      const decision = evaluateRedirectPolicy(
        'http://example.com/login',
        'https://example.com/login',
        allowedHosts,
      );
      expect(decision.allowed).toBe(true);
      expect(decision.isHttpsDowngrade).toBe(false);
    });
  });

  describe('HTTPS-to-HTTP Downgrade Protection', () => {
    it('strictly rejects HTTPS-to-HTTP downgrade by default', () => {
      const decision = evaluateRedirectPolicy(
        'https://example.com/secure',
        'http://example.com/insecure',
        allowedHosts,
      );
      expect(decision.allowed).toBe(false);
      expect(decision.isHttpsDowngrade).toBe(true);
      expect(decision.reason).toContain('HTTPS-to-HTTP downgrade redirect is strictly rejected');
    });

    it('permits HTTPS-to-HTTP downgrade only when explicitly authorized', () => {
      const decision = evaluateRedirectPolicy(
        'https://example.com/secure',
        'http://example.com/insecure',
        allowedHosts,
        { allowHttpsDowngrade: true },
      );
      expect(decision.allowed).toBe(true);
      expect(decision.isHttpsDowngrade).toBe(true);
    });
  });

  describe('Credential and Protocol Invariant Enforcement', () => {
    it('rejects targets containing embedded credentials fail-closed', () => {
      const decision = evaluateRedirectPolicy(
        'https://example.com/start',
        'https://admin:secret@example.com/dashboard',
        allowedHosts,
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('embedded credentials');
    });

    it('rejects non-HTTP protocols fail-closed', () => {
      const badProtocols = [
        'javascript:alert(1)',
        'data:text/html,<h1>bad</h1>',
        'file:///etc/passwd',
        'ftp://ftp.example.com/file',
        'gopher://gopher.floodgap.com',
      ];

      for (const protoUrl of badProtocols) {
        const decision = evaluateRedirectPolicy(
          'https://example.com/start',
          protoUrl,
          allowedHosts,
        );
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Unsupported redirect protocol');
      }
    });
  });

  describe('Hop Count Ceilings & Loop Prevention', () => {
    it('allows in-scope redirect up to default max hops (5)', () => {
      const hop1 = evaluateRedirectPolicy('https://example.com/1', '/2', allowedHosts, {
        hopCount: 1,
      });
      expect(hop1.allowed).toBe(true);
      expect(hop1.nextHopCount).toBe(2);

      const hop5 = evaluateRedirectPolicy('https://example.com/5', '/6', allowedHosts, {
        hopCount: 5,
      });
      expect(hop5.allowed).toBe(true);
      expect(hop5.nextHopCount).toBe(6);

      const hop6 = evaluateRedirectPolicy('https://example.com/6', '/7', allowedHosts, {
        hopCount: 6,
      });
      expect(hop6.allowed).toBe(false);
      expect(hop6.reason).toContain('Redirect hop count (6) exceeded maximum allowed limit (5)');
    });

    it('caps external redirect hops at 2 by default', () => {
      const hop1 = evaluateRedirectPolicy('https://external.com/page1', '/page2', allowedHosts, {
        hopCount: 1,
      });
      expect(hop1.allowed).toBe(true);

      const hop2 = evaluateRedirectPolicy('https://external.com/page2', '/page3', allowedHosts, {
        hopCount: 2,
      });
      expect(hop2.allowed).toBe(true);

      const hop3 = evaluateRedirectPolicy('https://external.com/page3', '/page4', allowedHosts, {
        hopCount: 3,
      });
      expect(hop3.allowed).toBe(false);
      expect(hop3.reason).toContain('exceeded maximum allowed limit (2)');
    });

    it('respects custom configured maxHops', () => {
      const decision = evaluateRedirectPolicy('https://example.com/1', '/2', allowedHosts, {
        hopCount: 3,
        maxHops: 2,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('exceeded maximum allowed limit (2)');
    });
  });

  describe('External Redirect Scope Boundaries', () => {
    it('rejects cross-host external redirect by default', () => {
      // Current is external host A, target is external host B
      const decision = evaluateRedirectPolicy(
        'https://external-partner.com/link',
        'https://another-third-party.com/landing',
        allowedHosts,
      );
      expect(decision.allowed).toBe(false);
      expect(decision.isExternal).toBe(true);
      expect(decision.isCrossHost).toBe(true);
      expect(decision.reason).toContain('Cross-host external redirect');
    });

    it('permits cross-host external redirect when explicitly authorized', () => {
      const decision = evaluateRedirectPolicy(
        'https://external-partner.com/link',
        'https://another-third-party.com/landing',
        allowedHosts,
        { allowCrossHostExternalRedirects: true },
      );
      expect(decision.allowed).toBe(true);
      expect(decision.isExternal).toBe(true);
      expect(decision.isCrossHost).toBe(true);
    });

    it('permits same-host external redirect within hop limit', () => {
      const decision = evaluateRedirectPolicy(
        'https://external-partner.com/link1',
        '/link2',
        allowedHosts,
      );
      expect(decision.allowed).toBe(true);
      expect(decision.isExternal).toBe(true);
      expect(decision.isCrossHost).toBe(false);
    });

    it('rejects external redirect port changes by default', () => {
      const decision = evaluateRedirectPolicy(
        'https://external-partner.com:443/test',
        'https://external-partner.com:8443/test',
        allowedHosts,
      );
      expect(decision.allowed).toBe(false);
      expect(decision.isPortChange).toBe(true);
      expect(decision.reason).toContain('External redirect port change');
    });

    it('allows external redirect port changes if port is in allowedPorts list', () => {
      const decision = evaluateRedirectPolicy(
        'https://external-partner.com:443/test',
        'https://external-partner.com:8443/test',
        allowedHosts,
        { allowedPorts: [8443] },
      );
      expect(decision.allowed).toBe(true);
      expect(decision.isPortChange).toBe(true);
    });
  });

  describe('Input Robustness & Fail-Closed Malformed Input', () => {
    it('rejects invalid current URLs fail-closed', () => {
      const decision = evaluateRedirectPolicy('not-a-valid-url', '/page', allowedHosts);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Invalid current URL');
    });

    it('rejects unparseable Location headers fail-closed', () => {
      const decision = evaluateRedirectPolicy(
        'https://example.com/home',
        'http://[invalid-ipv6-bracket',
        allowedHosts,
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Invalid or unparseable redirect Location');
    });
  });
});
