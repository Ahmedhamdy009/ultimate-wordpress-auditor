import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { RuntimeResourceAuditor } from '../../src/main/browser/runtime-auditor.js';

describe('Runtime Resource Auditor — Main Frame vs. Iframe Classification Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/main-404.html') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><h1>Main Document Not Found</h1></body></html>');
      } else if (url.pathname === '/main-500.html') {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><h1>Main Document Server Error</h1></body></html>');
      } else if (url.pathname === '/iframe-404-container.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <h1>Main Frame Healthy Container</h1>
            <iframe id="test-iframe" src="http://external-cdn.test:${fixturePort}/missing-iframe.html"></iframe>
          </body></html>
        `);
      } else if (url.pathname === '/iframe-500-container.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <h1>Main Frame Healthy Container</h1>
            <iframe id="test-iframe" src="http://external-cdn.test:${fixturePort}/server-error-iframe.html"></iframe>
          </body></html>
        `);
      } else if (url.pathname === '/server-error-iframe.html') {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><h1>Subframe Server Error</h1></body></html>');
      } else if (url.pathname === '/iframe-mixed-container.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <h1>Main Site Succeeded</h1>
            <p>Main content is complete and functional.</p>
            <iframe id="ad-frame" src="http://external-cdn.test:${fixturePort}/failing-ad-widget.html"></iframe>
          </body></html>
        `);
      } else if (url.pathname === '/failing-ad-widget.html') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Widget Not Found');
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

  it('1. classifies main document HTTP 404 as HTTP_MAIN_DOCUMENT_404 with critical severity', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/main-404.html`);

      const report = auditor.audit(`http://audit-target.test:${fixturePort}/main-404.html`);
      const mainDocFinding = report.findings.find(f => f.ruleId === 'HTTP_MAIN_DOCUMENT_404');

      expect(mainDocFinding).toBeDefined();
      expect(mainDocFinding?.severity).toBe('critical');
      expect(mainDocFinding?.confidence).toBe('confirmed');
      expect(mainDocFinding?.title).toBe('Main Document Not Found (HTTP 404)');
      expect(mainDocFinding?.evidence?.isMainFrame).toBe(true);
    } finally {
      auditor.detach();
      await managed.release();
    }
  });

  it('2. classifies main document HTTP 500 as HTTP_MAIN_DOCUMENT_5XX with critical severity', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/main-500.html`);

      const report = auditor.audit(`http://audit-target.test:${fixturePort}/main-500.html`);
      const mainDocFinding = report.findings.find(f => f.ruleId === 'HTTP_MAIN_DOCUMENT_5XX');

      expect(mainDocFinding).toBeDefined();
      expect(mainDocFinding?.severity).toBe('critical');
      expect(mainDocFinding?.confidence).toBe('confirmed');
      expect(mainDocFinding?.title).toContain('Main Document HTTP 500');
      expect(mainDocFinding?.evidence?.isMainFrame).toBe(true);
    } finally {
      auditor.detach();
      await managed.release();
    }
  });

  it('3. classifies cross-origin iframe HTTP 404 as HTTP_IFRAME_DOCUMENT_404 without mislabeling as main document failure', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      additionalAllowedDomains: ['external-cdn.test'],
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/iframe-404-container.html`);
      await new Promise(r => setTimeout(r, 200));

      const report = auditor.audit();

      // Must NOT generate a main document failure
      const mainDocFailures = report.findings.filter(
        f => f.ruleId.startsWith('HTTP_MAIN_DOCUMENT') || f.ruleId.startsWith('NET_MAIN_DOCUMENT'),
      );
      expect(mainDocFailures).toHaveLength(0);

      // Must generate an iframe-specific document failure
      const iframeFinding = report.findings.find(f => f.ruleId === 'HTTP_IFRAME_DOCUMENT_404');
      expect(iframeFinding).toBeDefined();
      expect(iframeFinding?.severity).not.toBe('critical');
      expect(iframeFinding?.title).toContain('Iframe Document Not Found');
      expect(iframeFinding?.targetUrl).toContain('missing-iframe.html');
      expect(iframeFinding?.evidence?.isMainFrame).toBe(false);
    } finally {
      auditor.detach();
      await managed.release();
    }
  });

  it('4. classifies cross-origin iframe HTTP 500 as HTTP_IFRAME_DOCUMENT_5XX without mislabeling as main document failure', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      additionalAllowedDomains: ['external-cdn.test'],
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/iframe-500-container.html`);
      await new Promise(r => setTimeout(r, 200));

      const report = auditor.audit();

      // Must NOT generate a main document failure
      const mainDocFailures = report.findings.filter(
        f => f.ruleId.startsWith('HTTP_MAIN_DOCUMENT') || f.ruleId.startsWith('NET_MAIN_DOCUMENT'),
      );
      expect(mainDocFailures).toHaveLength(0);

      // Must generate an iframe-specific 5xx failure
      const iframeFinding = report.findings.find(f => f.ruleId === 'HTTP_IFRAME_DOCUMENT_5XX');
      expect(iframeFinding).toBeDefined();
      expect(iframeFinding?.severity).not.toBe('critical');
      expect(iframeFinding?.title).toContain('Iframe Document HTTP 500');
      expect(iframeFinding?.targetUrl).toContain('server-error-iframe.html');
      expect(iframeFinding?.evidence?.isMainFrame).toBe(false);
    } finally {
      auditor.detach();
      await managed.release();
    }
  });

  it('5. preserves main document success when an embedded iframe fails (mixed container)', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      additionalAllowedDomains: ['external-cdn.test'],
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(
        `http://audit-target.test:${fixturePort}/iframe-mixed-container.html`,
      );
      await new Promise(r => setTimeout(r, 200));

      const report = auditor.audit();

      // Main frame resource should be present and healthy (HTTP 200)
      const mainResource = report.networkResources.find(
        r => r.isMainFrame && r.isNavigationRequest,
      );
      expect(mainResource).toBeDefined();
      expect(mainResource?.status).toBe(200);

      // Main document must NOT be flagged as broken
      const mainDocDefect = report.findings.find(
        f => f.ruleId.startsWith('HTTP_MAIN_DOCUMENT') || f.ruleId.startsWith('NET_MAIN_DOCUMENT'),
      );
      expect(mainDocDefect).toBeUndefined();

      // Subframe failure is accurately captured under iframe rule
      const iframeFinding = report.findings.find(f => f.ruleId === 'HTTP_IFRAME_DOCUMENT_404');
      expect(iframeFinding).toBeDefined();
      expect(iframeFinding?.targetUrl).toContain('failing-ad-widget.html');
    } finally {
      auditor.detach();
      await managed.release();
    }
  });
});
