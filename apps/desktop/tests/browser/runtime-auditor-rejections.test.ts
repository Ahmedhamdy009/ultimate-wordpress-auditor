import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { RuntimeResourceAuditor } from '../../src/main/browser/runtime-auditor.js';

describe('Evidence-Based Audit: Promise Rejections & Synchronous Exceptions', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/sync-exception.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              throw new ReferenceError("SyncExecutionFailure");
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/unhandled-rejection.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              setTimeout(() => {
                Promise.reject(new Error("AsyncPromiseRejectionToken"));
              }, 10);
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/handled-catch.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              Promise.reject(new Error("HandledLocally")).catch((e) => {
                window.__handledLocally = true;
              });
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/handled-window-listener.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              window.addEventListener("unhandledrejection", (event) => {
                window.__preventedAtWindow = true;
                event.preventDefault(); // Cancels browser default error reporting
              });
              Promise.reject(new Error("PreventedGlobally"));
            </script>
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

  it('1. captures an uncaught synchronous JavaScript exception as JS_RUNTIME_ERROR', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/sync-exception.html`);
      await new Promise(r => setTimeout(r, 100));

      const report = auditor.audit();
      expect(report.errors.length).toBe(1);

      const err = report.errors[0];
      expect(err.name).toBe('ReferenceError');
      expect(err.message).toContain('SyncExecutionFailure');
      expect(err.type).toBe('runtime_error');

      const finding = report.findings.find(f => f.ruleId === 'JS_RUNTIME_ERROR');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('high');
      expect(finding?.confidence).toBe('confirmed');
      expect(finding?.title).toContain('ReferenceError');
    } finally {
      auditor.detach();
      await managed.release();
    }
  });

  it('2. captures an unhandled Promise rejection and records it as a runtime defect', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/unhandled-rejection.html`);
      await new Promise(r => setTimeout(r, 150));

      const report = auditor.audit();
      expect(report.errors.length).toBeGreaterThanOrEqual(1);

      const err = report.errors[0];
      expect(err.message).toContain('AsyncPromiseRejectionToken');

      // Verified finding produced
      const finding = report.findings.find(
        f =>
          f.ruleId === 'JS_UNHANDLED_PROMISE_REJECTION' ||
          f.ruleId === 'JS_RUNTIME_ERROR' ||
          f.description.includes('AsyncPromiseRejectionToken'),
      );
      expect(finding).toBeDefined();
      expect(finding?.status).toBe('confirmed');
    } finally {
      auditor.detach();
      await managed.release();
    }
  });

  it('3. does NOT produce an error or finding when a Promise rejection has a registered .catch() handler', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/handled-catch.html`);
      await new Promise(r => setTimeout(r, 100));

      const report = auditor.audit();
      // Handled rejection must not generate errors or defect findings
      expect(report.errors.length).toBe(0);
      expect(report.findings.filter(f => f.category === 'runtime-network').length).toBe(0);

      const locallyHandled = await managed.page.evaluate(
        () => (window as unknown as { __handledLocally: boolean }).__handledLocally,
      );
      expect(locallyHandled).toBe(true);
    } finally {
      auditor.detach();
      await managed.release();
    }
  });

  it('4. does NOT receive pageerror when unhandledrejection event default reporting is prevented via event.preventDefault()', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(
        `http://audit-target.test:${fixturePort}/handled-window-listener.html`,
      );
      await new Promise(r => setTimeout(r, 100));

      const report = auditor.audit();
      // Calling preventDefault() on unhandledrejection cancels browser default reporting (no pageerror)
      expect(report.errors.length).toBe(0);
      expect(report.findings.filter(f => f.category === 'runtime-network').length).toBe(0);

      const prevented = await managed.page.evaluate(
        () => (window as unknown as { __preventedAtWindow: boolean }).__preventedAtWindow,
      );
      expect(prevented).toBe(true);
    } finally {
      auditor.detach();
      await managed.release();
    }
  });
});
