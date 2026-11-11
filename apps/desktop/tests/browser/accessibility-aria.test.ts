import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { AccessibilityAuditor } from '../../src/main/browser/accessibility-auditor.js';

describe('Accessibility Engine — ARIA Roles, Attributes & Relationships Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/invalid-aria-role.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Invalid Role</title></head>
            <body>
              <div id="bad-role-elem" role="invented-role">Click Me</div>
            </body>
          </html>
        `);
      } else if (url.pathname === '/missing-required-attr.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Missing Required ARIA Attribute</title></head>
            <body>
              <!-- role=checkbox requires aria-checked -->
              <span id="bad-checkbox" role="checkbox" aria-label="I agree"></span>
            </body>
          </html>
        `);
      } else if (url.pathname === '/proper-aria.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Proper ARIA Element</title></head>
            <body>
              <div id="good-btn" role="button" tabindex="0" aria-label="Dismiss Dialog">X</div>
              <div id="good-checkbox" role="checkbox" tabindex="0" aria-checked="false" aria-label="Accept Privacy Policy"></div>
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

  it('1. detects invalid ARIA role (aria-roles) with actionable target selector', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(
        `http://audit-target.test:${fixturePort}/invalid-aria-role.html`,
        { waitUntil: 'domcontentloaded' },
      );

      const report = await auditor.auditPage(managedPage.page);

      const roleViolation = report.violations.find(v => v.id === 'aria-roles');
      expect(roleViolation).toBeDefined();
      expect(roleViolation?.impact).toBe('critical');
      expect(roleViolation?.wcagCriteria).toContain('WCAG 4.1.2 Name, Role, Value (Level A)');

      const node = roleViolation?.nodes.find(n => n.targetSelector.includes('#bad-role-elem'));
      expect(node).toBeDefined();

      const finding = report.findings.find(f => f.ruleId === 'a11y-aria-roles');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('critical');
    } finally {
      await managedPage.release();
    }
  });

  it('2. detects missing required ARIA attributes (aria-required-attr)', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(
        `http://audit-target.test:${fixturePort}/missing-required-attr.html`,
        { waitUntil: 'domcontentloaded' },
      );

      const report = await auditor.auditPage(managedPage.page);

      const reqAttrViolation = report.violations.find(v => v.id === 'aria-required-attr');
      expect(reqAttrViolation).toBeDefined();
      expect(reqAttrViolation?.impact).toBe('critical');

      const node = reqAttrViolation?.nodes.find(n => n.targetSelector.includes('#bad-checkbox'));
      expect(node).toBeDefined();
    } finally {
      await managedPage.release();
    }
  });

  it('3. passes when ARIA roles and required attributes are valid and properly specified', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/proper-aria.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      expect(report.violations.find(v => v.id === 'aria-roles')).toBeUndefined();
      expect(report.violations.find(v => v.id === 'aria-required-attr')).toBeUndefined();
    } finally {
      await managedPage.release();
    }
  });
});
