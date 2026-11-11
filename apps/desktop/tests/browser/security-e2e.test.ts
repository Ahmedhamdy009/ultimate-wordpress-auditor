import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';

describe('Live Browser Security & SSRF End-to-End Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Secure Target Site</title></head>
            <body>
              <h1 id="title">Authorized WordPress Site</h1>
              <div id="dynamic-content">Initial</div>
              <script>
                document.getElementById('dynamic-content').textContent = 'Rendered by JS';
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/redirect-to-ssrf') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
        res.end();
      } else if (url.pathname === '/redirect-to-loopback') {
        res.writeHead(302, { Location: 'http://127.0.0.1:9999/admin' });
        res.end();
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
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

  it('renders authorized page dynamically through controlled proxy with socket pinning', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
        thirdPartyPolicy: 'SAME_ORIGIN_ONLY',
      },
      testHooks: {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1', // Connects socket to local fixture server
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      await page.goto(`http://audit-target.test:${fixturePort}/index.html`, {
        waitUntil: 'domcontentloaded',
      });

      const titleText = await page.textContent('#title');
      expect(titleText).toBe('Authorized WordPress Site');

      // Verify JavaScript executed dynamically
      const dynamicText = await page.textContent('#dynamic-content');
      expect(dynamicText).toBe('Rendered by JS');

      // Verify traffic flowed through controlled proxy
      const proxy = manager.getProxyServer();
      expect(proxy).toBeDefined();
      expect(proxy?.getStats().requestsAllowed).toBeGreaterThan(0);

      await managed.release();
    } finally {
      await manager.close();
    }
  }, 20000);

  it('strictly blocks direct browser navigation to loopback destination (127.0.0.1)', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: 'http://audit-target.test',
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      let failed = false;
      try {
        await page.goto(`http://127.0.0.1:${fixturePort}/index.html`, {
          timeout: 4000,
        });
      } catch {
        failed = true;
      }

      expect(failed).toBe(true);

      await managed.release();
    } finally {
      await manager.close();
    }
  }, 15000);

  it('strictly blocks browser navigation to cloud metadata IP (169.254.169.254)', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: 'http://audit-target.test',
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      let failed = false;
      try {
        await page.goto('http://169.254.169.254/latest/meta-data', {
          timeout: 4000,
        });
      } catch {
        failed = true;
      }

      expect(failed).toBe(true);

      await managed.release();
    } finally {
      await manager.close();
    }
  }, 15000);

  it('blocks redirects to cloud metadata endpoints (SSRF Redirect Defense)', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
        thirdPartyPolicy: 'SAME_ORIGIN_ONLY',
      },
      testHooks: {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      let navigationBlocked = false;
      try {
        const res = await page.goto(`http://audit-target.test:${fixturePort}/redirect-to-ssrf`, {
          timeout: 4000,
        });
        if (res && res.status() >= 400) {
          navigationBlocked = true;
        }
      } catch {
        navigationBlocked = true;
      }

      expect(navigationBlocked).toBe(true);

      await managed.release();
    } finally {
      await manager.close();
    }
  }, 15000);

  it('blocks redirects to internal loopback destinations', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
        thirdPartyPolicy: 'SAME_ORIGIN_ONLY',
      },
      testHooks: {
        lookupFn: mockPublicLookup,
        pinnedIpOverride: '127.0.0.1',
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      let navigationBlocked = false;
      try {
        const res = await page.goto(
          `http://audit-target.test:${fixturePort}/redirect-to-loopback`,
          {
            timeout: 4000,
          },
        );
        if (res && res.status() >= 400) {
          navigationBlocked = true;
        }
      } catch {
        navigationBlocked = true;
      }

      expect(navigationBlocked).toBe(true);

      await managed.release();
    } finally {
      await manager.close();
    }
  }, 15000);
});
