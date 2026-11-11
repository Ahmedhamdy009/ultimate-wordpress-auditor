import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { RuntimeResourceAuditor } from '../../src/main/browser/runtime-auditor.js';

describe('Runtime Errors Auditor — JavaScript & Console Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  async function waitForErrors(
    auditor: RuntimeResourceAuditor,
    minCount: number,
    timeoutMs = 5000,
  ): Promise<void> {
    const start = Date.now();
    while (auditor.getMetrics().totalErrors < minCount) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timed out waiting for ${minCount} errors (current: ${auditor.getMetrics().totalErrors})`,
        );
      }
      await new Promise(r => setTimeout(r, 20));
    }
  }

  async function waitForConsoleMessages(
    auditor: RuntimeResourceAuditor,
    minCount: number,
    timeoutMs = 5000,
  ): Promise<void> {
    const start = Date.now();
    while (
      auditor.getMetrics().totalConsoleErrors + auditor.getMetrics().totalConsoleWarnings <
      minCount
    ) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timed out waiting for ${minCount} console messages (current: ${
            auditor.getMetrics().totalConsoleErrors + auditor.getMetrics().totalConsoleWarnings
          })`,
        );
      }
      await new Promise(r => setTimeout(r, 20));
    }
  }

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/uncaught-exception.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <h1>Uncaught Exception Test</h1>
            <script>
              throw new ReferenceError("ApplicationConfig is not defined");
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/multiple-errors.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              setTimeout(() => { throw new TypeError("Cannot read properties of null"); }, 0);
              setTimeout(() => { throw new RangeError("Invalid array length"); }, 10);
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/unhandled-rejection.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              Promise.reject(new Error("Async data fetch failed without catch"));
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/console-events.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              console.error("Critical component render failed");
              console.warn("Deprecated API used: window.webkitStorageInfo");
              console.assert(false, "User state synchronization assert failed");
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/duplicate-errors.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              // Simulate repetitive error in an animation or interval loop
              for (let i = 0; i < 15; i++) {
                try {
                  throw new EvalError("Loop evaluation failure");
                } catch (e) {
                  setTimeout(() => { throw e; }, i * 5);
                }
              }
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/long-message.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              const hugeString = "VERY_LONG_ERROR_PAYLOAD_".repeat(200);
              throw new Error(hugeString);
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/excessive-console.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              // Flood console with 80 errors
              for (let i = 0; i < 80; i++) {
                console.error("Flood error message " + i);
              }
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/iframe-errors.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <h1>Main Page</h1>
            <iframe id="child-frame" src="/iframe-content.html"></iframe>
          </body></html>
        `);
      } else if (url.pathname === '/iframe-content.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <h2>Subframe Document</h2>
            <script>
              throw new URIError("Malformed URI in iframe");
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

  it('captures uncaught JavaScript exceptions with error name, message, and source location', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/uncaught-exception.html`);
      await waitForErrors(auditor, 1);

      const report = auditor.audit();
      expect(report.errors.length).toBeGreaterThanOrEqual(1);

      const err = report.errors[0];
      expect(err.name).toBe('ReferenceError');
      expect(err.message).toContain('ApplicationConfig is not defined');
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
  }, 20000);

  it('captures multiple distinct runtime errors independently', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/multiple-errors.html`);
      await waitForErrors(auditor, 2);

      const report = auditor.audit();
      expect(report.errors.length).toBeGreaterThanOrEqual(2);

      const typeErr = report.errors.find(e => e.name === 'TypeError');
      const rangeErr = report.errors.find(e => e.name === 'RangeError');

      expect(typeErr).toBeDefined();
      expect(rangeErr).toBeDefined();
      expect(typeErr?.message).toContain('Cannot read properties of null');
      expect(rangeErr?.message).toContain('Invalid array length');
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('captures unhandled promise rejections as distinct runtime findings', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/unhandled-rejection.html`);
      await waitForErrors(auditor, 1);

      const report = auditor.audit();
      expect(report.errors.length).toBeGreaterThanOrEqual(1);

      const rejection = report.errors.find(e => e.message.includes('Async data fetch failed'));
      expect(rejection).toBeDefined();

      const finding = report.findings.find(
        f =>
          f.ruleId === 'JS_UNHANDLED_PROMISE_REJECTION' ||
          f.description.includes('Async data fetch failed'),
      );
      expect(finding).toBeDefined();
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('captures browser console errors, warnings, and assert failures', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/console-events.html`);
      await waitForConsoleMessages(auditor, 3);

      const report = auditor.audit();
      expect(report.consoleMessages.length).toBe(3);

      const errMessage = report.consoleMessages.find(m => m.type === 'error');
      const warnMessage = report.consoleMessages.find(m => m.type === 'warning');
      const assertMessage = report.consoleMessages.find(m => m.type === 'assert');

      expect(errMessage).toBeDefined();
      expect(errMessage?.text).toContain('Critical component render failed');

      expect(warnMessage).toBeDefined();
      expect(warnMessage?.text).toContain('Deprecated API used');

      expect(assertMessage).toBeDefined();
      expect(assertMessage?.text).toContain('User state synchronization assert failed');

      const consoleFinding = report.findings.find(f => f.ruleId === 'BROWSER_CONSOLE_ERROR');
      expect(consoleFinding).toBeDefined();
      expect(consoleFinding?.severity).toBe('medium');
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('deduplicates repetitive errors into consolidated findings with occurrence counts', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/duplicate-errors.html`);
      await waitForErrors(auditor, 15);

      const report = auditor.audit();
      expect(report.errors.length).toBe(15);

      // Verify findings are deduplicated
      const evalFindings = report.findings.filter(f => f.title.includes('EvalError'));
      expect(evalFindings.length).toBe(1);

      const consolidated = evalFindings[0];
      expect(consolidated.title).toBe('JavaScript Runtime Error: EvalError (15 occurrences)');
      expect(consolidated.evidence?.occurrences).toBe(15);
      expect(report.metrics.duplicatesConsolidated).toBe(14);
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('bounds long error messages without crashing or overflowing memory', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      maxMessageLength: 200,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/long-message.html`);
      await waitForErrors(auditor, 1);

      const report = auditor.audit();
      expect(report.errors.length).toBe(1);

      const err = report.errors[0];
      expect(err.message.length).toBeLessThan(300);
      expect(err.message).toContain('[truncated');
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('enforces maximum console message bounds during excessive log flooding', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      maxConsoleMessages: 15,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/excessive-console.html`);
      await waitForConsoleMessages(auditor, 15);

      const report = auditor.audit();
      // Bounded by maxConsoleMessages
      expect(report.consoleMessages.length).toBe(15);
      expect(report.limitsReached).toBe(true);
      expect(report.metrics.totalConsoleErrors).toBe(80);
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);

  it('captures runtime exceptions originating inside dynamically created iframes', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/iframe-errors.html`);
      await waitForErrors(auditor, 1);

      const report = auditor.audit();
      expect(report.errors.length).toBeGreaterThanOrEqual(1);

      const uriErr = report.errors.find(e => e.name === 'URIError');
      expect(uriErr).toBeDefined();
      expect(uriErr?.message).toContain('Malformed URI in iframe');
    } finally {
      auditor.detach();
      await managed.release();
    }
  }, 20000);
});
