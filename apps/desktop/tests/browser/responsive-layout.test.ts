import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { ResponsiveLayoutAnalyzer } from '../../src/main/browser/responsive-analyzer.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

describe('Responsive Layout Analyzer Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  const smallMobile = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'small-mobile')!;
  const standardMobile = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'standard-mobile')!;
  const largeDesktop = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'large-desktop')!;

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/clean-responsive.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: sans-serif; }
                .container { max-width: 1200px; width: 100%; margin: 0 auto; padding: 16px; }
                .card { width: 100%; max-width: 100%; background: #f0f0f0; padding: 16px; margin-bottom: 16px; }
                img { max-width: 100%; height: auto; }
                button { max-width: 100%; padding: 8px 16px; }
                p { overflow-wrap: break-word; }
              </style>
            </head>
            <body>
              <div class="container">
                <header><h1>Clean Responsive Header</h1></header>
                <div class="card">
                  <p>This page uses 100% fluid layout and wraps perfectly on all screens.</p>
                  <button>Click Here</button>
                </div>
              </div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/mobile-overflow.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                .wide-box { width: 900px; height: 100px; background: red; }
              </style>
            </head>
            <body>
              <div class="wide-box" id="wide-box">Forced Wide Element</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/image-overflow.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                .container { width: 100%; padding: 10px; }
                img { width: 800px; height: 200px; }
              </style>
            </head>
            <body>
              <div class="container">
                <img id="overflowing-img" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='200'></svg>" alt="Wide" />
              </div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/control-overflow.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                button { width: 700px; padding: 10px; }
              </style>
            </head>
            <body>
              <button id="oversized-btn">Wide Button Exceeding Mobile</button>
            </body>
          </html>
        `);
      } else if (url.pathname === '/text-clipping.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                .clipped-text {
                  width: 150px;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                }
              </style>
            </head>
            <body>
              <div class="clipped-text" id="truncated">
                This is a very long string that definitely overflows the one hundred and fifty pixel container.
              </div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/subpixel-clean.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                /* Element is 320.5px wide on 320px viewport, well within 2px tolerance */
                .subpixel-box { width: 320.5px; height: 50px; background: #ddd; }
              </style>
            </head>
            <body>
              <div class="subpixel-box">Subpixel Test</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/decorative-clipped.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                /* Wrapper with overflow: hidden clips offscreen decoration */
                .hero { width: 100%; position: relative; overflow: hidden; height: 200px; }
                .blob { position: absolute; right: -200px; width: 400px; height: 400px; background: blue; }
              </style>
            </head>
            <body>
              <div class="hero">
                <h1>Hero Content</h1>
                <div class="blob" id="decorative-blob"></div>
              </div>
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

  it('1. correctly analyzes a clean responsive page without false positives', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: smallMobile.isMobile,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/clean-responsive.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer({ overflowTolerancePx: 2.0 });
      const { metrics, overflowingElements, findings } = await analyzer.analyzePage(
        page,
        smallMobile,
        url,
      );

      expect(metrics.hasHorizontalOverflow).toBe(false);
      expect(metrics.maxHorizontalOverflowPx).toBeLessThanOrEqual(2.0);
      expect(overflowingElements.length).toBe(0);
      expect(findings.length).toBe(0);
    } finally {
      await managedPage.release();
    }
  });

  it('2. detects horizontal overflow and fixed-width containers on mobile viewports', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: smallMobile.isMobile,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/mobile-overflow.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { metrics, overflowingElements, findings } = await analyzer.analyzePage(
        page,
        smallMobile,
        url,
      );

      expect(metrics.hasHorizontalOverflow).toBe(true);
      expect(metrics.maxHorizontalOverflowPx).toBeGreaterThan(500); // 900 - 320 = 580px
      expect(overflowingElements.length).toBeGreaterThan(0);

      const overflowFinding = findings.find(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW');
      expect(overflowFinding).toBeDefined();
      expect(overflowFinding?.severity).toBe('high');
      expect(overflowFinding?.confidence).toBe('confirmed');

      const fixedWidthFinding = findings.find(f => f.ruleId === 'RESPONSIVE_FIXED_WIDTH_CONTAINER');
      expect(fixedWidthFinding).toBeDefined();
      expect(fixedWidthFinding?.confidence).toBe('firm');
    } finally {
      await managedPage.release();
    }
  });

  it('3. detects responsive image overflow', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: standardMobile.width, height: standardMobile.height },
      deviceScaleFactor: standardMobile.deviceScaleFactor,
      isMobile: standardMobile.isMobile,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/image-overflow.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { findings, overflowingElements } = await analyzer.analyzePage(
        page,
        standardMobile,
        url,
      );

      const imgFinding = findings.find(f => f.ruleId === 'RESPONSIVE_IMAGE_OVERFLOW');
      expect(imgFinding).toBeDefined();
      expect(imgFinding?.severity).toBe('medium');
      expect(imgFinding?.confidence).toBe('confirmed');

      const imgElement = overflowingElements.find(e => e.overflowType === 'image-overflow');
      expect(imgElement).toBeDefined();
      expect(imgElement?.tagName).toBe('IMG');
    } finally {
      await managedPage.release();
    }
  });

  it('4. detects interactive form control / button overflow', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: standardMobile.width, height: standardMobile.height },
      deviceScaleFactor: standardMobile.deviceScaleFactor,
      isMobile: standardMobile.isMobile,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/control-overflow.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { findings } = await analyzer.analyzePage(page, standardMobile, url);

      const ctrlFinding = findings.find(f => f.ruleId === 'RESPONSIVE_CONTROL_OVERFLOW');
      expect(ctrlFinding).toBeDefined();
      expect(ctrlFinding?.severity).toBe('low');
      expect(ctrlFinding?.confidence).toBe('potential');
    } finally {
      await managedPage.release();
    }
  });

  it('5. detects text clipping on truncated elements', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/text-clipping.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { findings } = await analyzer.analyzePage(page, smallMobile, url);

      const textFinding = findings.find(f => f.ruleId === 'RESPONSIVE_TEXT_CLIPPED');
      expect(textFinding).toBeDefined();
      expect(textFinding?.severity).toBe('low');
      expect(textFinding?.confidence).toBe('potential');
    } finally {
      await managedPage.release();
    }
  });

  it('6. applies subpixel rounding tolerance to prevent false positives', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: 320, height: 640 },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/subpixel-clean.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer({ overflowTolerancePx: 2.0 });
      const { metrics, findings } = await analyzer.analyzePage(
        page,
        { id: 'test-320', name: 'Test 320', width: 320, height: 640, deviceScaleFactor: 1 },
        url,
      );

      // The 0.5px fractional width is within the 2.0px tolerance
      expect(findings.filter(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW').length).toBe(0);
      expect(metrics.hasHorizontalOverflow).toBe(false);
    } finally {
      await managedPage.release();
    }
  });

  it('7. does NOT report intentional off-screen decorative elements clipped by overflow:hidden', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/decorative-clipped.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { metrics, findings } = await analyzer.analyzePage(page, smallMobile, url);

      expect(metrics.hasHorizontalOverflow).toBe(false);
      expect(findings.length).toBe(0);
    } finally {
      await managedPage.release();
    }
  });

  it('8. demonstrates cross-viewport sensitivity (overflow on mobile, clean on desktop)', async () => {
    // 900px wide box on 1920px desktop viewport fits comfortably!
    const desktopPage = await manager.acquirePage({
      viewport: { width: largeDesktop.width, height: largeDesktop.height },
      deviceScaleFactor: largeDesktop.deviceScaleFactor,
    });

    try {
      const page = desktopPage.page;
      const url = `http://audit-target.test:${fixturePort}/mobile-overflow.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { metrics, findings } = await analyzer.analyzePage(page, largeDesktop, url);

      expect(metrics.hasHorizontalOverflow).toBe(false);
      expect(findings.length).toBe(0);
    } finally {
      await desktopPage.release();
    }
  });
});
