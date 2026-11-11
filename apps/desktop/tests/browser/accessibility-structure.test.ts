import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { AccessibilityAuditor } from '../../src/main/browser/accessibility-auditor.js';

describe('Accessibility Engine — Document Structure, Language & Landmarks Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/missing-lang-title.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <!-- No title tag -->
            </head>
            <body>
              <h1>Welcome without language or title</h1>
            </body>
          </html>
        `);
      } else if (url.pathname === '/proper-structure.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <title>Properly Structured Document</title>
            </head>
            <body>
              <main>
                <h1>Valid Heading 1</h1>
                <h2>Valid Heading 2</h2>
                <p>Properly structured content inside a main landmark.</p>
              </main>
            </body>
          </html>
        `);
      } else if (url.pathname === '/heading-order.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <title>Heading Hierarchy Test</title>
            </head>
            <body>
              <main>
                <h1>Main Heading</h1>
                <!-- Skips h2 directly to h4 -->
                <h4>Sub-sub-heading</h4>
              </main>
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

  it('1. detects missing document language (html-has-lang) and missing document title (document-title)', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(
        `http://audit-target.test:${fixturePort}/missing-lang-title.html`,
        { waitUntil: 'domcontentloaded' },
      );

      const report = await auditor.auditPage(managedPage.page);

      // Verify html-has-lang
      const langViolation = report.violations.find(v => v.id === 'html-has-lang');
      expect(langViolation).toBeDefined();
      expect(langViolation?.wcagCriteria).toContain('WCAG 3.1.1 Language of Page (Level A)');

      // Verify document-title
      const titleViolation = report.violations.find(v => v.id === 'document-title');
      expect(titleViolation).toBeDefined();
      expect(titleViolation?.wcagCriteria).toContain('WCAG 2.4.2 Page Titled (Level A)');

      // Verify findings mapping
      const langFinding = report.findings.find(f => f.ruleId === 'a11y-html-has-lang');
      expect(langFinding).toBeDefined();
      expect(langFinding?.severity).toBe('high');
      expect(langFinding?.status).toBe('confirmed');
    } finally {
      await managedPage.release();
    }
  });

  it('2. passes when document possesses valid lang, title, and proper structure', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/proper-structure.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      expect(report.violations.find(v => v.id === 'html-has-lang')).toBeUndefined();
      expect(report.violations.find(v => v.id === 'document-title')).toBeUndefined();
    } finally {
      await managedPage.release();
    }
  });

  it('3. detects heading order violation when best-practice rules are enabled', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a', 'best-practice'],
      includeBestPractice: true,
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/heading-order.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      const headingViolation = report.violations.find(v => v.id === 'heading-order');
      expect(headingViolation).toBeDefined();

      // Heading order is a best practice, verify category distinction
      const finding = report.findings.find(f => f.ruleId === 'a11y-bp-heading-order');
      expect(finding).toBeDefined();
      expect(finding?.category).toBe('accessibility-best-practice');
    } finally {
      await managedPage.release();
    }
  });
});
