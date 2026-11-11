import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { ResponsiveLayoutAnalyzer } from '../../src/main/browser/responsive-analyzer.js';
import { DEFAULT_VIEWPORT_PROFILES } from '../../src/main/browser/viewport-profiles.js';

describe('Responsive Overflow Mathematical Accuracy & Discrepancy Prevention Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const smallMobile = DEFAULT_VIEWPORT_PROFILES.find(p => p.id === 'small-mobile')!;

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/perfect-fit.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
                .content { width: 320px; max-width: 100%; background: #2ecc71; height: 200px; }
              </style>
            </head>
            <body>
              <div class="content">Content perfectly fitting 320px</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/genuine-overflow.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                .wide-box { width: 450px; height: 100px; background: #e74c3c; }
              </style>
            </head>
            <body>
              <div class="wide-box" id="overflowing-el">Definitely 450px wide</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/image-in-inline-anchor.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                .card { width: 100%; max-width: 100%; padding: 10px; }
                .card a { display: inline; }
                .card img { width: 100%; max-width: 100%; height: auto; display: block; }
              </style>
            </head>
            <body>
              <div class="card">
                <a href="/project-details">
                  <img
                    class="attachment-large"
                    src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='1140' height='500'></svg>"
                    width="1140"
                    height="500"
                    alt="Portfolio card"
                  />
                </a>
              </div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/internal-text-clipping-only.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                html, body { width: 100%; max-width: 100%; overflow-x: hidden; }
                .heading-box {
                  width: 280px;
                  white-space: nowrap;
                  text-overflow: ellipsis;
                  overflow: hidden;
                }
              </style>
            </head>
              <body>
              <div class="heading-box">Very Long Unbroken Heading That Exceeds Two Hundred Eighty Pixels Internally</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/body-exceeds-html-clipped.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                html { overflow-x: hidden; }
                body { width: 450px; background: #f8f9fa; }
                .inner { width: 420px; height: 60px; background: #9b59b6; }
              </style>
            </head>
            <body>
              <div class="inner" id="clipped-by-html">Body is wide but HTML root clips horizontal scroll</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/overflowing-child.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                .outer { width: 100%; }
                .child-card { min-width: 440px; height: 80px; background: #e67e22; }
              </style>
            </head>
            <body>
              <div class="outer">
                <div class="child-card" id="wide-child">Overflowing child pushes document past 320px</div>
              </div>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
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
  }, 30000);

  afterAll(async () => {
    if (manager) {
      await manager.close();
    }
    if (fixtureServer) {
      await new Promise(resolve => fixtureServer.close(resolve));
    }
  }, 30000);

  it('does NOT emit RESPONSIVE_HORIZONTAL_OVERFLOW when docScrollWidth <= viewport.width and 0 elements overflow', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/perfect-fit.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer({ overflowTolerancePx: 1.0 });
      const { metrics, findings, overflowingElements } = await analyzer.analyzePage(
        page,
        smallMobile,
        url,
      );

      expect(overflowingElements.length).toBe(0);
      expect(metrics.documentScrollWidth).toBeLessThanOrEqual(smallMobile.width + 1.0);
      expect(metrics.hasHorizontalOverflow).toBe(false);

      const overflowFinding = findings.find(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW');
      expect(overflowFinding).toBeUndefined();
    } finally {
      await managedPage.release();
    }
  });

  it('correctly emits RESPONSIVE_HORIZONTAL_OVERFLOW when content genuinely overflows', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/genuine-overflow.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer();
      const { metrics, findings, overflowingElements } = await analyzer.analyzePage(
        page,
        smallMobile,
        url,
      );

      expect(metrics.hasHorizontalOverflow).toBe(true);
      expect(metrics.maxHorizontalOverflowPx).toBeGreaterThanOrEqual(100);
      expect(overflowingElements.length).toBeGreaterThan(0);

      const overflowFinding = findings.find(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW');
      expect(overflowFinding).toBeDefined();
      expect(overflowFinding?.severity).toBe('high');
      expect(overflowFinding?.confidence).toBe('confirmed');
      expect(overflowFinding?.status).toBe('confirmed');
    } finally {
      await managedPage.release();
    }
  });

  it('downgrades to potential and does NOT report confirmed horizontal scrolling when body exceeds viewport while <html> clips overflow', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/body-exceeds-html-clipped.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer({ overflowTolerancePx: 1.0 });
      const { metrics, findings } = await analyzer.analyzePage(page, smallMobile, url);

      expect(metrics.documentOverflowX).toBe('hidden');
      expect(metrics.rootClipsOverflow).toBe(true);
      expect(metrics.windowInnerWidth).toBe(smallMobile.width);
      expect(metrics.bodyScrollWidth).toBeGreaterThan(smallMobile.width + 1.0);
      expect(metrics.hasHorizontalOverflow).toBe(false);
      expect(metrics.maxHorizontalOverflowPx).toBe(0);

      const overflowFinding = findings.find(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW');
      expect(overflowFinding).toBeDefined();
      expect(overflowFinding?.confidence).toBe('potential');
      expect(overflowFinding?.status).toBe('potential');
      expect(overflowFinding?.severity).toBe('low');
      for (const finding of findings) {
        expect(finding.status).not.toBe('active');
        expect(finding.confidence).not.toBe('confirmed');
      }
    } finally {
      await managedPage.release();
    }
  });

  it('detects genuine overflow from an unclipped overflowing child element', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/overflowing-child.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer({ overflowTolerancePx: 1.0 });
      const { metrics, findings, overflowingElements } = await analyzer.analyzePage(
        page,
        smallMobile,
        url,
      );

      expect(metrics.rootClipsOverflow).toBe(false);
      expect(metrics.documentScrollWidth).toBeGreaterThanOrEqual(440);
      expect(metrics.hasHorizontalOverflow).toBe(true);
      expect(overflowingElements.length).toBeGreaterThan(0);

      const overflowFinding = findings.find(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW');
      expect(overflowFinding).toBeDefined();
      expect(overflowFinding?.confidence).toBe('confirmed');
      expect(overflowFinding?.status).toBe('confirmed');
      for (const finding of findings) {
        expect(finding.status).not.toBe('active');
      }
    } finally {
      await managedPage.release();
    }
  });

  it('does NOT false-positive RESPONSIVE_IMAGE_OVERFLOW when responsive img is wrapped inside an inline <a> parent (clientWidth === 0)', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/image-in-inline-anchor.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer({ overflowTolerancePx: 1.0 });
      const { metrics, findings, overflowingElements } = await analyzer.analyzePage(
        page,
        smallMobile,
        url,
      );

      expect(metrics.hasHorizontalOverflow).toBe(false);
      expect(overflowingElements.length).toBe(0);
      expect(findings.find(f => f.ruleId === 'RESPONSIVE_IMAGE_OVERFLOW')).toBeUndefined();
      expect(findings.find(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW')).toBeUndefined();
    } finally {
      await managedPage.release();
    }
  });

  it('does NOT promote internal text-clipping into page-level RESPONSIVE_HORIZONTAL_OVERFLOW when doc and body fit viewport', async () => {
    const managedPage = await manager.acquirePage({
      viewport: { width: smallMobile.width, height: smallMobile.height },
      deviceScaleFactor: smallMobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
    });

    try {
      const page = managedPage.page;
      const url = `http://audit-target.test:${fixturePort}/internal-text-clipping-only.html`;
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const analyzer = new ResponsiveLayoutAnalyzer({ overflowTolerancePx: 1.0 });
      const { metrics, findings } = await analyzer.analyzePage(page, smallMobile, url);

      expect(metrics.documentScrollWidth).toBeLessThanOrEqual(smallMobile.width + 1.0);
      expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(smallMobile.width + 1.0);
      expect(metrics.hasHorizontalOverflow).toBe(false);
      expect(findings.some(f => f.ruleId === 'RESPONSIVE_TEXT_CLIPPED')).toBe(true);
      expect(findings.find(f => f.ruleId === 'RESPONSIVE_HORIZONTAL_OVERFLOW')).toBeUndefined();
    } finally {
      await managedPage.release();
    }
  });
});
