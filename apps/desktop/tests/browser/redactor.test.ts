import { describe, it, expect } from 'vitest';
import {
  redactUrl,
  redactHeaders,
  redactString,
  sanitizeEvidence,
} from '../../src/main/browser/redactor.js';

describe('Runtime Redactor & Privacy Protection Suite', () => {
  describe('redactUrl', () => {
    it('redacts sensitive query parameters (password, token, key, secret, session)', () => {
      const sensitiveUrl =
        'https://example.com/api/v1/auth?user=ahmed&password=SuperSecret123!&token=xyz789&api_key=key_abcdef&client_secret=topsecret&session_id=sess_999';
      const redacted = redactUrl(sensitiveUrl);

      expect(redacted).not.toContain('SuperSecret123!');
      expect(redacted).not.toContain('xyz789');
      expect(redacted).not.toContain('key_abcdef');
      expect(redacted).not.toContain('topsecret');
      expect(redacted).not.toContain('sess_999');

      expect(redacted).toContain('user=ahmed');
      expect(redacted).toContain('password=%5BREDACTED%5D');
      expect(redacted).toContain('token=%5BREDACTED%5D');
      expect(redacted).toContain('api_key=%5BREDACTED%5D');
    });

    it('redacts payment and card query parameters', () => {
      const paymentUrl = 'https://example.com/checkout?amount=100&card=4111111111111111&cvv=123';
      const redacted = redactUrl(paymentUrl);

      expect(redacted).not.toContain('4111111111111111');
      expect(redacted).not.toContain('123');
      expect(redacted).toContain('amount=100');
    });

    it('leaves non-sensitive query parameters untouched', () => {
      const safeUrl = 'https://example.com/blog?page=2&sort=desc&category=news';
      expect(redactUrl(safeUrl)).toBe(safeUrl);
    });

    it('handles malformed URLs with regex fallback safely', () => {
      const malformed = 'not-a-valid-url?token=secret_token_123&sort=asc';
      const redacted = redactUrl(malformed);
      expect(redacted).not.toContain('secret_token_123');
      expect(redacted).toContain('token=[REDACTED]');
      expect(redacted).toContain('sort=asc');
    });
  });

  describe('redactHeaders', () => {
    it('filters and redacts Authorization, Cookie, and sensitive API headers', () => {
      const headers = {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
        cookie: 'PHPSESSID=session_secret_cookie_val; logged_in=true',
        'set-cookie': 'session_id=new_secret; Path=/',
        'x-api-key': 'live_key_999999',
        'content-type': 'application/json',
        'user-agent': 'AuditBot/1.0',
      };

      const redacted = redactHeaders(headers);

      expect(redacted.authorization).toBe('[REDACTED]');
      expect(redacted.cookie).toBe('[REDACTED]');
      expect(redacted['set-cookie']).toBe('[REDACTED]');
      expect(redacted['x-api-key']).toBe('[REDACTED]');
      expect(redacted['content-type']).toBe('application/json');
      expect(redacted['user-agent']).toBe('AuditBot/1.0');
    });
  });

  describe('redactString', () => {
    it('redacts inline Bearer tokens and Basic auth credentials', () => {
      const text =
        'Error authenticating with Bearer eyJhbGciOiJIUzI1NiIs.tok and Basic YWRtaW46cGFzc3dvcmQ=';
      const redacted = redactString(text);

      expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIs.tok');
      expect(redacted).not.toContain('YWRtaW46cGFzc3dvcmQ=');
      expect(redacted).toContain('Bearer [REDACTED]');
      expect(redacted).toContain('Basic [REDACTED]');
    });

    it('redacts inline JSON password and token properties', () => {
      const jsonSnippet = '{"user": "admin", "password": "supersecretpassword123"}';
      const redacted = redactString(jsonSnippet);

      expect(redacted).not.toContain('supersecretpassword123');
      expect(redacted).toContain('"password": "[REDACTED]"');
    });

    it('truncates strings that exceed maxLength with a clear suffix', () => {
      const longText = 'A'.repeat(500);
      const truncated = redactString(longText, 100);

      expect(truncated.length).toBeLessThan(200);
      expect(truncated).toContain('[truncated 400 chars]');
    });
  });

  describe('sanitizeEvidence', () => {
    it('recursively redacts and sanitizes nested evidence structures', () => {
      const rawEvidence = {
        url: 'https://example.com/api?token=sensitive_token',
        nested: {
          authHeader: 'Bearer my_token_abc',
          details: ['safe item', 'Authorization: Bearer secret_xyz'],
        },
        count: 42,
      };

      const sanitized = sanitizeEvidence(rawEvidence);

      expect(sanitized.count).toBe(42);
      expect(JSON.stringify(sanitized)).not.toContain('sensitive_token');
      expect(JSON.stringify(sanitized)).not.toContain('my_token_abc');
      expect(JSON.stringify(sanitized)).not.toContain('secret_xyz');
    });

    it('bounds total serialized evidence size if exceeding maximum byte limit', () => {
      const hugeObject: Record<string, string> = {};
      for (let i = 0; i < 200; i++) {
        hugeObject[`key_${i}`] = 'X'.repeat(500);
      }

      const sanitized = sanitizeEvidence(hugeObject, 1024);
      expect(sanitized.truncated).toBe(true);
      expect(sanitized.summary).toContain('exceeded 1024 bytes limit');
    });
  });
});
