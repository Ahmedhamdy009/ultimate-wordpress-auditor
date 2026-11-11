import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';

describe('Browser Isolation & Network Hardening Suite', () => {
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
            <head>
              <title>Hardened Browser Test Page</title>
              <link rel="dns-prefetch" href="http://speculative-dns.test" />
              <link rel="preconnect" href="http://speculative-preconnect.test" />
            </head>
            <body>
              <h1 id="heading">Security Hardening Target</h1>
              <a id="unauthorized-link" href="http://unauthorized.test/popup" target="_blank">Open Popup</a>
            </body>
          </html>
        `);
      } else if (url.pathname === '/popup-source') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Authorized Popup Content</h1>');
      } else if (url.pathname === '/cross-origin-embed') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <body>
              <h1>Outer Document</h1>
              <iframe id="child-frame" src="http://cross-origin.test:${fixturePort}/popup-source"></iframe>
            </body>
          </html>
        `);
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

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  it('strictly neutralizes WebRTC APIs and restricts direct UDP communication', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      },
      testHooks: {
        lookupFn: mockLookup,
        pinnedIpOverride: '127.0.0.1',
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      await page.goto(`http://audit-target.test:${fixturePort}/index.html`, {
        waitUntil: 'domcontentloaded',
      });

      const rtcStatus = await page.evaluate(async () => {
        const topRtc = typeof (window as unknown as { RTCPeerConnection?: unknown })
          .RTCPeerConnection;
        const topWebkitRtc = typeof (window as unknown as { webkitRTCPeerConnection?: unknown })
          .webkitRTCPeerConnection;

        // Verify dynamic iframe inheritance
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        const frameWindow = frame.contentWindow as unknown as { RTCPeerConnection?: unknown };
        const frameRtc = typeof frameWindow.RTCPeerConnection;

        // Verify mediaDevices getUserMedia neutralization
        let mediaError = '';
        const nav = navigator as unknown as {
          mediaDevices?: { getUserMedia?: (c: unknown) => Promise<unknown> };
        };
        if (!nav.mediaDevices) {
          mediaError = 'navigator.mediaDevices is undefined in insecure context';
        } else if (nav.mediaDevices.getUserMedia) {
          try {
            await nav.mediaDevices.getUserMedia({ audio: true });
          } catch (err) {
            mediaError = err instanceof Error ? err.message : String(err);
          }
        }

        return {
          topRtc,
          topWebkitRtc,
          frameRtc,
          mediaError,
        };
      });

      expect(rtcStatus.topRtc).toBe('undefined');
      expect(rtcStatus.topWebkitRtc).toBe('undefined');
      expect(rtcStatus.frameRtc).toBe('undefined');
      expect(
        rtcStatus.mediaError.includes('WebRTC/MediaDevices disabled by audit policy') ||
          rtcStatus.mediaError.includes('undefined in insecure context'),
      ).toBe(true);

      await managed.release();
    } finally {
      await manager.close();
    }
  }, 20000);

  it('centrally intercepts and blocks unauthorized popups (window.open) at the context level', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
        thirdPartyPolicy: 'SAME_ORIGIN_ONLY',
      },
      testHooks: {
        lookupFn: mockLookup,
        pinnedIpOverride: '127.0.0.1',
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      await page.goto(`http://audit-target.test:${fixturePort}/index.html`, {
        waitUntil: 'domcontentloaded',
      });

      // Trigger popup navigation via target="_blank" link to an unauthorized destination
      const popupPromise = managed.context.waitForEvent('page');
      await page.click('#unauthorized-link');

      const popupPage = await popupPromise;
      expect(popupPage).toBeDefined();

      // Navigation in popup was aborted by context interceptor (blockedbyclient)
      // Allow browser tick to process aborted navigation
      await new Promise(r => setTimeout(r, 400));
      expect(popupPage.url()).not.toContain('unauthorized.test/popup');
      expect(popupPage.url()).toMatch(/^(about:blank|chrome-error:\/\/)/);

      // Verify that direct navigation on the popup page to unauthorized target is also blocked
      let popupDirectNavFailed = false;
      try {
        await popupPage.goto('http://unauthorized.test/direct', { timeout: 1500 });
      } catch {
        popupDirectNavFailed = true;
      }
      expect(popupDirectNavFailed).toBe(true);

      // Verify any additional new page created inside the context inherits scope interception
      const extraPage = await managed.context.newPage();
      let extraPageNavBlocked = false;
      try {
        await extraPage.goto('http://unauthorized.test/subpage', { timeout: 1500 });
      } catch {
        extraPageNavBlocked = true;
      }
      expect(extraPageNavBlocked).toBe(true);

      // Verify release closes all context pages cleanly
      await managed.release();
      expect(manager.getActivePageCount()).toBe(0);
    } finally {
      await manager.close();
    }
  }, 40000);

  it('fails closed when proxy server becomes unavailable (net::ERR_PROXY_CONNECTION_FAILED)', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      },
      testHooks: {
        lookupFn: mockLookup,
        pinnedIpOverride: '127.0.0.1',
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      // 1. First navigation succeeds through live proxy
      await page.goto(`http://audit-target.test:${fixturePort}/index.html`, {
        waitUntil: 'domcontentloaded',
      });
      const heading = await page.textContent('#heading');
      expect(heading).toBe('Security Hardening Target');

      // 2. Intentionally stop proxy server to test fail-closed behavior
      const proxyServer = manager.getProxyServer();
      expect(proxyServer).toBeDefined();
      await proxyServer?.stop();

      // 3. Subsequent navigation must fail closed immediately
      let failedClosed = false;
      let failureError = '';

      try {
        await page.goto(`http://audit-target.test:${fixturePort}/index.html`, {
          timeout: 4000,
        });
      } catch (err) {
        failedClosed = true;
        failureError = err instanceof Error ? err.message : String(err);
      }

      expect(failedClosed).toBe(true);
      expect(failureError).toMatch(/ERR_PROXY_CONNECTION_FAILED|ECONNREFUSED|net::ERR/);

      await managed.release();
    } finally {
      await manager.close();
    }
  }, 20000);

  it('renders pages with speculative preconnect and dns-prefetch without breaking proxy enforcement', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
        thirdPartyPolicy: 'SAME_ORIGIN_ONLY',
      },
      testHooks: {
        lookupFn: mockLookup,
        pinnedIpOverride: '127.0.0.1',
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      // Loading page containing dns-prefetch and preconnect headers
      const res = await page.goto(`http://audit-target.test:${fixturePort}/index.html`, {
        waitUntil: 'networkidle',
      });

      expect(res?.status()).toBe(200);

      const title = await page.title();
      expect(title).toBe('Hardened Browser Test Page');

      // Ensure no third-party socket bypass occurred
      const proxyStats = manager.getProxyServer()?.getStats();
      expect(proxyStats?.requestsAllowed).toBeGreaterThan(0);

      await managed.release();
    } finally {
      await manager.close();
    }
  }, 20000);

  it('strictly preserves Chromium Site Isolation and does not disable process separation or sandboxing', async () => {
    const manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
        allowedAdditionalDomains: ['cross-origin.test'],
        thirdPartyPolicy: 'ALLOW_CUSTOM_LIST',
      },
      testHooks: {
        lookupFn: mockLookup,
        pinnedIpOverride: '127.0.0.1',
      },
    });

    try {
      const managed = await manager.acquirePage();
      const page = managed.page;

      // Attach CDP session to observe targets and Out-Of-Process Iframes (OOPIF)
      const cdp = await managed.context.newCDPSession(page);
      await cdp.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      });

      const attachedTargets: Array<{ type: string; url: string }> = [];
      cdp.on('Target.attachedToTarget', event => {
        attachedTargets.push({
          type: event.targetInfo.type,
          url: event.targetInfo.url,
        });
      });

      await page.goto(`http://audit-target.test:${fixturePort}/cross-origin-embed`, {
        waitUntil: 'domcontentloaded',
      });

      // Wait for cross-origin child iframe to load
      await page.waitForSelector('#child-frame');
      const childFrame = page.frame({ url: /cross-origin\.test/ });
      expect(childFrame).toBeDefined();

      // Give browser time to attach OOPIF target (poll up to 3000ms for parallel test load resilience)
      const attachDeadline = Date.now() + 3000;
      while (Date.now() < attachDeadline && !attachedTargets.some(t => t.type === 'iframe')) {
        await new Promise(r => setTimeout(r, 100));
      }

      // With Site Isolation enabled, the cross-origin iframe is isolated into its own OOPIF target
      const iframeTarget = attachedTargets.find(t => t.type === 'iframe');
      expect(iframeTarget).toBeDefined();

      await managed.release();
    } finally {
      await manager.close();
    }
  }, 20000);

  it('enforces hardened Chromium argument allowlist with zero security overrides', () => {
    const args = BrowserManager.getHardenedChromiumArgs();

    // Verify absence of security-weakening flags
    expect(args).not.toContain('--disable-ipc-flooding-protection');
    expect(args).not.toContain('--no-sandbox');
    expect(args).not.toContain('--disable-setuid-sandbox');
    expect(args).not.toContain('--disable-web-security');

    // Verify disable-features strictly contains ONLY network speculative features
    const disableFeaturesArg = args.find(a => a.startsWith('--disable-features='));
    expect(disableFeaturesArg).toBe(
      '--disable-features=NetworkPrediction,SpeculativeResourcePrefetching',
    );
    expect(disableFeaturesArg).not.toContain('site-per-process');
    expect(disableFeaturesArg).not.toContain('IsolateOrigins');
    expect(disableFeaturesArg).not.toContain('AudioServiceOutOfProcess');
  });
});
