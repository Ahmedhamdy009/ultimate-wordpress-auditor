import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { handleResponseRedirect } from '../../../src/main/scanner/client/redirect.js';
import { SCANNER_CLIENT_ERROR_CODES } from '../../../src/main/scanner/client/types.js';

function createMockResponse(statusCode: number, headers: Record<string, string>): IncomingMessage {
  return {
    statusCode,
    headers,
  } as unknown as IncomingMessage;
}

describe('Safe Redirect Handler & Policy Integration', () => {
  it('returns shouldRedirect: false for 200 OK responses', () => {
    const res = createMockResponse(200, { 'content-type': 'text/html' });
    const result = handleResponseRedirect('https://example.com/page', res);
    expect(result.shouldRedirect).toBe(false);
  });

  it('handles valid relative 302 redirect', () => {
    const res = createMockResponse(302, { location: '/target-page' });
    const result = handleResponseRedirect('https://example.com/start', res, {
      allowedHosts: ['example.com'],
    });
    expect(result.shouldRedirect).toBe(true);
    expect(result.targetUrl).toBe('https://example.com/target-page');
    expect(result.nextHopCount).toBe(2);
  });

  it('rejects cross-host external redirect by default with ERR_REDIRECT_DISALLOWED', () => {
    const res = createMockResponse(301, { location: 'https://thirdparty.com/landing' });
    expect(() =>
      handleResponseRedirect('https://external.com/link', res, {
        allowedHosts: ['example.com'],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_REDIRECT_DISALLOWED,
      }),
    );
  });

  it('allows cross-host external redirect when explicitly authorized', () => {
    const res = createMockResponse(301, { location: 'https://thirdparty.com/landing' });
    const result = handleResponseRedirect('https://external.com/link', res, {
      allowedHosts: ['example.com'],
      allowCrossHostExternalRedirects: true,
    });
    expect(result.shouldRedirect).toBe(true);
    expect(result.targetUrl).toBe('https://thirdparty.com/landing');
  });

  it('rejects HTTPS-to-HTTP downgrade redirect by default', () => {
    const res = createMockResponse(302, { location: 'http://example.com/insecure' });
    expect(() =>
      handleResponseRedirect('https://example.com/secure', res, {
        allowedHosts: ['example.com'],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_REDIRECT_DISALLOWED,
      }),
    );
  });

  it('returns shouldRedirect: false when 3xx response has missing location', () => {
    const res = createMockResponse(302, {});
    const result = handleResponseRedirect('https://example.com/start', res);
    expect(result.shouldRedirect).toBe(false);
  });
});
