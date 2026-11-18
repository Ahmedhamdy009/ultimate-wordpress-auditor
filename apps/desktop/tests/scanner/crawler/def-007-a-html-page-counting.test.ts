import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import type { SafeHttpClientTestHooks } from '../../../src/main/scanner/client/types.js';
import { DatabaseConnection } from '../../../src/main/db/connection.js';
import { MigrationRunner } from '../../../src/main/db/migrations/runner.js';
import { ProjectRepository } from '../../../src/main/db/repositories/project.repository.js';
import { SiteRepository } from '../../../src/main/db/repositories/site.repository.js';
import { ScanRunRepository } from '../../../src/main/db/repositories/scan-run.repository.js';
import { FindingRepository } from '../../../src/main/db/repositories/finding.repository.js';
import { ScanOrchestrator } from '../../../src/main/scanner/orchestrator/orchestrator.js';
import { evaluateD1CrawlCoverage, evaluateAuditCoverage } from '@auditor/shared';

describe('DEF-007-A: Successful HTML Page Counting & Resource Classification', () => {
  let server: http.Server;
  let serverPort: number;
  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  const getTestHooks = (): SafeHttpClientTestHooks => ({
    lookupFn: mockPublicLookup,
    pinnedIpOverride: '127.0.0.1',
  });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      switch (url.pathname) {
        case '/html-ok':
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<!DOCTYPE html><html><head><title>Valid HTML</title></head><body><h1>OK</h1></body></html>',
          );
          break;
        case '/xhtml-ok':
          res.writeHead(200, { 'Content-Type': 'application/xhtml+xml; charset=utf-8' });
          res.end(
            '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>XHTML</title></head><body><h1>XHTML OK</h1></body></html>',
          );
          break;
        case '/image.png':
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
          break;
        case '/style.css':
          res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
          res.end('body { margin: 0; color: #111; }');
          break;
        case '/app.js':
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end('console.log("loaded");');
          break;
        case '/guide.pdf':
          res.writeHead(200, { 'Content-Type': 'application/pdf' });
          res.end('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
          break;
        case '/font.woff2':
          res.writeHead(200, { 'Content-Type': 'font/woff2' });
          res.end(Buffer.from('wOF2dummyfontbytes'));
          break;
        case '/binary.bin':
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          res.end(Buffer.from([0x00, 0x01, 0x02, 0x03]));
          break;
        case '/missing-ct':
          res.writeHead(200);
          res.end('<html><body>No Content-Type header</body></html>');
          break;
        case '/malformed-ct':
          res.writeHead(200, { 'Content-Type': 'text/html; brokenparam' });
          res.end('<html><body>Malformed Content-Type</body></html>');
          break;
        case '/spoofed-ct':
          res.writeHead(200, { 'Content-Type': 'application/json; note="text/html"' });
          res.end('{"note":"text/html"}');
          break;
        case '/not-found-html':
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<!DOCTYPE html><html><body><h1>404 Not Found</h1><a href="/html-ok">Home</a></body></html>',
          );
          break;
        case '/server-error-html':
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<!DOCTYPE html><html><body><h1>500 Internal Error</h1></body></html>');
          break;
        case '/redirect-to-html':
          res.writeHead(301, { Location: `http://${req.headers.host}/html-ok` });
          res.end();
          break;
        case '/redirect-to-pdf':
          res.writeHead(302, { Location: `http://${req.headers.host}/guide.pdf` });
          res.end();
          break;
        case '/duplicate-hub':
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><head><title>Dup Hub</title></head><body>
              <a href="/html-ok">Link 1</a>
              <a href="/html-ok#section1">Link 2 hash</a>
              <a href="/html-ok#section2">Link 3 hash</a>
              <a href="/duplicate-hub">Self cycle</a>
            </body></html>
          `);
          break;
        case '/mixed-site':
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><head><title>Mixed Site</title></head><body>
              <a href="/html-ok">Valid HTML</a>
              <a href="/xhtml-ok">Valid XHTML</a>
              <a href="/image.png">Image</a>
              <a href="/style.css">Stylesheet</a>
              <a href="/app.js">Script</a>
              <a href="/guide.pdf">PDF Document</a>
              <a href="/font.woff2">Font File</a>
              <a href="/binary.bin">Binary Blob</a>
              <a href="/missing-ct">Missing CT</a>
              <a href="/malformed-ct">Malformed CT</a>
              <a href="/spoofed-ct">Spoofed CT</a>
              <a href="/not-found-html">404 Page</a>
            </body></html>
          `);
          break;
        case '/clean-mixed-for-orchestrator':
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html><html><head><title>Home</title></head><body>
              <h1>Home</h1>
              <a href="/html-ok">About HTML</a>
              <a href="/guide.pdf">Brochure PDF</a>
              <a href="/image.png">Logo PNG</a>
            </body></html>
          `);
          break;
        default:
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<html><body>Default 404</body></html>');
      }
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        serverPort = address.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  it('1. counts valid 200 text/html response as 1 successful page', async () => {
    const crawler = new BoundedCrawler();
    const res = await crawler.crawl({
      entryUrl: `http://audit-target.com:${serverPort}/html-ok`,
      maxPages: 5,
      testHooks: getTestHooks(),
    });
    expect(res.summary.totalPagesAttempted).toBe(1);
    expect(res.summary.successfulPages).toBe(1);
    expect(res.summary.nonHtmlPages).toBe(0);
    expect(res.summary.failedPages).toBe(0);
    expect(res.pages[0].isHtml).toBe(true);
    expect(res.pages[0].parsedDocument).not.toBeNull();
  });

  it('2. counts valid 200 application/xhtml+xml response as 1 successful page', async () => {
    const crawler = new BoundedCrawler();
    const res = await crawler.crawl({
      entryUrl: `http://audit-target.com:${serverPort}/xhtml-ok`,
      maxPages: 5,
      testHooks: getTestHooks(),
    });
    expect(res.summary.totalPagesAttempted).toBe(1);
    expect(res.summary.successfulPages).toBe(1);
    expect(res.summary.nonHtmlPages).toBe(0);
    expect(res.summary.failedPages).toBe(0);
    expect(res.pages[0].isHtml).toBe(true);
    expect(res.pages[0].parsedDocument?.metadata.title).toBe('XHTML');
  });

  it.each([
    ['image response', '/image.png'],
    ['CSS response', '/style.css'],
    ['JavaScript response', '/app.js'],
    ['PDF response', '/guide.pdf'],
    ['font response', '/font.woff2'],
    ['unsupported binary response', '/binary.bin'],
    ['missing Content-Type', '/missing-ct'],
    ['malformed Content-Type', '/malformed-ct'],
    ['spoofed/ambiguous Content-Type containing text/html in parameter', '/spoofed-ct'],
  ])('3. does NOT count %s (%s) in successfulPages', async (_label, pathName) => {
    const crawler = new BoundedCrawler();
    const res = await crawler.crawl({
      entryUrl: `http://audit-target.com:${serverPort}${pathName}`,
      maxPages: 5,
      testHooks: getTestHooks(),
    });
    expect(res.summary.totalPagesAttempted).toBe(1);
    expect(res.summary.successfulPages).toBe(0);
    expect(res.summary.nonHtmlPages).toBe(1);
    expect(res.summary.failedPages).toBe(0);
    expect(res.pages[0].isHtml).toBe(false);
    expect(res.pages[0].parsedDocument).toBeNull();
  });

  it.each([
    ['HTTP 404 HTML response', '/not-found-html', 404],
    ['HTTP 500 HTML response', '/server-error-html', 500],
  ])('4. does NOT count failed %s in successfulPages', async (_label, pathName, expectedStatus) => {
    const crawler = new BoundedCrawler();
    const res = await crawler.crawl({
      entryUrl: `http://audit-target.com:${serverPort}${pathName}`,
      maxPages: 5,
      testHooks: getTestHooks(),
    });
    expect(res.summary.totalPagesAttempted).toBe(1);
    expect(res.summary.successfulPages).toBe(0);
    expect(res.summary.failedPages).toBe(1);
    expect(res.pages[0].statusCode).toBe(expectedStatus);
    // Do not crawl links discovered on failed error pages
    expect(res.summary.totalPagesAttempted).toBe(1);
  });

  it('5. counts redirect ending in HTML as 1 successful page and redirect ending in PDF as non-HTML', async () => {
    const crawler = new BoundedCrawler();

    const htmlRedirectRes = await crawler.crawl({
      entryUrl: `http://audit-target.com:${serverPort}/redirect-to-html`,
      maxPages: 5,
      testHooks: getTestHooks(),
    });
    expect(htmlRedirectRes.summary.successfulPages).toBe(1);
    expect(htmlRedirectRes.summary.nonHtmlPages).toBe(0);
    expect(htmlRedirectRes.pages[0].isHtml).toBe(true);
    expect(htmlRedirectRes.pages[0].finalUrl).toContain('/html-ok');

    const pdfRedirectRes = await crawler.crawl({
      entryUrl: `http://audit-target.com:${serverPort}/redirect-to-pdf`,
      maxPages: 5,
      testHooks: getTestHooks(),
    });
    expect(pdfRedirectRes.summary.successfulPages).toBe(0);
    expect(pdfRedirectRes.summary.nonHtmlPages).toBe(1);
    expect(pdfRedirectRes.pages[0].isHtml).toBe(false);
    expect(pdfRedirectRes.pages[0].finalUrl).toContain('/guide.pdf');
  });

  it('6. deduplicates duplicate HTML URLs and cycle links accurately', async () => {
    const crawler = new BoundedCrawler();
    const res = await crawler.crawl({
      entryUrl: `http://audit-target.com:${serverPort}/duplicate-hub`,
      maxPages: 10,
      maxDepth: 2,
      testHooks: getTestHooks(),
    });
    // Only /duplicate-hub and /html-ok should be crawled once each
    expect(res.summary.totalPagesAttempted).toBe(2);
    expect(res.summary.successfulPages).toBe(2);
    expect(res.summary.nonHtmlPages).toBe(0);
    expect(res.summary.failedPages).toBe(0);
  });

  it('7. accurately classifies mixed HTML, non-HTML, malformed CT, and failed HTTP pages in one crawl', async () => {
    const crawler = new BoundedCrawler();
    const res = await crawler.crawl({
      entryUrl: `http://audit-target.com:${serverPort}/mixed-site`,
      maxPages: 25,
      maxDepth: 2,
      maxConcurrency: 3,
      testHooks: getTestHooks(),
    });

    // 13 total URLs attempted:
    // - 3 successful HTML pages: /mixed-site, /html-ok, /xhtml-ok
    // - 9 non-HTML/invalid CT responses: image.png, style.css, app.js, guide.pdf, font.woff2, binary.bin, missing-ct, malformed-ct, spoofed-ct
    // - 1 failed HTTP response: /not-found-html (404)
    expect(res.summary.totalPagesAttempted).toBe(13);
    expect(res.summary.successfulPages).toBe(3);
    expect(res.summary.nonHtmlPages).toBe(9);
    expect(res.summary.failedPages).toBe(1);
    expect(res.summary.successfulPages + res.summary.nonHtmlPages + res.summary.failedPages).toBe(
      res.summary.totalPagesAttempted,
    );
  });

  describe('8. End-to-End Orchestrator, Coverage & Health Consistency', () => {
    let connection: DatabaseConnection;
    let projectRepo: ProjectRepository;
    let siteRepo: SiteRepository;
    let scanRunRepo: ScanRunRepository;
    let findingRepo: FindingRepository;
    let orchestrator: ScanOrchestrator;

    beforeEach(async () => {
      connection = new DatabaseConnection(':memory:', { isMemory: true });
      connection.open();
      await new MigrationRunner(connection).migrate();
      projectRepo = new ProjectRepository(connection);
      siteRepo = new SiteRepository(connection);
      scanRunRepo = new ScanRunRepository(connection);
      findingRepo = new FindingRepository(connection);
    });

    afterEach(() => {
      if (orchestrator) {
        orchestrator.dispose();
      }
      if (connection?.isOpen()) {
        connection.close();
      }
    });

    it('propagates corrected HTML-only pagesScanned and nonHtmlPages into summary_json and exact D1 coverage', async () => {
      const project = projectRepo.create({ name: 'DEF-007-A Project' });
      const site = siteRepo.create({
        projectId: project.id,
        name: 'Mixed Assets Site',
        baseUrl: `http://audit-target.com:${serverPort}/clean-mixed-for-orchestrator`,
      });

      const browserVisited: string[] = [];
      orchestrator = new ScanOrchestrator(scanRunRepo, siteRepo, findingRepo, {
        testHooks: getTestHooks(),
        browserManagerFactory: () =>
          ({
            launch: async () => {},
            close: async () => {},
            acquirePage: async () => ({
              page: {
                goto: async (u: string) => {
                  browserVisited.push(u);
                },
                url: () => browserVisited[browserVisited.length - 1] ?? '',
                setViewportSize: async () => {},
                evaluate: async () => ({}),
                content: async () => '<html><body></body></html>',
                title: async () => 'Page',
                isClosed: () => false,
                on: () => {},
                off: () => {},
                close: async () => {},
              },
              release: async () => {},
            }),
          }) as unknown as import('../../../src/main/browser/manager.js').BrowserManager,
        visualAuditorFactory: (mgr, _opts) =>
          ({
            auditUrl: async (targetUrl: string) => {
              const p = await mgr.acquirePage({ viewport: { width: 1440, height: 900 } });
              await p.page.goto(targetUrl);
              await p.release();
              return {
                targetUrl,
                profilesEvaluated: 1,
                totalFindings: 0,
                findings: [],
                viewportResults: [
                  {
                    viewport: {
                      id: 'desktop',
                      name: 'Desktop',
                      width: 1440,
                      height: 900,
                      deviceScaleFactor: 1,
                    },
                    targetUrl,
                    responsiveMetrics: { horizontalOverflowPx: 0 },
                    layoutStabilityMetrics: { clsScore: 0 },
                    layoutShiftEvents: [],
                    overflowingElements: [],
                    screenshots: [],
                    findings: [],
                    durationMs: 10,
                  },
                ],
                totalScreenshots: 0,
                totalScreenshotStorageBytes: 0,
                startedAt: Date.now(),
                completedAt: Date.now(),
                durationMs: 10,
                limitsReached: {
                  profilesLimit: false,
                  elementsLimit: false,
                  shiftEventsLimit: false,
                  screenshotCountLimit: false,
                  screenshotStorageLimit: false,
                },
              };
            },
            getProfiles: () => [
              { id: 'desktop', name: 'Desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
            ],
            getScreenshotManager: () => ({
              getScreenshotsCount: () => 0,
              getTotalStoredBytes: () => 0,
            }),
          }) as unknown as import('../../../src/main/browser/visual-auditor.js').VisualAuditor,
      });

      const run = await orchestrator.startScan({
        siteId: site.id,
        scanType: 'full',
        config: {
          maxPages: 10,
          maxDepth: 2,
          enableBrowserAudit: true,
          viewportProfiles: ['desktop'],
          auditModules: {
            http: true,
            seo: true,
            securityHeaders: false,
            cookies: false,
            wordpress: false,
            accessibility: false,
            responsiveLayout: true,
            layoutStability: false,
            runtimeErrors: false,
            networkResources: false,
            screenshots: false,
          },
        },
      });

      expect(run.status).toBe('completed');
      // 4 total attempted (/clean-mixed-for-orchestrator, /html-ok, /guide.pdf, /image.png)
      // Only 2 HTML pages (/clean-mixed-for-orchestrator and /html-ok) should be counted as pagesScanned!
      expect(run.summary?.urlsCrawled).toBe(4);
      expect(run.summary?.pagesScanned).toBe(2);
      expect(run.summary?.nonHtmlPages).toBe(2);
      expect(run.summary?.crawlFailedPages).toBe(0);

      // Browser auditor should ONLY audit the 2 HTML pages, NOT the PDF or PNG!
      expect(browserVisited).toHaveLength(2);
      expect(browserVisited.every(u => !u.endsWith('.pdf') && !u.endsWith('.png'))).toBe(true);

      // Coverage evaluation: D1 must be 'exact' with ratio 1.0 (2/2 HTML pages succeeded), NOT penalized for PDF/PNG!
      const d1 = evaluateD1CrawlCoverage({
        summary: run.summary as unknown as Record<string, unknown>,
        scanStatus: run.status,
      });
      expect(d1.status).toBe('exact');
      expect(d1.ratio).toBe(1);
      expect(d1.coverageApproximated).toBe(false);

      const coverage = evaluateAuditCoverage({
        scanType: run.scanType,
        scanStatus: run.status,
        config: run.config,
        summary: run.summary as unknown as Record<string, unknown>,
        findings: findingRepo.getAllByScanRunId(run.id),
      });
      expect(coverage.auditCoverage).toBe(100);
      expect(coverage.coverageStatus).toBe('full');
      expect(coverage.coverageApproximated).toBe(false);
    });
  });
});
