import { describe, it, expect } from 'vitest';
import {
  parseMediaType,
  validateHtmlContentType,
  ALLOWED_HTML_MEDIA_ESSENCES,
} from '../../src/scope/media-type.js';

describe('Media-Type (Content-Type) Parser & HTML Gatekeeper', () => {
  describe('parseMediaType RFC 7231 / RFC 2045 Parser', () => {
    it('parses simple type and subtype without parameters', () => {
      const parsed = parseMediaType('text/html');
      expect(parsed).toEqual({
        type: 'text',
        subtype: 'html',
        essence: 'text/html',
        parameters: {},
      });
    });

    it('normalizes type and subtype to lowercase', () => {
      const parsed = parseMediaType('TEXT/HTML');
      expect(parsed).toEqual({
        type: 'text',
        subtype: 'html',
        essence: 'text/html',
        parameters: {},
      });
    });

    it('parses single unquoted parameter', () => {
      const parsed = parseMediaType('text/html; charset=utf-8');
      expect(parsed).toEqual({
        type: 'text',
        subtype: 'html',
        essence: 'text/html',
        parameters: { charset: 'utf-8' },
      });
    });

    it('parses multiple parameters with whitespace variations', () => {
      const parsed = parseMediaType('text/html ; charset=UTF-8 ; foo=bar ; version=1.0');
      expect(parsed).toEqual({
        type: 'text',
        subtype: 'html',
        essence: 'text/html',
        parameters: {
          charset: 'UTF-8',
          foo: 'bar',
          version: '1.0',
        },
      });
    });

    it('parses quoted-string parameter values according to RFC 7230', () => {
      const parsed = parseMediaType('text/html; charset="utf-8"');
      expect(parsed).toEqual({
        type: 'text',
        subtype: 'html',
        essence: 'text/html',
        parameters: { charset: 'utf-8' },
      });
    });

    it('handles quoted-pair escape sequences inside quoted strings', () => {
      const parsed = parseMediaType('text/html; title="My \\"Quoted\\" Page"');
      expect(parsed).toEqual({
        type: 'text',
        subtype: 'html',
        essence: 'text/html',
        parameters: { title: 'My "Quoted" Page' },
      });
    });

    it('accepts duplicate identical parameters', () => {
      const parsed = parseMediaType('text/html; charset=utf-8; charset=utf-8');
      expect(parsed).not.toBeNull();
      expect(parsed?.parameters.charset).toBe('utf-8');
    });

    it('rejects conflicting duplicate parameters fail-closed', () => {
      const parsed = parseMediaType('text/html; charset=utf-8; charset=iso-8859-1');
      expect(parsed).toBeNull();
    });

    it('rejects unterminated quoted string parameters fail-closed', () => {
      expect(parseMediaType('text/html; charset="utf-8')).toBeNull();
    });

    it('rejects missing subtype', () => {
      expect(parseMediaType('text/')).toBeNull();
      expect(parseMediaType('text')).toBeNull();
    });

    it('rejects missing type', () => {
      expect(parseMediaType('/html')).toBeNull();
    });

    it('rejects invalid tchar characters in type and subtype', () => {
      expect(parseMediaType('text@/html')).toBeNull();
      expect(parseMediaType('text/ht ml')).toBeNull();
      expect(parseMediaType('text<>/html')).toBeNull();
    });

    it('rejects parameters missing equal sign delimiter', () => {
      expect(parseMediaType('text/html; charset')).toBeNull();
    });

    it('returns null for empty, whitespace, null, or undefined headers', () => {
      expect(parseMediaType('')).toBeNull();
      expect(parseMediaType('   ')).toBeNull();
      expect(parseMediaType(null)).toBeNull();
      expect(parseMediaType(undefined)).toBeNull();
    });
  });

  describe('validateHtmlContentType Gatekeeper Policy', () => {
    it('approves standard text/html and application/xhtml+xml essences', () => {
      expect(ALLOWED_HTML_MEDIA_ESSENCES).toEqual(['text/html', 'application/xhtml+xml']);

      const res1 = validateHtmlContentType('text/html');
      expect(res1.allowed).toBe(true);
      expect(res1.parsed?.essence).toBe('text/html');

      const res2 = validateHtmlContentType('text/html; charset=UTF-8');
      expect(res2.allowed).toBe(true);

      const res3 = validateHtmlContentType('application/xhtml+xml; charset=utf-8');
      expect(res3.allowed).toBe(true);
      expect(res3.parsed?.essence).toBe('application/xhtml+xml');
    });

    it('rejects non-HTML MIME types fail-closed without buffering', () => {
      const nonHtmlTypes = [
        'application/json',
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/svg+xml',
        'text/plain',
        'application/octet-stream',
        'text/css',
        'application/javascript',
        'application/xml',
        'video/mp4',
        'audio/mpeg',
      ];

      for (const mime of nonHtmlTypes) {
        const res = validateHtmlContentType(mime);
        expect(res.allowed).toBe(false);
        expect(res.reason).toContain('Non-HTML media type');
        expect(res.parsed?.essence).toBe(mime);
      }
    });

    it('rejects missing, null, or whitespace Content-Type header fail-closed', () => {
      expect(validateHtmlContentType('').allowed).toBe(false);
      expect(validateHtmlContentType('   ').allowed).toBe(false);
      expect(validateHtmlContentType(null).allowed).toBe(false);
      expect(validateHtmlContentType(undefined).allowed).toBe(false);
    });

    it('rejects malformed Content-Type header fail-closed', () => {
      const res = validateHtmlContentType('invalid; broken header');
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain('Malformed or invalid Content-Type');
    });
  });
});
