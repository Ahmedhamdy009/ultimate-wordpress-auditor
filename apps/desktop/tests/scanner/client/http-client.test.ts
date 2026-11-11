import { describe, it, expect, expectTypeOf, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { SafeHttpClient } from '../../../src/main/scanner/client/http-client.js';
import {
  SCANNER_CLIENT_ERROR_CODES,
  type SafeHttpClientOptions,
  type SafeHttpClientTestHooks,
} from '../../../src/main/scanner/client/types.js';

describe('SafeHttpClient End-to-End Security & Networking Integration', () => {
  let server: http.Server;
  let serverPort: number;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/hello.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><h1>Safe Scanner</h1></body></html>');
      } else if (url.pathname === '/head-not-allowed') {
        if (req.method === 'HEAD') {
          res.writeHead(405, { 'Content-Type': 'text/html', Allow: 'GET' });
          res.end();
        } else if (req.method === 'GET') {
          const hasRange = typeof req.headers['range'] === 'string';
          res.writeHead(206, {
            'Content-Type': 'text/html',
            'Content-Range': 'bytes 0-1024/2048',
            'X-Fallback-Success': hasRange ? 'true' : 'false',
          });
          res.end('partial html chunk');
        }
      } else if (url.pathname === '/head-ignores-range') {
        if (req.method === 'HEAD') {
          res.writeHead(405, { 'Content-Type': 'text/html', Allow: 'GET' });
          res.end();
        } else if (req.method === 'GET') {
          // Ignores Range header, returns 200 OK with 50 KB payload
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'X-Ignored-Range': 'true',
          });
          res.end('z'.repeat(50 * 1024));
        }
      } else if (url.pathname === '/head-fallback-hanging') {
        if (req.method === 'HEAD') {
          res.writeHead(405, { 'Content-Type': 'text/html', Allow: 'GET' });
          res.end();
        } else if (req.method === 'GET') {
          // Never respond to trigger fallback GET timeout/abort
        }
      } else if (url.pathname === '/pdf-file') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        res.end('%PDF-1.4 mock pdf data');
      } else if (url.pathname === '/huge-header') {
        // Exceeds 16 KB default header limit
        const hugeValue = 'x'.repeat(18 * 1024);
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'X-Huge-Header': hugeValue,
        });
        res.end('<html><body>huge</body></html>');
      } else if (url.pathname === '/hanging') {
        // Never respond to trigger timeout
      } else if (url.pathname === '/redirect-hop1') {
        res.writeHead(302, { Location: '/redirect-hop2' });
        res.end();
      } else if (url.pathname === '/redirect-hop2') {
        res.writeHead(302, { Location: '/hello.html' });
        res.end();
      } else if (url.pathname === '/redirect-to-ssrf') {
        res.writeHead(302, { Location: 'http://internal-vault.corp/secret' });
        res.end();
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body>Not Found</body></html>');
      }
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as net.AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  // Mock public DNS lookup helper that resolves example.com to public IP 93.184.216.34
  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  describe('SSRF Protection Gatekeeper', () => {
    it('blocks request to loopback address (127.0.0.1) before opening any socket', async () => {
      const client = new SafeHttpClient();
      const mockLoopbackLookup = async () => [{ address: '127.0.0.1', family: 4 }];

      await expect(
        client.get(`http://internal.site:${serverPort}/hello.html`, {
          lookupFn: mockLoopbackLookup,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
        }),
      );
    });

    it('blocks request to cloud metadata address (169.254.169.254)', async () => {
      const client = new SafeHttpClient();
      const mockMetadataLookup = async () => [{ address: '169.254.169.254', family: 4 }];

      await expect(
        client.get(`http://metadata.aws:${serverPort}/latest/meta-data`, {
          lookupFn: mockMetadataLookup,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
        }),
      );
    });
  });

  describe('GET Request Execution', () => {
    it('successfully fetches HTML page with verified headers and body buffer', async () => {
      const client = new SafeHttpClient();

      const response = await client.get(`http://audit-target.com:${serverPort}/hello.html`, {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.text()).toBe(
        '<!DOCTYPE html><html><body><h1>Safe Scanner</h1></body></html>',
      );
      expect(response.decompressedBodyBytes).toBe(
        Buffer.byteLength('<!DOCTYPE html><html><body><h1>Safe Scanner</h1></body></html>'),
      );
      expect(response.body).toBeInstanceOf(ArrayBuffer);
      expect(response.redirectHops).toBe(0);
    });

    it('successfully fetches HTML page using bracketed IPv6 destination URL', async () => {
      const client = new SafeHttpClient();

      const response = await client.get(
        `http://[2606:2800:220:1:248:1893:25c8:1946]:${serverPort}/hello.html`,
        {
          pinnedIpOverride: '127.0.0.1',
        },
      );

      expect(response.statusCode).toBe(200);
      expect(response.resolvedIp).toBe('127.0.0.1');
      expect(response.text()).toContain('Safe Scanner');
    });
  });

  describe('HEAD Request and HEAD Fallback', () => {
    it('returns headers with empty body for standard HEAD request', async () => {
      const client = new SafeHttpClient();

      const response = await client.head(`http://audit-target.com:${serverPort}/hello.html`, {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body.byteLength).toBe(0);
      expect(response.text()).toBe('');
    });

    it('automatically triggers fallback GET Range probe on 405 Method Not Allowed', async () => {
      const client = new SafeHttpClient();

      const response = await client.head(`http://audit-target.com:${serverPort}/head-not-allowed`, {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
      });

      // The fallback GET with Range header returned status 206 and X-Fallback-Success header
      expect(response.statusCode).toBe(206);
      expect(response.headers['x-fallback-success']).toBe('true');
      expect(response.body.byteLength).toBe(0); // Body is never buffered
    });

    it('immediately aborts and buffers zero body bytes when fallback server returns 200 and ignores Range', async () => {
      const client = new SafeHttpClient();

      const response = await client.head(
        `http://audit-target.com:${serverPort}/head-ignores-range`,
        {
          lookupFn: mockPublicLookup,
          pinnedIpOverride: '127.0.0.1',
        },
      );

      // Server returned 200 and tried to send 50 KB body, but stream was immediately aborted
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-ignored-range']).toBe('true');
      expect(response.body.byteLength).toBe(0);
      expect(response.text()).toBe('');
    });

    it('aborts hanging fallback GET probe on caller signal', async () => {
      const client = new SafeHttpClient();
      const controller = new AbortController();

      const promise = client.head(`http://audit-target.com:${serverPort}/head-fallback-hanging`, {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
        signal: controller.signal,
        responseTimeoutMs: 5000,
      });

      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
        }),
      );
    });

    it('times out hanging fallback GET probe when responseTimeoutMs expires', async () => {
      const client = new SafeHttpClient();

      await expect(
        client.head(`http://audit-target.com:${serverPort}/head-fallback-hanging`, {
          lookupFn: mockPublicLookup,
          pinnedIpOverride: '127.0.0.1',
          responseTimeoutMs: 150,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_TIMEOUT,
        }),
      );
    });
  });

  describe('Content-Type Enforcement', () => {
    it('aborts response without buffering body when Content-Type is non-HTML', async () => {
      const client = new SafeHttpClient();

      await expect(
        client.get(`http://audit-target.com:${serverPort}/pdf-file`, {
          lookupFn: mockPublicLookup,
          pinnedIpOverride: '127.0.0.1',
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_NON_HTML_CONTENT_TYPE,
        }),
      );
    });
  });

  describe('Max Header Size Enforcement (16 KB)', () => {
    it('throws ERR_HEADER_OVERFLOW when response headers exceed 16 KB', async () => {
      const client = new SafeHttpClient();

      await expect(
        client.get(`http://audit-target.com:${serverPort}/huge-header`, {
          lookupFn: mockPublicLookup,
          pinnedIpOverride: '127.0.0.1',
          maxHeaderSize: 16384,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_HEADER_OVERFLOW,
        }),
      );
    });
  });

  describe('Timeout and Cancellation', () => {
    it('throws ERR_REQUEST_TIMEOUT when response times out', async () => {
      const client = new SafeHttpClient();

      await expect(
        client.get(`http://audit-target.com:${serverPort}/hanging`, {
          lookupFn: mockPublicLookup,
          pinnedIpOverride: '127.0.0.1',
          responseTimeoutMs: 150,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_TIMEOUT,
        }),
      );
    });

    it('throws ERR_REQUEST_ABORTED when signal is aborted', async () => {
      const client = new SafeHttpClient();
      const controller = new AbortController();

      const promise = client.get(`http://audit-target.com:${serverPort}/hanging`, {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
        signal: controller.signal,
        responseTimeoutMs: 5000,
      });

      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_REQUEST_ABORTED,
        }),
      );
    });
  });

  describe('Multi-Hop In-Scope Redirects', () => {
    it('follows in-scope redirects to final destination and accounts hops', async () => {
      const client = new SafeHttpClient();

      const response = await client.get(`http://audit-target.com:${serverPort}/redirect-hop1`, {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
        allowedHosts: ['audit-target.com'],
      });

      expect(response.statusCode).toBe(200);
      expect(response.redirectHops).toBe(2);
      expect(response.finalUrl).toBe(`http://audit-target.com:${serverPort}/hello.html`);
      expect(response.text()).toContain('Safe Scanner');
    });

    it('rejects redirect immediately when redirect destination resolves to an SSRF prohibited address', async () => {
      const client = new SafeHttpClient();

      const mockLookupWithSsrfRedirect = async (hostname: string) => {
        if (hostname === 'audit-target.com') {
          return [{ address: '93.184.216.34', family: 4 }];
        }
        if (hostname === 'internal-vault.corp') {
          return [{ address: '10.0.0.1', family: 4 }]; // Private IP
        }
        return [];
      };

      await expect(
        client.get(`http://audit-target.com:${serverPort}/redirect-to-ssrf`, {
          lookupFn: mockLookupWithSsrfRedirect,
          pinnedIpOverride: '127.0.0.1',
          allowedHosts: ['audit-target.com', 'internal-vault.corp'],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_SSRF_PROHIBITED_IP,
        }),
      );
    });
  });

  describe('Pinned Socket Integrity & Fallback Immunity', () => {
    it('fails closed when connection to pinned destination IP is refused, never falling back to unpinned connection', async () => {
      const client = new SafeHttpClient();
      const closedPort = 59987;

      await expect(
        client.get(`http://audit-target.com:${closedPort}/test.html`, {
          lookupFn: mockPublicLookup,
          pinnedIpOverride: '127.0.0.1',
          connectTimeoutMs: 1000,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          code: SCANNER_CLIENT_ERROR_CODES.ERR_CONNECTION_REFUSED,
        }),
      );
    });
  });

  describe('Public Trust Boundary & Options Segregation', () => {
    it('strictly confines public SafeHttpClientOptions to production settings (no ca, rejectUnauthorized, lookupFn, pinnedIpOverride)', () => {
      // Type-level assertion: verify that public SafeHttpClientOptions lacks test/DI hooks
      expectTypeOf<SafeHttpClientOptions>().not.toHaveProperty('ca');
      expectTypeOf<SafeHttpClientOptions>().not.toHaveProperty('rejectUnauthorized');
      expectTypeOf<SafeHttpClientOptions>().not.toHaveProperty('lookupFn');
      expectTypeOf<SafeHttpClientOptions>().not.toHaveProperty('pinnedIpOverride');

      // Test hooks interface explicitly contains them
      expectTypeOf<SafeHttpClientTestHooks>().toHaveProperty('ca');
      expectTypeOf<SafeHttpClientTestHooks>().toHaveProperty('lookupFn');
      expectTypeOf<SafeHttpClientTestHooks>().toHaveProperty('pinnedIpOverride');
    });

    it('ignores custom CA if passed as an unknown property on public options object', async () => {
      const client = new SafeHttpClient();

      // If an external consumer tries to pass `ca` inside `options` via raw JSON or type bypass,
      // SafeHttpClient.request strips non-public fields so it does NOT leak into testHooks
      const reqWithOptionsCa = {
        url: `http://audit-target.com:${serverPort}/hello.html`,
        options: {
          connectTimeoutMs: 2000,
          ca: 'invalid-arbitrary-ca',
        } as unknown as Partial<SafeHttpClientOptions>,
        testHooks: {
          lookupFn: mockPublicLookup,
          pinnedIpOverride: '127.0.0.1',
        },
      };

      const res = await client.request(reqWithOptionsCa);
      expect(res.statusCode).toBe(200);
      expect(res.text()).toContain('Safe Scanner');
    });
  });
});
