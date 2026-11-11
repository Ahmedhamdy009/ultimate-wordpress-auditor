import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { ResponsiveLayoutAnalyzer } from '../../src/main/browser/responsive-analyzer.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

describe('Mobile Viewport Measurement Accuracy Suite (Real Chromium Emulation)', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const smallMobile = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'small-mobile')!;

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/responsive-clean.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body { font-family: sans-serif; }
                .container { width: 100%; max-width: 100%; padding: 16px; }
                h1 { font-size: 1.5rem; overflow-wrap: break-word; }
                p { margin-top: 8px; overflow-wrap: break-word; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Fluid Responsive Mobile Page</h1>
                <p>This layout fits 320px width completely with 100% fluid CSS containers.</p>
              </div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/fixed-900.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                .fixed-wide { width: 900px; height: 120px; background: #e74c3c; }
              </style>
            </head>
            <body>
              <div class="fixed-wide" id="wide-box">900px Fixed Element on Mobile</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/actual-horizontal-overflow.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                .overflow-content { width: 550px; background: purple; padding: 20px; }
              </style>
            </head>
            <body>
              <div class="overflow-content" id="wide-content">Uncontained 550px Content</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/decorative-hidden.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                .hero-wrapper { width: 100%; height: 200px; position: relative; overflow: hidden; }
                .decorative-circle { position: absolute; right: -200px; width: 350px; height: 350px; background: #3498db; }
              </style>
            </head>
            <body>
              <div class="hero-wrapper">
                <h2>Clipped Hero Content</h2>
                <div class="decorative-circle" id="circle"></div>
              </div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/wide-image.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                img { width: 850px; height: 200px; }
              </style>
            </head>
            <body>
              <img id="unconstrained-img" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='850' height='200'></svg>" alt="Wide Image" />
            </body>
          </html>
        `);
      } else if (url.pathname === '/subpixel-rounding.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { margin: 0; padding: 0; }
                /* 320.6px width on 320px viewport - within 2px tolerance */
                .subpixel-box { width: 320.6px; height: 50px; background: #95a5a6; }
              </style>
            </head>
            <body>
              <div class="subpixel-box">320.6px Box</div>
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

  it('1. correctly measures a responsive page with 320px mobile emulation (0 overflow)', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/responsive-clean.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Verify real browser measurements
      const browserDims = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        visualViewportWidth: window.visualViewport ? window.visualViewport.width : null,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      expect(browserDims.innerWidth).toBe(320);
      expect(browserDims.visualViewportWidth).toBe(320);
      expect(browserDims.scrollWidth).toBe(320);

      const analyzer = new ResponsiveLayoutAnalyzer({ overflowTolerancePx: 2.0 });
      const { metrics, findings } = await analyzer.analyzePage(page, smallMobile, url);

      expect(metrics.hasHorizontalOverflow).toBe(false);
      expect(metrics.maxHorizontalOverflowPx).toBe(0);
      expect(findings.length).toBe(0);
    } finally {
      await managedPage.release();
    }
  });

  it('2. verifies difference between layout viewport and visual viewport on 900px container in mobile Chromium', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/fixed-900.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Real browser measurements:
      // Mobile Chromium expands the layout viewport (window.innerWidth) to 900 to contain the wide element,
      // while the visual viewport (window.visualViewport.width) remains 320!
      const browserDims = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        visualViewportWidth: window.visualViewport ? window.visualViewport.width : null,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      // Document the actual browser behavior:
      expect(browserDims.innerWidth).toBe(900);
      expect(browserDims.visualViewportWidth).toBe(320);
      expect(browserDims.innerWidth).not.toBe(browserDims.visualViewportWidth);
      expect(browserDims.scrollWidth).toBe(900);

      // Analyzer must detect this genuine overflow against configured 320px
      const analyzer = new ResponsiveLayoutAnalyzer();
      const { metrics, findings, overflowingElements } = await analyzer.analyzePage(
        page,
        smallMobile,
        url,
      );

      expect(metrics.hasHorizontalOverflow).toBe(true);
      expect(metrics.maxHorizontalOverflowPx).toBe(580); // 900 - 320 = 580px

      const overflowFinding = findings.find(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW');
      expect(overflowFinding).toBeDefined();
      expect(overflowFinding?.severity).toBe('high'); // High on mobile

      const fixedWidthFinding = findings.find(f => f.ruleId === 'RESPONSIVE_FIXED_WIDTH_CONTAINER');
      expect(fixedWidthFinding).toBeDefined();

      const el = overflowingElements.find(e => e.overflowType === 'fixed-width-overflow');
      expect(el).toBeDefined();
      expect(el?.overflowAmountPx).toBe(580);
    } finally {
      await managedPage.release();
    }
  });

  it('3. detects actual document horizontal overflow on mobile emulation', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/actual-horizontal-overflow.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { metrics, findings } = await analyzer.analyzePage(page, smallMobile, url);

      expect(metrics.hasHorizontalOverflow).toBe(true);
      expect(metrics.maxHorizontalOverflowPx).toBe(270); // 550px width + 40px padding (content-box) - 320px viewport = 270px
      expect(findings.some(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW')).toBe(true);
    } finally {
      await managedPage.release();
    }
  });

  it('4. ignores intentionally hidden decorative elements clipped by overflow:hidden', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/decorative-hidden.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { metrics, findings } = await analyzer.analyzePage(page, smallMobile, url);

      // Wrapper clips decorative circle -> no horizontal overflow, 0 defect findings
      expect(metrics.hasHorizontalOverflow).toBe(false);
      expect(findings.length).toBe(0);
    } finally {
      await managedPage.release();
    }
  });

  it('5. detects wide unconstrained responsive image on mobile emulation', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/wide-image.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { findings, overflowingElements } = await analyzer.analyzePage(page, smallMobile, url);

      const imgFinding = findings.find(f => f.ruleId === 'RESPONSIVE_IMAGE_OVERFLOW');
      expect(imgFinding).toBeDefined();
      expect(imgFinding?.severity).toBe('medium');

      const imgEl = overflowingElements.find(e => e.overflowType === 'image-overflow');
      expect(imgEl).toBeDefined();
      expect(imgEl?.tagName).toBe('IMG');
      expect(imgEl?.overflowAmountPx).toBe(530); // 850 - 320 = 530px
    } finally {
      await managedPage.release();
    }
  });

  it('6. applies subpixel rounding tolerance (0.6px does not produce false positive)', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/subpixel-rounding.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer({ overflowTolerancePx: 2.0 });
      const { metrics, findings } = await analyzer.analyzePage(page, smallMobile, url);

      // 320.6px is within 2.0px tolerance
      expect(metrics.hasHorizontalOverflow).toBe(false);
      expect(findings.filter(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW').length).toBe(0);
    } finally {
      await managedPage.release();
    }
  });
});
