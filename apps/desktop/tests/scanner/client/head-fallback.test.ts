import { describe, it, expect } from 'vitest';
import {
  shouldFallbackToGetRange,
  createHeadFallbackResponse,
} from '../../../src/main/scanner/client/head-fallback.js';

describe('HEAD Fallback Handler', () => {
  it('correctly identifies fallback status codes (405 and 501)', () => {
    expect(shouldFallbackToGetRange(405)).toBe(true);
    expect(shouldFallbackToGetRange(501)).toBe(true);
    expect(shouldFallbackToGetRange(200)).toBe(false);
    expect(shouldFallbackToGetRange(403)).toBe(false);
    expect(shouldFallbackToGetRange(404)).toBe(false);
    expect(shouldFallbackToGetRange(500)).toBe(false);
  });

  it('constructs headers-only fallback response with 0 byte body', () => {
    const headers = { 'content-type': 'text/html', server: 'Apache/2.4' };
    const response = createHeadFallbackResponse(
      200,
      'OK',
      headers,
      '93.184.216.34',
      'https://example.com/',
      0,
    );

    expect(response.statusCode).toBe(200);
    expect(response.statusMessage).toBe('OK');
    expect(response.headers).toEqual(headers);
    expect(response.resolvedIp).toBe('93.184.216.34');
    expect(response.finalUrl).toBe('https://example.com/');
    expect(response.redirectHops).toBe(0);
    expect(response.encodedBodyBytes).toBe(0);
    expect(response.decompressedBodyBytes).toBe(0);
    expect(response.body.byteLength).toBe(0);
    expect(response.text()).toBe('');
  });
});
