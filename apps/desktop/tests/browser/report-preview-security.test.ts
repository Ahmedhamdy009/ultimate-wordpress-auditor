import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { prepareSandboxedHtml } from '../../src/renderer/src/components/reports/SecureReportPreview.js';

describe('Live Browser Security & Report Preview Hardening Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  const leakCounters = {
    script: 0,
    image: 0,
    stylesheet: 0,
    font: 0,
    fetch: 0,
    xhr: 0,
    ws: 0,
    breakout: 0,
  };

  // Base64 transparent 1x1 PNG for legitimate visual evidence test
  const VALID_DATA_IMAGE =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  function escapeHtmlAttr(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/preview-host.html') {
        // Construct hostile adversarial report content
        const hostileReportHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Untrusted Hostile Report</title>
              <!-- Adversary attempts to override CSP -->
              <meta http-equiv="Content-Security-Policy" content="default-src *; script-src * 'unsafe-inline';">
              <!-- Adversary attempts base-uri hijacking -->
              <base href="http://audit-target.test:${fixturePort}/">
              <!-- Adversary attempts external stylesheet leak -->
              <link rel="stylesheet" href="http://audit-target.test:${fixturePort}/leak.css" />
              <!-- Adversary attempts external font leak via inline style -->
              <style>
                @font-face {
                  font-family: 'HostileFont';
                  src: url('http://audit-target.test:${fixturePort}/evil.woff2');
                }
                body { font-family: 'HostileFont', sans-serif; }
              </style>
            </head>
            <body>
              <h1 id="report-title">Audited Findings</h1>
              
              <!-- Adversary attempts inline script execution and parent pollution -->
              <script>
                window.adversaryScriptExecuted = true;
                try {
                  if (parent && parent.electronAPI) {
                    parent.leakedToken = parent.electronAPI.token;
                  }
                } catch (e) {
                  window.parentAccessError = e.message;
                }
              </script>

              <!-- Adversary attempts external script load -->
              <script src="http://audit-target.test:${fixturePort}/leak.js"></script>

              <!-- Adversary attempts programmatic network egress (fetch, XHR, WebSocket) -->
              <script>
                try { fetch('http://audit-target.test:${fixturePort}/leak-fetch'); } catch(e) {}
                try {
                  var x = new XMLHttpRequest();
                  x.open('GET', 'http://audit-target.test:${fixturePort}/leak-xhr');
                  x.send();
                } catch(e) {}
                try { new WebSocket('ws://audit-target.test:${fixturePort}/leak-ws'); } catch(e) {}
              </script>

              <!-- Adversary attempts image onerror handler -->
              <img src="invalid-src-trigger" onerror="window.imgErrorExecuted = true;" />

              <!-- Adversary attempts external image request -->
              <img id="hostile-img" src="http://audit-target.test:${fixturePort}/leak.png" alt="Hostile Tracker" />

              <!-- Adversary attempts local file URL access -->
              <img id="file-img" src="file:///C:/Windows/win.ini" alt="Local File Access" />

              <!-- Legitimate base64 screenshot evidence: must be allowed by img-src data: -->
              <img id="valid-evidence-img" src="${VALID_DATA_IMAGE}" alt="Legitimate Screenshot" />

              <!-- Adversary attempts top-level breakout navigation -->
              <a id="breakout-anchor" href="http://audit-target.test:${fixturePort}/breakout.html" target="_top">Breakout Link</a>
            </body>
          </html>
        `;

        // Apply our hardened transformation: strips attacker CSP, strips base tag, injects REPORT_PREVIEW_CSP
        const preparedReport = prepareSandboxedHtml(hostileReportHtml);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Desktop Host Window</title></head>
            <body>
              <h1>Desktop Host Application Shell</h1>
              <div id="host-status">Running</div>
              <script>
                // Simulate privileged Electron desktop renderer context
                window.electronAPI = {
                  isPrivileged: true,
                  token: 'CRITICAL_SECRET_USER_TOKEN_12345',
                  ping: () => 'pong',
                };
                window.parentState = 'CLEAN_UNTOUCHED';
              </script>
              <iframe
                id="secure-preview-iframe"
                sandbox=""
                srcdoc="${escapeHtmlAttr(preparedReport)}"
                style="width: 800px; height: 600px; border: 1px solid #ccc;"
              ></iframe>
            </body>
          </html>
        `);
      } else if (url.pathname === '/leak.js') {
        leakCounters.script++;
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('window.externalScriptLoaded = true;');
      } else if (url.pathname === '/leak.png') {
        leakCounters.image++;
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      } else if (url.pathname === '/leak.css') {
        leakCounters.stylesheet++;
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end('body { background: red !important; }');
      } else if (url.pathname === '/evil.woff2') {
        leakCounters.font++;
        res.writeHead(200, { 'Content-Type': 'font/woff2' });
        res.end(Buffer.from('FONT'));
      } else if (url.pathname === '/leak-fetch') {
        leakCounters.fetch++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"leaked":true}');
      } else if (url.pathname === '/leak-xhr') {
        leakCounters.xhr++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"leaked":true}');
      } else if (url.pathname === '/leak-ws') {
        leakCounters.ws++;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('WS');
      } else if (url.pathname === '/breakout.html') {
        leakCounters.breakout++;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Breakout Succeeded</h1>');
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

    manager = new BrowserManager({
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

    await manager.launch();
  });

  afterAll(async () => {
    if (manager) {
      await manager.close();
    }
    if (fixtureServer) {
      await new Promise<void>(resolve => fixtureServer.close(() => resolve()));
    }
  });

  it('1. guarantees zero external network requests for scripts, images, stylesheets, and fonts', async () => {
    const managed = await manager.acquirePage();
    const page = managed.page;

    const recordedRequests: string[] = [];
    page.on('request', req => {
      recordedRequests.push(req.url());
    });

    try {
      await page.goto(`http://audit-target.test:${fixturePort}/preview-host.html`, {
        waitUntil: 'networkidle',
      });

      // Verify that NO leak requests reached the HTTP server
      expect(leakCounters.script).toBe(0);
      expect(leakCounters.image).toBe(0);
      expect(leakCounters.stylesheet).toBe(0);
      expect(leakCounters.font).toBe(0);

      // Verify that Playwright network observer never saw hostile subresource requests
      expect(recordedRequests.some(url => url.includes('/leak.js'))).toBe(false);
      expect(recordedRequests.some(url => url.includes('/leak.png'))).toBe(false);
      expect(recordedRequests.some(url => url.includes('/leak.css'))).toBe(false);
      expect(recordedRequests.some(url => url.includes('/evil.woff2'))).toBe(false);
    } finally {
      await managed.release();
    }
  }, 20000);

  it('2. strictly neutralizes inline script execution and onerror event handlers', async () => {
    const managed = await manager.acquirePage();
    const page = managed.page;

    try {
      await page.goto(`http://audit-target.test:${fixturePort}/preview-host.html`, {
        waitUntil: 'networkidle',
      });

      const iframeElement = await page.$('#secure-preview-iframe');
      expect(iframeElement).not.toBeNull();

      const frame = await iframeElement!.contentFrame();
      expect(frame).not.toBeNull();

      // Ensure inline script did not set variables inside frame
      const scriptRan = await frame?.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).adversaryScriptExecuted;
      });
      expect(scriptRan).toBeUndefined();

      // Ensure onerror handler did not execute
      const imgErrorRan = await frame?.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).imgErrorExecuted;
      });
      expect(imgErrorRan).toBeUndefined();

      // Ensure parent window state was untouched
      const parentState = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).parentState;
      });
      expect(parentState).toBe('CLEAN_UNTOUCHED');
    } finally {
      await managed.release();
    }
  }, 20000);

  it('3. isolates parent frame, Electron API, and Node.js globals from sandboxed frame', async () => {
    const managed = await manager.acquirePage();
    const page = managed.page;

    try {
      await page.goto(`http://audit-target.test:${fixturePort}/preview-host.html`, {
        waitUntil: 'networkidle',
      });

      const iframeElement = await page.$('#secure-preview-iframe');
      expect(iframeElement).not.toBeNull();
      const frame = await iframeElement!.contentFrame();
      expect(frame).not.toBeNull();

      // Frame has opaque unique origin ('null')
      const frameOrigin = await frame?.evaluate(() => window.location.origin);
      expect(frameOrigin).toBe('null');

      // Attempting to access parent document throws cross-origin SecurityError
      const accessAttempt = await frame?.evaluate(() => {
        try {
          const doc = window.parent.document;
          return { allowed: true, title: doc.title };
        } catch (err) {
          return {
            allowed: false,
            errorName: (err as Error).name,
            errorMessage: (err as Error).message,
          };
        }
      });

      expect(accessAttempt?.allowed).toBe(false);
      expect(accessAttempt?.errorName).toBe('SecurityError');

      // Verify no privileged Electron or Node globals leaked into iframe
      const privilegedGlobals = await frame?.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        return {
          hasElectronAPI: Boolean(w.electronAPI),
          hasProcess: typeof process !== 'undefined',
          hasRequire: typeof w.require !== 'undefined',
          parentLeakedToken: Boolean(w.leakedToken),
        };
      });

      expect(privilegedGlobals?.hasElectronAPI).toBe(false);
      expect(privilegedGlobals?.hasProcess).toBe(false);
      expect(privilegedGlobals?.hasRequire).toBe(false);
      expect(privilegedGlobals?.parentLeakedToken).toBe(false);
    } finally {
      await managed.release();
    }
  }, 20000);

  it('4. blocks top-level breakout navigation from sandboxed report links', async () => {
    const managed = await manager.acquirePage();
    const page = managed.page;

    try {
      await page.goto(`http://audit-target.test:${fixturePort}/preview-host.html`, {
        waitUntil: 'networkidle',
      });

      const iframeElement = await page.$('#secure-preview-iframe');
      expect(iframeElement).not.toBeNull();
      const frame = await iframeElement!.contentFrame();
      expect(frame).not.toBeNull();

      // Click anchor with target="_top" inside the sandboxed iframe
      const anchor = await frame?.$('#breakout-anchor');
      expect(anchor).not.toBeNull();

      // Clicking must NOT navigate the top page
      await anchor?.click({ timeout: 3000 }).catch(() => {});

      // Small delay to allow any navigation attempt to process
      await page.waitForTimeout(500);

      // Verify top-level URL is still preview-host.html, NOT breakout.html
      expect(page.url()).toContain('/preview-host.html');
      expect(page.url()).not.toContain('/breakout.html');
      expect(leakCounters.breakout).toBe(0);
    } finally {
      await managed.release();
    }
  }, 20000);

  it('5. allows legitimate visual evidence screenshots embedded as base64 data URIs', async () => {
    const managed = await manager.acquirePage();
    const page = managed.page;

    try {
      await page.goto(`http://audit-target.test:${fixturePort}/preview-host.html`, {
        waitUntil: 'networkidle',
      });

      const iframeElement = await page.$('#secure-preview-iframe');
      expect(iframeElement).not.toBeNull();
      const frame = await iframeElement!.contentFrame();
      expect(frame).not.toBeNull();

      // Verify legitimate base64 screenshot rendered successfully
      const imgDimensions = await frame?.evaluate(() => {
        const img = document.getElementById('valid-evidence-img') as HTMLImageElement | null;
        if (!img) return null;
        return {
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        };
      });

      expect(imgDimensions).not.toBeNull();
      expect(imgDimensions?.complete).toBe(true);
      expect(imgDimensions?.naturalWidth).toBe(1);
      expect(imgDimensions?.naturalHeight).toBe(1);
    } finally {
      await managed.release();
    }
  }, 20000);

  it('6. blocks programmatic network egress (fetch, XHR, WebSocket) via script-src "none" and connect-src "none"', async () => {
    const managed = await manager.acquirePage();
    const page = managed.page;

    const recordedRequests: string[] = [];
    page.on('request', req => {
      recordedRequests.push(req.url());
    });

    try {
      await page.goto(`http://audit-target.test:${fixturePort}/preview-host.html`, {
        waitUntil: 'networkidle',
      });

      // Verify zero programmatic network egress reached the server
      expect(leakCounters.fetch).toBe(0);
      expect(leakCounters.xhr).toBe(0);
      expect(leakCounters.ws).toBe(0);

      // Verify network requests list never saw fetch, xhr, or ws endpoints
      expect(recordedRequests.some(url => url.includes('/leak-fetch'))).toBe(false);
      expect(recordedRequests.some(url => url.includes('/leak-xhr'))).toBe(false);
      expect(recordedRequests.some(url => url.includes('/leak-ws'))).toBe(false);
    } finally {
      await managed.release();
    }
  }, 20000);

  it('7. strictly blocks local file URL access (file:///) via sandbox origin and CSP', async () => {
    const managed = await manager.acquirePage();
    const page = managed.page;

    try {
      await page.goto(`http://audit-target.test:${fixturePort}/preview-host.html`, {
        waitUntil: 'networkidle',
      });

      const iframeElement = await page.$('#secure-preview-iframe');
      expect(iframeElement).not.toBeNull();
      const frame = await iframeElement!.contentFrame();
      expect(frame).not.toBeNull();

      // Verify file image failed to load
      const fileImgLoaded = await frame?.evaluate(() => {
        const img = document.getElementById('file-img') as HTMLImageElement | null;
        if (!img) return false;
        return img.complete && img.naturalWidth > 0;
      });

      expect(fileImgLoaded).toBe(false);
    } finally {
      await managed.release();
    }
  }, 20000);
});
