import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { BrowserProxyServer } from '../../src/main/browser/proxy-server.js';

describe('BrowserProxyServer & SSRF Pinning Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      if (req.url === '/hello') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Hello from Fixture Server');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise<void>(resolve => {
      fixtureServer.listen(0, '127.0.0.1', () => {
        fixturePort = (fixtureServer.address() as net.AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => {
      fixtureServer.close(() => resolve());
    });
  });

  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const mockMixedLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 }, // Toxic private IP injected
  ];

  it('starts proxy on local dynamic port and reports valid proxy URL', async () => {
    const proxy = new BrowserProxyServer();
    const proxyUrl = await proxy.start();

    expect(proxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(proxy.getPort()).toBeGreaterThan(0);

    await proxy.stop();
  });

  it('successfully forwards HTTP request for public domain with socket pinning', async () => {
    const proxy = new BrowserProxyServer({
      scopePolicy: {
        authorizedOrigin: 'http://audit-target.test',
        thirdPartyPolicy: 'SAME_ORIGIN_ONLY',
      },
      testHooks: {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1', // Points pinned socket to local fixture server
      },
    });

    await proxy.start();
    const proxyPort = proxy.getPort();

    const response = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'GET',
          path: `http://audit-target.test:${fixturePort}/hello`,
          headers: { Host: `audit-target.test:${fixturePort}` },
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('Hello from Fixture Server');

    const stats = proxy.getStats();
    expect(stats.requestsTotal).toBe(1);
    expect(stats.requestsAllowed).toBe(1);
    expect(stats.requestsBlocked).toBe(0);

    await proxy.stop();
  });

  it('strictly blocks direct request to loopback address (127.0.0.1)', async () => {
    const proxy = new BrowserProxyServer({
      scopePolicy: {
        authorizedOrigin: 'http://audit-target.test',
      },
    });

    await proxy.start();
    const proxyPort = proxy.getPort();

    const response = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'GET',
          path: `http://127.0.0.1:${fixturePort}/hello`,
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Blocked by SSRF Scope Policy');

    const stats = proxy.getStats();
    expect(stats.requestsBlocked).toBe(1);

    await proxy.stop();
  });

  it('strictly blocks cloud metadata endpoint (169.254.169.254)', async () => {
    const proxy = new BrowserProxyServer();
    await proxy.start();
    const proxyPort = proxy.getPort();

    const response = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'GET',
          path: `http://169.254.169.254/latest/meta-data`,
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Blocked by SSRF Scope Policy');

    await proxy.stop();
  });

  it('resists DNS rebinding by failing closed when hostname resolves to mixed private IP', async () => {
    const proxy = new BrowserProxyServer({
      scopePolicy: {
        authorizedOrigin: 'http://rebinding-target.test',
      },
      testHooks: {
        lookupFn: mockMixedLookup, // Returns public IP + loopback IP
      },
    });

    await proxy.start();
    const proxyPort = proxy.getPort();

    const response = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: proxyPort,
          method: 'GET',
          path: `http://rebinding-target.test:${fixturePort}/hello`,
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Prohibited Destination Address');

    await proxy.stop();
  });

  it('blocks CONNECT tunnels targeting prohibited IP ranges', async () => {
    const proxy = new BrowserProxyServer();
    await proxy.start();
    const proxyPort = proxy.getPort();

    const result = await new Promise<string>((resolve, reject) => {
      const client = net.createConnection({ host: '127.0.0.1', port: proxyPort }, () => {
        client.write('CONNECT 169.254.169.254:443 HTTP/1.1\r\nHost: 169.254.169.254:443\r\n\r\n');
      });

      let response = '';
      client.on('data', chunk => {
        response += chunk.toString();
      });

      client.on('end', () => resolve(response));
      client.on('error', reject);
    });

    expect(result).toContain('HTTP/1.1 403 Forbidden');
    expect(result).toContain('Blocked by SSRF Scope Policy');

    const stats = proxy.getStats();
    expect(stats.connectTunnelsBlocked).toBe(1);

    await proxy.stop();
  });

  it('blocks WebSocket upgrade requests by default', async () => {
    const proxy = new BrowserProxyServer({
      scopePolicy: {
        authorizedOrigin: 'http://audit-target.test',
        allowWebSockets: false, // Default fail-closed
      },
    });

    await proxy.start();
    const proxyPort = proxy.getPort();

    const result = await new Promise<string>((resolve, reject) => {
      const client = net.createConnection({ host: '127.0.0.1', port: proxyPort }, () => {
        client.write(
          'GET /chat HTTP/1.1\r\n' +
            'Host: audit-target.test\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n\r\n',
        );
      });

      let response = '';
      client.on('data', chunk => {
        response += chunk.toString();
      });

      client.on('end', () => resolve(response));
      client.on('error', reject);
    });

    expect(result).toContain('HTTP/1.1 403 Forbidden');
    expect(result).toContain('WebSockets are blocked');

    await proxy.stop();
  });
});
