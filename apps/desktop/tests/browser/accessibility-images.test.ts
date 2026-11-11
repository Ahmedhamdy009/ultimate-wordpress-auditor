import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { AccessibilityAuditor } from '../../src/main/browser/accessibility-auditor.js';

describe('Accessibility Engine — Images and Alternative Text Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/missing-alt.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Missing Alt Test</title></head>
            <body>
              <h1>Product Gallery</h1>
              <img id="bad-image" src="/sample.png">
            </body>
          </html>
        `);
      } else if (url.pathname === '/valid-alt.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Valid Alt Test</title></head>
            <body>
              <h1>Company Info</h1>
              <img id="good-logo" src="/logo.png" alt="Company Logo">
              <img id="decorative-img" src="/divider.png" alt="">
            </body>
          </html>
        `);
      } else if (url.pathname === '/empty-aria-label.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Inaccessible Name Test</title></head>
            <body>
              <img id="empty-aria" src="/icon.png" role="img" aria-label="">
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

  it('1. detects image missing alt attribute and extracts actionable element evidence', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/missing-alt.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      expect(report.metrics.violationsCount).toBeGreaterThanOrEqual(1);
      const imageAltViolation = report.violations.find(v => v.id === 'image-alt');
      expect(imageAltViolation).toBeDefined();
      expect(imageAltViolation?.impact).toBe('critical');

      // Verify WCAG mapping
      expect(imageAltViolation?.wcagCriteria).toContain('WCAG 1.1.1 Non-text Content (Level A)');

      // Verify node-level evidence
      expect(imageAltViolation?.nodes.length).toBe(1);
      const node = imageAltViolation?.nodes[0];
      expect(node?.targetSelector).toContain('#bad-image');
      expect(node?.html).toContain('<img id="bad-image"');

      // Verify normalized finding
      const finding = report.findings.find(f => f.ruleId === 'a11y-image-alt');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('critical');
      expect(finding?.confidence).toBe('confirmed');
      expect(finding?.status).toBe('confirmed');
      expect(finding?.category).toBe('accessibility');
      expect(finding?.references).toContain(
        'https://dequeuniversity.com/rules/axe/4.14/image-alt?application=axeAPI',
      );
    } finally {
      await managedPage.release();
    }
  });

  it('2. passes when images have meaningful alternative text or valid decorative empty alt', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/valid-alt.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      const imageAltViolation = report.violations.find(v => v.id === 'image-alt');
      expect(imageAltViolation).toBeUndefined();
    } finally {
      await managedPage.release();
    }
  });

  it('3. detects image with empty aria-label as accessibility violation', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/empty-aria-label.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      const imageAltViolation = report.violations.find(v => v.id === 'image-alt');
      expect(imageAltViolation).toBeDefined();
    } finally {
      await managedPage.release();
    }
  });
});
