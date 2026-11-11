import { describe, it, expect } from 'vitest';
import {
  redactUrl,
  redactHeaders,
  redactString,
  sanitizeEvidence,
} from '../../src/main/browser/redactor.js';

describe('Adversarial Sensitive Data Redaction Suite', () => {
  describe('redactUrl adversarial tests', () => {
    it('redacts credentials embedded in URL authority', () => {
      const url = 'https://admin:SuperSecretPass123!@example.com/api/v1/resource';
      const redacted = redactUrl(url);

      expect(redacted).not.toContain('SuperSecretPass123!');
      expect(redacted).toMatch(/(?:\[REDACTED\]|%5BREDACTED%5D)/);
      expect(redacted).toBe('https://admin:%5BREDACTED%5D@example.com/api/v1/resource');
    });

    it('redacts sensitive query parameters with arbitrary casing and separators', () => {
      const sensitiveQueries = [
        'https://example.com/login?password=myP@ssw0rd!',
        'https://example.com/api?API_KEY=sk_live_12345678901234567890',
        'https://example.com/auth?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMC6Y5uZ3iSSrqncLxYWmH123456',
        'https://example.com/session?session_id=sess_abcdef1234567890',
        'https://example.com/pay?cardnumber=4111222233334444&cvv=123',
        'https://example.com/reset?secret_key=xyz987654321',
        'https://example.com/refresh?refresh_token=rt_9988776655443322',
      ];

      for (const raw of sensitiveQueries) {
        const redacted = redactUrl(raw);
        expect(redacted).not.toContain('myP@ssw0rd!');
        expect(redacted).not.toContain('sk_live_12345678901234567890');
        expect(redacted).not.toContain('sess_abcdef1234567890');
        expect(redacted).not.toContain('4111222233334444');
        expect(redacted).not.toContain('123');
        expect(redacted).not.toContain('xyz987654321');
        expect(redacted).not.toContain('rt_9988776655443322');
        expect(redacted).toMatch(/(?:\[REDACTED\]|%5BREDACTED%5D)/);
      }
    });

    it('redacts JWT tokens and token hashes embedded in URL paths', () => {
      const jwtPathUrl =
        'https://example.com/api/v1/verify/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMC6Y5uZ3iSSrqncLxYWmH123456/profile';
      const redactedJwt = redactUrl(jwtPathUrl);

      expect(redactedJwt).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(redactedJwt).toContain('[REDACTED_JWT]');

      const resetTokenPathUrl =
        'https://example.com/reset-password/a1b2c3d4e5f67890123456789abcdef0';
      const redactedReset = redactUrl(resetTokenPathUrl);

      expect(redactedReset).not.toContain('a1b2c3d4e5f67890123456789abcdef0');
      expect(redactedReset).toContain('[REDACTED]');
      expect(redactedReset).toBe('https://example.com/reset-password/[REDACTED]');
    });

    it('preserves non-sensitive benign paths and query parameters intact', () => {
      const benignUrl = 'https://example.com/blog/article-1?page=2&sort=desc&category=news';
      const result = redactUrl(benignUrl);

      expect(result).toBe(benignUrl);
    });
  });

  describe('redactHeaders adversarial tests', () => {
    it('strictly redacts all sensitive headers regardless of letter casing', () => {
      const headers = {
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeak',
        'Proxy-Authorization': 'Basic YWRtaW46c2VjcmV0MTIz',
        Cookie: 'sessionid=s_123456; csrf_token=csrf_98765',
        'Set-Cookie': 'sessionid=s_new; Path=/; Secure; HttpOnly',
        'X-API-KEY': 'ak_live_abcdef1234567890',
        'X-Auth-Token': 'auth_token_999999',
        'X-Signature': 'sha256=1234567890abcdef',
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'Mozilla/5.0 Auditor/1.0',
      };

      const redacted = redactHeaders(headers);

      expect(redacted.Authorization).toBe('[REDACTED]');
      expect(redacted['Proxy-Authorization']).toBe('[REDACTED]');
      expect(redacted.Cookie).toBe('[REDACTED]');
      expect(redacted['Set-Cookie']).toBe('[REDACTED]');
      expect(redacted['X-API-KEY']).toBe('[REDACTED]');
      expect(redacted['X-Auth-Token']).toBe('[REDACTED]');
      expect(redacted['X-Signature']).toBe('[REDACTED]');

      // Benign headers preserved
      expect(redacted['Content-Type']).toBe('application/json; charset=utf-8');
      expect(redacted['User-Agent']).toBe('Mozilla/5.0 Auditor/1.0');
    });
  });

  describe('redactString adversarial tests (console & stack messages)', () => {
    it('redacts inline Bearer and Basic tokens embedded in error text', () => {
      const text =
        'Failed to authenticate with Authorization: Bearer abc.123.def-456 and Basic dXNlcjpwYXNz';
      const sanitized = redactString(text);

      expect(sanitized).not.toContain('abc.123.def-456');
      expect(sanitized).not.toContain('dXNlcjpwYXNz');
      expect(sanitized).toContain('Bearer [REDACTED]');
      expect(sanitized).toContain('Basic [REDACTED]');
    });

    it('redacts known cloud & SaaS API keys (Stripe, GitHub, Google)', () => {
      const messages = [
        'Stripe error with key sk_live_abcdef1234567890123456',
        'GitHub authentication failure with token ghp_123456789012345678901234567890123456',
        'Google Maps API call failed with key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q',
      ];

      for (const msg of messages) {
        const result = redactString(msg);
        expect(result).not.toContain('sk_live_');
        expect(result).not.toContain('ghp_');
        expect(result).not.toContain('AIzaSy');
        expect(result).toContain('[REDACTED_API_KEY]');
      }
    });

    it('redacts JSON-formatted password and token properties in stack or console traces', () => {
      const payload =
        '{"user": "admin", "password": "SuperSecretPassword123!", "token": "tok_xyz"}';
      const sanitized = redactString(payload);

      expect(sanitized).not.toContain('SuperSecretPassword123!');
      expect(sanitized).not.toContain('tok_xyz');
      expect(sanitized).toContain('"password": "[REDACTED]"');
      expect(sanitized).toContain('"token": "[REDACTED]"');
    });
  });

  describe('sanitizeEvidence adversarial tests', () => {
    it('redacts nested object strings and arrays before persistence', () => {
      const evidence = {
        url: 'https://example.com/api?token=secretTokenValue',
        nested: {
          errorMessage: 'Call to payment gateway with Bearer secretBearerToken failed',
          requestHeaders: {
            authorization: 'Bearer secretBearerToken',
            'content-type': 'application/json',
          },
        },
        breadcrumbs: [
          'Navigated to https://example.com/dashboard',
          'Token received: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMC6Y5uZ3iSSrqncLxYWmH123456',
        ],
      };

      const sanitized = sanitizeEvidence(evidence);

      expect(JSON.stringify(sanitized)).not.toContain('secretTokenValue');
      expect(JSON.stringify(sanitized)).not.toContain('secretBearerToken');
      expect(JSON.stringify(sanitized)).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('strictly caps evidence payload size at maximum 64KB without throw', () => {
      const hugeMetadata: Record<string, unknown> = {
        title: 'Huge Audit Result',
        logs: [],
      };

      for (let i = 0; i < 4000; i++) {
        (hugeMetadata.logs as unknown[]).push({
          id: i,
          data: 'sample long trace payload '.repeat(10),
        });
      }

      const capped = sanitizeEvidence(hugeMetadata, 64 * 1024);
      const jsonBytes = Buffer.byteLength(JSON.stringify(capped), 'utf-8');

      expect(jsonBytes).toBeLessThanOrEqual(64 * 1024);
      expect((capped as Record<string, unknown>).truncated).toBe(true);
    });
  });
});
