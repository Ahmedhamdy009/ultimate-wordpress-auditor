import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { RuntimeResourceAuditor } from '../../src/main/browser/runtime-auditor.js';

describe('Runtime Resource Auditor — Network Resources & HTTP Status Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/success.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><head>
            <link rel="stylesheet" href="/valid.css" />
            <script src="/valid.js"></script>
          </head><body>
            <img src="/valid.png" alt="Valid Image" />
            <script>fetch('/api/valid-data');</script>
          </body></html>
        `);
      } else if (url.pathname === '/valid.css') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end('body { margin: 0; }');
      } else if (url.pathname === '/valid.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end('window.__validScriptLoaded = true;');
      } else if (url.pathname === '/valid.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      } else if (url.pathname === '/api/valid-data') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (url.pathname === '/broken-resources.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><head>
            <link rel="stylesheet" href="/missing-styles.css" />
            <script src="/missing-script.js"></script>
          </head><body>
            <img src="/missing-hero.jpg" alt="Missing Hero" />
            <script>
              // Load custom web font that fails
              const font = new FontFace('CustomBrokenFont', 'url(/missing-font.woff2)');
              font.load().catch(() => {});
              // Fetch missing API endpoint
              fetch('/api/missing-endpoint').catch(() => {});
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/server-error.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              fetch('/api/failing-backend').catch(() => {});
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/api/failing-backend') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database connection failed' }));
      } else if (url.pathname === '/access-restricted.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              fetch('/admin/secure-settings').catch(() => {});
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/admin/secure-settings') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
      } else if (url.pathname === '/redirect-source.html') {
        res.writeHead(302, { Location: '/redirect-target.html' });
        res.end();
      } else if (url.pathname === '/redirect-target.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Redirect Target Page</h1>');
      } else if (url.pathname === '/unauthorized.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              fetch('/api/need-auth').catch(() => {});
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/api/need-auth') {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
      } else if (url.pathname === '/gateway-error.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              fetch('/api/gateway-down').catch(() => {});
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/api/gateway-down') {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
      } else if (url.pathname === '/xhr-broken.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              const xhr = new XMLHttpRequest();
              xhr.open('GET', '/api/xhr-missing');
              xhr.send();
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/api/xhr-missing') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else if (url.pathname === '/third-party-broken.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <img src="http://external-cdn.test:${fixturePort}/unreachable-ad.jpg" alt="Ad" />
          </body></html>
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

    manager = new BrowserManager({
      headless: true,
      maxConcurrentPages: 1,
      scopePolicy: {
        authorizedOrigin: `http://audit-target.test:${fixturePort}`,
        allowedAdditionalDomains: ['external-cdn.test'],
        thirdPartyPolicy: 'ALLOW_PUBLIC_SUBRESOURCES',
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

  it('tracks successful network resources without generating false-positive findings', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/success.html`);
      await new Promise(r => setTimeout(r, 200));

      const report = auditor.audit();
      expect(report.networkResources.length).toBeGreaterThanOrEqual(4);

      // Verify statuses
      const cssRes = report.networkResources.find(r => r.url.endsWith('valid.css'));
      const jsRes = report.networkResources.find(r => r.url.endsWith('valid.js'));
      const imgRes = report.networkResources.find(r => r.url.endsWith('valid.png'));

      expect(cssRes?.status).toBe(200);
      expect(jsRes?.status).toBe(200);
      expect(imgRes?.status).toBe(200);

      // No defect findings for 200 OK resources
      expect(report.findings.filter(f => f.category === 'runtime-network')).toHaveLength(0);
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('detects broken JavaScript, CSS, image, and font resources (HTTP 404) with proper criticality', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/broken-resources.html`);
      await new Promise(r => setTimeout(r, 300));

      const report = auditor.audit();
      const brokenFindings = report.findings.filter(f => f.ruleId === 'HTTP_BROKEN_RESOURCE_404');
      expect(brokenFindings.length).toBeGreaterThanOrEqual(3);

      const brokenScript = brokenFindings.find(f => f.targetUrl.includes('missing-script.js'));
      const brokenCss = brokenFindings.find(f => f.targetUrl.includes('missing-styles.css'));
      const brokenImg = brokenFindings.find(f => f.targetUrl.includes('missing-hero.jpg'));

      expect(brokenScript).toBeDefined();
      expect(brokenCss).toBeDefined();
      expect(brokenImg).toBeDefined();

      // Broken scripts and stylesheets must have higher severity than broken images
      expect(brokenScript?.severity).toBe('high');
      expect(brokenCss?.severity).toBe('high');
      expect(brokenImg?.severity).toBe('medium');

      expect(brokenScript?.confidence).toBe('confirmed');
      expect(brokenCss?.confidence).toBe('confirmed');
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('detects HTTP 5xx server errors on API endpoints and marks as high severity', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      const [response] = await Promise.all([
        managed.page.waitForResponse(res => res.url().includes('/api/failing-backend')),
        managed.page.goto(`http://audit-target.test:${fixturePort}/server-error.html`),
      ]);
      await response.finished();
      await new Promise(r => setTimeout(r, 50));

      const report = auditor.audit();
      const serverError = report.findings.find(
        f => f.ruleId === 'HTTP_INTERNAL_SERVER_ERROR_500' || f.ruleId === 'HTTP_5XX_SERVER_ERROR',
      );

      expect(serverError).toBeDefined();
      expect(serverError?.severity).toBe('high');
      expect(serverError?.confidence).toBe('confirmed');
      expect(serverError?.title).toContain('HTTP 500');
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('classifies HTTP 403 Forbidden on protected paths as informational / potential finding', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      const [response] = await Promise.all([
        managed.page.waitForResponse(res => res.url().includes('/admin/secure-settings')),
        managed.page.goto(`http://audit-target.test:${fixturePort}/access-restricted.html`),
      ]);
      await response.finished();
      await new Promise(r => setTimeout(r, 50));

      const report = auditor.audit();
      const restricted = report.findings.find(f => f.ruleId === 'HTTP_FORBIDDEN_403');

      expect(restricted).toBeDefined();
      expect(restricted?.severity).toBe('info');
      expect(restricted?.confidence).toBe('potential');
      expect(restricted?.title).toContain('HTTP 403');
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('handles HTTP redirects seamlessly while maintaining network timing context', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/redirect-source.html`);

      const report = auditor.audit();
      expect(report.pageUrl).toContain('redirect-target.html');
      expect(report.networkResources.length).toBeGreaterThanOrEqual(1);

      const targetResource = report.networkResources.find(r =>
        r.url.includes('redirect-target.html'),
      );
      expect(targetResource?.status).toBe(200);
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('differentiates third-party resource failures from first-party assets', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      additionalAllowedDomains: ['external-cdn.test'],
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/third-party-broken.html`);
      await new Promise(r => setTimeout(r, 200));

      const report = auditor.audit();
      const thirdPartyResource = report.networkResources.find(r =>
        r.url.includes('unreachable-ad.jpg'),
      );
      expect(thirdPartyResource).toBeDefined();
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('does NOT report client-side aborted or policy-blocked requests as website defects', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/success.html`);

      // Trigger an aborted fetch request via AbortController
      await managed.page.evaluate(() => {
        const controller = new AbortController();
        fetch('/api/slow-call', { signal: controller.signal }).catch(() => {});
        controller.abort();
      });

      await new Promise(r => setTimeout(r, 200));

      const report = auditor.audit();
      // Aborted requests should never produce high/medium severity findings
      const abortedDefects = report.findings.filter(f => f.targetUrl.includes('slow-call'));
      expect(abortedDefects).toHaveLength(0);
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('classifies HTTP 401 Unauthorized distinctly with HTTP_UNAUTHORIZED_401', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      const [response] = await Promise.all([
        managed.page.waitForResponse(res => res.url().includes('/api/need-auth')),
        managed.page.goto(`http://audit-target.test:${fixturePort}/unauthorized.html`),
      ]);
      await response.finished();
      await new Promise(r => setTimeout(r, 50));

      const report = auditor.audit();
      const unauthorized = report.findings.find(f => f.ruleId === 'HTTP_UNAUTHORIZED_401');

      expect(unauthorized).toBeDefined();
      expect(unauthorized?.severity).toBe('info');
      expect(unauthorized?.confidence).toBe('potential');
      expect(unauthorized?.title).toContain('HTTP 401');
      expect(unauthorized?.evidence?.status).toBe(401);
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('detects HTTP 502 Bad Gateway as gateway/service unavailable finding', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      const [response] = await Promise.all([
        managed.page.waitForResponse(res => res.url().includes('/api/gateway-down')),
        managed.page.goto(`http://audit-target.test:${fixturePort}/gateway-error.html`),
      ]);
      await response.finished();
      await new Promise(r => setTimeout(r, 50));

      const report = auditor.audit();
      const gatewayErr = report.findings.find(f => f.ruleId === 'HTTP_GATEWAY_UNAVAILABLE_5XX');

      expect(gatewayErr).toBeDefined();
      expect(gatewayErr?.severity).toBe('high');
      expect(gatewayErr?.confidence).toBe('confirmed');
      expect(gatewayErr?.title).toContain('502');
      expect(gatewayErr?.evidence?.status).toBe(502);
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('captures XMLHttpRequest (XHR) failures accurately', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      const [response] = await Promise.all([
        managed.page.waitForResponse(res => res.url().includes('/api/xhr-missing')),
        managed.page.goto(`http://audit-target.test:${fixturePort}/xhr-broken.html`),
      ]);
      await response.finished();
      await new Promise(r => setTimeout(r, 50));

      const report = auditor.audit();
      const xhrResource = report.networkResources.find(r => r.url.includes('/api/xhr-missing'));
      expect(xhrResource).toBeDefined();
      expect(xhrResource?.status).toBe(404);

      const xhrFinding = report.findings.find(f => f.targetUrl.includes('/api/xhr-missing'));
      expect(xhrFinding).toBeDefined();
      expect(xhrFinding?.status).toBe('confirmed');
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('detects main document HTTP 404 failure with critical severity', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/non-existent-top-doc.html`);

      const report = auditor.audit(
        `http://audit-target.test:${fixturePort}/non-existent-top-doc.html`,
      );
      const mainDoc404 = report.findings.find(f => f.ruleId === 'HTTP_MAIN_DOCUMENT_404');

      expect(mainDoc404).toBeDefined();
      expect(mainDoc404?.severity).toBe('critical');
      expect(mainDoc404?.confidence).toBe('confirmed');
      expect(mainDoc404?.title).toContain('Main Document Not Found');
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);
});
