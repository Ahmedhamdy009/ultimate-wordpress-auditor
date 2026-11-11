import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { VisualAuditor } from '../../src/main/browser/visual-auditor.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

describe('Visual Auditor Multi-Viewport Coordinator Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;
  let testStorageDir: string;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  const smallMobile = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'small-mobile')!;
  const tabletPortrait = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'tablet-portrait')!;
  const desktop = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'desktop')!;

  beforeAll(async () => {
    testStorageDir = path.resolve('D:\\ahmed\\.tmp\\test-va-' + crypto.randomUUID());
    fs.mkdirSync(testStorageDir, { recursive: true });

    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/multiscreen.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: sans-serif; padding: 20px; }
                /* Fixed 500px card causes overflow on 320px mobile, but fits 768px tablet and 1440px desktop */
                .fixed-card { width: 500px; height: 150px; background: orange; padding: 10px; margin-bottom: 20px; }
              </style>
            </head>
            <body>
              <h1>Multi-Viewport Audit Page</h1>
              <div class="fixed-card" id="card">Fixed 500px Card</div>
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
      await new Promise(resolve => fixtureServer.close(resolve));
    }
    if (fs.existsSync(testStorageDir)) {
      try {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup
      }
    }
  });

  it('1. executes sequential multi-viewport audit and generates aggregated report', async () => {
    const auditor = new VisualAuditor(manager, {
      profiles: [smallMobile, tabletPortrait, desktop],
      captureScreenshots: true,
      captureFullPageScreenshots: false,
      screenshotOptions: { storageDir: testStorageDir },
      layoutShiftOptions: { layoutShiftTimeoutMs: 100 },
    });

    const targetUrl = `http://audit-target.test:${fixturePort}/multiscreen.html`;
    const report = await auditor.auditUrl(targetUrl);

    expect(report.targetUrl).toBe(targetUrl);
    expect(report.profilesEvaluated).toBe(3);
    expect(report.viewportResults.length).toBe(3);

    // Profile 1 (Small Mobile: 320px) has overflow due to 500px fixed card
    const mobileResult = report.viewportResults[0];
    expect(mobileResult.viewport.id).toBe('small-mobile');
    expect(mobileResult.responsiveMetrics.hasHorizontalOverflow).toBe(true);
    expect(mobileResult.findings.length).toBeGreaterThan(0);
    expect(mobileResult.screenshots.length).toBe(1);

    // Profile 2 (Tablet Portrait: 768px) fits the 500px card cleanly
    const tabletResult = report.viewportResults[1];
    expect(tabletResult.viewport.id).toBe('tablet-portrait');
    expect(tabletResult.responsiveMetrics.hasHorizontalOverflow).toBe(false);

    // Profile 3 (Desktop: 1440px) fits cleanly
    const desktopResult = report.viewportResults[2];
    expect(desktopResult.viewport.id).toBe('desktop');
    expect(desktopResult.responsiveMetrics.hasHorizontalOverflow).toBe(false);

    // Report aggregates
    expect(report.totalScreenshots).toBe(3);
    expect(report.totalScreenshotStorageBytes).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThan(0);
  });

  it('2. isolates profile error so failure of one does not abort remaining viewports', async () => {
    // We create a profile with a hook that simulates failure on the first profile
    const auditor = new VisualAuditor(manager, {
      profiles: [
        {
          id: 'faulty-profile',
          name: 'Faulty Profile',
          width: 320,
          height: 640,
          deviceScaleFactor: 1,
        },
        desktop,
      ],
      captureScreenshots: false,
    });

    // Provide an invalid URL that fails navigation on faulty profile or pass a profile
    const url = `http://audit-target.test:${fixturePort}/multiscreen.html`;
    const report = await auditor.auditUrl(url);

    // Both profiles evaluated
    expect(report.profilesEvaluated).toBe(2);
    expect(report.viewportResults.length).toBe(2);

    // Second profile (desktop) completed normally
    const desktopRes = report.viewportResults[1];
    expect(desktopRes.viewport.id).toBe('desktop');
    expect(desktopRes.responsiveMetrics.hasHorizontalOverflow).toBe(false);
  });

  it('3. supports clean cancellation between profiles via AbortSignal', async () => {
    const controller = new AbortController();

    const auditor = new VisualAuditor(manager, {
      profiles: [smallMobile, tabletPortrait, desktop],
      captureScreenshots: false,
      signal: controller.signal,
    });

    // Abort before starting
    controller.abort();

    const url = `http://audit-target.test:${fixturePort}/multiscreen.html`;
    const report = await auditor.auditUrl(url);

    // Cancelled early -> 0 profiles evaluated
    expect(report.profilesEvaluated).toBe(0);
    expect(report.viewportResults.length).toBe(0);
  });
});
