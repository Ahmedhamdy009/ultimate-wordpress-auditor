import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { RuntimeResourceAuditor } from '../../src/main/browser/runtime-auditor.js';
import { sanitizeEvidence } from '../../src/main/browser/redactor.js';

describe('Runtime Resource Auditor — Lifecycle, Limits & Security Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/flood-resources.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              for (let i = 0; i < 20; i++) {
                fetch('/item-' + i).catch(() => {});
              }
            </script>
          </body></html>
        `);
      } else if (url.pathname.startsWith('/item-')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ item: url.pathname }));
      } else if (url.pathname === '/flood-console.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              for (let i = 0; i < 25; i++) {
                console.warn('Flood warning ' + i);
              }
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/flood-errors.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <script>
              for (let i = 0; i < 15; i++) {
                setTimeout(() => {
                  throw new Error('Flood error ' + i);
                }, i * 5);
              }
            </script>
          </body></html>
        `);
      } else if (url.pathname === '/slow-page.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write('<!DOCTYPE html><html><body><h1>Slow Page</h1>');
        // Do not end immediately to allow closing during load
        setTimeout(() => {
          res.end('</body></html>');
        }, 3000);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body>OK</body></html>');
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

  it('detaches cleanly and removes all page event listeners', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      const page = managed.page;

      // Count listeners before attach
      const listenersBefore = {
        pageerror: page.listenerCount('pageerror'),
        console: page.listenerCount('console'),
        request: page.listenerCount('request'),
        response: page.listenerCount('response'),
        requestfailed: page.listenerCount('requestfailed'),
        requestfinished: page.listenerCount('requestfinished'),
      };

      auditor.attach(page);

      // Listeners should have increased
      expect(page.listenerCount('pageerror')).toBeGreaterThan(listenersBefore.pageerror);
      expect(page.listenerCount('console')).toBeGreaterThan(listenersBefore.console);
      expect(page.listenerCount('request')).toBeGreaterThan(listenersBefore.request);
      expect(page.listenerCount('response')).toBeGreaterThan(listenersBefore.response);

      // Detach
      auditor.detach();

      // Listeners must be exactly restored to original count
      expect(page.listenerCount('pageerror')).toBe(listenersBefore.pageerror);
      expect(page.listenerCount('console')).toBe(listenersBefore.console);
      expect(page.listenerCount('request')).toBe(listenersBefore.request);
      expect(page.listenerCount('response')).toBe(listenersBefore.response);
      expect(page.listenerCount('requestfailed')).toBe(listenersBefore.requestfailed);
      expect(page.listenerCount('requestfinished')).toBe(listenersBefore.requestfinished);
    } finally {
      await managed.release();
    }
  });

  it('handles page closure during active collection gracefully', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);

      // Start navigation to slow page
      const navPromise = managed.page
        .goto(`http://audit-target.test:${fixturePort}/slow-page.html`, {
          timeout: 5000,
        })
        .catch(() => {});

      // Close page mid-flight
      await managed.page.close();
      await navPromise;

      // Auditor should still produce audit result without crashing
      const result = auditor.audit(`http://audit-target.test:${fixturePort}/slow-page.html`);
      expect(result).toBeDefined();
      expect(result.pageUrl).toBe(`http://audit-target.test:${fixturePort}/slow-page.html`);
      expect(result.metrics).toBeDefined();
      expect(Array.isArray(result.findings)).toBe(true);

      // Detach should be safe even after page is closed
      expect(() => auditor.detach()).not.toThrow();
    } finally {
      await managed.release();
    }
  });

  it('strictly enforces maxNetworkResources limit and discards excess events', async () => {
    const managed = await manager.acquirePage();
    const maxNetwork = 5;
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      maxNetworkResources: maxNetwork,
    });

    try {
      auditor.attach(managed.page);

      await managed.page.goto(`http://audit-target.test:${fixturePort}/flood-resources.html`, {
        waitUntil: 'networkidle',
      });

      expect(auditor.isLimitsReached()).toBe(true);
      const metrics = auditor.getMetrics();
      const result = auditor.audit();

      expect(result.limitsReached).toBe(true);
      expect(result.networkResources.length).toBeLessThanOrEqual(maxNetwork);
      // Total requests recorded in metrics exceeds the bounded array size
      expect(metrics.totalNetworkRequests).toBeGreaterThan(result.networkResources.length);

      auditor.detach();
    } finally {
      await managed.release();
    }
  });

  it('strictly enforces maxConsoleMessages limit and discards excess events', async () => {
    const managed = await manager.acquirePage();
    const maxConsole = 4;
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      maxConsoleMessages: maxConsole,
    });

    try {
      auditor.attach(managed.page);

      await managed.page.goto(`http://audit-target.test:${fixturePort}/flood-console.html`, {
        waitUntil: 'load',
      });

      expect(auditor.isLimitsReached()).toBe(true);
      const metrics = auditor.getMetrics();
      const result = auditor.audit();

      expect(result.limitsReached).toBe(true);
      expect(result.consoleMessages.length).toBeLessThanOrEqual(maxConsole);
      // Total console warnings recorded exceeds the collected array size
      expect(metrics.totalConsoleWarnings).toBeGreaterThan(result.consoleMessages.length);

      auditor.detach();
    } finally {
      await managed.release();
    }
  });

  it('strictly enforces maxErrors limit and discards excess errors', async () => {
    const managed = await manager.acquirePage();
    const maxErrors = 3;
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      maxErrors,
    });

    try {
      auditor.attach(managed.page);

      await managed.page.goto(`http://audit-target.test:${fixturePort}/flood-errors.html`, {
        waitUntil: 'load',
      });

      await managed.page.waitForTimeout(300);

      expect(auditor.isLimitsReached()).toBe(true);
      const metrics = auditor.getMetrics();
      const result = auditor.audit();

      expect(result.limitsReached).toBe(true);
      expect(result.errors.length).toBeLessThanOrEqual(maxErrors);
      // Total errors recorded in metrics exceeds the bounded array size
      expect(metrics.totalErrors).toBeGreaterThan(result.errors.length);

      auditor.detach();
    } finally {
      await managed.release();
    }
  });

  it('enforces evidence payload bounding to maximum 64KB', () => {
    // Generate massive deeply nested object
    const hugeObject: Record<string, unknown> = {
      description: 'Audit test evidence',
      items: [],
    };

    for (let i = 0; i < 5000; i++) {
      (hugeObject.items as unknown[]).push({
        id: i,
        data: 'x'.repeat(100),
        nested: { deepKey: 'some value ' + i },
      });
    }

    const bounded = sanitizeEvidence(hugeObject, 64 * 1024);
    const jsonStr = JSON.stringify(bounded);

    // Size in bytes must be <= 64KB
    const byteLength = Buffer.byteLength(jsonStr, 'utf-8');
    expect(byteLength).toBeLessThanOrEqual(64 * 1024);
    expect((bounded as Record<string, unknown>).truncated).toBe(true);
  });

  it('confirms Batch 4.1 security invariants are strictly preserved', () => {
    // Inspect hardened Chromium arguments
    const args = BrowserManager.getHardenedChromiumArgs();

    // 1. OS Sandboxing must be preserved: no --no-sandbox or --disable-setuid-sandbox
    expect(args).not.toContain('--no-sandbox');
    expect(args).not.toContain('--disable-setuid-sandbox');

    // 2. IPC flooding protection must NOT be disabled
    expect(args).not.toContain('--disable-ipc-flooding-protection');

    // 3. Site Isolation must NOT be disabled
    const disableFeaturesArg = args.find(a => a.startsWith('--disable-features='));
    expect(disableFeaturesArg).toBeDefined();
    expect(disableFeaturesArg).not.toContain('IsolateOrigins');
    expect(disableFeaturesArg).not.toContain('site-per-process');

    // 4. WebRTC direct UDP bypass prevention
    expect(args).toContain('--disable-webrtc');
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');

    // 5. Speculative networking disabled
    expect(args).toContain('--dns-prefetch-disable');
    expect(disableFeaturesArg).toContain('NetworkPrediction');
    expect(disableFeaturesArg).toContain('SpeculativeResourcePrefetching');

    // 6. extraArgs extension point must NOT exist on BrowserManager constructor options
    const testManager = new BrowserManager();
    expect(
      (testManager as unknown as { options: { extraArgs?: unknown } }).options.extraArgs,
    ).toBeUndefined();
  });

  it('handles browser context closure mid-collection without uncaught errors', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);

      // Start navigation
      managed.page
        .goto(`http://audit-target.test:${fixturePort}/slow-page.html`, {
          timeout: 5000,
        })
        .catch(() => {});

      // Close the entire context mid-flight
      await managed.context.close().catch(() => {});

      // Audit must still succeed safely and report whatever state was collected
      const result = auditor.audit();
      expect(result).toBeDefined();
      expect(Array.isArray(result.findings)).toBe(true);

      expect(() => auditor.detach()).not.toThrow();
    } finally {
      await managed.release();
    }
  });

  it('strictly bounds maximum generated findings according to maxFindings option', async () => {
    const managed = await manager.acquirePage();
    const maxFindings = 3;
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
      maxFindings,
    });

    try {
      auditor.attach(managed.page);
      await managed.page.goto(`http://audit-target.test:${fixturePort}/flood-errors.html`, {
        waitUntil: 'load',
      });
      await managed.page.waitForTimeout(300);

      const result = auditor.audit();
      expect(result.findings.length).toBeLessThanOrEqual(maxFindings);
    } finally {
      auditor.detach();
      await managed.release();
    }
  });

  it('releases all page and request references completely after detach', async () => {
    const managed = await manager.acquirePage();
    const auditor = new RuntimeResourceAuditor({
      authorizedOrigin: `http://audit-target.test:${fixturePort}`,
    });

    try {
      auditor.attach(managed.page);
      auditor.detach();

      // Verify internal collector state is cleared
      const collector = (
        auditor as unknown as { collector: { page: unknown; requestStates: Map<unknown, unknown> } }
      ).collector;
      expect(collector.page).toBeNull();
      expect(collector.requestStates.size).toBe(0);
    } finally {
      await managed.release();
    }
  });
});
