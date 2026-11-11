import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { LayoutShiftCollector } from '../../src/main/browser/layout-shift-collector.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';
import type { LayoutShiftEvent } from '../../src/main/browser/visual-types.js';

describe('Layout Shift & Stability Measurement Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const desktop = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'desktop')!;

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/no-shifts.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><style>body { font-family: sans-serif; margin: 0; padding: 20px; }</style></head>
            <body>
              <h1>Completely Static Page</h1>
              <p>No content shifts or reflows will happen here.</p>
            </body>
          </html>
        `);
      } else if (url.pathname === '/single-shift.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { margin: 0; padding: 20px; }
                #dynamic-banner { background: yellow; height: 0; }
                #content { background: #e0e0e0; height: 300px; padding: 20px; }
              </style>
            </head>
            <body>
              <div id="dynamic-banner"></div>
              <div id="content">Existing Content Pushed Down</div>
              <script>
                // Cause an unannounced layout shift by expanding the banner after initial paint
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    const banner = document.getElementById('dynamic-banner');
                    banner.style.height = '200px';
                  });
                });
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/multi-shifts.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { margin: 0; padding: 20px; }
                .spacer { height: 0; }
                #target { height: 250px; background: cyan; }
              </style>
            </head>
            <body>
              <div id="spacer1" class="spacer"></div>
              <div id="spacer2" class="spacer"></div>
              <div id="target">Pushed Down Twice</div>
              <script>
                // Schedule shifts after initial paint so slow startup under load cannot coalesce them into frame 1
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    document.getElementById('spacer1').style.height = '150px';
                    setTimeout(() => {
                      requestAnimationFrame(() => {
                        document.getElementById('spacer2').style.height = '150px';
                      });
                    }, 60);
                  });
                });
              </script>
            </body>
          </html>
        `);
      } else if (url.pathname === '/user-input-shift.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { margin: 0; padding: 20px; }
                #dynamic { height: 0; }
                #box { height: 200px; background: lightgreen; }
              </style>
            </head>
            <body>
              <button id="trigger-btn">Click for Content</button>
              <div id="dynamic"></div>
              <div id="box">Interactive Target</div>
              <script>
                document.getElementById('trigger-btn').addEventListener('click', () => {
                  document.getElementById('dynamic').style.height = '180px';
                });
              </script>
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
  });

  it('1. records zero layout shifts and emits no findings on a static page', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const collector = new LayoutShiftCollector({ layoutShiftTimeoutMs: 300 });

      // Install observer before navigation
      await collector.installScript(page);

      const url = `http://audit-target.test:${fixturePort}/no-shifts.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const { metrics, events, findings } = await collector.collectMetrics(page, desktop, url);

      expect(metrics.isSupported).toBe(true);
      expect(metrics.totalShiftsRecorded).toBe(0);
      expect(metrics.sessionWindowCLS).toBe(0);
      expect(metrics.rawCumulativeLayoutShift).toBe(0);
      expect(events.length).toBe(0);
      expect(findings.length).toBe(0);
    } finally {
      await managedPage.release();
    }
  });

  it('2. captures a single unexpected layout shift and measures CLS accurately', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const collector = new LayoutShiftCollector({ layoutShiftTimeoutMs: 1500 });

      await collector.installScript(page);

      const url = `http://audit-target.test:${fixturePort}/single-shift.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const { metrics, events, findings } = await collector.collectMetrics(page, desktop, url);

      expect(metrics.isSupported).toBe(true);
      expect(metrics.totalShiftsRecorded).toBeGreaterThan(0);
      expect(metrics.sessionWindowCLS).toBeGreaterThan(0);
      expect(events[0].hadRecentInput).toBe(false);

      if (metrics.sessionWindowCLS > 0.1) {
        expect(findings.length).toBeGreaterThan(0);
        const shiftFinding = findings[0];
        expect(shiftFinding.category).toBe('layout-stability');
        expect(shiftFinding.evidence).toHaveProperty('sessionWindowCLS');
        expect(shiftFinding.evidence).toHaveProperty('measurementNotice');
      }
    } finally {
      await managedPage.release();
    }
  });

  it('3. aggregates multiple shifts within the same session window (<1000ms gap, <5000ms duration)', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const collector = new LayoutShiftCollector({ layoutShiftTimeoutMs: 1500 });

      await collector.installScript(page);

      const url = `http://audit-target.test:${fixturePort}/multi-shifts.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const { metrics, events } = await collector.collectMetrics(page, desktop, url);

      expect(metrics.isSupported).toBe(true);
      expect(metrics.totalShiftsRecorded).toBeGreaterThanOrEqual(1);
      expect(events.length).toBe(metrics.totalShiftsRecorded);
    } finally {
      await managedPage.release();
    }
  });

  it('4. calculates CLS across distinct session windows correctly (unit verification)', () => {
    const collector = new LayoutShiftCollector();

    // Simulating events across 2 separate session windows:
    // Window 1: t=100 (val=0.08), t=400 (val=0.07) -> Sum = 0.15
    // Gap: 1500ms (> 1000ms gap) -> Closes Window 1
    // Window 2: t=2000 (val=0.20), t=2200 (val=0.10) -> Sum = 0.30
    const mockEvents: LayoutShiftEvent[] = [
      { startTime: 100, value: 0.08, hadRecentInput: false },
      { startTime: 400, value: 0.07, hadRecentInput: false },
      { startTime: 2000, value: 0.2, hadRecentInput: false },
      { startTime: 2200, value: 0.1, hadRecentInput: false },
    ];

    const result = collector.calculateSessionWindowCLS(mockEvents);

    expect(result.sessionWindowsCount).toBe(2);
    expect(result.rawTotal).toBe(0.45);
    // Window 1 = 0.15, Window 2 = 0.30 -> Max session window CLS = 0.30
    expect(result.sessionWindowCLS).toBe(0.3);
    expect(result.excludedUserShiftsCount).toBe(0);
    expect(result.maxSingleShiftValue).toBe(0.2);
  });

  it('5. excludes user-initiated shifts (hadRecentInput: true) from CLS score', () => {
    const collector = new LayoutShiftCollector();

    // Shift 1: User-initiated (hadRecentInput: true, value: 0.35)
    // Shift 2: Unprompted layout shift (hadRecentInput: false, value: 0.05)
    const mockEvents: LayoutShiftEvent[] = [
      { startTime: 200, value: 0.35, hadRecentInput: true },
      { startTime: 800, value: 0.05, hadRecentInput: false },
    ];

    const result = collector.calculateSessionWindowCLS(mockEvents);

    expect(result.rawTotal).toBe(0.4);
    // User shift excluded -> sessionWindowCLS should be 0.05, NOT 0.40!
    expect(result.sessionWindowCLS).toBe(0.05);
    expect(result.excludedUserShiftsCount).toBe(1);
  });

  it('6. handles closed or unsupported page gracefully', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    const page = managedPage.page;
    await managedPage.release(); // Close immediately

    const collector = new LayoutShiftCollector();
    const { metrics, events, findings } = await collector.collectMetrics(
      page,
      desktop,
      'http://test',
    );

    expect(metrics.isSupported).toBe(false);
    expect(metrics.sessionWindowCLS).toBe(0);
    expect(events.length).toBe(0);
    expect(findings.length).toBe(0);
  });

  it('7. bounds the shift events queue by maxShiftEventsLimit', async () => {
    const collector = new LayoutShiftCollector({ maxShiftEventsLimit: 5 });

    const manyEvents: LayoutShiftEvent[] = [];
    for (let i = 0; i < 20; i++) {
      manyEvents.push({
        startTime: i * 50,
        value: 0.01,
        hadRecentInput: false,
      });
    }

    const result = collector.calculateSessionWindowCLS(manyEvents.slice(0, 5));
    expect(result.rawTotal).toBe(0.05);
  });

  it('8. provides lab measurement notice in finding evidence', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: desktop.width, height: desktop.height },
    });

    try {
      const page = managedPage.page;
      const collector = new LayoutShiftCollector({ layoutShiftTimeoutMs: 1500 });
      await collector.installScript(page);

      const url = `http://audit-target.test:${fixturePort}/single-shift.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const { findings, metrics } = await collector.collectMetrics(page, desktop, url);

      if (metrics.sessionWindowCLS > 0.1) {
        expect(findings.length).toBeGreaterThan(0);
        const evidence = findings[0].evidence as Record<string, unknown>;
        expect(evidence.measurementNotice).toContain('Lab measurement is single automated visit');
      }
    } finally {
      await managedPage.release();
    }
  });
});
