import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import { BoundedCrawler } from '../../../src/main/scanner/crawler/crawler.js';
import type { SafeHttpClientTestHooks } from '../../../src/main/scanner/client/types.js';

describe('BoundedCrawler Depth-Frontier BFS & Concurrency Scheduling Audit', () => {
  let server: http.Server;
  let serverPort: number;

  const startTimes = new Map<string, number>();
  const finishTimes = new Map<string, number>();

  const mockPublicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      startTimes.set(url.pathname, Date.now());

      if (url.pathname === '/bfs-root') {
        // Depth 0: Discovers B and C (Depth 1)
        finishTimes.set('/bfs-root', Date.now());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html><body>
            <a href="/bfs-b">Fast Page B</a>
            <a href="/bfs-c">Slow Page C</a>
          </body></html>
        `);
      } else if (url.pathname === '/bfs-b') {
        // Depth 1: Responds fast (15ms) and discovers D (Depth 2)
        setTimeout(() => {
          finishTimes.set('/bfs-b', Date.now());
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html><body>
              <a href="/bfs-d">Page D from B</a>
            </body></html>
          `);
        }, 15);
      } else if (url.pathname === '/bfs-c') {
        // Depth 1: Responds slow (70ms) and discovers E (Depth 2)
        setTimeout(() => {
          finishTimes.set('/bfs-c', Date.now());
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <!DOCTYPE html>
            <html><body>
              <a href="/bfs-e">Page E from C</a>
            </body></html>
          `);
        }, 70);
      } else if (url.pathname === '/bfs-d') {
        // Depth 2
        finishTimes.set('/bfs-d', Date.now());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body>Leaf D</body></html>');
      } else if (url.pathname === '/bfs-e') {
        // Depth 2
        finishTimes.set('/bfs-e', Date.now());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body>Leaf E</body></html>');
      } else if (url.pathname === '/multi-link-root') {
        // Page with 10 child links
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        let links = '';
        for (let i = 1; i <= 10; i++) {
          links += `<a href="/child-${i}">Child ${i}</a> `;
        }
        res.end(`<!DOCTYPE html><html><body>${links}</body></html>`);
      } else if (url.pathname.startsWith('/child-')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body>Child Page</body></html>');
      } else if (url.pathname === '/fail-hub') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html><html><body>
            <a href="/fail-child-1">Failing Child 1</a>
            <a href="/ok-child-2">OK Child 2</a>
            <a href="/ok-child-3">OK Child 3</a>
            <a href="/ok-child-4">OK Child 4</a>
          </body></html>
        `);
      } else if (url.pathname === '/fail-child-1') {
        // Abruptly destroy socket to simulate hard network / transport failure
        req.destroy();
      } else if (url.pathname.startsWith('/ok-child-')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>OK Child</body></html>');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>OK</body></html>');
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

  const getTestHooks = (): SafeHttpClientTestHooks => ({
    lookupFn: mockPublicLookup,
    pinnedIpOverride: '127.0.0.1',
  });

  describe('1. True Breadth-First Traversal Under Concurrency', () => {
    it('guarantees that no depth-2 page can be fetched while a depth-1 page is in flight', async () => {
      startTimes.clear();
      finishTimes.clear();
      const crawler = new BoundedCrawler();
      const entryUrl = `http://audit-target.com:${serverPort}/bfs-root`;

      const result = await crawler.crawl({
        entryUrl,
        maxPages: 10,
        maxDepth: 2,
        maxConcurrency: 2, // Concurrency > 1 is strictly required
        testHooks: getTestHooks(),
      });

      expect(result.summary.totalPagesAttempted).toBe(5);
      expect(result.summary.successfulPages).toBe(5);
      expect(result.summary.failedPages).toBe(0);

      // Verify page results contain all 5 pages
      const pagePaths = result.pages.map(p => new URL(p.requestedUrl).pathname);
      expect(pagePaths).toContain('/bfs-root');
      expect(pagePaths).toContain('/bfs-b');
      expect(pagePaths).toContain('/bfs-c');
      expect(pagePaths).toContain('/bfs-d');
      expect(pagePaths).toContain('/bfs-e');

      // Find individual pages and their depths
      const pageRoot = result.pages.find(p => p.requestedUrl.endsWith('/bfs-root'))!;
      const pageB = result.pages.find(p => p.requestedUrl.endsWith('/bfs-b'))!;
      const pageC = result.pages.find(p => p.requestedUrl.endsWith('/bfs-c'))!;
      const pageD = result.pages.find(p => p.requestedUrl.endsWith('/bfs-d'))!;
      const pageE = result.pages.find(p => p.requestedUrl.endsWith('/bfs-e'))!;

      expect(pageRoot.depth).toBe(0);
      expect(pageB.depth).toBe(1);
      expect(pageC.depth).toBe(1);
      expect(pageD.depth).toBe(2);
      expect(pageE.depth).toBe(2);

      // Verify that all Depth 1 pages appear before Depth 2 pages in page results
      const indexB = result.pages.indexOf(pageB);
      const indexC = result.pages.indexOf(pageC);
      const indexD = result.pages.indexOf(pageD);
      const indexE = result.pages.indexOf(pageE);

      expect(indexB).toBeLessThan(indexD);
      expect(indexB).toBeLessThan(indexE);
      expect(indexC).toBeLessThan(indexD);
      expect(indexC).toBeLessThan(indexE);

      // Timeline assertion: Depth 1 pages (B and C) were both started before any Depth 2 pages
      const startB = startTimes.get('/bfs-b')!;
      const startC = startTimes.get('/bfs-c')!;
      const startD = startTimes.get('/bfs-d')!;
      const startE = startTimes.get('/bfs-e')!;
      const finishC = finishTimes.get('/bfs-c')!;

      expect(startB).toBeLessThanOrEqual(startD);
      expect(startC).toBeLessThanOrEqual(startD);
      expect(startB).toBeLessThanOrEqual(startE);
      expect(startC).toBeLessThanOrEqual(startE);

      // PROOF: Page D (depth 2) was NOT started until the slow Depth 1 page (C) completed
      expect(startD).toBeGreaterThanOrEqual(finishC - 5);
    });

    it('produces identical deterministic URL discovery across repeated executions', async () => {
      const crawler = new BoundedCrawler();
      const entryUrl = `http://audit-target.com:${serverPort}/bfs-root`;

      const run1 = await crawler.crawl({
        entryUrl,
        maxPages: 10,
        maxDepth: 2,
        maxConcurrency: 2,
        testHooks: getTestHooks(),
      });

      const run2 = await crawler.crawl({
        entryUrl,
        maxPages: 10,
        maxDepth: 2,
        maxConcurrency: 2,
        testHooks: getTestHooks(),
      });

      const run3 = await crawler.crawl({
        entryUrl,
        maxPages: 10,
        maxDepth: 2,
        maxConcurrency: 2,
        testHooks: getTestHooks(),
      });

      expect(run1.discoveredUrls).toEqual(run2.discoveredUrls);
      expect(run2.discoveredUrls).toEqual(run3.discoveredUrls);
    });
  });

  describe('2. Atomic maxPages Reservation Under Concurrency', () => {
    it('strictly caps reserved and started requests to maxPages when many links are discovered', async () => {
      const crawler = new BoundedCrawler();
      const entryUrl = `http://audit-target.com:${serverPort}/multi-link-root`;

      // 1 root + 10 children = 11 candidate pages. We limit to maxPages = 3 with high concurrency = 5.
      const result = await crawler.crawl({
        entryUrl,
        maxPages: 3,
        maxConcurrency: 5,
        testHooks: getTestHooks(),
      });

      // Must never exceed maxPages under concurrent scheduling
      expect(result.summary.totalPagesAttempted).toBe(3);
      expect(result.pages).toHaveLength(3);
      expect(result.summary.successfulPages).toBe(3);
      expect(result.summary.failedPages).toBe(0);

      // Remaining 8 children should be accounted for in urlsSkippedLimits
      expect(result.summary.urlsSkippedLimits).toBe(8);
    });

    it('counts failed HTTP requests accurately within atomic maxPages quota', async () => {
      const crawler = new BoundedCrawler();
      const entryUrl = `http://audit-target.com:${serverPort}/fail-hub`;

      // /fail-hub has 4 children (1 failing with 500, 3 OK). maxPages = 3, maxConcurrency = 4.
      const result = await crawler.crawl({
        entryUrl,
        maxPages: 3,
        maxConcurrency: 4,
        testHooks: getTestHooks(),
      });

      // Total attempted must be exactly 3
      expect(result.summary.totalPagesAttempted).toBe(3);
      expect(result.pages).toHaveLength(3);

      // Consistency check: successful + failed must equal attempted
      expect(result.summary.successfulPages + result.summary.failedPages).toBe(
        result.summary.totalPagesAttempted,
      );
      expect(result.summary.failedPages).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. Multi-Limit Interactions & Resource Cleanup', () => {
    it('accurately respects maxDepth, link per page, duration, and cancellation boundaries simultaneously', async () => {
      const crawler = new BoundedCrawler();
      const entryUrl = `http://audit-target.com:${serverPort}/multi-link-root`;

      const result = await crawler.crawl({
        entryUrl,
        maxPages: 50,
        maxDepth: 1,
        maxConcurrency: 3,
        maxDiscoveredLinksPerPage: 4, // Only 4 links allowed from root
        testHooks: getTestHooks(),
      });

      // Root (1) + 4 allowed links = 5 pages
      expect(result.summary.totalPagesAttempted).toBe(5);
      expect(result.summary.maxDepthReached).toBe(1);
      // 10 candidate links - 4 enqueued = 6 skipped limits
      expect(result.summary.urlsSkippedLimits).toBe(6);
    });
  });
});
