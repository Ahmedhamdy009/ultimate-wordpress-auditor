import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { AccessibilityAuditor } from '../../src/main/browser/accessibility-auditor.js';

describe('Accessibility Engine — Forms, Controls & Labels Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/unlabeled-form.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Unlabeled Form</title></head>
            <body>
              <form>
                <input id="unlabeled-text" type="text">
                <button id="empty-button" type="submit"></button>
              </form>
            </body>
          </html>
        `);
      } else if (url.pathname === '/valid-form.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Properly Labeled Form</title></head>
            <body>
              <form>
                <label for="username">Username</label>
                <input id="username" type="text" name="username">
                
                <label for="user-email">Email Address</label>
                <input id="user-email" type="email" name="email">

                <button id="submit-btn" type="submit">Sign Up</button>
              </form>
            </body>
          </html>
        `);
      } else if (url.pathname === '/invalid-labelledby.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Invalid Labelledby</title></head>
            <body>
              <input id="broken-ref" type="text" aria-labelledby="missing-label-id">
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

  it('1. detects form input without an accessible label and button without accessible name', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/unlabeled-form.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      // Verify label rule violation
      const labelViolation = report.violations.find(v => v.id === 'label');
      expect(labelViolation).toBeDefined();
      expect(labelViolation?.nodes.some(n => n.targetSelector.includes('#unlabeled-text'))).toBe(
        true,
      );

      // Verify button-name violation
      const buttonViolation = report.violations.find(v => v.id === 'button-name');
      expect(buttonViolation).toBeDefined();
      expect(buttonViolation?.nodes.some(n => n.targetSelector.includes('#empty-button'))).toBe(
        true,
      );
      expect(buttonViolation?.impact).toBe('critical');

      // Verify finding mappings
      const buttonFinding = report.findings.find(f => f.ruleId === 'a11y-button-name');
      expect(buttonFinding).toBeDefined();
      expect(buttonFinding?.severity).toBe('critical');
      expect(buttonFinding?.confidence).toBe('confirmed');
    } finally {
      await managedPage.release();
    }
  });

  it('2. passes when inputs and buttons have explicit valid labels and accessible names', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/valid-form.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      const labelViolation = report.violations.find(v => v.id === 'label');
      expect(labelViolation).toBeUndefined();

      const buttonViolation = report.violations.find(v => v.id === 'button-name');
      expect(buttonViolation).toBeUndefined();
    } finally {
      await managedPage.release();
    }
  });

  it('3. detects input with non-existent aria-labelledby reference', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
    });

    try {
      await managedPage.page.goto(
        `http://audit-target.test:${fixturePort}/invalid-labelledby.html`,
        { waitUntil: 'domcontentloaded' },
      );

      const report = await auditor.auditPage(managedPage.page);

      // Either label or aria-valid-attr-value violation is triggered
      const hasLabelIssue = report.violations.some(
        v => v.id === 'label' || v.id === 'aria-valid-attr-value',
      );
      expect(hasLabelIssue).toBe(true);
    } finally {
      await managedPage.release();
    }
  });
});
