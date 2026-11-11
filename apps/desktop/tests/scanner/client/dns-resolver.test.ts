import { describe, it, expect } from 'vitest';
import { resolveAndValidateDns } from '../../../src/main/scanner/client/dns-resolver.js';
import { SCANNER_CLIENT_ERROR_CODES } from '../../../src/main/scanner/client/types.js';

describe('Safe DNS Resolver & Socket IP Pinning Foundation', () => {
  it('resolves valid public hostname to pinned public IP', async () => {
    const mockLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ];

    const result = await resolveAndValidateDns('example.com', { lookupFn: mockLookup });
    expect(result.hostname).toBe('example.com');
    expect(result.pinnedIp).toBe('93.184.216.34');
    expect(result.family).toBe(4);
    expect(result.allIps).toEqual(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
  });

  it('fails closed when ANY resolved IP is prohibited (mixed public + loopback)', async () => {
    // Round-Robin DNS anti-pinning attack vector
    const mockLookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];

    await expect(
      resolveAndValidateDns('malicious-round-robin.com', { lookupFn: mockLookup }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
      }),
    );
  });

  it('fails closed when ANY resolved IP is cloud metadata (169.254.169.254)', async () => {
    const mockLookup = async () => [{ address: '169.254.169.254', family: 4 }];

    await expect(
      resolveAndValidateDns('metadata.local', { lookupFn: mockLookup }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
      }),
    );
  });

  it('fails closed when ANY resolved IP is private RFC 1918 address', async () => {
    const mockLookup = async () => [
      { address: '10.0.0.1', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ];

    await expect(
      resolveAndValidateDns('internal.corp', { lookupFn: mockLookup }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
      }),
    );
  });

  it('fails closed when ANY resolved IP is IPv6 loopback (::1) or ULA', async () => {
    const mockLookup = async () => [{ address: '::1', family: 6 }];

    await expect(
      resolveAndValidateDns('ipv6-loopback.local', { lookupFn: mockLookup }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
      }),
    );
  });

  it('throws ERR_DNS_EMPTY_RESULT when DNS lookup returns zero records', async () => {
    const mockLookup = async () => [];

    await expect(
      resolveAndValidateDns('empty-records.com', { lookupFn: mockLookup }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_DNS_EMPTY_RESULT,
      }),
    );
  });

  it('classifies system ENOTFOUND errors as ERR_DNS_RESOLUTION_FAILED', async () => {
    const mockLookup = async () => {
      const err = new Error('getaddrinfo ENOTFOUND non-existent.domain') as NodeJS.ErrnoException;
      err.code = 'ENOTFOUND';
      throw err;
    };

    await expect(
      resolveAndValidateDns('non-existent.domain', { lookupFn: mockLookup }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_DNS_RESOLUTION_FAILED,
      }),
    );
  });

  it('handles direct public IP address literals without DNS lookup', async () => {
    const result = await resolveAndValidateDns('93.184.216.34');
    expect(result.pinnedIp).toBe('93.184.216.34');
    expect(result.family).toBe(4);
  });

  it('handles bracketed public IPv6 literals and returns unbracketed pinnedIp', async () => {
    const result = await resolveAndValidateDns('[2606:2800:220:1:248:1893:25c8:1946]');
    expect(result.pinnedIp).toBe('2606:2800:220:1:248:1893:25c8:1946');
    expect(result.family).toBe(6);
  });

  it('rejects direct prohibited IP address literals fail-closed', async () => {
    await expect(resolveAndValidateDns('127.0.0.1')).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
      }),
    );

    await expect(resolveAndValidateDns('169.254.169.254')).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
      }),
    );

    await expect(resolveAndValidateDns('[::1]')).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
      }),
    );

    await expect(resolveAndValidateDns('[fe80::1]')).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
      }),
    );
  });

  it('throws ERR_REQUEST_ABORTED when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      resolveAndValidateDns('example.com', { signal: controller.signal }),
    ).rejects.toThrowError(
      expect.objectContaining({
        code: SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
      }),
    );
  });
});
