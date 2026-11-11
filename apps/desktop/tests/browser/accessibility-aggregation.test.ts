import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BrowserManager } from '../../src/main/browser/manager.js';
import { AccessibilityAuditor } from '../../src/main/browser/accessibility-auditor.js';
import { AccessibilityAnalyzer } from '../../src/main/browser/accessibility-analyzer.js';

describe('Accessibility Engine — Finding Aggregation & Multi-Node Retention Suite', () => {
  let fixtureServer: http.Server;
  let fixturePort: number;
  let manager: BrowserManager;

  const mockLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/multi-node.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head><title>Multi-Node Aggregation Test</title></head>
            <body>
              <h1>Gallery with multiple missing alts</h1>
              <img id="img-1" src="/1.png">
              <img id="img-2" src="/2.png">
              <img id="img-3" src="/3.png">
              <img id="img-4" src="/4.png">
              <img id="img-5" src="/5.png">
              
              <!-- Different rule on same page -->
              <button id="bad-btn-1"></button>
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

  it('1. aggregates multiple violating nodes under a single finding while preserving element selectors', async () => {
    const managedPage = await manager.acquirePage();
    const auditor = new AccessibilityAuditor({
      tags: ['wcag2a'],
      maxNodesPerViolation: 10,
    });

    try {
      await managedPage.page.goto(`http://audit-target.test:${fixturePort}/multi-node.html`, {
        waitUntil: 'domcontentloaded',
      });

      const report = await auditor.auditPage(managedPage.page);

      // Verify image-alt aggregated finding
      const imageAltFinding = report.findings.find(f => f.ruleId === 'a11y-image-alt');
      expect(imageAltFinding).toBeDefined();

      const evidence = imageAltFinding?.evidence as Record<string, unknown>;
      expect(evidence.totalNodesDetected).toBe(5);
      expect(evidence.nodesTruncated).toBe(false);

      const nodes = evidence.nodes as Array<{ targetSelector: string }>;
      expect(nodes.length).toBe(5);
      expect(nodes.some(n => n.targetSelector.includes('#img-1'))).toBe(true);
      expect(nodes.some(n => n.targetSelector.includes('#img-5'))).toBe(true);

      // Verify button-name is separate finding on the same page
      const buttonFinding = report.findings.find(f => f.ruleId === 'a11y-button-name');
      expect(buttonFinding).toBeDefined();
    } finally {
      await managedPage.release();
    }
  });

  it('2. bounds retained nodes per violation when total violating elements exceeds maxNodesPerViolation', () => {
    const analyzer = new AccessibilityAnalyzer({
      maxNodesPerViolation: 3,
    });

    const mockNodes = Array.from({ length: 15 }, (_, i) => ({
      html: `<img id="img-${i}" src="/${i}.png">`,
      target: [`#img-${i}`],
      impact: 'critical' as const,
      failureSummary: 'Fix any of the following: Element does not have an alt attribute',
    }));

    const analysis = analyzer.analyze({
      pageUrl: 'http://audit-target.test/gallery',
      rawResults: {
        violations: [
          {
            id: 'image-alt',
            description: 'Images must have alternate text',
            help: 'Images must have alternate text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
            impact: 'critical',
            tags: ['wcag2a', 'wcag111'],
            nodes: mockNodes,
          },
        ],
        incomplete: [],
        passes: [],
        inapplicable: [],
      },
    });

    expect(analysis.limitsReached.nodesLimit).toBe(true);
    expect(analysis.violations[0].totalNodesDetected).toBe(15);
    expect(analysis.violations[0].nodesTruncated).toBe(true);
    expect(analysis.violations[0].nodes.length).toBe(3);

    const evidence = analysis.findings[0].evidence as Record<string, unknown>;
    expect(evidence.totalNodesDetected).toBe(15);
    expect(evidence.nodesTruncated).toBe(true);
    expect((evidence.nodes as unknown[]).length).toBe(3);
  });

  it('3. preserves viewport profile metadata across multiple viewport evaluation audits', () => {
    const analyzerMobile = new AccessibilityAnalyzer({
      viewportProfile: 'small-mobile',
    });
    const analyzerDesktop = new AccessibilityAnalyzer({
      viewportProfile: 'desktop',
    });

    const sampleRaw = {
      violations: [
        {
          id: 'image-alt',
          description: 'Images must have alternate text',
          help: 'Images must have alternate text',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
          impact: 'critical' as const,
          tags: ['wcag2a', 'wcag111'],
          nodes: [{ html: '<img src="/test.png">', target: ['img'] }],
        },
      ],
      incomplete: [],
      passes: [],
      inapplicable: [],
    };

    const resMobile = analyzerMobile.analyze({ pageUrl: 'http://test.com', rawResults: sampleRaw });
    const resDesktop = analyzerDesktop.analyze({
      pageUrl: 'http://test.com',
      rawResults: sampleRaw,
    });

    const mobileEvidence = resMobile.findings[0].evidence as Record<string, unknown>;
    const desktopEvidence = resDesktop.findings[0].evidence as Record<string, unknown>;

    expect(mobileEvidence.viewportProfile).toBe('small-mobile');
    expect(desktopEvidence.viewportProfile).toBe('desktop');
  });
});
