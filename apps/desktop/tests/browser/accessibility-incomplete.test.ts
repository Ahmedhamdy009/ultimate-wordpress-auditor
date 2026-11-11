import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { AccessibilityAuditor } from '../../src/main/browser/accessibility-auditor.js';
import { AccessibilityAnalyzer } from '../../src/main/browser/accessibility-analyzer.js';

describe('Accessibility Engine — Incomplete & Manual Review Handling Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/indeterminate-contrast.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <title>Manual Review Contrast Test</title>
              <style>
                /* Linear gradient background prevents axe from computing deterministic contrast */
                .gradient-box {
                  background: linear-gradient(90deg, #000000 0%, #ffffff 100%);
                  color: #888888;
                  font-size: 16px;
                  padding: 20px;
                }
              </style>
            </head>
            <body>
              <main>
                <h1>Gradient Header</h1>
                <p id="gradient-text" class="gradient-box">Text on a sharp gradient requires human judgment.</p>
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

  it('1. separates incomplete checks requiring manual review and does not inflate confirmed violations count', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2aa'],
    });

    try {
      await managedPage.page.goto(
        `http://audit-target.test:${fixturePort}/indeterminate-contrast.html`,
        { waitUntil: 'domcontentloaded' },
      );

      const report = await auditor.auditPage(managedPage.page);

      // Verify that if color-contrast is incomplete, it is in report.incomplete and NOT in report.violations
      const incompleteContrast = report.incomplete.find(i => i.id === 'color-contrast');
      if (incompleteContrast) {
        expect(report.violations.find(v => v.id === 'color-contrast')).toBeUndefined();
        expect(incompleteContrast.reviewReason).toBeDefined();

        // Check finding status
        const reviewFinding = report.findings.find(f => f.ruleId === 'a11y-review-color-contrast');
        expect(reviewFinding).toBeDefined();
        expect(reviewFinding?.status).toBe('needs_manual_review');
        expect(reviewFinding?.confidence).toBe('potential');
      }

      // In either case, violations count reflects strictly confirmed violations
      expect(report.metrics.violationsCount).toBe(report.violations.length);
      expect(report.metrics.incompleteCount).toBe(report.incomplete.length);
    } finally {
      await managedPage.release();
    }
  });

  it('2. strictly verifies analyzer assigns needs_manual_review status and potential confidence to incomplete results', () => {
    const analyzer = new AccessibilityAnalyzer({
      maxViolations: 50,
      maxIncomplete: 50,
    });

    const analysis = analyzer.analyze({
      pageUrl: 'http://audit-target.test/sample',
      rawResults: {
        violations: [],
        incomplete: [
          {
            id: 'color-contrast',
            description:
              'Ensures the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
            help: 'Elements must meet minimum color contrast ratio thresholds',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/color-contrast',
            impact: 'serious',
            tags: ['cat.color', 'wcag2aa', 'wcag143'],
            nodes: [
              {
                html: '<span class="semi-transparent">Uncertain contrast</span>',
                target: ['.semi-transparent'],
                impact: 'serious',
                failureSummary:
                  'Element has a semi-transparent background that requires manual review',
                any: [
                  {
                    id: 'color-contrast',
                    impact: 'serious',
                    message: 'Element background is partially transparent',
                  },
                ],
              },
            ],
          },
        ],
        passes: [],
        inapplicable: [],
      },
    });

    // 0 violations, 1 incomplete
    expect(analysis.metrics.violationsCount).toBe(0);
    expect(analysis.metrics.incompleteCount).toBe(1);
    expect(analysis.violations.length).toBe(0);
    expect(analysis.incomplete.length).toBe(1);

    const finding = analysis.findings[0];
    expect(finding.ruleId).toBe('a11y-review-color-contrast');
    expect(finding.status).toBe('needs_manual_review');
    expect(finding.confidence).toBe('potential');
    expect(finding.severity).toBe('low');
    expect(finding.references).toContain('WCAG 1.4.3 Contrast (Minimum) (Level AA)');
  });
});
