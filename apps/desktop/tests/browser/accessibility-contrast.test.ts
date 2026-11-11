import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { AccessibilityAuditor } from '../../src/main/browser/accessibility-auditor.js';

describe('Accessibility Engine — Color Contrast & Visual Limitations Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/poor-contrast.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <title>Poor Contrast Page</title>
              <style>
                .low-contrast-text {
                  color: #888888;
                  background-color: #999999;
                  font-size: 14px;
                }
              </style>
            </head>
            <body>
              <h1>Contrast Evaluation</h1>
              <p class="low-contrast-text" id="low-contrast-p">This text has very poor contrast.</p>
            </body>
          </html>
        `);
      } else if (url.pathname === '/good-contrast.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <title>Good Contrast Page</title>
              <style>
                .high-contrast-text {
                  color: #000000;
                  background-color: #ffffff;
                  font-size: 16px;
                }
                .dark-theme-text {
                  color: #ffffff;
                  background-color: #121212;
                  font-size: 16px;
                }
              </style>
            </head>
            <body>
              <h1>Contrast Evaluation</h1>
              <p class="high-contrast-text" id="light-p">Crisp black on white.</p>
              <p class="dark-theme-text" id="dark-p">Crisp white on dark.</p>
            </body>
          </html>
        `);
      } else if (url.pathname === '/complex-bg.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <title>Complex Background</title>
              <style>
                .image-bg {
                  background-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="orange" width="100" height="100"/></svg>');
                  color: #333333;
                }
              </style>
            </head>
            <body>
              <div class="image-bg" id="complex-node">Text over background image</div>
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

  it('1. detects insufficient text color contrast on low-contrast elements', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2aa'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/poor-contrast.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      const contrastViolation = report.violations.find(v => v.id === 'color-contrast');
      expect(contrastViolation).toBeDefined();
      expect(contrastViolation?.impact).toBe('serious');
      expect(contrastViolation?.wcagCriteria).toContain('WCAG 1.4.3 Contrast (Minimum) (Level AA)');

      const node = contrastViolation?.nodes.find(n => n.targetSelector.includes('#low-contrast-p'));
      expect(node).toBeDefined();

      const finding = report.findings.find(f => f.ruleId === 'a11y-color-contrast');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('high');
      expect(finding?.confidence).toBe('confirmed');
    } finally {
      await managedPage.release();
    }
  });

  it('2. passes when text meets or exceeds standard 4.5:1 contrast requirements', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2aa'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/good-contrast.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      const contrastViolation = report.violations.find(v => v.id === 'color-contrast');
      expect(contrastViolation).toBeUndefined();
    } finally {
      await managedPage.release();
    }
  });

  it('3. handles complex background where automatic contrast determination is limited', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2aa'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/complex-bg.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      // Complex backgrounds typically produce incomplete or pass depending on image rasterization
      // In either case, the engine must not crash and metrics must remain accurate
      expect(report.metrics).toBeDefined();
      expect(report.durationMs).toBeGreaterThan(0);
    } finally {
      await managedPage.release();
    }
  });
});
